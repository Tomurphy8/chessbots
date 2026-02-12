import { randomUUID } from 'crypto';
import { CONFIG } from '../config.js';

interface PendingChallenge {
  nonce: string;
  wallet: string;
  message: string;
  expiresAt: number;
}

const challenges = new Map<string, PendingChallenge>();

// Periodic cleanup of expired challenges (every 30 seconds)
setInterval(() => {
  const now = Date.now();
  for (const [nonce, challenge] of challenges) {
    if (challenge.expiresAt < now) challenges.delete(nonce);
  }
}, 30_000);

export function createChallenge(wallet: string): { challenge: string; nonce: string; expiresAt: number } | null {
  // GW-H1: cap challenge store to prevent memory DoS
  if (challenges.size >= CONFIG.maxChallenges) {
    return null; // Caller should return 429
  }

  const nonce = randomUUID();
  const expiresAt = Date.now() + CONFIG.challengeTtlMs;
  const message = [
    'Sign this message to authenticate with ChessBots:',
    `Nonce: ${nonce}`,
    `Timestamp: ${new Date().toISOString()}`,
    `Wallet: ${wallet}`,
  ].join('\n');

  challenges.set(nonce, { nonce, wallet: wallet.toLowerCase(), message, expiresAt });

  return { challenge: message, nonce, expiresAt };
}

export function consumeChallenge(nonce: string, wallet: string): string | null {
  const challenge = challenges.get(nonce);
  if (!challenge) return null;
  if (challenge.expiresAt < Date.now()) {
    challenges.delete(nonce);
    return null;
  }
  if (challenge.wallet !== wallet.toLowerCase()) return null;

  challenges.delete(nonce); // Single-use
  return challenge.message;
}
