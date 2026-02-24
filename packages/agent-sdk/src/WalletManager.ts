import {
  createWalletClient,
  createPublicClient,
  http,
  encodeFunctionData,
  type WalletClient,
  type PublicClient,
  type Address,
  type Hex,
  type Chain,
  parseAbi,
  formatUnits,
} from 'viem';
import type { RelayerClient, RelayRequest } from './RelayerClient.js';
import { privateKeyToAccount } from 'viem/accounts';

const monad: Chain = {
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } },
};

const USDC_ADDRESS = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603' as Address;
const TOURNAMENT_V3 = '0x0e2663b0DCD9b7408d51C6972f679B81a5A7477e' as Address;
const TOURNAMENT_V4 = '0xa6B8eA116E16321B98fa9aCCfb63Cf0933c7e787' as Address;

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
  // Referral economics
  'function referralEarnings(address account) view returns (uint256)',
  'function referralCount(address account) view returns (uint16)',
  'function getReferrerTier(address referrer) view returns (uint8 tier, uint16 rateBps, uint16 count)',
  'function claimReferralEarnings()',
]);

// ── Meta-Transaction (EIP-712) Constants ─────────────────────────────────

const FORWARDER_ADDRESS = '0x99088C6D13113219B9fdA263Acb0229677c1658A' as Address;

const EIP712_DOMAIN = {
  name: 'ChessForwarder' as const,
  version: '1' as const,
  chainId: 143n,
  verifyingContract: FORWARDER_ADDRESS,
};

