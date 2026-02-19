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
import { TournamentWatcher } from './indexer/TournamentWatcher.js';
import { WebhookRegistry } from './indexer/WebhookRegistry.js';
import { ErrorStore } from './indexer/ErrorStore.js';

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

  // Webhook registry — in-memory, agents register HTTPS URLs for push notifications
  const webhookRegistry = new WebhookRegistry();

  // Error store — in-memory ring buffer for agent error logs
  const errorStore = new ErrorStore();

  // Tournament watcher — created early so routes can reference it.
  // SocketBridge callback is wired below after Socket.IO is initialized.
  let socketBridge: SocketBridge | null = null;
  const tournamentWatcher = new TournamentWatcher(
    publicClient,
    CONFIG.contractAddress as Address,
    CONFIG.deployBlock,
    (notification) => {
      socketBridge?.broadcastToAllAgents('tournament:created', notification);
      webhookRegistry.deliverAll(notification).catch(console.error);
    },
  );

  // HTTP routes
  registerAuthRoutes(app, webhookRegistry);
  registerGameRoutes(app, gameArchive);
  registerAgentRoutes(app, agentIndexer, gameArchive, webhookRegistry, errorStore);
  // Late-binding proxy: socketBridge is created after app.ready(), but routes only execute at request time
  const socketBridgeProxy = {
    broadcastToAllAgents(event: string, data: any) {
      socketBridge?.broadcastToAllAgents(event, data);
    },
  };
  registerTournamentRoutes(app, publicClient, agentIndexer, tournamentWatcher, socketBridgeProxy, webhookRegistry);

  // Health check — no internal info leaked
  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'agent-gateway',
    uptime: process.uptime(),
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

  // Socket bridge (connects to chess engine, serves agents + broadcasts tournament events)
  socketBridge = new SocketBridge(io, webhookRegistry);

  // Start listening
  httpServer!.listen(CONFIG.port, CONFIG.host, () => {
    console.log(`Agent Gateway running on ${CONFIG.host}:${CONFIG.port}`);
  });

  // Start agent indexer in background (non-blocking)
  agentIndexer.initialize().catch(err => {
    console.error('AgentIndexer background init failed:', err);
  });

  // Start tournament watcher in background (non-blocking)
  tournamentWatcher.start().catch(err => {
    console.error('TournamentWatcher background init failed:', err);
  });
}

main().catch(console.error);
