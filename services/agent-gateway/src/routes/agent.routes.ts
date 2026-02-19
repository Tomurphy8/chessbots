import { type FastifyInstance } from 'fastify';
import { type PublicClient, type Address, formatUnits } from 'viem';
import { checkPublicRateLimit } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/auth.js';
import { CONFIG } from '../config.js';
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

const ERC20_BALANCE_ABI = [{
  inputs: [{ name: 'account', type: 'address' }],
  name: 'balanceOf',
  outputs: [{ name: '', type: 'uint256' }],
  stateMutability: 'view',
  type: 'function',
}] as const;

// ABI for reading on-chain game data — MUST match Game struct in ChessBotsTournamentV3.sol exactly
const GET_GAME_ABI = [{
  inputs: [
    { name: 'tournamentId', type: 'uint256' },
    { name: 'round', type: 'uint8' },
    { name: 'gameIndex', type: 'uint8' },
  ],
  name: 'getGame',
  outputs: [{
    components: [
      { name: 'tournamentId', type: 'uint256' },
      { name: 'round', type: 'uint8' },
      { name: 'gameIndex', type: 'uint8' },
      { name: 'white', type: 'address' },
      { name: 'black', type: 'address' },
      { name: 'status', type: 'uint8' },
      { name: 'result', type: 'uint8' },
      { name: 'moveCount', type: 'uint16' },
      { name: 'startedAt', type: 'int64' },
      { name: 'endedAt', type: 'int64' },
      { name: 'pgnHash', type: 'bytes32' },
      { name: 'resultHash', type: 'bytes32' },
      { name: 'arbiter', type: 'address' },
      { name: 'exists', type: 'bool' },
    ],
    name: '',
    type: 'tuple',
  }],
  stateMutability: 'view',
  type: 'function',
}] as const;

const PROTOCOL_ABI = [{
  inputs: [],
  name: 'protocol',
  outputs: [
    { name: 'authority', type: 'address' },
    { name: 'treasury', type: 'address' },
    { name: 'protocolFeeBps', type: 'uint16' },
    { name: 'buybackShareBps', type: 'uint16' },
    { name: 'treasuryShareBps', type: 'uint16' },
    { name: 'totalTournaments', type: 'uint64' },
    { name: 'totalPrizeDistributed', type: 'uint64' },
    { name: 'paused', type: 'bool' },
  ],
  stateMutability: 'view',
  type: 'function',
}] as const;

const GET_TOURNAMENT_ABI_MINI = [{
  inputs: [{ name: 'tournamentId', type: 'uint256' }],
  name: 'getTournament',
  outputs: [{
    components: [
      { name: 'id', type: 'uint256' },
      { name: 'authority', type: 'address' },
      { name: 'tier', type: 'uint8' },
      { name: 'format', type: 'uint8' },
      { name: 'entryFee', type: 'uint256' },
      { name: 'status', type: 'uint8' },
      { name: 'maxPlayers', type: 'uint8' },
      { name: 'minPlayers', type: 'uint8' },
      { name: 'registeredCount', type: 'uint8' },
      { name: 'currentRound', type: 'uint8' },
      { name: 'totalRounds', type: 'uint8' },
      { name: 'teamSize', type: 'uint8' },
      { name: 'bestOf', type: 'uint8' },
      { name: 'startTime', type: 'int64' },
      { name: 'registrationDeadline', type: 'int64' },
      { name: 'baseTimeSeconds', type: 'uint32' },
      { name: 'incrementSeconds', type: 'uint32' },
      { name: 'winners', type: 'address[3]' },
      { name: 'resultsUri', type: 'string' },
      { name: 'prizeDistributed', type: 'bool' },
      { name: 'exists', type: 'bool' },
      { name: 'challengeTarget', type: 'address' },
    ],
    name: '',
    type: 'tuple',
  }],
  stateMutability: 'view',
  type: 'function',
}] as const;

// Engine result → standard chess notation
const RESULT_MAP: Record<number, string> = {
  0: '*',       // Undecided
  1: '1-0',     // WhiteWins
  2: '0-1',     // BlackWins
  3: '1/2-1/2', // Draw
  4: '0-1',     // WhiteForfeit
  5: '1-0',     // BlackForfeit
};

// String result → standard chess notation (for archive data)
const RESULT_STRING_MAP: Record<string, string> = {
  'white_wins': '1-0',
  'black_wins': '0-1',
  'draw': '1/2-1/2',
  'white_forfeit': '0-1',
  'black_forfeit': '1-0',
};

