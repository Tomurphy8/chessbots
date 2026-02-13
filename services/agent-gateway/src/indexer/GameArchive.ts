/**
 * Persistent archive for completed game data (PGN, moves, results).
 * Receives data from the tournament orchestrator after games complete.
 * Serves as fallback when chess engine no longer has the game in memory.
 * Persists to a JSON file on disk using atomic writes.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';

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
  private games: Map<string, ArchivedGame>;
  private filePath: string;

  constructor(archivePath?: string) {
    this.filePath = archivePath || process.env.GAME_ARCHIVE_PATH || join(process.cwd(), '.data', 'games.json');
    this.games = this.load();
  }

  /**
   * Load archived games from disk. Returns empty Map on any error.
   */
  private load(): Map<string, ArchivedGame> {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const arr: ArchivedGame[] = JSON.parse(raw);
        const map = new Map<string, ArchivedGame>();
        for (const game of arr) {
          map.set(game.gameId, game);
        }
        console.log(`GameArchive: loaded ${map.size} games from ${this.filePath}`);
        return map;
      }
    } catch (err: any) {
      console.error(`GameArchive: failed to load from disk: ${err.message}, starting fresh`);
    }
    return new Map();
  }

  /**
   * Persist all games to disk. Best-effort — logs errors but does not throw.
   * Uses atomic write (tmp file + rename) to prevent corruption.
   */
  private save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const tmpPath = this.filePath + '.tmp';
      writeFileSync(tmpPath, JSON.stringify(Array.from(this.games.values()), null, 2), 'utf-8');
      try {
        renameSync(tmpPath, this.filePath);
      } catch (renameErr: any) {
        try { unlinkSync(tmpPath); } catch { /* ignore cleanup error */ }
        throw renameErr;
      }
    } catch (err: any) {
      console.error(`GameArchive: failed to save to disk: ${err.message}`);
    }
  }

  /**
   * Store a completed game's data and persist to disk.
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
    this.save();
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
