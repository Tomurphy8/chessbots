import { type FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { type PublicClient, formatUnits, type Address } from 'viem';
import { CONFIG } from '../config.js';
import { checkPublicRateLimit } from '../middleware/rateLimit.js';
import type { AgentIndexer } from '../indexer/AgentIndexer.js';
import type { TournamentWatcher } from '../indexer/TournamentWatcher.js';
import type { SocketBridge } from '../proxy/socketBridge.js';
import type { WebhookRegistry } from '../indexer/WebhookRegistry.js';

function safeKeyCheck(provided: string, expected: string): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

// V4 struct layout — must match ChessBotsTournamentV4.sol exactly
const TOURNAMENT_ABI = [
  {
    inputs: [{ name: 'tournamentId', type: 'uint256' }],
    name: 'getTournament',
    outputs: [{
      components: [
        { name: 'id', type: 'uint256' },
        { name: 'authority', type: 'address' },
        { name: 'tier', type: 'uint8' },
        { name: 'format', type: 'uint8' },
        { name: 'tournamentType', type: 'uint8' },
        { name: 'bracket', type: 'uint8' },
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
  },
  {
    inputs: [],
    name: 'protocol',
    outputs: [
      { name: 'authority', type: 'address' },
      { name: 'treasury', type: 'address' },
      { name: 'totalTournaments', type: 'uint64' },
      { name: 'totalPrizeDistributed', type: 'uint256' },
      { name: 'paused', type: 'bool' },
      { name: 'sponsoredFreeTournaments', type: 'uint16' },
      { name: 'maxFreeTournaments', type: 'uint16' },
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

const TournamentTypeNames = ['Standard', 'Satellite', 'Bounty'] as const;
const BracketNames = ['Unrated', 'ClassC', 'ClassB', 'ClassA', 'Open'] as const;

function formatTournament(raw: any) {
  return {
    id: Number(raw.id),
    authority: raw.authority,
    tier: TierNames[raw.tier] || 'Unknown',
    format: FormatNames[raw.format] || 'Swiss',
    tournamentType: TournamentTypeNames[raw.tournamentType] || 'Standard',
    bracket: BracketNames[raw.bracket] || 'Unrated',
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
    resultsUri: raw.resultsUri,
    prizeDistributed: raw.prizeDistributed,
    exists: raw.exists,
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

export function registerTournamentRoutes(
  app: FastifyInstance,
  publicClient: PublicClient,
  agentIndexer: AgentIndexer,
  tournamentWatcher: TournamentWatcher,
  getSocketBridge: () => SocketBridge | null,
  webhookRegistry: WebhookRegistry,
) {
  // Standings cache: { tournamentId -> { data, timestamp } }
  const standingsCache = new Map<number, { data: any; timestamp: number }>();
  const STANDINGS_CACHE_TTL = 30_000; // 30 seconds — keep fresh for live tournament updates

  // Dedup: if a standings fetch is already running for a tournament, share the result
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

      // Start the fetch and store the promise for dedup
      const scanPromise = (async () => {
      // 1. Find all players using AgentIndexer (in-memory) + multicall getRegistration.
      //    This replaces the old EventScanner approach which scanned ~1M blocks (30-120s).
      //    Now uses a single multicall to check all known agents' registrations (~200ms).
      const allAgents = agentIndexer.getAll();
      const candidateWallets = allAgents.map(a => a.wallet);

      if (candidateWallets.length === 0) {
        return { standings: [], tournamentId: parsedId };
      }

      // Multicall getRegistration for ALL known agents in one batch
      const regCalls = candidateWallets.map(wallet => ({
        address: CONFIG.contractAddress as Address,
        abi: REGISTRATION_ABI,
        functionName: 'getRegistration' as const,
        args: [BigInt(parsedId), wallet as Address] as const,
      }));

      const regResults = await publicClient.multicall({
        contracts: regCalls,
        allowFailure: true,
      });

      // 2. Build standings from successful registrations
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

      for (let i = 0; i < regResults.length; i++) {
        const r = regResults[i];
        if (r.status !== 'success') continue;
        const reg = r.result as any;
        if (!reg || !reg.exists) continue;

        const wallet = candidateWallets[i];
        const agentInfo = agentIndexer.get(wallet);
        const name = agentInfo?.name || wallet.slice(0, 10) + '...';

        standings.push({
          rank: 0,
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
  // Step 1: Use TournamentWatcher's in-memory data for candidate discovery (zero-RPC).
  // Step 2: For each candidate (~1-2), do ONE chain read to get live registeredCount & status.
  // Total: 1-2 RPC calls instead of the original 21+ per request.
  app.get('/api/tournaments/open', async (_request, reply) => {
    if (!checkPublicRateLimit(_request)) return reply.status(429).send({ error: 'Rate limited' });

    const nowSec = Math.floor(Date.now() / 1000);
    const recent = tournamentWatcher.getRecentNotifications();
    const candidates = [];

    for (const n of recent) {
      // Pre-filter: only tournaments with unexpired deadlines
      if (n.registrationDeadline && nowSec < n.registrationDeadline) {
        candidates.push(n);
      }
    }

    // Enrich each candidate with live on-chain registeredCount & status
    const tournaments = [];
    for (const n of candidates) {
      let registeredCount = 0;
      let spotsRemaining = n.maxPlayers;
      try {
        const raw = await publicClient.readContract({
          address: CONFIG.contractAddress as Address,
          abi: TOURNAMENT_ABI,
          functionName: 'getTournament',
          args: [BigInt(n.tournamentId)],
        });
        // Skip if no longer in Registration status (0) or doesn't exist
        if (!raw.exists || raw.status !== 0) continue;
        // Skip if full
        if (raw.registeredCount >= raw.maxPlayers) continue;
        registeredCount = Number(raw.registeredCount);
        spotsRemaining = Number(raw.maxPlayers) - registeredCount;
      } catch {
        // RPC failed — still include with in-memory data so agents can try
        // (they'll get a revert if it's actually full)
      }

      tournaments.push({
        tournamentId: n.tournamentId,
        tier: n.tier,
        format: n.format,
        entryFee: n.entryFee,
        maxPlayers: n.maxPlayers,
        registeredCount,
        spotsRemaining,
        startTime: n.startTime,
        registrationDeadline: n.registrationDeadline,
        baseTimeSeconds: n.baseTimeSeconds,
        incrementSeconds: n.incrementSeconds,
      });
    }

    // Sort by deadline (soonest first)
    tournaments.sort((a, b) => a.registrationDeadline - b.registrationDeadline);
    return reply.send({ tournaments });
  });

  // POST /api/internal/tournament-completed — Notify agents of tournament completion + prize distribution
  app.post('/api/internal/tournament-completed', async (request, reply) => {
    const serviceKey = (request.headers as any)['x-service-key'] as string;
    if (!serviceKey || !CONFIG.serviceApiKey || !safeKeyCheck(serviceKey, CONFIG.serviceApiKey)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = request.body as {
      tournamentId: number;
      winners: Array<{ wallet: string; prize: number; place: number }>;
    };

    if (typeof body.tournamentId !== 'number' || !Array.isArray(body.winners)) {
      return reply.status(400).send({ error: 'Invalid payload' });
    }

    const notification = {
      type: 'tournament:completed' as const,
      tournamentId: body.tournamentId,
      winners: body.winners,
      timestamp: Date.now(),
    };

    // Broadcast via WebSocket to all connected agents
    getSocketBridge()?.broadcastToAllAgents('tournament:completed', notification);

    // Deliver via webhooks (cast to any — completed notification has different shape than TournamentNotification)
    webhookRegistry.deliverAll(notification as any).catch(console.error);

    console.log(`[tournament-completed] Tournament #${body.tournamentId} completed, notified ${body.winners.length} winners`);
    return reply.send({ ok: true });
  });

  // POST /api/internal/game-started — Orchestrator notifies gateway that a game has started.
  // This solves the chicken-and-egg problem: agents can't subscribe to a game room before
  // they know the gameId, but game:started fires on the engine before agents subscribe.
  // The orchestrator calls this AFTER starting each game on the chess engine.
  app.post('/api/internal/game-started', async (request, reply) => {
    const serviceKey = (request.headers as any)['x-service-key'] as string;
    if (!serviceKey || !CONFIG.serviceApiKey || !safeKeyCheck(serviceKey, CONFIG.serviceApiKey)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { games } = request.body as {
      games: Array<{ gameId: string; white: string; black: string; tournamentId?: number }>;
    };

    if (!Array.isArray(games) || games.length === 0) {
      return reply.status(400).send({ error: 'games array required' });
    }

    const bridge = getSocketBridge();
    if (!bridge) {
      return reply.status(503).send({ error: 'SocketBridge not ready' });
    }

    for (const g of games) {
      bridge.notifyGameStarted(g.gameId, g.white, g.black, g.tournamentId);
    }

    return reply.send({ ok: true, notified: games.length });
  });

  // POST /api/internal/tournament-notify — Fast-path trigger from orchestrator
  app.post('/api/internal/tournament-notify', async (request, reply) => {
    const serviceKey = (request.headers as any)['x-service-key'] as string;
    if (!serviceKey || !CONFIG.serviceApiKey || !safeKeyCheck(serviceKey, CONFIG.serviceApiKey)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { tournamentId, tournament: tournamentData } = request.body as { tournamentId: number; tournament?: any };
    if (typeof tournamentId !== 'number' || tournamentId < 0) {
      return reply.status(400).send({ error: 'Invalid tournamentId' });
    }

    await tournamentWatcher.triggerNotification(tournamentId, tournamentData);
    return reply.send({ ok: true });
  });

  // POST /api/internal/tournament-complete — Orchestrator notifies gateway of tournament winners
  app.post('/api/internal/tournament-complete', async (request, reply) => {
    const serviceKey = (request.headers as any)['x-service-key'] as string;
    if (!serviceKey || !CONFIG.serviceApiKey || !safeKeyCheck(serviceKey, CONFIG.serviceApiKey)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { tournamentId, winners } = request.body as {
      tournamentId: number;
      winners: Array<{ wallet: string; placement: number; prizeAmount: string }>;
    };

    if (typeof tournamentId !== 'number' || tournamentId < 0) {
      return reply.status(400).send({ error: 'Invalid tournamentId' });
    }
    if (!Array.isArray(winners) || winners.length === 0) {
      return reply.status(400).send({ error: 'Invalid winners array' });
    }

    const ERC20_BALANCE_ABI = [{
      inputs: [{ name: 'account', type: 'address' }],
      name: 'balanceOf',
      outputs: [{ name: '', type: 'uint256' }],
      stateMutability: 'view',
      type: 'function',
    }] as const;

    // Enrich winners with post-distribution USDC balance
    const enrichedWinners = await Promise.all(
      winners.map(async (w) => {
        let newUsdcBalance = '0';
        try {
          const raw = await publicClient.readContract({
            address: CONFIG.usdcAddress as Address,
            abi: ERC20_BALANCE_ABI,
            functionName: 'balanceOf',
            args: [w.wallet as Address],
          });
          newUsdcBalance = formatUnits(raw, 6);
        } catch { /* balance read failed, send 0 */ }
        return { ...w, newUsdcBalance };
      })
    );

    const bridge = getSocketBridge();

    // Emit targeted 'tournament:won' to each winner's wallet room
    for (const winner of enrichedWinners) {
      const notification = {
        tournamentId,
        placement: winner.placement,
        prizeAmount: winner.prizeAmount,
        newUsdcBalance: winner.newUsdcBalance,
        message: `You placed #${winner.placement} in tournament #${tournamentId} and won ${winner.prizeAmount} USDC!`,
      };
      bridge?.emitToWallet(winner.wallet, 'tournament:won', notification);
    }

    // Broadcast 'tournament:completed' to the tournament room (all subscribers)
    bridge?.broadcastToTournament(tournamentId, 'tournament:completed', {
      tournamentId,
      winners: enrichedWinners.map(w => ({
        wallet: w.wallet,
        placement: w.placement,
        prizeAmount: w.prizeAmount,
      })),
    });

    // Deliver targeted webhooks to winners
    webhookRegistry.deliverToWallets(
      enrichedWinners.map(w => w.wallet),
      'tournament:won',
      {
        tournamentId,
        winners: enrichedWinners.map(w => ({
          wallet: w.wallet,
          placement: w.placement,
          prizeAmount: w.prizeAmount,
          newUsdcBalance: w.newUsdcBalance,
        })),
      },
    ).catch(err => console.error('Failed to deliver win webhooks:', err));

    console.log(`Tournament #${tournamentId} complete: notified ${enrichedWinners.length} winners via socket + webhook`);
    return reply.send({ ok: true, notified: enrichedWinners.length });
  });
}
