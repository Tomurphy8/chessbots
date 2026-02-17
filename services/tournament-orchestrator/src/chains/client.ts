import { createPublicClient, createWalletClient, http, defineChain, type Address, type Hash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ChainConfig, PlayerStanding, Pairing } from '../types/index.js';

const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz/'] } },
  blockExplorers: { default: { name: 'MonadScan', url: 'https://monadscan.com' } },
});

// Minimal ABI for tournament operations the orchestrator needs
const TOURNAMENT_ABI = [
  // createTournament (V3: includes format param)
  {
    inputs: [
      { name: 'tier', type: 'uint8' },
      { name: 'format', type: 'uint8' },
      { name: 'maxPlayers', type: 'uint8' },
      { name: 'minPlayers', type: 'uint8' },
      { name: 'startTime', type: 'int64' },
      { name: 'registrationDeadline', type: 'int64' },
      { name: 'baseTimeSeconds', type: 'uint32' },
      { name: 'incrementSeconds', type: 'uint32' },
    ],
    name: 'createTournament',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // startTournament
  {
    inputs: [{ name: 'tournamentId', type: 'uint256' }],
    name: 'startTournament',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // batchCreateAndStartGames
  {
    inputs: [
      { name: 'tournamentId', type: 'uint256' },
      { name: 'round', type: 'uint8' },
      { name: 'gameInputs', type: 'tuple[]', components: [
        { name: 'gameIndex', type: 'uint8' },
        { name: 'white', type: 'address' },
        { name: 'black', type: 'address' },
      ]},
    ],
    name: 'batchCreateAndStartGames',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // executeRound (super-batch)
  {
    inputs: [
      { name: 'tournamentId', type: 'uint256' },
      { name: 'round', type: 'uint8' },
      { name: 'results', type: 'tuple[]', components: [
        { name: 'gameIndex', type: 'uint8' },
        { name: 'result', type: 'uint8' },
        { name: 'pgnHash', type: 'bytes32' },
        { name: 'resultHash', type: 'bytes32' },
        { name: 'moveCount', type: 'uint16' },
      ]},
      { name: 'standings', type: 'tuple[]', components: [
        { name: 'agent', type: 'address' },
        { name: 'score', type: 'uint16' },
        { name: 'buchholz', type: 'uint16' },
        { name: 'gamesPlayed', type: 'uint8' },
        { name: 'gamesWon', type: 'uint8' },
        { name: 'gamesDrawn', type: 'uint8' },
        { name: 'gamesLost', type: 'uint8' },
      ]},
      { name: 'advance', type: 'bool' },
    ],
    name: 'executeRound',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // finalizeTournament
  {
    inputs: [
      { name: 'tournamentId', type: 'uint256' },
      { name: 'winners', type: 'address[3]' },
      { name: 'resultsUri', type: 'string' },
    ],
    name: 'finalizeTournament',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // distributePrizes
  {
    inputs: [{ name: 'tournamentId', type: 'uint256' }],
    name: 'distributePrizes',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // fundTournament (authority-only: deposits USDC into tournament prize pool)
  {
    inputs: [
      { name: 'tournamentId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'fundTournament',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // protocol (read)
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
  // getTournament (read) — V3 struct with format, teamSize, bestOf, challengeTarget
  {
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
  },
  // getRegistration (read)
  {
    inputs: [
      { name: 'tournamentId', type: 'uint256' },
      { name: 'agent', type: 'address' },
    ],
    name: 'getRegistration',
    outputs: [{
      components: [
        { name: 'agent', type: 'address' },
        { name: 'tournamentId', type: 'uint256' },
        { name: 'exists', type: 'bool' },
      ],
      name: '',
      type: 'tuple',
    }],
    stateMutability: 'view',
    type: 'function',
  },
  // V3: createMatchChallenge (1v1 with bestOf + optional opponent targeting)
  {
    inputs: [
      { name: 'tier', type: 'uint8' },
      { name: 'startTime', type: 'int64' },
      { name: 'registrationDeadline', type: 'int64' },
      { name: 'baseTimeSeconds', type: 'uint32' },
      { name: 'incrementSeconds', type: 'uint32' },
      { name: 'bestOf', type: 'uint8' },
      { name: 'opponent', type: 'address' },
    ],
    name: 'createMatchChallenge',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // V3: createTeamTournament
  {
    inputs: [
      { name: 'tier', type: 'uint8' },
      { name: 'maxTeams', type: 'uint8' },
      { name: 'minTeams', type: 'uint8' },
      { name: 'startTime', type: 'int64' },
      { name: 'registrationDeadline', type: 'int64' },
      { name: 'baseTimeSeconds', type: 'uint32' },
      { name: 'incrementSeconds', type: 'uint32' },
      { name: 'teamSize', type: 'uint8' },
    ],
    name: 'createTeamTournament',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // V3: getTeamRoster (read)
  {
    inputs: [
      { name: 'tournamentId', type: 'uint256' },
      { name: '_teamId', type: 'uint8' },
    ],
    name: 'getTeamRoster',
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  // V3: getTeamCount (read)
  {
    inputs: [{ name: 'tournamentId', type: 'uint256' }],
    name: 'getTeamCount',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  // registerAgent
  {
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'metadataUri', type: 'string' },
      { name: 'agentType', type: 'uint8' },
    ],
    name: 'registerAgent',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // registerForTournament
  {
    inputs: [{ name: 'tournamentId', type: 'uint256' }],
    name: 'registerForTournament',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // getAgent (read)
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

// Minimal ERC20 ABI for USDC approve + allowance
const ERC20_ABI = [
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ABI for the AgentJoined event to fetch registered wallets from logs
const AGENT_JOINED_EVENT = {
  type: 'event' as const,
  name: 'AgentJoined',
  inputs: [
    { name: 'tournamentId', type: 'uint256', indexed: true },
    { name: 'agent', type: 'address', indexed: true },
    { name: 'registeredCount', type: 'uint8', indexed: false },
  ],
};

export class MonadClient {
  private publicClient;
  private walletClient;
  private account;
  private contractAddress: Address;
  private usdcAddress: Address;

  constructor(config: ChainConfig) {
    // TO-C4: Validate private key format at startup
    if (!config.privateKey.startsWith('0x') || config.privateKey.length !== 66) {
      throw new Error('Invalid PRIVATE_KEY format. Must be a 0x-prefixed 32-byte hex string.');
    }
    this.account = privateKeyToAccount(config.privateKey as `0x${string}`);
    this.contractAddress = config.contractAddress as Address;
    this.usdcAddress = config.usdcAddress as Address;

    const chain = { ...monad, rpcUrls: { default: { http: [config.rpcUrl] } } };

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(config.rpcUrl),
    });
  }

  // TO-C1: Wait for transaction receipt confirmation
  private async confirmTx(hash: Hash, label: string): Promise<void> {
    console.log(`  [tx] ${label}: ${hash}`);
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 60_000, // 60s timeout
    });
    if (receipt.status === 'reverted') {
      throw new Error(`Transaction reverted: ${label} (${hash})`);
    }
    console.log(`  [tx] ${label}: confirmed (block ${receipt.blockNumber})`);
  }

  // TO-C3: Retry wrapper for write transactions with exponential backoff
  private async withRetry<T>(
    fn: () => Promise<T>,
    label: string,
    maxRetries: number = 3,
  ): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        // Don't retry on revert (business logic error) or if last attempt
        if (err.message?.includes('reverted') || attempt === maxRetries) {
          throw err;
        }
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10_000);
        console.warn(`  [tx] ${label}: attempt ${attempt} failed (${err.message}), retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }

  async getProtocolState() {
    return this.publicClient.readContract({
      address: this.contractAddress,
      abi: TOURNAMENT_ABI,
      functionName: 'protocol',
    });
  }

  async getTournament(tournamentId: bigint) {
    return this.publicClient.readContract({
      address: this.contractAddress,
      abi: TOURNAMENT_ABI,
      functionName: 'getTournament',
      args: [tournamentId],
    });
  }

  async createTournament(
    tier: number, format: number, maxPlayers: number, minPlayers: number,
    startTime: bigint, registrationDeadline: bigint,
    baseTimeSeconds: number, incrementSeconds: number,
  ): Promise<Hash> {
    const hash = await this.walletClient.writeContract({
      address: this.contractAddress,
      abi: TOURNAMENT_ABI,
      functionName: 'createTournament',
      args: [tier, format, maxPlayers, minPlayers, startTime, registrationDeadline, baseTimeSeconds, incrementSeconds],
    });
    await this.confirmTx(hash, 'createTournament');
    return hash;
  }

  async startTournament(tournamentId: bigint): Promise<Hash> {
    return this.withRetry(async () => {
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: TOURNAMENT_ABI,
        functionName: 'startTournament',
        args: [tournamentId],
      });
      await this.confirmTx(hash, `startTournament(${tournamentId})`);
      return hash;
    }, `startTournament(${tournamentId})`);
  }

  async batchCreateAndStartGames(
    tournamentId: bigint, round: number,
    pairings: Pairing[],
  ): Promise<Hash> {
    return this.withRetry(async () => {
      const gameInputs = pairings.map(p => ({
        gameIndex: p.gameIndex,
        white: p.white as Address,
        black: p.black as Address,
      }));
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: TOURNAMENT_ABI,
        functionName: 'batchCreateAndStartGames',
        args: [tournamentId, round, gameInputs],
      });
      await this.confirmTx(hash, `batchCreateAndStartGames(${tournamentId}, round ${round})`);
      return hash;
    }, `batchCreateAndStartGames(${tournamentId}, round ${round})`);
  }

  async executeRound(
    tournamentId: bigint, round: number,
    results: Array<{ gameIndex: number; result: number; pgnHash: `0x${string}`; resultHash: `0x${string}`; moveCount: number }>,
    standings: PlayerStanding[],
    advance: boolean,
  ): Promise<Hash> {
    const resultInputs = results.map(r => ({
      gameIndex: r.gameIndex,
      result: r.result,
      pgnHash: r.pgnHash,
      resultHash: r.resultHash,
      moveCount: r.moveCount,
    }));
    const standingInputs = standings.map(s => ({
      agent: s.wallet as Address,
      score: s.score,
      buchholz: s.buchholz,
      gamesPlayed: s.gamesPlayed,
      gamesWon: s.gamesWon,
      gamesDrawn: s.gamesDrawn,
      gamesLost: s.gamesLost,
    }));
    return this.withRetry(async () => {
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: TOURNAMENT_ABI,
        functionName: 'executeRound',
        args: [tournamentId, round, resultInputs, standingInputs, advance],
      });
      await this.confirmTx(hash, `executeRound(${tournamentId}, round ${round})`);
      return hash;
    }, `executeRound(${tournamentId}, round ${round})`);
  }

  async finalizeTournament(
    tournamentId: bigint,
    winners: [Address, Address, Address],
    resultsUri: string,
  ): Promise<Hash> {
    return this.withRetry(async () => {
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: TOURNAMENT_ABI,
        functionName: 'finalizeTournament',
        args: [tournamentId, winners, resultsUri],
      });
      await this.confirmTx(hash, `finalizeTournament(${tournamentId})`);
      return hash;
    }, `finalizeTournament(${tournamentId})`);
  }

  async distributePrizes(tournamentId: bigint): Promise<Hash> {
    return this.withRetry(async () => {
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: TOURNAMENT_ABI,
        functionName: 'distributePrizes',
        args: [tournamentId],
      });
      await this.confirmTx(hash, `distributePrizes(${tournamentId})`);
      return hash;
    }, `distributePrizes(${tournamentId})`);
  }

  /**
   * Check USDC allowance the orchestrator wallet has granted to the tournament contract.
   */
  async getUsdcAllowance(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.usdcAddress,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [this.account.address, this.contractAddress],
    });
  }

  /**
   * Approve the tournament contract to spend USDC on behalf of the orchestrator wallet.
   */
  async approveUsdc(amount: bigint): Promise<Hash> {
    return this.withRetry(async () => {
      const hash = await this.walletClient.writeContract({
        address: this.usdcAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [this.contractAddress, amount],
      });
      await this.confirmTx(hash, `approveUsdc(${amount})`);
      return hash;
    }, `approveUsdc(${amount})`);
  }

  /**
   * Fund a free-tier tournament's prize pool with USDC.
   * Requires prior ERC20 approve() for the tournament contract.
   * @param tournamentId On-chain tournament ID
   * @param amount USDC amount in raw units (6 decimals, e.g. 100_000_000n = $100)
   */
  async fundTournament(tournamentId: bigint, amount: bigint): Promise<Hash> {
    return this.withRetry(async () => {
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: TOURNAMENT_ABI,
        functionName: 'fundTournament',
        args: [tournamentId, amount],
      });
      await this.confirmTx(hash, `fundTournament(${tournamentId}, ${amount})`);
      return hash;
    }, `fundTournament(${tournamentId})`);
  }

  // ── V3: Format-specific tournament creation ──────────────────────────────

  async createMatchChallenge(
    tier: number, startTime: bigint, registrationDeadline: bigint,
    baseTimeSeconds: number, incrementSeconds: number,
    bestOf: number, opponent: Address,
  ): Promise<Hash> {
    const hash = await this.walletClient.writeContract({
      address: this.contractAddress,
      abi: TOURNAMENT_ABI,
      functionName: 'createMatchChallenge',
      args: [tier, startTime, registrationDeadline, baseTimeSeconds, incrementSeconds, bestOf, opponent],
    });
    await this.confirmTx(hash, 'createMatchChallenge');
    return hash;
  }

  async createTeamTournament(
    tier: number, maxTeams: number, minTeams: number,
    startTime: bigint, registrationDeadline: bigint,
    baseTimeSeconds: number, incrementSeconds: number,
    teamSize: number,
  ): Promise<Hash> {
    const hash = await this.walletClient.writeContract({
      address: this.contractAddress,
      abi: TOURNAMENT_ABI,
      functionName: 'createTeamTournament',
      args: [tier, maxTeams, minTeams, startTime, registrationDeadline, baseTimeSeconds, incrementSeconds, teamSize],
    });
    await this.confirmTx(hash, 'createTeamTournament');
    return hash;
  }

  // ── V3: Team roster reading ─────────────────────────────────────────────

  async getTeamCount(tournamentId: bigint): Promise<number> {
    const count = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: TOURNAMENT_ABI,
      functionName: 'getTeamCount',
      args: [tournamentId],
    });
    return Number(count);
  }

  async getTeamRoster(tournamentId: bigint, teamId: number): Promise<Address[]> {
    const roster = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: TOURNAMENT_ABI,
      functionName: 'getTeamRoster',
      args: [tournamentId, teamId],
    });
    return [...roster]; // Copy from readonly to mutable
  }

  /**
   * Load all teams for a tournament. Returns team info with members and captain.
   * Captain is members[0] (the on-chain captain is msg.sender of registerTeam,
   * but members[0] is used as the prize recipient for simplicity).
   */
  async loadAllTeams(tournamentId: bigint): Promise<Array<{ teamId: number; captain: string; members: Address[] }>> {
    const count = await this.getTeamCount(tournamentId);
    const teams: Array<{ teamId: number; captain: string; members: Address[] }> = [];

    for (let i = 0; i < count; i++) {
      const members = await this.getTeamRoster(tournamentId, i);
      teams.push({
        teamId: i,
        captain: members[0] || '0x0000000000000000000000000000000000000000',
        members: [...members],
      });
    }

    return teams;
  }

  /**
   * Discover registered wallets for a tournament by reading AgentJoined event logs.
   * Uses binary search to find the approximate block range, then scans in chunks.
   * Monad RPC limits eth_getLogs to 100-block range per request.
   */
  async getRegisteredWallets(tournamentId: bigint, expectedCount?: number): Promise<Address[]> {
    const CHUNK_SIZE = 99n;
    const PARALLEL_BATCH = 5;
    const latestBlock = await this.publicClient.getBlockNumber();
    const wallets: Address[] = [];

    // Use TournamentCreated event to find the creation block, then scan from there
    // First, try scanning recent blocks (most tournaments are recent)
    // Scan last 10k blocks first (covers ~1 hour on Monad)
    const scanRanges = [
      { from: latestBlock > 10_000n ? latestBlock - 10_000n : 0n, to: latestBlock },
      { from: latestBlock > 50_000n ? latestBlock - 50_000n : 0n, to: latestBlock > 10_000n ? latestBlock - 10_000n : 0n },
      { from: latestBlock > 200_000n ? latestBlock - 200_000n : 0n, to: latestBlock > 50_000n ? latestBlock - 50_000n : 0n },
    ];

    for (const range of scanRanges) {
      if (range.from >= range.to) continue;

      const blockSpan = range.to - range.from;
      console.log(`  Scanning blocks ${range.from}..${range.to} (${blockSpan} blocks)...`);

      // Build chunk ranges
      const chunks: Array<{ from: bigint; to: bigint }> = [];
      for (let from = range.from; from <= range.to; from += CHUNK_SIZE + 1n) {
        const to = from + CHUNK_SIZE > range.to ? range.to : from + CHUNK_SIZE;
        chunks.push({ from, to });
      }

      // Process chunks in parallel batches
      for (let i = 0; i < chunks.length; i += PARALLEL_BATCH) {
        const batch = chunks.slice(i, i + PARALLEL_BATCH);
        const results = await Promise.allSettled(
          batch.map(chunk =>
            this.publicClient.getLogs({
              address: this.contractAddress,
              event: AGENT_JOINED_EVENT,
              args: { tournamentId },
              fromBlock: chunk.from,
              toBlock: chunk.to,
            })
          )
        );

        for (const result of results) {
          if (result.status === 'fulfilled') {
            for (const logEntry of result.value) {
              const args = logEntry.args as Record<string, unknown>;
              if (args.agent) {
                wallets.push(args.agent as Address);
              }
            }
          }
        }
      }

      // If we found enough wallets, stop scanning older ranges
      if (wallets.length > 0 && (!expectedCount || wallets.length >= expectedCount)) {
        break;
      }
    }

    console.log(`  Found ${wallets.length} registered wallets for tournament #${tournamentId}`);
    return wallets;
  }

  // ── Agent registration ────────────────────────────────────────────────────

  async registerAgent(name: string, metadataUri: string, agentType: number): Promise<Hash> {
    const hash = await this.walletClient.writeContract({
      address: this.contractAddress,
      abi: TOURNAMENT_ABI,
      functionName: 'registerAgent',
      args: [name, metadataUri, agentType],
    });
    await this.confirmTx(hash, `registerAgent(${name})`);
    return hash;
  }

  async registerForTournament(tournamentId: bigint): Promise<Hash> {
    const hash = await this.walletClient.writeContract({
      address: this.contractAddress,
      abi: TOURNAMENT_ABI,
      functionName: 'registerForTournament',
      args: [tournamentId],
    });
    await this.confirmTx(hash, `registerForTournament(${tournamentId})`);
    return hash;
  }

  async getAgent(wallet: Address) {
    return this.publicClient.readContract({
      address: this.contractAddress,
      abi: TOURNAMENT_ABI,
      functionName: 'getAgent',
      args: [wallet],
    });
  }

  getAddress(): Address {
    return this.account.address;
  }
}
