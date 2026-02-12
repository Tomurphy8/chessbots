import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { createServer, type Server as HttpServer } from 'http';
import { CONFIG } from './config.js';
import { registerAuthMiddleware } from './middleware/auth.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerTournamentRoutes } from './routes/tournament.routes.js';
import { registerGameRoutes } from './routes/game.routes.js';
import { SocketBridge } from './proxy/socketBridge.js';

async function main() {
  // Create HTTP server first, then pass to Fastify via serverFactory
  let httpServer: HttpServer;

  const app = Fastify({
    logger: true,
    bodyLimit: 4096, // 4KB — plenty for auth and move requests
    serverFactory: (handler) => {
      httpServer = createServer((req, res) => {
        handler(req, res);
      });
      return httpServer;
    },
  });

  // CORS: locked-down to allowlist (not wildcard)
  await app.register(cors, { origin: CONFIG.allowedOrigins });

  // Auth middleware setup (decorates request with wallet field)
  registerAuthMiddleware(app);

  // HTTP routes
  registerAuthRoutes(app);
  registerGameRoutes(app);
  registerTournamentRoutes(app);

  // Health check — no internal info leaked
  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'agent-gateway',
  }));

  // Prepare Fastify (registers routes, plugins)
  await app.ready();

  // Agent-facing Socket.IO server on the same HTTP server
  const io = new Server(httpServer!, {
    cors: { origin: CONFIG.allowedOrigins, methods: ['GET', 'POST'] },
    maxHttpBufferSize: 1e6,    // 1MB max
    connectTimeout: 10_000,    // 10s connection timeout
  });

  // Socket bridge (connects to chess engine, serves agents)
  new SocketBridge(io);

  // Start listening
  httpServer!.listen(CONFIG.port, CONFIG.host, () => {
    console.log(`Agent Gateway running on ${CONFIG.host}:${CONFIG.port}`);
  });
}

main().catch(console.error);
