import { type PublicClient, type Address, formatUnits, parseAbiItem } from 'viem';
import { EventScanner } from './EventScanner.js';
import { CONFIG } from '../config.js';

export interface TournamentNotification {
  tournamentId: number;
  tier: string;
  format: string;
  entryFee: number;
  maxPlayers: number;
  startTime: number;
  registrationDeadline: number;
  baseTimeSeconds: number;
  incrementSeconds: number;
  createdAt: number;
  // Prize & earning info — makes notifications actionable marketing
  prizePool: number;          // total USDC prize pool (entryFee * maxPlayers * 0.9)
  firstPrize: number;         // USDC the winner takes home
  currency: string;           // 'USDC' or 'MON'
  earningMessage: string;     // human-readable CTA e.g. "Win up to 45.00 USDC!"
  // Human-in-the-loop support — for agents that require human approval before spending
  humanApprovalPrompt: string | null;  // null = free (auto-join), string = approval prompt for paid tournaments
}

const TierNames = ['Rookie', 'Bronze', 'Silver', 'Masters', 'Legends', 'Free'] as const;
const StatusNames = ['Registration', 'InProgress', 'RoundActive', 'RoundComplete', 'Completed', 'Cancelled'] as const;
const FormatNames = ['Swiss', '1v1', 'Team', 'League'] as const;

const TOURNAMENT_CREATED_EVENT = parseAbiItem(
  'event TournamentCreated(uint256 indexed id, uint8 tier, uint8 format, uint256 entryFee, uint8 maxPlayers)'
);

// ABI for reading tournament details — same as tournament.routes.ts
const GET_TOURNAMENT_ABI = [
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
] as const;

// ── Prize calculation (mirrors contract: 10% protocol fee, rest to winners) ──

// First-place share of the 90% prize pool by format
const FIRST_PLACE_SHARE: Record<string, number> = {
  'Swiss': 0.70,   // 63% of total (70% of 90%)
  '1v1': 1.0,      // 90% of total (100% of 90%)
  'Team': 0.70,    // 63% of total
  'League': 0.50,  // 45% of total
};

function computePrizeInfo(
  entryFee: number,
  maxPlayers: number,
  format: string,
  tier: string,
  tournamentId: number,
): { prizePool: number; firstPrize: number; currency: string; earningMessage: string; humanApprovalPrompt: string | null } {
  const currency = 'USDC';

  if (entryFee === 0) {
    // Free tier — no prize pool from entry fees, no approval needed
    return {
      prizePool: 0,
      firstPrize: 0,
      currency,
      earningMessage: `Free ${format} tournament — play to climb the leaderboard and build your rating!`,
      humanApprovalPrompt: null,
    };
  }

  const grossPool = entryFee * maxPlayers;
  const prizePool = parseFloat((grossPool * 0.9).toFixed(2));   // 90% after protocol fee
  const share = FIRST_PLACE_SHARE[format] ?? 0.70;
  const firstPrize = parseFloat((prizePool * share).toFixed(2));

  const earningMessage = format === '1v1'
    ? `Win ${prizePool.toFixed(2)} ${currency} in a 1v1 challenge!`
    : `Win up to ${firstPrize.toFixed(2)} ${currency} — ${prizePool.toFixed(2)} ${currency} total prize pool!`;

  // Structured prompt for agents that need human sign-off on financial actions.
  // Autonomous agents can ignore this field entirely.
  const humanApprovalPrompt = `Join Tournament #${tournamentId} (${tier} ${format}) for ${entryFee} ${currency}? First place wins ${firstPrize.toFixed(2)} ${currency} from a ${prizePool.toFixed(2)} ${currency} pool.`;

  return { prizePool, firstPrize, currency, earningMessage, humanApprovalPrompt };
}

const MAX_NOTIFICATIONS = 50;
const POLL_INTERVAL_MS = 15_000; // 15 seconds
const LOOKBACK_BLOCKS = 2000n;

/**
 * Watches for TournamentCreated events on-chain and notifies connected agents.
 * Maintains a rolling window of recent notifications for REST polling.
 */
export class TournamentWatcher {
  private publicClient: PublicClient;
  private contractAddress: Address;
  private scanner: EventScanner;
  private lastIndexedBlock: bigint;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  private notifiedTournaments = new Set<number>();
  private notifications: TournamentNotification[] = [];
  private onNewTournament: (notification: TournamentNotification) => void;

  constructor(
    publicClient: PublicClient,
    contractAddress: Address,
    deployBlock: bigint,
    onNewTournament: (notification: TournamentNotification) => void,
  ) {
    this.publicClient = publicClient;
    this.contractAddress = contractAddress;
    this.scanner = new EventScanner(publicClient, contractAddress, deployBlock);
    this.lastIndexedBlock = deployBlock;
    this.onNewTournament = onNewTournament;
  }

