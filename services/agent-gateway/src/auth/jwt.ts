import { SignJWT, jwtVerify } from 'jose';
import { CONFIG } from '../config.js';
import type { JWTPayload } from '../types/index.js';

const secret = new TextEncoder().encode(CONFIG.jwtSecret);

// GW-JWT1: Standard JWT claims for service isolation
const JWT_ISSUER = 'chessbots-agent-gateway';
const JWT_AUDIENCE = 'chessbots-agent-gateway';

export async function signToken(wallet: string): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Math.floor(Date.now() / 1000) + CONFIG.jwtExpirySeconds;
  const token = await new SignJWT({ sub: wallet })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(expiresAt)
    .sign(secret);

  return { token, expiresAt: expiresAt * 1000 };
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}
