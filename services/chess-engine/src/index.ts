import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { GameManager } from './engine/GameManager.js';
import { registerGameRoutes } from './api/routes/game.routes.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '127.0.0.1'; // Default to loopback (not 0.0.0.0)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3002').split(',').map(s => s.trim());

async function main() {
  const app = Fastify({ logger: true, bodyLimit: 8192 }); // Limit body size
  await app.register(cors, { origin: ALLOWED_ORIGINS }); // Locked-down CORS

  const httpServer = createServer(app.server);
  const io = new Server(httpServer, {
    cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'] },
    maxHttpBufferSize: 1e6, // 1MB max
    connectTimeout: 10_000,
  });
  const gameManager = new GameManager();

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
  await app.listen({ port: PORT, host: HOST });
  console.log(`Chess engine service running on ${HOST}:${PORT}`);
}

main().catch(console.error);
