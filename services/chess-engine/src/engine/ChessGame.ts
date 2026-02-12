import { Chess } from 'chess.js';
import { GameInfo, GameStatus, GameResult, TimeControl } from '../types/index.js';

export class ChessGame {
  private chess: Chess;
  private gameId: string;
  private tournamentId: number;
  private round: number;
  private gameIndex: number;
  private white: string;
  private black: string;
  private status: GameStatus;
  private result: GameResult;
  private startedAt: number;
  private endedAt: number;
  private timeControl: TimeControl;
  private whiteTimeMs: number;
  private blackTimeMs: number;
  private lastMoveTimestamp: number;
  private moves: string[];
  private locked: boolean; // CE-H5: per-game mutex

  constructor(
    gameId: string, tournamentId: number, round: number, gameIndex: number,
    white: string, black: string, timeControl: TimeControl,
  ) {
    this.chess = new Chess();
    this.gameId = gameId;
    this.tournamentId = tournamentId;
    this.round = round;
    this.gameIndex = gameIndex;
    this.white = white;
    this.black = black;
    this.status = GameStatus.Pending;
    this.result = GameResult.Undecided;
    this.startedAt = 0;
    this.endedAt = 0;
    this.timeControl = timeControl;
    this.whiteTimeMs = timeControl.baseTimeSeconds * 1000;
    this.blackTimeMs = timeControl.baseTimeSeconds * 1000;
    this.lastMoveTimestamp = 0;
    this.moves = [];
    this.locked = false;
  }

  // CE-H1: Guard against re-starting
  start(): void {
    if (this.status !== GameStatus.Pending) {
      throw new Error('Game already started or completed');
    }
    this.status = GameStatus.InProgress;
    this.startedAt = Date.now();
    this.lastMoveTimestamp = this.startedAt;
  }

  // CE-H5: Acquire lock before processing
  acquireLock(): boolean {
    if (this.locked) return false;
    this.locked = true;
    return true;
  }

  releaseLock(): void {
    this.locked = false;
  }

  // CE-H2: Fixed — time increment applied AFTER move validation
  makeMove(player: string, moveStr: string): { success: boolean; error?: string } {
    if (this.status !== GameStatus.InProgress) {
      return { success: false, error: 'Game is not in progress' };
    }

    const isWhiteTurn = this.chess.turn() === 'w';
    const expectedPlayer = isWhiteTurn ? this.white : this.black;

    if (player !== expectedPlayer) {
      return { success: false, error: 'Not your turn' };
    }

    const now = Date.now();
    const elapsed = now - this.lastMoveTimestamp;

    // Check for time expiry BEFORE attempting the move
    if (isWhiteTurn) {
      const remainingTime = this.whiteTimeMs - elapsed;
      if (remainingTime <= 0) {
        this.whiteTimeMs = 0;
        this.endGame(GameResult.BlackWins);
        return { success: false, error: 'White flagged (time expired)' };
      }
    } else {
      const remainingTime = this.blackTimeMs - elapsed;
      if (remainingTime <= 0) {
        this.blackTimeMs = 0;
        this.endGame(GameResult.WhiteWins);
        return { success: false, error: 'Black flagged (time expired)' };
      }
    }

    // Validate the move FIRST
    try {
      const result = this.chess.move(moveStr);
      if (!result) return { success: false, error: 'Illegal move' };

      // Move is valid — NOW apply time changes
      // CE-T1: Cap time to prevent unbounded accumulation (max 2x base time)
      const maxTimeMs = this.timeControl.baseTimeSeconds * 1000 * 2;
      if (isWhiteTurn) {
        this.whiteTimeMs -= elapsed;
        this.whiteTimeMs += this.timeControl.incrementSeconds * 1000;
        this.whiteTimeMs = Math.min(this.whiteTimeMs, maxTimeMs);
      } else {
        this.blackTimeMs -= elapsed;
        this.blackTimeMs += this.timeControl.incrementSeconds * 1000;
        this.blackTimeMs = Math.min(this.blackTimeMs, maxTimeMs);
      }

      this.moves.push(result.san);
      this.lastMoveTimestamp = now;

      if (this.chess.isCheckmate()) {
        this.endGame(isWhiteTurn ? GameResult.WhiteWins : GameResult.BlackWins);
      } else if (this.chess.isDraw() || this.chess.isStalemate() || this.chess.isThreefoldRepetition() || this.chess.isInsufficientMaterial()) {
        this.endGame(GameResult.Draw);
      }

      return { success: true };
    } catch {
      return { success: false, error: 'Invalid move format' };
    }
  }

