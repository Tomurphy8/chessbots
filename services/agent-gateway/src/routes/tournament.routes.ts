import { type FastifyInstance } from 'fastify';
import { type PublicClient, formatUnits, parseAbiItem, type Address } from 'viem';
import { CONFIG } from '../config.js';
import { checkPublicRateLimit } from '../middleware/rateLimit.js';
import { EventScanner } from '../indexer/EventScanner.js';
import type { AgentIndexer } from '../indexer/AgentIndexer.js';

const TOURNAMENT_ABI = [
  {
    inputs: [{ name: 'tournamentId', type: 'uint256' }],
    name: 'getTournament',
    outputs: [{
      components: [
        { name: 'id', type: 'uint256' },
        { name: 'authority', type: 'address' },
        { name: 'tier', type: 'uint8' },
        { name: 'entryFee', type: 'uint256' },
        { name: 'status', type: 'uint8' },
        { name: 'maxPlayers', type: 'uint8' },
        { name: 'minPlayers', type: 'uint8' },
        { name: 'registeredCount', type: 'uint8' },
        { name: 'currentRound', type: 'uint8' },
        { name: 'totalRounds', type: 'uint8' },
        { name: 'startTime', type: 'int64' },
        { name: 'registrationDeadline', type: 'int64' },
        { name: 'baseTimeSeconds', type: 'uint32' },
        { name: 'incrementSeconds', type: 'uint32' },
        { name: 'winners', type: 'address[3]' },
        { name: 'resultsUri', type: 'string' },
        { name: 'prizeDistributed', type: 'bool' },
        { name: 'exists', type: 'bool' },
      ],
      name: '',
      type: 'tuple',
    }],
    stateMutability: 'view',
    type: 'function',
  },
  {
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
  },
  {
    inputs: [{ name: 'wallet', type: 'address' }],
    name: 'getAgent',
    outputs: [{
      components: [
        { name: 'wallet', type: 'address' },
        { name: 'name', type: 'string' },
        { name: 'metadataUri', type: 'string' },
        { name: 'agentType', type: 'uint8' },
        { name: 'eloRating', type: 'uint16' },
        { name: 'gamesPlayed', type: 'uint32' },
        { name: 'gamesWon', type: 'uint32' },
        { name: 'gamesDrawn', type: 'uint32' },
        { name: 'gamesLost', type: 'uint32' },
        { name: 'totalEarnings', type: 'uint64' },
        { name: 'registered', type: 'bool' },
      ],
      name: '',
      type: 'tuple',
    }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const TierNames = ['Rookie', 'Bronze', 'Silver', 'Masters', 'Legends'] as const;
const StatusNames = ['Registration', 'InProgress', 'RoundActive', 'RoundComplete', 'Completed', 'Cancelled'] as const;

function formatTournament(raw: any) {
  return {
    id: Number(raw.id),
    authority: raw.authority,
    tier: TierNames[raw.tier] || 'Unknown',
    entryFee: parseFloat(formatUnits(BigInt(raw.entryFee), 6)), // USDC 6 decimals — safe BigInt conversion
    status: StatusNames[raw.status] || 'Unknown',
    maxPlayers: raw.maxPlayers,
    minPlayers: raw.minPlayers,
    registeredCount: raw.registeredCount,
    currentRound: raw.currentRound,
    totalRounds: raw.totalRounds,
    startTime: Number(raw.startTime),
    registrationDeadline: Number(raw.registrationDeadline),
    baseTimeSeconds: raw.baseTimeSeconds,
    incrementSeconds: raw.incrementSeconds,
    winners: raw.winners,
    resultsUri: raw.resultsUri,
    prizeDistributed: raw.prizeDistributed,
    exists: raw.exists,
  };
}

// ABI for getRegistration (per-player standings within a tournament)
const REGISTRATION_ABI = [
  {
    inputs: [
      { name: 'tournamentId', type: 'uint256' },
      { name: 'agent', type: 'address' },
    ],
    name: 'getRegistration',
    outputs: [{
      components: [
        { name: 'agent', type: 'address' },
        { name: 'score', type: 'uint16' },
        { name: 'buchholz', type: 'uint16' },
        { name: 'gamesPlayed', type: 'uint8' },
        { name: 'gamesWon', type: 'uint8' },
        { name: 'gamesDrawn', type: 'uint8' },
        { name: 'gamesLost', type: 'uint8' },
        { name: 'finalRank', type: 'uint8' },
        { name: 'active', type: 'bool' },
        { name: 'exists', type: 'bool' },
      ],
      name: '',
      type: 'tuple',
    }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const AGENT_JOINED_EVENT = parseAbiItem(
  'event AgentJoined(uint256 indexed tournamentId, address indexed agent, uint8 registeredCount)'
);

export function registerTournamentRoutes(app: FastifyInstance, publicClient: PublicClient, agentIndexer: AgentIndexer) {
  // Shared event scanner for standings queries
  const scanner = new EventScanner(
    publicClient,
    CONFIG.contractAddress as Address,
    CONFIG.deployBlock,
  );

  // GET /api/tournaments - List recent tournaments
  app.get('/api/tournaments', async (_request, reply) => {
    if (!checkPublicRateLimit(_request)) return reply.status(429).send({ error: 'Rate limited' });
    try {
      const protocolState = await publicClient.readContract({
        address: CONFIG.contractAddress as Address,
        abi: TOURNAMENT_ABI,
        functionName: 'protocol',
      });

      const total = Number(protocolState[5]); // totalTournaments
      if (total === 0) return reply.send([]);

      // Fetch last 50 tournaments
      const start = Math.max(1, total - 49);
      const tournaments = [];
      for (let i = total; i >= start; i--) {
        try {
          const raw = await publicClient.readContract({
            address: CONFIG.contractAddress as Address,
            abi: TOURNAMENT_ABI,
            functionName: 'getTournament',
            args: [BigInt(i)],
          });
          const t = formatTournament(raw);
          if (t.exists) tournaments.push(t);
        } catch {
          // Skip tournaments that fail to load
        }
      }

      return reply.send(tournaments);
    } catch (err: any) {
      return reply.status(500).send({ error: 'Failed to read tournament data from chain' });
    }
  });

  // GET /api/tournaments/:id - Get tournament details
  app.get('/api/tournaments/:id', async (request, reply) => {
    if (!checkPublicRateLimit(request)) return reply.status(429).send({ error: 'Rate limited' });
    const { id } = request.params as { id: string };
    // Validate tournament ID is a non-negative integer (0-indexed)
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId) || parsedId < 0 || parsedId > 1_000_000 || String(parsedId) !== id) {
      return reply.status(400).send({ error: 'Invalid tournament ID' });
    }
    try {
      const raw = await publicClient.readContract({
        address: CONFIG.contractAddress as Address,
        abi: TOURNAMENT_ABI,
        functionName: 'getTournament',
        args: [BigInt(parsedId)],
      });

      const t = formatTournament(raw);
      if (!t.exists) {
        return reply.status(404).send({ error: 'Tournament not found' });
      }

      return reply.send(t);
    } catch (err: any) {
      return reply.status(500).send({ error: 'Failed to read tournament data from chain' });
    }
  });

  // GET /api/tournaments/:id/standings - Get tournament standings
  app.get('/api/tournaments/:id/standings', async (request, reply) => {
    if (!checkPublicRateLimit(request)) return reply.status(429).send({ error: 'Rate limited' });
    const { id } = request.params as { id: string };
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId) || parsedId < 0 || parsedId > 1_000_000 || String(parsedId) !== id) {
      return reply.status(400).send({ error: 'Invalid tournament ID' });
    }

    try {
      // 1. Find all players by scanning AgentJoined events for this tournament
      const logs = await scanner.scan(
        AGENT_JOINED_EVENT,
        undefined,
        undefined,
        { tournamentId: BigInt(parsedId) } as any,
      );

      const wallets = new Set<string>();
      for (const log of logs) {
        const args = (log as any).args;
        if (args?.agent) {
          wallets.add(args.agent as string);
        }
      }

      if (wallets.size === 0) {
        return reply.send({ standings: [], tournamentId: parsedId });
      }

      // 2. Fetch registration data for each wallet
      const standings: Array<{
        rank: number;
        wallet: string;
        name: string;
        score: number;
        buchholz: number;
        gamesPlayed: number;
        gamesWon: number;
        gamesDrawn: number;
        gamesLost: number;
      }> = [];

      const walletArr = [...wallets];

      // Batch in groups of 10
      for (let i = 0; i < walletArr.length; i += 10) {
        const batch = walletArr.slice(i, i + 10);

        const results = await Promise.allSettled(
          batch.map(wallet =>
            publicClient.readContract({
              address: CONFIG.contractAddress as Address,
              abi: REGISTRATION_ABI,
              functionName: 'getRegistration',
              args: [BigInt(parsedId), wallet as Address],
            })
          )
        );

        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          if (result.status === 'fulfilled' && result.value && result.value.exists) {
            const reg = result.value;
            const wallet = batch[j];

            // Get agent name from indexer or contract
            const agentInfo = agentIndexer.get(wallet);
            const name = agentInfo?.name || wallet.slice(0, 10) + '...';

            standings.push({
              rank: 0, // Will be assigned after sorting
              wallet: reg.agent,
              name,
              score: Number(reg.score),
              buchholz: Number(reg.buchholz),
              gamesPlayed: Number(reg.gamesPlayed),
              gamesWon: Number(reg.gamesWon),
              gamesDrawn: Number(reg.gamesDrawn),
              gamesLost: Number(reg.gamesLost),
            });
          }
        }
      }

      // 3. Sort by score (desc), then buchholz (desc)
      standings.sort((a, b) => b.score - a.score || b.buchholz - a.buchholz);

      // 4. Assign ranks
      standings.forEach((s, i) => { s.rank = i + 1; });

      return reply.send({ standings, tournamentId: parsedId });
    } catch (err: any) {
      console.error(`Standings error for tournament ${parsedId}:`, err.message);
      return reply.status(500).send({ error: 'Failed to fetch standings' });
    }
  });
}