export function registerAgentRoutes(app: FastifyInstance, agentIndexer: AgentIndexer, gameArchive: GameArchive, webhookRegistry: WebhookRegistry, errorStore: ErrorStore, publicClient: PublicClient) {
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
  // Tries the in-memory archive first, falls back to on-chain game data.
  app.get('/api/agents/:wallet/games', async (request, reply) => {
    if (!checkPublicRateLimit(request)) return reply.status(429).send({ error: 'Rate limited' });

    const { wallet } = request.params as { wallet: string };

    if (!ADDRESS_REGEX.test(wallet)) {
      return reply.status(400).send({ error: 'Invalid wallet address' });
    }

    // Fast path: use archive if populated
    const archived = gameArchive.getByWallet(wallet);
    if (archived.length > 0) {
      return reply.send({
        games: archived.map(g => ({
          gameId: g.gameId,
          tournamentId: g.tournamentId,
          round: g.round,
          gameIndex: g.gameIndex,
          white: g.white,
          black: g.black,
          result: RESULT_STRING_MAP[g.result] || g.result,
          moveCount: g.moveCount,
          archivedAt: g.archivedAt,
        })),
        total: archived.length,
      });
    }

    // Fallback: read game data directly from chain
    // Scan recent tournaments (last 20) and read getGame() for each round/gameIndex
    try {
      const contract = CONFIG.contractAddress as Address;
      const proto = await publicClient.readContract({
        address: contract, abi: PROTOCOL_ABI, functionName: 'protocol',
      });
      const totalTournaments = Number(proto[5]);
      if (totalTournaments === 0) return reply.send({ games: [], total: 0 });

      const start = Math.max(0, totalTournaments - 20);
      const w = wallet.toLowerCase();
      const games: any[] = [];

      // Read tournament metadata for recent tournaments (multicall-friendly)
      const tournamentCalls = [];
      for (let id = totalTournaments - 1; id >= start; id--) {
        tournamentCalls.push({
          address: contract,
          abi: GET_TOURNAMENT_ABI_MINI,
          functionName: 'getTournament' as const,
          args: [BigInt(id)] as const,
        });
      }

      const tournamentResults = await publicClient.multicall({
        contracts: tournamentCalls,
        allowFailure: true,
      });

      // For completed/active tournaments, read all games to find this wallet
      const gameCalls: Array<{ address: Address; abi: typeof GET_GAME_ABI; functionName: 'getGame'; args: readonly [bigint, number, number]; meta: { tournamentId: number; round: number; gameIndex: number } }> = [];

      for (let idx = 0; idx < tournamentResults.length; idx++) {
        const r = tournamentResults[idx];
        if (r.status !== 'success') continue;
        const t = r.result as any;
        if (!t.exists || t.status === 0) continue; // Skip Registration-only tournaments

        const tournamentId = totalTournaments - 1 - idx;
        const maxRound = t.currentRound || t.totalRounds || 0;
        const maxGames = Math.ceil(t.registeredCount / 2);

        for (let round = 1; round <= maxRound; round++) {
          for (let gi = 0; gi < maxGames; gi++) {
            gameCalls.push({
              address: contract,
              abi: GET_GAME_ABI,
              functionName: 'getGame' as const,
              args: [BigInt(tournamentId), round, gi] as const,
              meta: { tournamentId, round, gameIndex: gi },
            });
          }
        }
      }

      if (gameCalls.length > 0) {
        // Batch all game reads in one multicall
        const gameResults = await publicClient.multicall({
          contracts: gameCalls.map(c => ({
            address: c.address,
            abi: c.abi,
            functionName: c.functionName,
            args: c.args,
          })),
          allowFailure: true,
        });

        for (let i = 0; i < gameResults.length; i++) {
          const gr = gameResults[i];
          if (gr.status !== 'success') continue;
          const g = gr.result as any;
          const meta = gameCalls[i].meta;

          // Skip non-existent/unplayed games
          if (!g.exists) continue;
          const gWhite = (g.white as string).toLowerCase();
          const gBlack = (g.black as string).toLowerCase();
          if (gWhite === '0x0000000000000000000000000000000000000000') continue;
          // Check if this wallet participated
          if (gWhite !== w && gBlack !== w) continue;

          games.push({
            gameId: `t${meta.tournamentId}-r${meta.round}-g${meta.gameIndex}`,
            tournamentId: meta.tournamentId,
            round: meta.round,
            gameIndex: meta.gameIndex,
            white: g.white,
            black: g.black,
            result: RESULT_MAP[Number(g.result)] || '*',
            moveCount: Number(g.moveCount),
            archivedAt: Number(g.endedAt) * 1000 || 0,
          });
        }
      }

      // Sort newest first
      games.sort((a, b) => b.tournamentId - a.tournamentId || b.round - a.round);
      return reply.send({ games, total: games.length, source: 'chain' });
    } catch (err: any) {
      console.error(`Failed to read on-chain games for ${wallet}: ${err.message}`);
      return reply.send({ games: [], total: 0 });
    }
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

  // ── Balance Check (authenticated) ─────────────────────────────────

  // GET /api/agents/balance — Check wallet MON and USDC balances on-chain
  app.get('/api/agents/balance', { preHandler: [requireAuth] }, async (request, reply) => {
    const wallet = request.wallet;
    if (!wallet) return reply.status(401).send({ error: 'Not authenticated' });

    try {
      const [monBalance, usdcBalance] = await Promise.all([
        publicClient.getBalance({ address: wallet as Address }),
        publicClient.readContract({
          address: CONFIG.usdcAddress as Address,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [wallet as Address],
        }),
      ]);

      return reply.send({
        wallet,
        mon: formatUnits(monBalance, 18),
        usdc: formatUnits(usdcBalance as bigint, 6),
        monWei: monBalance.toString(),
        usdcRaw: (usdcBalance as bigint).toString(),
      });
    } catch (err: any) {
      console.error(`Failed to read balances for ${wallet}: ${err.message}`);
      return reply.status(500).send({ error: 'Failed to read balances from chain' });
    }
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