const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint48' },
    { name: 'data', type: 'bytes' },
  ],
} as const;

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
  async approveUsdc(amount: bigint, spender: Address = TOURNAMENT_V4): Promise<Hex> {
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
  async checkAllowance(spender: Address = TOURNAMENT_V4): Promise<bigint> {
    return this.publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [this.address, spender],
    });
  }

  /** Register agent on-chain (gasless via relayer if available) */
  async registerAgent(
    name: string,
    metadataUri: string,
    referrer?: Address,
    contract: Address = TOURNAMENT_V4,
    relayer?: RelayerClient,
  ): Promise<Hex> {
    const directWrite = () =>
      referrer
        ? this.wallet.writeContract({
            account: this.account,
            chain: this.chain,
            address: contract,
            abi: TOURNAMENT_ABI,
            functionName: 'registerAgentWithReferral',
            args: [name, metadataUri, 2, referrer],
          })
        : this.wallet.writeContract({
            account: this.account,
            chain: this.chain,
            address: contract,
            abi: TOURNAMENT_ABI,
            functionName: 'registerAgent',
            args: [name, metadataUri, 2],
          });

    const calldata = referrer
      ? encodeFunctionData({
          abi: TOURNAMENT_ABI,
          functionName: 'registerAgentWithReferral',
          args: [name, metadataUri, 2, referrer],
        })
      : encodeFunctionData({
          abi: TOURNAMENT_ABI,
          functionName: 'registerAgent',
          args: [name, metadataUri, 2],
        });

    return this._relayOrWrite(relayer, contract, calldata, directWrite);
  }

  /** Register for tournament on-chain (gasless via relayer if available) */
  async registerForTournament(
    tournamentId: number,
    contract: Address = TOURNAMENT_V4,
    relayer?: RelayerClient,
  ): Promise<Hex> {
    const calldata = encodeFunctionData({
      abi: TOURNAMENT_ABI,
      functionName: 'registerForTournament',
      args: [BigInt(tournamentId)],
    });

    return this._relayOrWrite(
      relayer,
      contract,
      calldata,
      () =>
        this.wallet.writeContract({
          account: this.account,
          chain: this.chain,
          address: contract,
          abi: TOURNAMENT_ABI,
          functionName: 'registerForTournament',
          args: [BigInt(tournamentId)],
        }),
    );
  }

  /** Check if agent is registered on-chain */
  async isRegistered(contract: Address = TOURNAMENT_V4): Promise<boolean> {
    try {
      const agent = await this.publicClient.readContract({
        address: contract,
        abi: TOURNAMENT_ABI,
        functionName: 'getAgent',
        args: [this.address],
      });
      return agent.registeredAt > 0n;
    } catch {
      return false;
    }
  }

  // ── Referral Economics ───────────────────────────────────────────────

  /** Get accumulated referral earnings in USDC (human-readable, 6 decimals) */
  async getReferralEarnings(): Promise<number> {
    const earnings = await this.publicClient.readContract({
      address: TOURNAMENT_V4,
      abi: TOURNAMENT_ABI,
      functionName: 'referralEarnings',
      args: [this.address],
    });
    return Number(formatUnits(earnings, 6));
  }

  /** Get number of agents this address has referred */
  async getReferralCount(): Promise<number> {
    const count = await this.publicClient.readContract({
      address: TOURNAMENT_V4,
      abi: TOURNAMENT_ABI,
      functionName: 'referralCount',
      args: [this.address],
    });
    return Number(count);
  }

  /** Get referral tier info: tier (0=Bronze,1=Silver,2=Gold), rate in bps, and count */
  async getReferrerTier(): Promise<{ tier: number; rateBps: number; count: number }> {
    const [tier, rateBps, count] = await this.publicClient.readContract({
      address: TOURNAMENT_V4,
      abi: TOURNAMENT_ABI,
      functionName: 'getReferrerTier',
      args: [this.address],
    });
    return { tier: Number(tier), rateBps: Number(rateBps), count: Number(count) };
  }

  /** Claim accumulated referral earnings — gasless via relayer if available */
  async claimReferralEarnings(
    contract: Address = TOURNAMENT_V4,
    relayer?: RelayerClient,
  ): Promise<Hex> {
    const calldata = encodeFunctionData({
      abi: TOURNAMENT_ABI,
      functionName: 'claimReferralEarnings',
      args: [],
    });

    return this._relayOrWrite(
      relayer,
      contract,
      calldata,
      () =>
        this.wallet.writeContract({
          account: this.account,
          chain: this.chain,
          address: contract,
          abi: TOURNAMENT_ABI,
          functionName: 'claimReferralEarnings',
          args: [],
        }),
    );
  }

  // ── Meta-Transaction Helpers ──────────────────────────────────────────

  /** Sign an EIP-712 ForwardRequest for the ChessForwarder */
  async signForwardRequest(request: {
    from: Address;
    to: Address;
    value: bigint;
    gas: bigint;
    nonce: bigint;
    deadline: number;
    data: Hex;
  }): Promise<Hex> {
    return this.account.signTypedData({
      domain: EIP712_DOMAIN,
      types: FORWARD_REQUEST_TYPES,
      primaryType: 'ForwardRequest',
      message: request,
    });
  }

  /**
   * Try to execute a contract call via the relayer (gasless meta-tx).
   * Falls back to direct writeContract if relayer is unavailable or fails.
   */
  private async _relayOrWrite(
    relayer: RelayerClient | undefined,
    contract: Address,
    calldata: Hex,
    directWrite: () => Promise<Hex>,
    gasLimit: bigint = 500_000n,
  ): Promise<Hex> {
    if (!relayer) return directWrite();

    try {
      const available = await relayer.isAvailable();
      if (!available) return directWrite();

      // Get nonce from relayer
      const nonce = await relayer.getNonce(this.address);

      // Build forward request
      const forwardRequest = {
        from: this.address,
        to: contract,
        value: 0n,
        gas: gasLimit,
        nonce,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        data: calldata,
      };

      // Sign EIP-712
      const signature = await this.signForwardRequest(forwardRequest);

      // Serialize BigInts as strings for JSON transport
      const relayRequest: RelayRequest = {
        from: forwardRequest.from,
        to: forwardRequest.to,
        value: forwardRequest.value.toString(),
        gas: forwardRequest.gas.toString(),
        nonce: forwardRequest.nonce.toString(),
        deadline: forwardRequest.deadline,
        data: forwardRequest.data,
      };

      const result = await relayer.relay(relayRequest, signature);
      return result.txHash;
    } catch {
      // Relayer failed — fall back to direct write
      return directWrite();
    }
  }
}
