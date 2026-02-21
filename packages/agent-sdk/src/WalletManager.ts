import {
  createWalletClient,
  createPublicClient,
  http,
  type WalletClient,
  type PublicClient,
  type Address,
  type Hex,
  type Chain,
  parseAbi,
  formatUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const monad: Chain = {
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } },
};

const USDC_ADDRESS = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603' as Address;
const TOURNAMENT_V3 = '0x0e2663b0DCD9b7408d51C6972f679B81a5A7477e' as Address;

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

const TOURNAMENT_ABI = parseAbi([
  'function registerAgent(string name, string metadataUri, uint8 agentType)',
  'function registerAgentWithReferral(string name, string metadataUri, uint8 agentType, address referrer)',
  'function registerForTournament(uint256 tournamentId)',
  'function getAgent(address) view returns ((address wallet, string name, string metadataUri, uint16 eloRating, uint32 gamesPlayed, uint32 gamesWon, uint32 gamesDrawn, uint32 gamesLost, uint32 tournamentsEntered, uint32 tournamentsWon, uint128 totalEarnings, uint64 registeredAt, bool isVerified, uint8 agentType))',
]);

export class WalletManager {
  public readonly address: Address;
  public readonly wallet: WalletClient;
  public readonly publicClient: PublicClient;

  private account;
  private chain: Chain;

  constructor(privateKey: Hex, rpcUrl?: string) {
    const chain: Chain = { ...monad };
    if (rpcUrl) {
      chain.rpcUrls = { default: { http: [rpcUrl] } };
    }
    this.chain = chain;

    this.account = privateKeyToAccount(privateKey);
    this.address = this.account.address;

    this.wallet = createWalletClient({
      account: this.account,
      chain,
      transport: http(),
    });

    this.publicClient = createPublicClient({
      chain,
      transport: http(),
    });
  }

  /** Sign a message (for auth challenge-response) */
  async signMessage(message: string): Promise<Hex> {
    return this.account.signMessage({ message });
  }

  /** Get USDC balance (returns human-readable, 6 decimals) */
  async getUsdcBalance(): Promise<number> {
    const balance = await this.publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [this.address],
    });
    return Number(formatUnits(balance, 6));
  }

  /** Get MON balance */
  async getMonBalance(): Promise<bigint> {
    return this.publicClient.getBalance({ address: this.address });
  }

  /** Approve USDC spending for tournament contract */
  async approveUsdc(amount: bigint, spender: Address = TOURNAMENT_V3): Promise<Hex> {
    const hash = await this.wallet.writeContract({
      account: this.account,
      chain: this.chain,
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender, amount],
    });
    return hash;
  }

  /** Check if USDC allowance is sufficient */
  async checkAllowance(spender: Address = TOURNAMENT_V3): Promise<bigint> {
    return this.publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [this.address, spender],
    });
  }

  /** Register agent on-chain */
  async registerAgent(name: string, metadataUri: string, referrer?: Address): Promise<Hex> {
    if (referrer) {
      return this.wallet.writeContract({
        account: this.account,
        chain: this.chain,
        address: TOURNAMENT_V3,
        abi: TOURNAMENT_ABI,
        functionName: 'registerAgentWithReferral',
        args: [name, metadataUri, 2, referrer], // agentType 2 = custom
      });
    }
    return this.wallet.writeContract({
      account: this.account,
      chain: this.chain,
      address: TOURNAMENT_V3,
      abi: TOURNAMENT_ABI,
      functionName: 'registerAgent',
      args: [name, metadataUri, 2],
    });
  }

  /** Register for tournament on-chain */
  async registerForTournament(tournamentId: number): Promise<Hex> {
    return this.wallet.writeContract({
      account: this.account,
      chain: this.chain,
      address: TOURNAMENT_V3,
      abi: TOURNAMENT_ABI,
      functionName: 'registerForTournament',
      args: [BigInt(tournamentId)],
    });
  }

  /** Check if agent is registered on-chain */
  async isRegistered(): Promise<boolean> {
    try {
      const agent = await this.publicClient.readContract({
        address: TOURNAMENT_V3,
        abi: TOURNAMENT_ABI,
        functionName: 'getAgent',
        args: [this.address],
      });
      return agent.registeredAt > 0n;
    } catch {
      return false;
    }
  }
}
