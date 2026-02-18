import { type FastifyInstance } from 'fastify';
import { type PublicClient, formatUnits, parseAbiItem, type Address } from 'viem';
import { CONFIG } from '../config.js';
import { checkPublicRateLimit } from '../middleware/rateLimit.js';
import { EventScanner } from '../indexer/EventScanner.js';
import type { AgentIndexer } from '../indexer/AgentIndexer.js';
import type { TournamentWatcher } from '../indexer/TournamentWatcher.js';

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
        { name: 'format', type: 'uint8' },
        { name: 'teamSize', type: 'uint8' },
        { name: 'bestOf', type: 'uint8' },
        { name: 'challengeTarget', type: 'address' },
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

const TierNames = ['Rookie', 'Bronze', 'Silver', 'Masters', 'Legends', 'Free'] as const;
const StatusNames = ['Registration', 'InProgress', 'RoundActive', 'RoundComplete', 'Completed', 'Cancelled'] as const;
const FormatNames = ['Swiss', '1v1', 'Team', 'League'] as const;

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
    format: FormatNames[raw.format] || 'Swiss',
    teamSize: raw.teamSize || 0,
    bestOf: raw.bestOf || 0,
    challengeTarget: raw.challengeTarget || '0x0000000000000000000000000000000000000000',
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

export function registerTournamentRoutes(app: FastifyInstance, publicClient: PublicClient, agentIndexer: AgentIndexer, tournamentWatcher: TournamentWatcher) {
  // Shared event scanner for standings queries
  const scanner = new EventScanner(
    publicClient,
    CONFIG.contractAddress as Address,
    CONFIG.deployBlock,
  );

  // Standings cache: { tournamentId -> { data, timestamp } }
  const standingsCache = new Map<number, { data: any; timestamp: number }>();
  const STANDINGS_CACHE_TTL = 30_000; // 30 seconds — keep fresh for live tournament updates
  // Dedup: if a standings scan is already running for a tournament, share the result
  const pendingStandings = new Map<number, Promise<any>>();

  // Pre-warm standings cache 15s after boot for completed/active tournaments
  setTimeout(async () => {
    try {
      const protocolState = await publicClient.readContract({
        address: CONFIG.contractAddress as Address,
        abi: TOURNAMENT_ABI,
        functionName: 'protocol',
      });
      const total = Number(protocolState[5]);
      console.log(`Pre-warming standings cache for up to ${total} tournaments...`);
      for (let i = 1; i <= total; i++) {
        try {
          const raw = await publicClient.readContract({
            address: CONFIG.contractAddress as Address,
            abi: TOURNAMENT_ABI,
            functionName: 'getTournament',
            args: [BigInt(i)],
          });
          const status = StatusNames[raw.status] || 'Unknown';
          if (status === 'Completed' || status === 'RoundActive' || status === 'RoundComplete') {
            console.log(`Warming standings for tournament #${i} (${status})...`);
            // Trigger internal fetch to populate cache
            fetch(`http://127.0.0.1:${CONFIG.port}/api/tournaments/${i}/standings`).catch(() => {});
          }
        } catch { /* skip */ }
      }
    } catch (err: any) {
      console.error('Standings cache warmup failed:', err.message);
    }
  }, 15_000);

  // GET /api/tournaments - List recent tournaments
  app.get('/api/tournaments', async (_request, reply) => {
    if (!checkPublicRateLimit(_request)) return reply.status(429).send({ error: 'Rate limited' });
    try {
      const protocolState = await publicClient.readContract({
        address: CONFIG.contractAddress as Address,
        abi: TOURNAMENT_ABI,
        functionName: 'protocol',
      });

      const total = Number(protocolState[5]); // totalTournaments (count, IDs are 0-indexed)
      if (total === 0) return reply.send([]);

      // Fetch last 50 tournaments (IDs are 0-indexed: 0 to total-1)
      const start = Math.max(0, total - 50);
      const tournaments = [];
      for (let i = total - 1; i >= start; i--) {
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
      // Check cache first
      const cached = standingsCache.get(parsedId);
      if (cached && Date.now() - cached.timestamp < STANDINGS_CACHE_TTL) {
        return reply.send(cached.data);
      }

      // Dedup: if already scanning for this tournament, wait for that result
      const pending = pendingStandings.get(parsedId);
      if (pending) {
        const result = await pending;
        return reply.send(result);
      }

      // Start the scan and store the promise for dedup
      const scanPromise = (async () => {
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

      const response = { standings, tournamentId: parsedId };
      standingsCache.set(parsedId, { data: response, timestamp: Date.now() });
      return response;
      })();

      pendingStandings.set(parsedId, scanPromise);
      try {
        const result = await scanPromise;
        return reply.send(result);
      } finally {
        pendingStandings.delete(parsedId);
      }
    } catch (err: any) {
      pendingStandings.delete(parsedId);
      console.error(`Standings error for tournament ${parsedId}:`, err.message);
      return reply.status(500).send({ error: 'Failed to fetch standings' });
    }
  });

  // GET /api/tournaments/open — Registration-status tournaments for agent polling
  app.get('/api/tournaments/open', async (_request, reply) => {
    if (!checkPublicRateLimit(_request)) return reply.status(429).send({ error: 'Rate limited' });
    try {
      const protocolState = await publicClient.readContract({
        address: CONFIG.contractAddress as Address,
        abi: TOURNAMENT_ABI,
        functionName: 'protocol',
      });

      const total = Number(protocolState[5]);
      if (total === 0) return reply.send({ tournaments: [] });

      // Check last 20 tournaments for open registration
      const start = Math.max(0, total - 20);
      const tournaments = [];
      for (let i = total - 1; i >= start; i--) {
        try {
          const raw = await publicClient.readContract({
            address: CONFIG.contractAddress as Address,
            abi: TOURNAMENT_ABI,
            functionName: 'getTournament',
            args: [BigInt(i)],
          });
          if (!raw.exists || raw.status !== 0) continue; // status 0 = Registration
          const t = formatTournament(raw);
          tournaments.push({
            tournamentId: t.id,
            tier: t.tier,
            format: t.format,
            entryFee: t.entryFee,
            maxPlayers: t.maxPlayers,
            registeredCount: t.registeredCount,
            spotsRemaining: t.maxPlayers - t.registeredCount,
            startTime: t.startTime,
            registrationDeadline: t.registrationDeadline,
            baseTimeSeconds: t.baseTimeSeconds,
            incrementSeconds: t.incrementSeconds,
          });
        } catch { /* skip */ }
      }

      // Sort by deadline (soonest first)
      tournaments.sort((a, b) => a.registrationDeadline - b.registrationDeadline);

      return reply.send({ tournaments });
    } catch (err: any) {
      return reply.status(500).send({ error: 'Failed to read tournament data from chain' });
    }
  });

  // POST /api/internal/tournament-notify — Fast-path trigger from orchestrator
  app.post('/api/internal/tournament-notify', async (request, reply) => {
    const serviceKey = (request.headers as any)['x-service-key'];
    if (serviceKey !== CONFIG.serviceApiKey) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { tournamentId } = request.body as { tournamentId: number };
    if (typeof tournamentId !== 'number' || tournamentId < 0) {
      return reply.status(400).send({ error: 'Invalid tournamentId' });
    }

    await tournamentWatcher.triggerNotification(tournamentId);
    return reply.send({ ok: true });
  });
}
