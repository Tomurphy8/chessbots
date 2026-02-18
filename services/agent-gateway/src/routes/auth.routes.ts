import { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createChallenge, consumeChallenge } from '../auth/challenge.js';
import { verifyWalletSignature } from '../auth/verify.js';
import { signToken } from '../auth/jwt.js';
import { CONFIG } from '../config.js';
import type { WebhookRegistry } from '../indexer/WebhookRegistry.js';

const ChallengeSchema = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address'),
});

const VerifySchema = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address'),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/).max(200),
  nonce: z.string().uuid(),
  notifyUrl: z.string().url().max(256).optional(),
});

// GW-H2: Per-IP rate limiting for auth endpoints
const authAttempts = new Map<string, { count: number; resetAt: number }>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of authAttempts) {
    if (now > entry.resetAt) authAttempts.delete(key);
  }
}, 5 * 60_000);

function checkAuthRateLimit(request: FastifyRequest): boolean {
  const ip = request.ip || 'unknown';
  const now = Date.now();
  const windowMs = 60_000; // 1 minute window
  const maxPerMinute = CONFIG.authRateLimitPerMinute;

  const entry = authAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    authAttempts.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }

  entry.count++;
  return entry.count <= maxPerMinute;
}

export function registerAuthRoutes(app: FastifyInstance, webhookRegistry?: WebhookRegistry) {
  // POST /api/auth/challenge - Request a nonce challenge for wallet authentication
  app.post('/api/auth/challenge', async (request, reply) => {
    if (!checkAuthRateLimit(request)) {
      return reply.status(429).send({ error: 'Too many requests. Try again later.' });
    }
    try {
      const { wallet } = ChallengeSchema.parse(request.body);
      const result = createChallenge(wallet);
      if (!result) {
        return reply.status(503).send({ error: 'Service busy. Try again later.' });
      }
      return reply.send(result);
    } catch (err: any) {
      if (err.name === 'ZodError') return reply.status(400).send({ error: 'Invalid input' });
      return reply.status(500).send({ error: 'Internal error' });
    }
  });

  // POST /api/auth/verify - Submit signed challenge, receive JWT
  app.post('/api/auth/verify', async (request, reply) => {
    if (!checkAuthRateLimit(request)) {
      return reply.status(429).send({ error: 'Too many requests. Try again later.' });
    }
    try {
      const { wallet, signature, nonce, notifyUrl } = VerifySchema.parse(request.body);

      const message = consumeChallenge(nonce, wallet);
      if (!message) {
        return reply.status(400).send({ error: 'Invalid or expired challenge. Request a new one.' });
      }

      const verifiedWallet = await verifyWalletSignature(message, signature, wallet);
      if (!verifiedWallet) {
        return reply.status(401).send({ error: 'Invalid signature.' });
      }

      // Auto-register webhook if notifyUrl provided (zero-friction, non-blocking)
      let webhookRegistered = false;
      if (notifyUrl && webhookRegistry) {
        const result = webhookRegistry.register(verifiedWallet, notifyUrl);
        webhookRegistered = result.ok;
      }

      const { token, expiresAt } = await signToken(verifiedWallet);
      return reply.send({ token, expiresAt, wallet: verifiedWallet, webhookRegistered });
    } catch (err: any) {
      if (err.name === 'ZodError') return reply.status(400).send({ error: 'Invalid input' });
      return reply.status(500).send({ error: 'Internal error' });
    }
  });
}
