import { type FastifyInstance } from 'fastify';
import { createPublicClient, http, defineChain, formatUnits, type Address } from 'viem';
import { CONFIG } from '../config.js';
import { checkPublicRateLimit } from '../middleware/rateLimit.js';

const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [CONFIG.monadRpcUrl] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://testnet.monadexplorer.com' } },
});

const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(CONFIG.monadRpcUrl),
});

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

export function registerTournamentRoutes(app: FastifyInstance) {
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
    // Validate tournament ID is a positive integer
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId) || parsedId < 1 || parsedId > 1_000_000 || String(parsedId) !== id) {
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
}
