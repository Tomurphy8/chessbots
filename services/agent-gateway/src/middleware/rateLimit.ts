import { type FastifyRequest } from 'fastify';
import { CONFIG } from '../config.js';

// ── Move Rate Limiting (per-game, per-agent) ────────────────────────────────

// Key: `${gameId}:${wallet}` -> last move timestamp
const moveTimestamps = new Map<string, number>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [key, ts] of moveTimestamps) {
    if (ts < cutoff) moveTimestamps.delete(key);
  }
}, 5 * 60_000).unref();

export function checkMoveRateLimit(gameId: string, wallet: string): boolean {
  const key = `${gameId}:${wallet.toLowerCase()}`;
  const last = moveTimestamps.get(key);
  const now = Date.now();

  if (last && now - last < CONFIG.moveRateLimitMs) {
    return false; // Rate limited
  }

  moveTimestamps.set(key, now);
  return true;
}

// ── Public API Rate Limiting (per-IP, shared across all public routes) ──────

const publicApiAttempts = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of publicApiAttempts) {
    if (now > entry.resetAt) publicApiAttempts.delete(ip);
  }
}, 5 * 60_000).unref();

/**
 * GW-RL1: Consolidated public API rate limiter.
 * Shared across all public routes (game + tournament) so a single IP
 * can't exceed the configured limit by hitting different route files.
 */
export function checkPublicRateLimit(request: FastifyRequest): boolean {
  const ip = request.ip || 'unknown';
  const now = Date.now();
  const entry = publicApiAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    publicApiAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count++;
  return entry.count <= CONFIG.publicApiRateLimitPerMinute;
}
