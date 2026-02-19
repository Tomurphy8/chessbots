import { CONFIG } from '../config.js';
import type { GameInfo, MoveResponse } from '../types/index.js';

const BASE = CONFIG.chessEngineUrl;

// GW-H3: validate gameId format before using in URL
const GAME_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
function validateGameId(gameId: string): void {
  if (!GAME_ID_REGEX.test(gameId)) throw new Error('Invalid game ID format');
}

async function fetchEngine<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Service-Key': CONFIG.serviceApiKey, // Service-to-service auth
      ...options?.headers,
    },
  });
  if (!res.ok) {
    // Sanitize error — don't leak internal engine details
    if (res.status === 404) throw new Error('Game not found');
    if (res.status === 400) throw new Error('Invalid request');
    if (res.status === 403) throw new Error('Unauthorized');
    throw new Error('Chess engine unavailable');
  }
  return res.json() as Promise<T>;
}

export async function getGameInfo(gameId: string): Promise<GameInfo> {
  validateGameId(gameId);
  return fetchEngine<GameInfo>(`/api/game/${gameId}`);
}

export async function getLegalMoves(gameId: string): Promise<{ moves: string[] }> {
  validateGameId(gameId);
  return fetchEngine<{ moves: string[] }>(`/api/game/${gameId}/legal-moves`);
}

export async function getGamePgn(gameId: string): Promise<string> {
  validateGameId(gameId);
  const res = await fetch(`${BASE}/api/game/${gameId}/pgn`, {
    headers: { 'X-Service-Key': CONFIG.serviceApiKey },
  });
  if (!res.ok) throw new Error('Game not found');
  return res.text();
}

export async function submitMove(gameId: string, player: string, move: string): Promise<MoveResponse> {
  validateGameId(gameId);
  return fetchEngine<MoveResponse>(`/api/game/${gameId}/move`, {
    method: 'POST',
    body: JSON.stringify({
      player,
      move,
      signature: '', // Gateway handles auth via JWT; engine uses service key
      timestamp: Date.now(),
    }),
  });
}

export async function submitResign(gameId: string, player: string): Promise<GameInfo> {
  validateGameId(gameId);
  return fetchEngine<GameInfo>(`/api/game/${gameId}/resign`, {
    method: 'POST',
    body: JSON.stringify({ player }),
  });
}

export async function getActiveGames(): Promise<GameInfo[]> {
  return fetchEngine<GameInfo[]>('/api/games/active');
}

export async function getAllGames(): Promise<{ games: GameInfo[] }> {
  return fetchEngine<{ games: GameInfo[] }>('/api/games/all');
}

export async function healthCheck(): Promise<{ status: string }> {
  return fetchEngine<{ status: string }>('/api/health');
}
