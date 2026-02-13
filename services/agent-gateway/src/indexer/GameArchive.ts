/**
 * In-memory archive for completed game data (PGN, moves, results).
 * Receives data from the tournament orchestrator after games complete.
 * Serves as fallback when chess engine no longer has the game in memory.
 */

export interface ArchivedGame {
  gameId: string;
  tournamentId: number;
  round: number;
  gameIndex: number;
  white: string;
  black: string;
  pgn: string;
  moves: string[];
  result: string;
  moveCount: number;
  fen: string;
  archivedAt: number;
}

export class GameArchive {
  private games = new Map<string, ArchivedGame>();

  /**
   * Store a completed game's data.
   */
  store(data: {
    gameId: string;
    tournamentId: number;
    round: number;
    gameIndex: number;
    white: string;
    black: string;
    pgn: string;
    moves: string[];
    result: string;
    moveCount: number;
    fen?: string;
  }): void {
    this.games.set(data.gameId, {
      ...data,
      fen: data.fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', // final position or starting
      archivedAt: Date.now(),
    });
    console.log(`GameArchive: stored ${data.gameId} (${data.moveCount} moves, result: ${data.result})`);
  }

  /**
   * Retrieve archived game data.
   */
  get(gameId: string): ArchivedGame | null {
    return this.games.get(gameId) ?? null;
  }

  /**
   * Format archived game as a response matching chess engine's GameInfo shape.
   */
  toGameInfo(archived: ArchivedGame) {
    return {
      gameId: archived.gameId,
      tournamentId: archived.tournamentId,
      round: archived.round,
      gameIndex: archived.gameIndex,
      white: archived.white,
      black: archived.black,
      status: 'completed',
      result: archived.result,
      fen: archived.fen,
      moves: archived.moves,
      moveCount: archived.moveCount,
      startedAt: 0,
      timeControl: { baseTimeSeconds: 0, incrementSeconds: 0 },
      whiteTimeMs: 0,
      blackTimeMs: 0,
      pgn: archived.pgn,
      source: 'archive', // Signal to frontend that this came from archive
    };
  }

  /**
   * Get all archived games where the given wallet was white or black.
   * Returns newest games first.
   */
  getByWallet(wallet: string): ArchivedGame[] {
    const w = wallet.toLowerCase();
    const results: ArchivedGame[] = [];
    for (const game of this.games.values()) {
      if (game.white.toLowerCase() === w || game.black.toLowerCase() === w) {
        results.push(game);
      }
    }
    results.sort((a, b) => b.archivedAt - a.archivedAt);
    return results;
  }

  /**
   * Get total number of archived games.
   */
  get size(): number {
    return this.games.size;
  }
}
