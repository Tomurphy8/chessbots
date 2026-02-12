import { describe, it, expect, beforeEach } from 'vitest';
import { createChallenge, consumeChallenge } from '../auth/challenge.js';
import { signToken, verifyToken } from '../auth/jwt.js';
import { verifyWalletSignature } from '../auth/verify.js';
import { checkMoveRateLimit } from '../middleware/rateLimit.js';

describe('Challenge', () => {
  it('creates a challenge with nonce and expiry', () => {
    const result = createChallenge('0x388a08E5CE0722A2A5C690C76e2118f169d626c0');
    expect(result).not.toBeNull();
    expect(result!.nonce).toBeTruthy();
    expect(result!.challenge).toContain('ChessBots');
    expect(result!.challenge).toContain('0x388a08E5CE0722A2A5C690C76e2118f169d626c0');
    expect(result!.expiresAt).toBeGreaterThan(Date.now());
  });

  it('consumes a challenge (single-use)', () => {
    const wallet = '0x388a08E5CE0722A2A5C690C76e2118f169d626c0';
    const result = createChallenge(wallet);
    expect(result).not.toBeNull();
    const { nonce } = result!;

    const msg1 = consumeChallenge(nonce, wallet);
    expect(msg1).toBeTruthy();

    const msg2 = consumeChallenge(nonce, wallet);
    expect(msg2).toBeNull(); // already consumed
  });

  it('rejects wrong wallet for challenge', () => {
    const result = createChallenge('0x388a08E5CE0722A2A5C690C76e2118f169d626c0');
    expect(result).not.toBeNull();
    const msg = consumeChallenge(result!.nonce, '0x0000000000000000000000000000000000000001');
    expect(msg).toBeNull();
  });

  it('rejects invalid nonce', () => {
    const msg = consumeChallenge('nonexistent-nonce', '0x388a08E5CE0722A2A5C690C76e2118f169d626c0');
    expect(msg).toBeNull();
  });
});

describe('JWT', () => {
  it('signs and verifies a token', async () => {
    const wallet = '0x388a08E5CE0722A2A5C690C76e2118f169d626c0';
    const { token, expiresAt } = await signToken(wallet);

    expect(token).toBeTruthy();
    expect(expiresAt).toBeGreaterThan(Date.now());

    const payload = await verifyToken(token);
    expect(payload).toBeTruthy();
    expect(payload!.sub).toBe(wallet);
  });

  it('rejects invalid token', async () => {
    const payload = await verifyToken('invalid.jwt.token');
    expect(payload).toBeNull();
  });

  it('rejects empty token', async () => {
    const payload = await verifyToken('');
    expect(payload).toBeNull();
  });
});

describe('Rate Limit', () => {
  it('allows first move', () => {
    const ok = checkMoveRateLimit('unique-game-1', '0xAgent1');
    expect(ok).toBe(true);
  });

  it('blocks rapid moves on same game', () => {
    const gameId = 'ratelimit-test-game';
    const wallet = '0xRateLimitAgent';
    checkMoveRateLimit(gameId, wallet);
    const ok = checkMoveRateLimit(gameId, wallet);
    expect(ok).toBe(false);
  });

  it('allows moves on different games', () => {
    const wallet = '0xMultiGameAgent';
    const ok1 = checkMoveRateLimit('game-a', wallet);
    const ok2 = checkMoveRateLimit('game-b', wallet);
    expect(ok1).toBe(true);
    expect(ok2).toBe(true);
  });
});
