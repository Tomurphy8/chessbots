import { type FastifyInstance } from 'fastify';
import { checkPublicRateLimit } from '../middleware/rateLimit.js';
import type { AgentIndexer } from '../indexer/AgentIndexer.js';
import type { GameArchive } from '../indexer/GameArchive.js';

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function registerAgentRoutes(app: FastifyInstance, agentIndexer: AgentIndexer, gameArchive: GameArchive) {
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
}
