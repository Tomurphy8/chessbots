import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { createServer, type Server as HttpServer } from 'http';
import { createPublicClient, http, defineChain, type Address } from 'viem';
import { CONFIG } from './config.js';
import { registerAuthMiddleware } from './middleware/auth.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerTournamentRoutes } from './routes/tournament.routes.js';
import { registerGameRoutes } from './routes/game.routes.js';
import { registerAgentRoutes } from './routes/agent.routes.js';
import { SocketBridge } from './proxy/socketBridge.js';
import { AgentIndexer } from './indexer/AgentIndexer.js';
import { GameArchive } from './indexer/GameArchive.js';

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

  // Initialize shared infrastructure
  const monad = defineChain({
    id: 143,
    name: 'Monad',
    nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [CONFIG.monadRpcUrl] } },
    blockExplorers: { default: { name: 'MonadScan', url: 'https://monadscan.com' } },
  });

  const publicClient = createPublicClient({
    chain: monad,
    transport: http(CONFIG.monadRpcUrl),
  });

  const agentIndexer = new AgentIndexer(
    publicClient,
    CONFIG.contractAddress as Address,
    CONFIG.deployBlock,
  );

  const gameArchive = new GameArchive();

  // HTTP routes
  registerAuthRoutes(app);
  registerGameRoutes(app, gameArchive);
  registerAgentRoutes(app, agentIndexer, gameArchive);
  registerTournamentRoutes(app, publicClient, agentIndexer);

  // Health check — no internal info leaked
  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'agent-gateway',
    agentIndexReady: agentIndexer.isReady(),
    archivedGames: gameArchive.size,
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

  // Start agent indexer in background (non-blocking)
  agentIndexer.initialize().catch(err => {
    console.error('AgentIndexer background init failed:', err);
  });
}

main().catch(console.error);