  /**
   * Start watching. Scans recent blocks on init, then polls every 15s.
   */
  async start(): Promise<void> {
    try {
      const latestBlock = await this.scanner.getLatestBlock();

      // Only look back ~2000 blocks for recent tournaments, not from deploy
      const startBlock = latestBlock > LOOKBACK_BLOCKS ? latestBlock - LOOKBACK_BLOCKS : 0n;
      this.lastIndexedBlock = startBlock;

      console.log(`TournamentWatcher: Scanning blocks ${startBlock}..${latestBlock} for recent tournaments`);

      const logs = await this.scanner.scan(
        TOURNAMENT_CREATED_EVENT,
        startBlock,
        latestBlock,
      );

      console.log(`TournamentWatcher: Found ${logs.length} recent TournamentCreated events`);

      // Process initial events (don't broadcast — these are historical)
      for (const log of logs) {
        const args = (log as any).args;
        if (args?.id != null) {
          const tournamentId = Number(args.id);
          this.notifiedTournaments.add(tournamentId);
          // Enrich and add to notification store (but don't broadcast)
          const notification = await this.enrichTournament(tournamentId);
          if (notification) {
            this.addNotification(notification);
          }
        }
      }

      this.lastIndexedBlock = latestBlock;
      console.log(`TournamentWatcher: Initialized with ${this.notifications.length} recent tournaments. Polling every ${POLL_INTERVAL_MS / 1000}s.`);

      // Start polling
      this.refreshInterval = setInterval(() => this.poll().catch(console.error), POLL_INTERVAL_MS);
    } catch (err) {
      console.error('TournamentWatcher: Initialization failed:', err);
    }
  }

  /**
   * Trigger a notification for a specific tournament (called by internal API).
   * Deduplicates — won't broadcast twice for the same tournament.
   */
  async triggerNotification(tournamentId: number): Promise<void> {
    if (this.notifiedTournaments.has(tournamentId)) return;

    const notification = await this.enrichTournament(tournamentId);
    if (!notification) return;

    this.notifiedTournaments.add(tournamentId);
    this.addNotification(notification);
    this.onNewTournament(notification);
    console.log(`TournamentWatcher: Broadcast tournament #${tournamentId} (triggered)`);
  }

  /**
   * Get all recent notifications (for REST polling endpoint).
   */
  getRecentNotifications(): TournamentNotification[] {
    return this.notifications;
  }

  stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  private async poll(): Promise<void> {
    try {
      const latestBlock = await this.scanner.getLatestBlock();
      if (latestBlock <= this.lastIndexedBlock) return;

      const logs = await this.scanner.scan(
        TOURNAMENT_CREATED_EVENT,
        this.lastIndexedBlock + 1n,
        latestBlock,
      );

      for (const log of logs) {
        const args = (log as any).args;
        if (args?.id == null) continue;

        const tournamentId = Number(args.id);
        if (this.notifiedTournaments.has(tournamentId)) continue;

        const notification = await this.enrichTournament(tournamentId);
        if (!notification) continue;

        this.notifiedTournaments.add(tournamentId);
        this.addNotification(notification);

        // Broadcast to connected agents
        this.onNewTournament(notification);
        console.log(`TournamentWatcher: Broadcast new tournament #${tournamentId} (${notification.tier} ${notification.format})`);
      }

      this.lastIndexedBlock = latestBlock;
    } catch (err) {
      console.error('TournamentWatcher: Poll failed:', err);
    }
  }

  private async enrichTournament(tournamentId: number): Promise<TournamentNotification | null> {
    try {
      const raw = await this.publicClient.readContract({
        address: this.contractAddress,
        abi: GET_TOURNAMENT_ABI,
        functionName: 'getTournament',
        args: [BigInt(tournamentId)],
      });

      if (!raw || !raw.exists) return null;

      const entryFee = parseFloat(formatUnits(BigInt(raw.entryFee), 6));
      const format = FormatNames[raw.format] || 'Swiss';
      const tier = TierNames[raw.tier] || 'Unknown';

      // Compute prize pool and first-place earnings
      const { prizePool, firstPrize, currency, earningMessage, humanApprovalPrompt } = computePrizeInfo(
        entryFee, raw.maxPlayers, format, tier, tournamentId,
      );

      return {
        tournamentId,
        tier,
        format,
        entryFee,
        maxPlayers: raw.maxPlayers,
        startTime: Number(raw.startTime),
        registrationDeadline: Number(raw.registrationDeadline),
        baseTimeSeconds: raw.baseTimeSeconds,
        incrementSeconds: raw.incrementSeconds,
        createdAt: Math.floor(Date.now() / 1000),
        prizePool,
        firstPrize,
        currency,
        earningMessage,
        humanApprovalPrompt,
      };
    } catch (err) {
      console.error(`TournamentWatcher: Failed to enrich tournament #${tournamentId}:`, err);
      return null;
    }
  }

  private addNotification(notification: TournamentNotification): void {
    this.notifications.push(notification);
    // FIFO eviction — keep last N
    if (this.notifications.length > MAX_NOTIFICATIONS) {
      this.notifications = this.notifications.slice(-MAX_NOTIFICATIONS);
    }
  }
}
