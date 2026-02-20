import { ChessGame } from './ChessGame.js';
import { GameInfo, TimeControl, GameStatus } from '../types/index.js';

const MAX_ACTIVE_GAMES = 1000; // CE-H4: prevent unbounded growth
const COMPLETED_GAME_TTL_MS = 30 * 60 * 1000; // 30 minutes — longer for debugging/querying
const TIMEOUT_CHECK_INTERVAL_MS = 1_000; // CE-H6: check timeouts every 1s — fast for bullet games

export class GameManager {
  private games: Map<string, ChessGame> = new Map();
  private completedTimestamps: Map<string, number> = new Map();
  /** Callback fired when a game ends via timeout (so Socket.IO can emit game:ended) */
  public onGameTimeout: ((gameId: string, info: GameInfo) => void) | null = null;

  constructor() {
    // CE-H4: periodic cleanup of completed games
    setInterval(() => this.cleanupCompletedGames(), 60_000);
    // CE-H6: periodic timeout check for stalled games
    setInterval(() => this.checkAllTimeouts(), TIMEOUT_CHECK_INTERVAL_MS);
  }

  createGame(gameId: string, tournamentId: number, round: number, gameIndex: number, white: string, black: string, timeControl: TimeControl): GameInfo {
    if (this.games.has(gameId)) throw new Error('Game already exists'); // CE-L: generic error
    if (this.getActiveGameCount() >= MAX_ACTIVE_GAMES) throw new Error('Max active games reached');
    const game = new ChessGame(gameId, tournamentId, round, gameIndex, white, black, timeControl);
    this.games.set(gameId, game);
    return game.getInfo();
  }

  startGame(gameId: string): GameInfo {
    const game = this.getGame(gameId);
    game.start();
    return game.getInfo();
  }

  makeMove(gameId: string, player: string, move: string): { info: GameInfo; success: boolean; error?: string } {
    const game = this.getGame(gameId);
    // CE-H5: per-game lock
    if (!game.acquireLock()) {
      return { info: game.getInfo(), success: false, error: 'Game is processing another move' };
    }
    try {
      const result = game.makeMove(player, move);
      if (game.isGameOver()) this.markCompleted(gameId);
      return { info: game.getInfo(), ...result };
    } finally {
      game.releaseLock();
    }
  }

  resign(gameId: string, player: string): { info: GameInfo; applied: boolean } {
    const game = this.getGame(gameId);
    const applied = game.resign(player);
    if (applied) this.markCompleted(gameId);
    return { info: game.getInfo(), applied };
  }

  getGameInfo(gameId: string): GameInfo { return this.getGame(gameId).getInfo(); }
  getLegalMoves(gameId: string): string[] { return this.getGame(gameId).getLegalMoves(); }
  getGamePgn(gameId: string): string { return this.getGame(gameId).toPgn(); }
  isGameOver(gameId: string): boolean { return this.getGame(gameId).isGameOver(); }
  removeGame(gameId: string): void { this.games.delete(gameId); this.completedTimestamps.delete(gameId); }

  getActiveGames(): GameInfo[] {
    return Array.from(this.games.values()).filter(g => !g.isGameOver()).map(g => g.getInfo());
  }

  /** Return ALL games (active + completed but not yet cleaned up) */
  getAllGames(): GameInfo[] {
    return Array.from(this.games.values()).map(g => g.getInfo());
  }

  private getGame(gameId: string): ChessGame {
    const game = this.games.get(gameId);
    if (!game) throw new Error('Game not found'); // CE-L: generic error
    return game;
  }

  private getActiveGameCount(): number {
    let count = 0;
    for (const game of this.games.values()) {
      if (!game.isGameOver()) count++;
    }
    return count;
  }

  private markCompleted(gameId: string): void {
    this.completedTimestamps.set(gameId, Date.now());
  }

  // CE-H4: remove completed games after TTL
  private cleanupCompletedGames(): void {
    const now = Date.now();
    for (const [gameId, completedAt] of this.completedTimestamps) {
      if (now - completedAt > COMPLETED_GAME_TTL_MS) {
        this.games.delete(gameId);
        this.completedTimestamps.delete(gameId);
      }
    }
  }

  // CE-H6: check all active games for timeouts
  // Now emits game:ended via callback so Socket.IO can notify agents
  private checkAllTimeouts(): void {
    for (const game of this.games.values()) {
      const wasActive = !game.isGameOver();
      const timedOut = game.checkTimeout();
      if (timedOut && wasActive) {
        const info = game.getInfo();
        this.markCompleted(info.gameId);
        if (this.onGameTimeout) {
          this.onGameTimeout(info.gameId, info);
        }
      }
    }
  }
}
