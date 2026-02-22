import "dotenv/config";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function optionalInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid integer, got: ${raw}`);
  }
  return parsed;
}

export const CONFIG = {
  /** Private key of the relayer wallet that pays gas */
  relayerPrivateKey: requireEnv("RELAYER_PRIVATE_KEY") as `0x${string}`,

  /** Monad RPC endpoint */
  rpcUrl: optionalEnv("MONAD_RPC", "https://rpc.monad.xyz/"),

  /** HTTP server port */
  port: optionalInt("PORT", 3004),

  /** ChessForwarder contract address on Monad mainnet */
  forwarderAddress: "0x99088C6D13113219B9fdA263Acb0229677c1658A" as `0x${string}`,

  /** Monad chain ID */
  chainId: 143,

  /** Maximum relay requests per agent within the rate limit window */
  maxRelaysPerAgent: optionalInt("MAX_RELAYS_PER_AGENT", 10),

  /** Rate limit window in milliseconds (default: 60 seconds) */
  rateLimitWindowMs: optionalInt("RATE_LIMIT_WINDOW_MS", 60_000),
} as const;
