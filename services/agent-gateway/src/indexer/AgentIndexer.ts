import { type PublicClient, type Address, formatUnits, parseAbiItem } from 'viem';
import { EventScanner } from './EventScanner.js';

export interface IndexedAgent {
  wallet: string;
  name: string;
  agentType: string;
  eloRating: number;       // Computed off-chain
  gamesPlayed: number;
  gamesWon: number;
  gamesDrawn: number;
  gamesLost: number;
  totalEarnings: number;
  winRate: number;          // Computed
  registered: boolean;
  referralEarnings: number;  // Referral V2: total USDC earned from referrals
  referralCount: number;     // Referral V2: number of agents referred
}

export interface LegacyContract {
  address: string;
  deployBlock: bigint;
}

// ABI for getAgent call — must match V3 AgentProfile struct exactly
const GET_AGENT_ABI = [
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
        { name: 'referredBy', type: 'address' },
        { name: 'registered', type: 'bool' },
      ],
      name: '',
      type: 'tuple',
    }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ABI for referralEarnings and referralCount reads
const REFERRAL_EARNINGS_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'referralEarnings',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const REFERRAL_COUNT_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'referralCount',
    outputs: [{ name: '', type: 'uint16' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// V3 contract enum: 0=OpenClaw, 1=SolanaAgentKit, 2=Custom
const AGENT_TYPE_MAP: Record<number, string> = {
  0: 'OpenClaw',
  1: 'SolanaAgentKit',
  2: 'Custom',
};

const AGENT_REGISTERED_EVENT = parseAbiItem(
  'event AgentRegistered(address indexed wallet, string name, uint8 agentType)'
);

/**
 * Indexes all registered agents from on-chain events and computes performance ratings.
 * Scans AgentRegistered events from current + legacy contracts, then sums stats
 * across all contracts for cumulative totals.
 */
export class AgentIndexer {
  private agents = new Map<string, IndexedAgent>();
  private publicClient: PublicClient;
  private contractAddress: Address;
  private legacyContracts: readonly LegacyContract[];
  private scanner: EventScanner;
  private legacyScanners: EventScanner[];
  private lastIndexedBlock: bigint = 0n;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private initializing = false;
  private initialized = false;

  // Cache legacy stats since old contracts never change
  private legacyStatsCache = new Map<string, { gamesPlayed: number; gamesWon: number; gamesDrawn: number; gamesLost: number; totalEarnings: number }>();
  private legacyStatsCached = false;

  constructor(
    publicClient: PublicClient,
    contractAddress: Address,
    deployBlock: bigint,
    legacyContracts: readonly LegacyContract[] = [],
  ) {
    this.publicClient = publicClient;
    this.contractAddress = contractAddress;
    this.legacyContracts = legacyContracts;
    this.scanner = new EventScanner(publicClient, contractAddress, deployBlock);
    this.legacyScanners = legacyContracts.map(
      lc => new EventScanner(publicClient, lc.address as Address, lc.deployBlock)
    );
    this.lastIndexedBlock = deployBlock;
  }

  /**
   * Initialize: scan all AgentRegistered events from all contracts and fetch current stats.
   */
  async initialize(): Promise<void> {
    if (this.initializing) return;
    this.initializing = true;

    try {
      console.log('AgentIndexer: Starting initialization...');
      const latestBlock = await this.scanner.getLatestBlock();

      // Scan AgentRegistered events from current contract
      const logs = await this.scanner.scan(
        AGENT_REGISTERED_EVENT,
        this.lastIndexedBlock,
        latestBlock,
      );

      console.log(`AgentIndexer: Found ${logs.length} AgentRegistered events (current contract)`);

      // Also scan legacy contracts for agent registrations
      for (let i = 0; i < this.legacyScanners.length; i++) {
        try {
          const legacyLogs = await this.legacyScanners[i].scan(
            AGENT_REGISTERED_EVENT,
            undefined, // from deploy block
            latestBlock,
          );
          console.log(`AgentIndexer: Found ${legacyLogs.length} AgentRegistered events (legacy contract ${i + 1})`);
          logs.push(...legacyLogs);
        } catch (err) {
          console.error(`AgentIndexer: Failed to scan legacy contract ${i + 1}:`, err);
        }
      }

      // Extract unique wallets from all events
      const wallets = new Set<string>();
      for (const log of logs) {
        const args = (log as any).args;
        if (args?.wallet) {
          wallets.add((args.wallet as string).toLowerCase());
        }
      }

      const walletList = [...wallets];
      console.log(`AgentIndexer: ${walletList.length} unique agents to index (across all contracts)`);

      // Fetch and cache legacy stats (these never change)
      await this.fetchLegacyStats(walletList);

      // Fetch current stats and merge with legacy
      await this.fetchAgentStats(walletList);

      this.lastIndexedBlock = latestBlock;
      this.initialized = true;
      console.log(`AgentIndexer: Initialized with ${this.agents.size} agents`);

      // Start periodic refresh (every 30 seconds for live leaderboard updates)
      this.refreshInterval = setInterval(() => this.refresh().catch(console.error), 30_000);
    } catch (err) {
      console.error('AgentIndexer: Initialization failed:', err);
    } finally {
      this.initializing = false;
    }
  }

  /**
   * Fetch and cache stats from legacy contracts (one-time, since they never change).
   */
  private async fetchLegacyStats(wallets: string[]): Promise<void> {
    if (this.legacyContracts.length === 0 || this.legacyStatsCached) return;

    console.log(`AgentIndexer: Fetching legacy stats from ${this.legacyContracts.length} contracts...`);

    for (const lc of this.legacyContracts) {
      const BATCH_SIZE = 10;
      for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
        const batch = wallets.slice(i, i + BATCH_SIZE);

        const results = await Promise.allSettled(
          batch.map(wallet =>
            this.publicClient.readContract({
              address: lc.address as Address,
              abi: GET_AGENT_ABI,
              functionName: 'getAgent',
              args: [wallet as Address],
            })
          )
        );

        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          if (result.status !== 'fulfilled' || !result.value || !result.value.registered) continue;

          const raw = result.value;
          const key = batch[j].toLowerCase();
          const existing = this.legacyStatsCache.get(key) || { gamesPlayed: 0, gamesWon: 0, gamesDrawn: 0, gamesLost: 0, totalEarnings: 0 };

          existing.gamesPlayed += Number(raw.gamesPlayed);
          existing.gamesWon += Number(raw.gamesWon);
          existing.gamesDrawn += Number(raw.gamesDrawn);
          existing.gamesLost += Number(raw.gamesLost);
          existing.totalEarnings += parseFloat(formatUnits(BigInt(raw.totalEarnings), 6));

          this.legacyStatsCache.set(key, existing);
        }
      }
    }

    console.log(`AgentIndexer: Legacy stats cached for ${this.legacyStatsCache.size} agents`);
    this.legacyStatsCached = true;
  }

  /**
   * Incremental refresh: scan new blocks for new agents + re-fetch all stats.
   */
  async refresh(): Promise<void> {
    try {
      const latestBlock = await this.scanner.getLatestBlock();
      if (latestBlock <= this.lastIndexedBlock) return;

      // Scan for new AgentRegistered events since last indexed block (current contract only)
      const logs = await this.scanner.scan(
        AGENT_REGISTERED_EVENT,
        this.lastIndexedBlock + 1n,
        latestBlock,
      );

      if (logs.length > 0) {
        const newWallets: string[] = [];
        for (const log of logs) {
          const args = (log as any).args;
          if (args?.wallet) {
            const wallet = (args.wallet as string).toLowerCase();
            if (!this.agents.has(wallet)) {
              newWallets.push(wallet);
            }
          }
        }
        if (newWallets.length > 0) {
          console.log(`AgentIndexer: Found ${newWallets.length} new agents`);
          // Fetch legacy stats for new agents too
          if (this.legacyContracts.length > 0) {
            // Temporarily allow re-fetch for new wallets
            const prevCached = this.legacyStatsCached;
            this.legacyStatsCached = false;
            await this.fetchLegacyStats(newWallets);
            this.legacyStatsCached = prevCached;
          }
          await this.fetchAgentStats(newWallets);
        }
      }

      // Re-fetch stats for ALL known agents (stats may have changed from games)
      const allWallets = [...this.agents.keys()];
      if (allWallets.length > 0) {
        await this.fetchAgentStats(allWallets);
      }

      this.lastIndexedBlock = latestBlock;
    } catch (err) {
      console.error('AgentIndexer: Refresh failed:', err);
    }
  }

  /**
   * Fetch on-chain stats from current contract for a list of wallets,
   * merge with cached legacy stats, and update the index.
   */
  private async fetchAgentStats(wallets: string[]): Promise<void> {
    // Batch in groups of 10 to avoid overwhelming RPC
    const BATCH_SIZE = 10;
    for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
      const batch = wallets.slice(i, i + BATCH_SIZE);

      // Fetch agent profile, referral earnings, and referral count in parallel
      const [agentResults, earningsResults, countResults] = await Promise.all([
        Promise.allSettled(
          batch.map(wallet =>
            this.publicClient.readContract({
              address: this.contractAddress,
              abi: GET_AGENT_ABI,
              functionName: 'getAgent',
              args: [wallet as Address],
            })
          )
        ),
        Promise.allSettled(
          batch.map(wallet =>
            this.publicClient.readContract({
              address: this.contractAddress,
              abi: REFERRAL_EARNINGS_ABI,
              functionName: 'referralEarnings',
              args: [wallet as Address],
            })
          )
        ),
        Promise.allSettled(
          batch.map(wallet =>
            this.publicClient.readContract({
              address: this.contractAddress,
              abi: REFERRAL_COUNT_ABI,
              functionName: 'referralCount',
              args: [wallet as Address],
            })
          )
        ),
      ]);

      for (let j = 0; j < batch.length; j++) {
        const walletKey = batch[j].toLowerCase();
        const agentResult = agentResults[j];

        // Current contract stats (may not exist if agent only registered on legacy)
        let currentGamesPlayed = 0;
        let currentGamesWon = 0;
        let currentGamesDrawn = 0;
        let currentGamesLost = 0;
        let currentTotalEarnings = 0;
        let name = '';
        let walletAddr = batch[j];
        let agentType = 'Custom';
        let registeredOnCurrent = false;

        if (agentResult.status === 'fulfilled' && agentResult.value && agentResult.value.registered) {
          const raw = agentResult.value;
          registeredOnCurrent = true;
          walletAddr = raw.wallet;
          name = raw.name || '';
          agentType = AGENT_TYPE_MAP[Number(raw.agentType)] || 'Custom';
          currentGamesPlayed = Number(raw.gamesPlayed);
          currentGamesWon = Number(raw.gamesWon);
          currentGamesDrawn = Number(raw.gamesDrawn);
          currentGamesLost = Number(raw.gamesLost);
          currentTotalEarnings = parseFloat(formatUnits(BigInt(raw.totalEarnings), 6));
        }

        // Legacy stats (cached, from old contracts)
        const legacy = this.legacyStatsCache.get(walletKey);

        // Skip agents not registered on any contract
        if (!registeredOnCurrent && !legacy) continue;

        // Sum across contracts
        const gamesPlayed = currentGamesPlayed + (legacy?.gamesPlayed || 0);
        const gamesWon = currentGamesWon + (legacy?.gamesWon || 0);
        const gamesDrawn = currentGamesDrawn + (legacy?.gamesDrawn || 0);
        const gamesLost = currentGamesLost + (legacy?.gamesLost || 0);
        const totalEarnings = currentTotalEarnings + (legacy?.totalEarnings || 0);

        const winRate = gamesPlayed > 0
          ? (gamesWon + 0.5 * gamesDrawn) / gamesPlayed
          : 0;

        const eloRating = this.computeRating(gamesPlayed, winRate);

        // For legacy-only agents, try to get name from legacy cache
        // The name comes from AgentRegistered events or getAgent — we use current if available
        if (!name) {
          name = batch[j].slice(0, 10) + '...';
        }

        // Extract referral data (default to 0 if fetch failed)
        let refEarnings = 0;
        let refCount = 0;
        const earningsResult = earningsResults[j];
        if (earningsResult.status === 'fulfilled') {
          refEarnings = parseFloat(formatUnits(BigInt(earningsResult.value as any), 6));
        }
        const countResult = countResults[j];
        if (countResult.status === 'fulfilled') {
          refCount = Number(countResult.value);
        }

        this.agents.set(walletKey, {
          wallet: walletAddr,
          name,
          agentType,
          eloRating,
          gamesPlayed,
          gamesWon,
          gamesDrawn,
          gamesLost,
          totalEarnings,
          winRate,
          registered: registeredOnCurrent || !!legacy,
          referralEarnings: refEarnings,
          referralCount: refCount,
        });
      }
    }
  }

  /**
   * Compute performance-based Elo rating.
   * Formula: 1200 + (winRate - 0.5) * 400 * sqrt(gamesPlayed)
   * Clamped to [800, 2400].
   */
  private computeRating(gamesPlayed: number, winRate: number): number {
    if (gamesPlayed === 0) return 1200;
    const raw = 1200 + (winRate - 0.5) * 400 * Math.sqrt(gamesPlayed);
    return Math.round(Math.max(800, Math.min(2400, raw)));
  }

  /**
   * Get all indexed agents sorted by computed rating (descending).
   */
  getAll(): IndexedAgent[] {
    return [...this.agents.values()]
      .sort((a, b) => b.eloRating - a.eloRating || b.gamesPlayed - a.gamesPlayed);
  }

  /**
   * Get a single agent by wallet address.
   */
  get(wallet: string): IndexedAgent | null {
    return this.agents.get(wallet.toLowerCase()) ?? null;
  }

  /**
   * Check if indexer has completed initial scan.
   */
  isReady(): boolean {
    return this.initialized;
  }

  /**
   * Stop periodic refresh.
   */
  stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
}
