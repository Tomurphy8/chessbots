import { createPublicClient, createWalletClient, http, defineChain, type Address, type Hash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ChainConfig, PlayerStanding, Pairing } from '../types/index.js';

const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz/'] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://testnet.monadexplorer.com' } },
});

// Minimal ABI for tournament operations the orchestrator needs
const TOURNAMENT_ABI = [
  // createTournament
  {
    inputs: [
      { name: 'tier', type: 'uint8' },
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
  // getTournament (read)
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
] as const;

export class MonadClient {
  private publicClient;
  private walletClient;
  private account;
  private contractAddress: Address;

  constructor(config: ChainConfig) {
    // TO-C4: Validate private key format at startup
    if (!config.privateKey.startsWith('0x') || config.privateKey.length !== 66) {
      throw new Error('Invalid PRIVATE_KEY format. Must be a 0x-prefixed 32-byte hex string.');
    }
    this.account = privateKeyToAccount(config.privateKey as `0x${string}`);
    this.contractAddress = config.contractAddress as Address;

    const chain = { ...monadTestnet, rpcUrls: { default: { http: [config.rpcUrl] } } };

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
    tier: number, maxPlayers: number, minPlayers: number,
    startTime: bigint, registrationDeadline: bigint,
    baseTimeSeconds: number, incrementSeconds: number,
  ): Promise<Hash> {
    const hash = await this.walletClient.writeContract({
      address: this.contractAddress,
      abi: TOURNAMENT_ABI,
      functionName: 'createTournament',
      args: [tier, maxPlayers, minPlayers, startTime, registrationDeadline, baseTimeSeconds, incrementSeconds],
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

  getAddress(): Address {
    return this.account.address;
  }
}
