import {
  createPublicClient,
  createWalletClient,
  http,
  type Hash,
  type Address,
  type Chain,
  getAddress,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { CONFIG } from "./config.js";

// ── Monad chain definition ──────────────────────────────────────────────────

const monad: Chain = {
  id: CONFIG.chainId,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [CONFIG.rpcUrl] },
  },
};

// ── ForwardRequest type ─────────────────────────────────────────────────────

export interface ForwardRequest {
  from: Address;
  to: Address;
  value: bigint;
  gas: bigint;
  nonce: bigint;
  deadline: number; // uint48
  data: `0x${string}`;
}

// ── ABI (minimal subset for execute, verify, getNonce) ──────────────────────

const FORWARDER_ABI = [
  {
    name: "execute",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "req",
        type: "tuple",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint48" },
          { name: "data", type: "bytes" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [
      { name: "success", type: "bool" },
      { name: "returndata", type: "bytes" },
    ],
  },
  {
    name: "verify",
    type: "function",
    stateMutability: "view",
    inputs: [
      {
        name: "req",
        type: "tuple",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint48" },
          { name: "data", type: "bytes" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getNonce",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "from", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ── Rate limiter ────────────────────────────────────────────────────────────

interface RateLimitEntry {
  timestamps: number[];
}

class RateLimiter {
  private entries = new Map<string, RateLimitEntry>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {
    // Purge stale entries every 5 minutes
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60_000);
    // Allow Node to exit even if the timer is pending
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /** Returns true if the request is allowed, false if rate-limited. */
  check(key: string): boolean {
    const now = Date.now();
    const entry = this.entries.get(key);

    if (!entry) {
      this.entries.set(key, { timestamps: [now] });
      return true;
    }

    // Evict timestamps outside the current window
    entry.timestamps = entry.timestamps.filter(
      (t) => now - t < this.windowMs,
    );

    if (entry.timestamps.length >= this.maxRequests) {
      return false;
    }

    entry.timestamps.push(now);
    return true;
  }

  /** Remove entries that have no recent timestamps. */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      entry.timestamps = entry.timestamps.filter(
        (t) => now - t < this.windowMs,
      );
      if (entry.timestamps.length === 0) {
        this.entries.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
  }
}

// ── Relayer class ───────────────────────────────────────────────────────────

export interface RelayResult {
  success: boolean;
  txHash: Hash;
}

export class Relayer {
  private readonly publicClient;
  private readonly walletClient;
  private readonly account: PrivateKeyAccount;
  readonly walletAddress: Address;
  private readonly rateLimiter: RateLimiter;

  constructor() {
    this.account = privateKeyToAccount(CONFIG.relayerPrivateKey);
    this.walletAddress = this.account.address;

    this.publicClient = createPublicClient({
      chain: monad,
      transport: http(CONFIG.rpcUrl),
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain: monad,
      transport: http(CONFIG.rpcUrl),
    });

    this.rateLimiter = new RateLimiter(
      CONFIG.maxRelaysPerAgent,
      CONFIG.rateLimitWindowMs,
    );

    console.log(`[relayer] Wallet address: ${this.walletAddress}`);
  }

  // ── relay ───────────────────────────────────────────────────────────────

  async relay(
    request: ForwardRequest,
    signature: `0x${string}`,
  ): Promise<RelayResult> {
    const from = getAddress(request.from);

    // 1. Rate limit check
    if (!this.rateLimiter.check(from.toLowerCase())) {
      throw new RelayError(
        429,
        `Rate limited: max ${CONFIG.maxRelaysPerAgent} relays per ${CONFIG.rateLimitWindowMs / 1000}s window`,
      );
    }

    // 2. Verify signature on-chain before spending gas
    let verified: boolean;
    try {
      verified = (await this.publicClient.readContract({
        address: CONFIG.forwarderAddress,
        abi: FORWARDER_ABI,
        functionName: "verify",
        args: [toContractRequest(request), signature],
      })) as boolean;
    } catch (err) {
      throw new RelayError(
        400,
        `Signature verification call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!verified) {
      throw new RelayError(400, "Invalid signature: on-chain verify() returned false");
    }

    // 3. Submit the execute transaction
    let txHash: Hash;
    try {
      txHash = await this.walletClient.writeContract({
        address: CONFIG.forwarderAddress,
        abi: FORWARDER_ABI,
        functionName: "execute",
        args: [toContractRequest(request), signature],
        value: request.value,
      });
    } catch (err) {
      throw new RelayError(
        502,
        `Transaction submission failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 4. Wait for receipt
    let receipt;
    try {
      receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 60_000,
      });
    } catch (err) {
      // The tx was submitted but we failed to get receipt -- still return hash
      console.warn(
        `[relayer] Tx ${txHash} submitted but receipt wait failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { success: false, txHash };
    }

    return {
      success: receipt.status === "success",
      txHash,
    };
  }

  // ── getNonce ────────────────────────────────────────────────────────────

  async getNonce(address: Address): Promise<bigint> {
    const nonce = (await this.publicClient.readContract({
      address: CONFIG.forwarderAddress,
      abi: FORWARDER_ABI,
      functionName: "getNonce",
      args: [getAddress(address)],
    })) as bigint;
    return nonce;
  }

  // ── cleanup ─────────────────────────────────────────────────────────────

  destroy(): void {
    this.rateLimiter.destroy();
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Convert our ForwardRequest to the tuple shape expected by the ABI. */
function toContractRequest(req: ForwardRequest) {
  return {
    from: getAddress(req.from),
    to: getAddress(req.to),
    value: req.value,
    gas: req.gas,
    nonce: req.nonce,
    deadline: req.deadline,
    data: req.data,
  } as const;
}

/** Typed error with an HTTP status code for the API layer. */
export class RelayError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "RelayError";
  }
}
