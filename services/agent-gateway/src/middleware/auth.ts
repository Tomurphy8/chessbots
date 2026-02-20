import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { verifyToken } from '../auth/jwt.js';
import { type Address } from 'viem';

export function registerAuthMiddleware(app: FastifyInstance) {
  app.decorateRequest('wallet', undefined);
}

/**
 * Optional auth: sets request.wallet if a valid JWT is provided, but does NOT
 * reject the request if missing/invalid. Used on public endpoints to skip rate
 * limits for authenticated bots while still allowing anonymous access.
 */
export async function optionalAuth(request: FastifyRequest, _reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return;
  const token = authHeader.slice(7);
  const payload = await verifyToken(token);
  if (payload) {
    request.wallet = payload.sub as Address;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid Authorization header. Use: Bearer <token>' });
  }

  const token = authHeader.slice(7);
  const payload = await verifyToken(token);
  if (!payload) {
    return reply.status(401).send({ error: 'Invalid or expired token. Re-authenticate via /api/auth/challenge' });
  }

  request.wallet = payload.sub as Address;
}
