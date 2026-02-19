import { type FastifyInstance } from 'fastify';
import { checkPublicRateLimit } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/auth.js';
import type { AgentIndexer } from '../indexer/AgentIndexer.js';
import type { GameArchive } from '../indexer/GameArchive.js';
import type { WebhookRegistry } from '../indexer/WebhookRegistry.js';
import type { ErrorStore } from '../indexer/ErrorStore.js';
import { z } from 'zod';

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

const LogSchema = z.object({
  level: z.enum(['error', 'warn', 'info']),
  message: z.string().min(1).max(2000),
  context: z.record(z.unknown()).optional(),
});

export function registerAgentRoutes(app: FastifyInstance, agentIndexer: AgentIndexer, gameArchive: GameArchive, webhookRegistry: WebhookRegistry, errorStore: ErrorStore) {
  // GET /api/agents - List all indexed agents sorted by computed rating
  app.get('/api/agents', async (request, reply) => {
    if (!checkPublicRateLimit(request)) return reply.status(429).send({ error: 'Rate limited' });

    if (!agentIndexer.isReady()) {
      return reply.send({
        agents: [],
        total: 0,
        ready: false,
        message: 'Agent index is still initializing. Please try again in a moment.',
      });
    }

    const agents = agentIndexer.getAll();
    return reply.send({
      agents,
      total: agents.length,
      ready: true,
    });
  });

  // GET /api/agents/:wallet - Get single agent profile
  app.get('/api/agents/:wallet', async (request, reply) => {
    if (!checkPublicRateLimit(request)) return reply.status(429).send({ error: 'Rate limited' });

    const { wallet } = request.params as { wallet: string };

    if (!ADDRESS_REGEX.test(wallet)) {
      return reply.status(400).send({ error: 'Invalid wallet address' });
    }

    const agent = agentIndexer.get(wallet);
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    return reply.send(agent);
  });

  // GET /api/referral-leaderboard - Top referrers ranked by count
  app.get('/api/referral-leaderboard', async (request, reply) => {
    if (!checkPublicRateLimit(request)) return reply.status(429).send({ error: 'Rate limited' });

    if (!agentIndexer.isReady()) {
      return reply.send([]);
    }

    const agents = agentIndexer.getAll();
    const leaderboard = agents
      .filter(a => a.referralCount > 0)
      .sort((a, b) => b.referralCount - a.referralCount || b.referralEarnings - a.referralEarnings)
      .slice(0, 50)
      .map(a => ({
        wallet: a.wallet,
        name: a.name,
        referralCount: a.referralCount,
        totalEarnings: a.referralEarnings.toFixed(2),
        tier: a.referralCount >= 25 ? 'Gold' : a.referralCount >= 10 ? 'Silver' : 'Bronze',
      }));
    return reply.send(leaderboard);
  });

  // GET /api/agents/:wallet/games - Get game history for an agent
  app.get('/api/agents/:wallet/games', async (request, reply) => {
    if (!checkPublicRateLimit(request)) return reply.status(429).send({ error: 'Rate limited' });

    const { wallet } = request.params as { wallet: string };

    if (!ADDRESS_REGEX.test(wallet)) {
      return reply.status(400).send({ error: 'Invalid wallet address' });
    }

    const games = gameArchive.getByWallet(wallet);
    return reply.send({
      games: games.map(g => ({
        gameId: g.gameId,
        tournamentId: g.tournamentId,
        round: g.round,
        gameIndex: g.gameIndex,
        white: g.white,
        black: g.black,
        result: g.result,
        moveCount: g.moveCount,
        archivedAt: g.archivedAt,
      })),
      total: games.length,
    });
  });

  // ── Agent Error Logging (authenticated) ──────────────────────────

  // POST /api/agent/log — Submit error/warn/info log
  app.post('/api/agent/log', { preHandler: [requireAuth] }, async (request, reply) => {
    const wallet = request.wallet;
    if (!wallet) return reply.status(401).send({ error: 'Not authenticated' });

    try {
      const body = LogSchema.parse(request.body);
      const entry = errorStore.add(wallet, body.level, body.message, body.context);
      return reply.send({ ok: true, id: entry.id });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid log data', details: err.issues });
      }
      return reply.status(400).send({ error: 'Invalid log data' });
    }
  });

  // GET /api/admin/errors — Query error logs (public, admin use)
  app.get('/api/admin/errors', async (request, reply) => {
    if (!checkPublicRateLimit(request)) return reply.status(429).send({ error: 'Rate limited' });

    const query = request.query as { wallet?: string; level?: string; limit?: string };
    const entries = errorStore.query({
      wallet: query.wallet,
      level: query.level,
      limit: query.limit ? parseInt(query.limit) : 100,
    });

    return reply.send({ entries, total: errorStore.size });
  });

  // ── Webhook Registration (authenticated) ──────────────────────────

  // POST /api/agents/webhook — Register a webhook URL for tournament notifications
  app.post('/api/agents/webhook', { preHandler: [requireAuth] }, async (request, reply) => {
    const wallet = request.wallet;
    if (!wallet) return reply.status(401).send({ error: 'Not authenticated' });

    const { url } = request.body as { url?: string };
    if (!url || typeof url !== 'string') {
      return reply.status(400).send({ error: 'Missing url field' });
    }

    const result = webhookRegistry.register(wallet, url);
    if (!result.ok) {
      return reply.status(400).send({ error: result.error });
    }

    return reply.send({ ok: true, message: 'Webhook registered. You will receive POST notifications for new tournaments.' });
  });

  // DELETE /api/agents/webhook — Remove your webhook
  app.delete('/api/agents/webhook', { preHandler: [requireAuth] }, async (request, reply) => {
    const wallet = request.wallet;
    if (!wallet) return reply.status(401).send({ error: 'Not authenticated' });

    const removed = webhookRegistry.unregister(wallet);
    return reply.send({ ok: true, removed });
  });

  // GET /api/agents/webhook — Check your webhook status
  app.get('/api/agents/webhook', { preHandler: [requireAuth] }, async (request, reply) => {
    const wallet = request.wallet;
    if (!wallet) return reply.status(401).send({ error: 'Not authenticated' });

    const entry = webhookRegistry.get(wallet);
    if (!entry) {
      return reply.send({ registered: false });
    }

    return reply.send({
      registered: true,
      url: entry.url,
      registeredAt: entry.registeredAt,
      deliveries: entry.deliveries,
      failures: entry.failures,
      lastDeliveryAt: entry.lastDeliveryAt,
    });
  });
}
