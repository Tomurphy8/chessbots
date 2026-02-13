import type { Pairing, TournamentConfig } from '../types/index.js';

const GAME_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * HTTP client for the chess engine service.
 * Creates games, polls status, and retrieves results.
 * TO-H1: Includes service auth header, retry logic, and input validation.
 */
export class ChessEngineClient {
  private baseUrl: string;
  private serviceKey: string;
  private maxRetries: number;

  constructor(baseUrl: string = 'http://localhost:3001', serviceKey?: string) {
    this.baseUrl = baseUrl;
    this.serviceKey = serviceKey || process.env.SERVICE_API_KEY || '';
    this.maxRetries = 3;
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      // Only set Content-Type when we have a body (Fastify rejects empty body with JSON content-type)
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(this.serviceKey ? { 'x-service-key': this.serviceKey } : {}),
      ...(options?.headers as Record<string, string> || {}),
    };

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          ...options,
          headers,
          signal: AbortSignal.timeout(10_000), // TO-H2: 10s request timeout
        });
        if (!res.ok) {
          const body = await res.text().catch(() => 'Unknown error');
          throw new Error(`Chess engine error (${res.status}): ${body}`);
        }
        return res.json() as Promise<T>;
      } catch (err: any) {
        lastError = err;
        // Only retry on network/timeout errors, not 4xx
        if (err.message?.includes('(4')) break;
        if (attempt < this.maxRetries - 1) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // Exponential backoff
        }
      }
    }
    throw lastError || new Error('Chess engine request failed');
  }

  async createGame(
    tournamentId: number,
    round: number,
    gameIndex: number,
    white: string,
    black: string,
    timeControl: { baseTimeSeconds: number; incrementSeconds: number },
  ): Promise<any> {
    const gameId = `t${tournamentId}-r${round}-g${gameIndex}`;
    return this.fetch('/api/game', {
      method: 'POST',
      body: JSON.stringify({
        gameId,
        tournamentId,
        round,
        gameIndex,
        white,
        black,
        baseTimeSeconds: timeControl.baseTimeSeconds,
        incrementSeconds: timeControl.incrementSeconds,
      }),
    });
  }

  async startGame(gameId: string): Promise<any> {
    if (!GAME_ID_REGEX.test(gameId)) throw new Error('Invalid game ID format');
    return this.fetch(`/api/game/${encodeURIComponent(gameId)}/start`, { method: 'POST' });
  }

  async getGameInfo(gameId: string): Promise<any> {
    if (!GAME_ID_REGEX.test(gameId)) throw new Error('Invalid game ID format');
    return this.fetch(`/api/game/${encodeURIComponent(gameId)}`);
  }

  async getActiveGames(): Promise<any[]> {
    return this.fetch<any[]>('/api/games/active');
  }

  async healthCheck(): Promise<{ status: string }> {
    return this.fetch('/api/health');
  }

  /**
   * Create and start all games for a round.
   * Returns an array of gameIds.
   * TO-H1 (R6): Fail-fast — if ANY game creation fails, throw immediately.
   * This prevents desync between engine and on-chain state where on-chain
   * games reference engine games that don't exist.
   */
  async createRoundGames(
    tournamentId: number,
    round: number,
    pairings: Pairing[],
    timeControl: { baseTimeSeconds: number; incrementSeconds: number },
  ): Promise<string[]> {
    const gameIds: string[] = [];

    for (const pairing of pairings) {
      const gameId = `t${tournamentId}-r${round}-g${pairing.gameIndex}`;
      // Fail-fast: any failure aborts the entire round before on-chain commit
      await this.createGame(tournamentId, round, pairing.gameIndex, pairing.white, pairing.black, timeControl);
      await this.startGame(gameId);
      gameIds.push(gameId);
    }

    return gameIds;
  }

  /**
   * Poll games until all are completed. Returns results.
   * TO-H4: Handles partial completion gracefully — returns whatever completed within timeout.
   */
  async waitForGamesCompletion(
    gameIds: string[],
    pollIntervalMs: number = 2000,
    timeoutMs: number = 30 * 60 * 1000, // 30 minutes max
  ): Promise<Map<string, any>> {
    const results = new Map<string, any>();
    const startTime = Date.now();
    let consecutiveErrors = 0;

    while (results.size < gameIds.length) {
      if (Date.now() - startTime > timeoutMs) {
        console.warn(`  Timeout: ${results.size}/${gameIds.length} games completed`);
        break; // Return partial results instead of throwing
      }

      // TO-H5: Circuit breaker — if engine is down, stop polling
      if (consecutiveErrors >= 10) {
        console.error('  Chess engine appears unreachable. Stopping poll.');
        break;
      }

      let hadError = false;
      for (const gameId of gameIds) {
        if (results.has(gameId)) continue;

        try {
          const info = await this.getGameInfo(gameId);
          if (info.status === 'completed' || info.status === 'adjudicated') {
            results.set(gameId, info);
            console.log(`  Game ${gameId}: ${info.result} (${info.moveCount} moves)`);
            consecutiveErrors = 0;
          }
        } catch {
          hadError = true;
          consecutiveErrors++;
        }
      }

      if (!hadError) consecutiveErrors = 0;

      if (results.size < gameIds.length) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }

    return results;
  }
}
