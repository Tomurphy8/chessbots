import 'dotenv/config';

// GW-C1: Crash if JWT_SECRET not set (no hardcoded fallback)
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  console.error('FATAL: JWT_SECRET environment variable must be set and at least 32 characters.');
  console.error('Generate one with: openssl rand -hex 32');
  process.exit(1);
}

// Service-to-service auth key for chess engine
const serviceApiKey = process.env.SERVICE_API_KEY;
if (!serviceApiKey || serviceApiKey.length < 16) {
  console.error('FATAL: SERVICE_API_KEY environment variable must be set and at least 16 characters.');
  process.exit(1);
}

// CORS: parse allowed origins
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map(s => s.trim());

export const CONFIG = {
  port: parseInt(process.env.PORT || process.env.GATEWAY_PORT || '3002', 10),
  host: process.env.GATEWAY_HOST || '::',  // '::' binds to both IPv4 and IPv6 (required for Railway)

  // Internal chess engine
  chessEngineUrl: process.env.CHESS_ENGINE_URL || 'http://localhost:3001',
  serviceApiKey,

  // JWT
  jwtSecret,
  jwtExpirySeconds: 24 * 60 * 60, // 24 hours

  // Challenge
  challengeTtlMs: 5 * 60 * 1000, // 5 minutes
  maxChallenges: 10_000, // GW-H1: cap challenge store size

  // Rate limiting
  moveRateLimitMs: 1000, // 1 move per second per game per agent
  authRateLimitPerMinute: 10, // GW-H2: auth endpoint rate limit
  publicApiRateLimitPerMinute: 60, // GW-H3: public GET endpoint rate limit per IP

  // CORS
  allowedOrigins,

  // Monad RPC for on-chain reads
  monadRpcUrl: process.env.MONAD_RPC || 'https://rpc.monad.xyz/',
  contractAddress: process.env.MONAD_CONTRACT || '0x952d995DA79deDC98dD20A18036eb7464f0002fd',

  // Block at which the V3 contract was deployed (for event scanning)
  deployBlock: BigInt(process.env.DEPLOY_BLOCK || '55948950'),
} as const;