  // CE-C3: Add game-state guard to resign
  resign(player: string): boolean {
    if (this.status !== GameStatus.InProgress) return false;
    if (player === this.white) {
      this.endGame(GameResult.BlackWins);
      return true;
    } else if (player === this.black) {
      this.endGame(GameResult.WhiteWins);
      return true;
    }
    return false;
  }

  // CE-H6: Check if current player has timed out
  checkTimeout(): boolean {
    if (this.status !== GameStatus.InProgress) return false;
    const now = Date.now();
    const elapsed = now - this.lastMoveTimestamp;
    const isWhiteTurn = this.chess.turn() === 'w';

    if (isWhiteTurn && this.whiteTimeMs - elapsed <= 0) {
      this.whiteTimeMs = 0;
      this.endGame(GameResult.BlackWins);
      return true;
    } else if (!isWhiteTurn && this.blackTimeMs - elapsed <= 0) {
      this.blackTimeMs = 0;
      this.endGame(GameResult.WhiteWins);
      return true;
    }
    return false;
  }

  private endGame(result: GameResult): void {
    this.result = result;
    this.status = GameStatus.Completed;
    this.endedAt = Date.now();
  }

  getFen(): string { return this.chess.fen(); }
  getLegalMoves(): string[] { return this.chess.moves(); }
  getMoves(): string[] { return [...this.moves]; }

  isGameOver(): boolean {
    return this.status === GameStatus.Completed || this.status === GameStatus.Adjudicated;
  }

  getInfo(): GameInfo {
    return {
      gameId: this.gameId, tournamentId: this.tournamentId, round: this.round,
      gameIndex: this.gameIndex, white: this.white, black: this.black,
      status: this.status, result: this.result, fen: this.chess.fen(),
      moves: [...this.moves], moveCount: this.moves.length, startedAt: this.startedAt,
      timeControl: this.timeControl, whiteTimeMs: this.whiteTimeMs, blackTimeMs: this.blackTimeMs,
    };
  }

  // CE-PGN1: Sanitize PGN header values to prevent injection
  private sanitizePgnValue(value: string): string {
    return value.replace(/[\\"]/g, '_').replace(/[\x00-\x1f]/g, '');
  }

  toPgn(): string {
    const resultStr = this.result === GameResult.WhiteWins ? '1-0' : this.result === GameResult.BlackWins ? '0-1' : this.result === GameResult.Draw ? '1/2-1/2' : '*';
    const headers = [
      `[Event "ChessBots Tournament #${this.tournamentId}"]`,
      `[Site "Monad Blockchain"]`,
      `[Date "${new Date(this.startedAt || Date.now()).toISOString().split('T')[0]}"]`,
      `[Round "${this.round}"]`,
      `[White "${this.sanitizePgnValue(this.white)}"]`,
      `[Black "${this.sanitizePgnValue(this.black)}"]`,
      `[Result "${resultStr}"]`,
    ];
    const parts: string[] = [];
    for (let i = 0; i < this.moves.length; i++) {
      if (i % 2 === 0) parts.push(`${Math.floor(i / 2) + 1}.`);
      parts.push(this.moves[i]);
    }
    parts.push(resultStr);
    return [...headers, '', parts.join(' '), ''].join('\n');
  }
}
