import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { GameManager } from './engine/GameManager.js';
import { registerGameRoutes } from './api/routes/game.routes.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '::'; // '::' binds to both IPv4 and IPv6 (required for Railway)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3002').split(',').map(s => s.trim());

async function main() {
  // Create the HTTP server FIRST, then pass it to Fastify via serverFactory.
  // This ensures Socket.IO and Fastify share the same HTTP server.
  const httpServer = createServer();

  const app = Fastify({
    logger: true,
    bodyLimit: 8192,
    serverFactory: (handler) => {
      httpServer.on('request', handler);
      return httpServer;
    },
  });
  await app.register(cors, { origin: ALLOWED_ORIGINS }); // Locked-down CORS

  // Allow POST requests with Content-Type: application/json but empty body
  // (e.g. /api/game/:id/start doesn't need a body)
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const str = (body as string).trim();
      done(null, str ? JSON.parse(str) : {});
    } catch (err: any) {
      done(err, undefined);
    }
  });

  const io = new Server(httpServer, {
    cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'] },
    maxHttpBufferSize: 1e6, // 1MB max
    connectTimeout: 10_000,
  });
  const gameManager = new GameManager();

  // Emit game:ended via Socket.IO when a game times out (previously silent)
  gameManager.onGameTimeout = (gameId, info) => {
    io.to(`game:${gameId}`).emit('game:ended', info);
    io.to(`tournament:${info.tournamentId}`).emit('game:ended', info);
  };

  const GAME_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

  io.on('connection', (socket) => {
    // Validate room names before joining
    socket.on('join:game', (gameId: string) => {
      if (typeof gameId === 'string' && GAME_ID_REGEX.test(gameId)) {
        socket.join(`game:${gameId}`);
      }
    });
    socket.on('join:tournament', (tournamentId: string) => {
      if (typeof tournamentId === 'string' && /^\d{1,10}$/.test(tournamentId)) {
        socket.join(`tournament:${tournamentId}`);
      }
    });
    socket.on('leave:game', (gameId: string) => {
      if (typeof gameId === 'string' && GAME_ID_REGEX.test(gameId)) {
        socket.leave(`game:${gameId}`);
      }
    });
    socket.on('leave:tournament', (tournamentId: string) => {
      if (typeof tournamentId === 'string' && /^\d{1,10}$/.test(tournamentId)) {
        socket.leave(`tournament:${tournamentId}`);
      }
    });
  });

  registerGameRoutes(app, gameManager, io);
  // When using serverFactory, Fastify's listen() starts the shared httpServer
  await app.listen({ port: PORT, host: HOST });
  console.log(`Chess engine service running on ${HOST}:${PORT} (Socket.IO enabled)`);
}

main().catch(console.error);
