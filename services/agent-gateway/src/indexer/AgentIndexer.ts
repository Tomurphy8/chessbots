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
 * Initializes by scanning AgentRegistered events, then periodically refreshes stats.
 */
export class AgentIndexer {
  private agents = new Map<string, IndexedAgent>();
  private publicClient: PublicClient;
  private contractAddress: Address;
  private scanner: EventScanner;
  private lastIndexedBlock: bigint = 0n;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private initializing = false;
  private initialized = false;

  constructor(publicClient: PublicClient, contractAddress: Address, deployBlock: bigint) {
    this.publicClient = publicClient;
    this.contractAddress = contractAddress;
    this.scanner = new EventScanner(publicClient, contractAddress, deployBlock);
    this.lastIndexedBlock = deployBlock;
  }

  /**
   * Initialize: scan all AgentRegistered events and fetch current stats.
   */
  async initialize(): Promise<void> {
    if (this.initializing) return;
    this.initializing = true;

    try {
      console.log('AgentIndexer: Starting initialization...');
      const latestBlock = await this.scanner.getLatestBlock();

      // Scan AgentRegistered events from deploy block to latest
      const logs = await this.scanner.scan(
        AGENT_REGISTERED_EVENT,
        this.lastIndexedBlock,
        latestBlock,
      );

      console.log(`AgentIndexer: Found ${logs.length} AgentRegistered events`);

      // Extract unique wallets from events
      const wallets = new Set<string>();
      for (const log of logs) {
        const args = (log as any).args;
        if (args?.wallet) {
          wallets.add((args.wallet as string).toLowerCase());
        }
      }

      console.log(`AgentIndexer: ${wallets.size} unique agents to index`);

      // Fetch current stats for all agents
      await this.fetchAgentStats([...wallets]);

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
   * Incremental refresh: scan new blocks for new agents + re-fetch all stats.
   */
  async refresh(): Promise<void> {
    try {
      const latestBlock = await this.scanner.getLatestBlock();
      if (latestBlock <= this.lastIndexedBlock) return;

      // Scan for new AgentRegistered events since last indexed block
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
          // Fetch stats for newly discovered agents to add them to the index
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
   * Fetch on-chain stats for a list of wallets and update the index.
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

      for (let j = 0; j < agentResults.length; j++) {
        const result = agentResults[j];
        if (result.status === 'rejected') {
          console.error(`AgentIndexer: getAgent failed for ${batch[j]}:`, result.reason?.message || result.reason);
          continue;
        }
        if (result.status === 'fulfilled' && result.value) {
          const raw = result.value;
          if (!raw.registered) continue;

          const gamesPlayed = Number(raw.gamesPlayed);
          const gamesWon = Number(raw.gamesWon);
          const gamesDrawn = Number(raw.gamesDrawn);
          const gamesLost = Number(raw.gamesLost);

          const winRate = gamesPlayed > 0
            ? (gamesWon + 0.5 * gamesDrawn) / gamesPlayed
            : 0;

          const eloRating = this.computeRating(gamesPlayed, winRate);

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

          this.agents.set(batch[j].toLowerCase(), {
            wallet: raw.wallet,
            name: raw.name || batch[j].slice(0, 10) + '...',
            agentType: AGENT_TYPE_MAP[Number(raw.agentType)] || 'Custom',
            eloRating,
            gamesPlayed,
            gamesWon,
            gamesDrawn,
            gamesLost,
            totalEarnings: parseFloat(formatUnits(BigInt(raw.totalEarnings), 6)),
            winRate,
            registered: raw.registered,
            referralEarnings: refEarnings,
            referralCount: refCount,
          });
        }
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
