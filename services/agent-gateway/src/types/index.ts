import type { Address } from 'viem';

// --- Auth Types ---

export interface ChallengeRequest {
  wallet: string;
}

export interface ChallengeResponse {
  challenge: string;
  nonce: string;
  expiresAt: number;
}

export interface VerifyRequest {
  wallet: string;
  signature: string;
  nonce: string;
}

export interface VerifyResponse {
  token: string;
  expiresAt: number;
  wallet: string;
}

export interface JWTPayload {
  sub: string;   // wallet address (checksummed)
  iat: number;
  exp: number;
}

// --- Game Types (mirrors chess engine) ---

export interface GameInfo {
  gameId: string;
  tournamentId: number;
  round: number;
  gameIndex: number;
  white: string;
  black: string;
  status: string;
  result: string;
  fen: string;
  moves: string[];
  moveCount: number;
  startedAt: number;
  timeControl: { baseTimeSeconds: number; incrementSeconds: number };
  whiteTimeMs: number;
  blackTimeMs: number;
}

export interface MoveSubmission {
  move: string;
}

export interface MoveResponse {
  success: boolean;
  info?: GameInfo;
  error?: string;
}

// --- Fastify augmentation ---

declare module 'fastify' {
  interface FastifyRequest {
    wallet?: Address;
  }
}
