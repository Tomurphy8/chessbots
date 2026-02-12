import { describe, it, expect, beforeEach } from 'vitest';
import { ChessGame } from '../engine/ChessGame.js';
import { GameStatus, GameResult, TimeControl } from '../types/index.js';

const TC: TimeControl = { baseTimeSeconds: 300, incrementSeconds: 5 };

describe('ChessGame', () => {
  let game: ChessGame;

  beforeEach(() => {
    game = new ChessGame('g1', 1, 1, 0, '0xWhite', '0xBlack', TC);
  });

  it('initializes in Pending status with starting FEN', () => {
    const info = game.getInfo();
    expect(info.status).toBe(GameStatus.Pending);
    expect(info.result).toBe(GameResult.Undecided);
    expect(info.fen).toContain('rnbqkbnr');
    expect(info.moveCount).toBe(0);
    expect(info.whiteTimeMs).toBe(300_000);
    expect(info.blackTimeMs).toBe(300_000);
  });

  it('starts a game and sets InProgress', () => {
    game.start();
    const info = game.getInfo();
    expect(info.status).toBe(GameStatus.InProgress);
    expect(info.startedAt).toBeGreaterThan(0);
  });

  it('rejects moves when game not started', () => {
    const result = game.makeMove('0xWhite', 'e4');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not in progress');
  });

  it('allows white to move first', () => {
    game.start();
    const result = game.makeMove('0xWhite', 'e4');
    expect(result.success).toBe(true);
    expect(game.getMoves()).toEqual(['e4']);
  });

  it('rejects move from wrong player', () => {
    game.start();
    const result = game.makeMove('0xBlack', 'e4');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Not your turn');
  });

  it('alternates turns white → black → white', () => {
    game.start();
    expect(game.makeMove('0xWhite', 'e4').success).toBe(true);
    expect(game.makeMove('0xBlack', 'e5').success).toBe(true);
    expect(game.makeMove('0xWhite', 'Nf3').success).toBe(true);
    expect(game.getMoves()).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('rejects illegal moves', () => {
    game.start();
    const result = game.makeMove('0xWhite', 'e5');
    expect(result.success).toBe(false);
  });

  it('detects checkmate', () => {
    game.start();
    // Scholar's mate
    game.makeMove('0xWhite', 'e4');
    game.makeMove('0xBlack', 'e5');
    game.makeMove('0xWhite', 'Bc4');
    game.makeMove('0xBlack', 'Nc6');
    game.makeMove('0xWhite', 'Qh5');
    game.makeMove('0xBlack', 'Nf6');
    const result = game.makeMove('0xWhite', 'Qxf7');
    expect(result.success).toBe(true);

    const info = game.getInfo();
    expect(info.status).toBe(GameStatus.Completed);
    expect(info.result).toBe(GameResult.WhiteWins);
    expect(game.isGameOver()).toBe(true);
  });

  it('handles resignation by white', () => {
    game.start();
    game.resign('0xWhite');
    const info = game.getInfo();
    expect(info.status).toBe(GameStatus.Completed);
    expect(info.result).toBe(GameResult.BlackWins);
  });

  it('handles resignation by black', () => {
    game.start();
    game.resign('0xBlack');
    const info = game.getInfo();
    expect(info.status).toBe(GameStatus.Completed);
    expect(info.result).toBe(GameResult.WhiteWins);
  });

  it('returns legal moves', () => {
    game.start();
    const moves = game.getLegalMoves();
    expect(moves.length).toBe(20); // 20 legal opening moves for white
    expect(moves).toContain('e4');
    expect(moves).toContain('d4');
  });

  it('generates valid PGN', () => {
    game.start();
    game.makeMove('0xWhite', 'e4');
    game.makeMove('0xBlack', 'e5');
    const pgn = game.toPgn();
    expect(pgn).toContain('[Event "ChessBots Tournament #1"]');
    expect(pgn).toContain('[White "0xWhite"]');
    expect(pgn).toContain('[Black "0xBlack"]');
    expect(pgn).toContain('1. e4 e5');
  });

  it('reports FEN after moves', () => {
    game.start();
    game.makeMove('0xWhite', 'e4');
    const fen = game.getFen();
    expect(fen).toContain('rnbqkbnr/pppppppp/8/8/4P3');
  });

  it('adds increment after each move', () => {
    game.start();
    // Move immediately - elapsed ≈ 0ms so time should stay near base + increment
    game.makeMove('0xWhite', 'e4');
    const info = game.getInfo();
    // White gets +5s increment after the move
    expect(info.whiteTimeMs).toBeGreaterThanOrEqual(300_000);
  });
});
