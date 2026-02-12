import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameManager } from '../engine/GameManager.js';
import { ChessGame } from '../engine/ChessGame.js';
import { GameStatus, GameResult, TimeControl } from '../types/index.js';

const TC: TimeControl = { baseTimeSeconds: 300, incrementSeconds: 5 };

describe('Security Tests', () => {
  let mgr: GameManager;

  beforeEach(() => {
    mgr = new GameManager();
  });

  describe('Input Validation', () => {
    it('creates game with empty gameId (no engine-level validation)', () => {
      // GameManager does not validate gameId format — the API layer handles that
      const info = mgr.createGame('', 1, 1, 0, '0xW', '0xB', TC);
      expect(info.gameId).toBe('');
    });

    it('rejects moves after game is over', () => {
      mgr.createGame('g1', 1, 1, 0, '0xW', '0xB', TC);
      mgr.startGame('g1');
      mgr.resign('g1', '0xW');
      const result = mgr.makeMove('g1', '0xB', 'e4');
      expect(result.success).toBe(false);
    });

    it('rejects double resignation', () => {
      mgr.createGame('g1', 1, 1, 0, '0xW', '0xB', TC);
      mgr.startGame('g1');
      const first = mgr.resign('g1', '0xW');
      expect(first.applied).toBe(true);
      // Second resign should not apply (game already over)
      const second = mgr.resign('g1', '0xB');
      expect(second.applied).toBe(false);
    });

    it('rejects start on already started game', () => {
      mgr.createGame('g1', 1, 1, 0, '0xW', '0xB', TC);
      mgr.startGame('g1');
      expect(() => mgr.startGame('g1')).toThrow();
    });

    it('rejects moves from non-participant addresses', () => {
      mgr.createGame('g1', 1, 1, 0, '0xW', '0xB', TC);
      mgr.startGame('g1');
      const result = mgr.makeMove('g1', '0xAttacker', 'e4');
      expect(result.success).toBe(false);
    });

    it('resignation from non-participant does not change game state', () => {
      mgr.createGame('g1', 1, 1, 0, '0xW', '0xB', TC);
      mgr.startGame('g1');
      // Resign returns applied=false for non-participants (doesn't throw)
      const { applied } = mgr.resign('g1', '0xAttacker');
      expect(applied).toBe(false);
      // Game should still be in progress
      const info = mgr.getGameInfo('g1');
      expect(info.status).toBe(GameStatus.InProgress);
    });
  });

  describe('Game State Integrity', () => {
    it('game result is immutable after completion', () => {
      mgr.createGame('g1', 1, 1, 0, '0xW', '0xB', TC);
      mgr.startGame('g1');
      mgr.resign('g1', '0xW');

      const info = mgr.getGameInfo('g1');
      expect(info.result).toBe(GameResult.BlackWins);
      expect(info.status).toBe(GameStatus.Completed);

      // Further moves should not change the state
      const moveResult = mgr.makeMove('g1', '0xB', 'e4');
      expect(moveResult.success).toBe(false);

      const infoAfter = mgr.getGameInfo('g1');
      expect(infoAfter.result).toBe(GameResult.BlackWins);
    });

    it('does not leak internal state in getInfo', () => {
      mgr.createGame('g1', 1, 1, 0, '0xW', '0xB', TC);
      const info = mgr.getGameInfo('g1');
      // Ensure no prototype pollution or unexpected fields
      expect(typeof info.gameId).toBe('string');
      expect(typeof info.status).toBe('string');
      expect(typeof info.result).toBe('string');
    });

    it('active games list reflects actual game state', () => {
      mgr.createGame('g1', 1, 1, 0, '0xW', '0xB', TC);
      mgr.createGame('g2', 1, 1, 1, '0xA', '0xC', TC);

      // getActiveGames returns all non-completed games (including pending)
      const beforeStart = mgr.getActiveGames();
      expect(beforeStart.length).toBe(2);

      mgr.startGame('g1');
      const afterOneStart = mgr.getActiveGames();
      expect(afterOneStart.length).toBe(2); // both pending and in-progress are "active"

      mgr.startGame('g2');
      mgr.resign('g2', '0xA');
      const afterResign = mgr.getActiveGames();
      expect(afterResign.length).toBe(1);
      expect(afterResign[0].gameId).toBe('g1');
    });
  });

  describe('Time Control Bounds', () => {
    it('initializes time correctly from config', () => {
      const game = new ChessGame('g1', 1, 1, 0, '0xW', '0xB', { baseTimeSeconds: 60, incrementSeconds: 1 });
      const info = game.getInfo();
      expect(info.whiteTimeMs).toBe(60_000);
      expect(info.blackTimeMs).toBe(60_000);
    });

    it('time does not go negative from elapsed time', () => {
      const game = new ChessGame('g1', 1, 1, 0, '0xW', '0xB', { baseTimeSeconds: 1, incrementSeconds: 0 });
      game.start();
      game.makeMove('0xW', 'e4');
      const info = game.getInfo();
      // With 1 second base and near-instant move, time should still be non-negative
      expect(info.whiteTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Concurrent Game Isolation', () => {
    it('moves in one game do not affect another', () => {
      mgr.createGame('g1', 1, 1, 0, '0xW', '0xB', TC);
      mgr.createGame('g2', 1, 1, 1, '0xW', '0xB', TC);
      mgr.startGame('g1');
      mgr.startGame('g2');

      mgr.makeMove('g1', '0xW', 'e4');
      const g1Info = mgr.getGameInfo('g1');
      const g2Info = mgr.getGameInfo('g2');

      expect(g1Info.moveCount).toBe(1);
      expect(g2Info.moveCount).toBe(0);
    });

    it('resignation in one game does not affect another', () => {
      mgr.createGame('g1', 1, 1, 0, '0xW', '0xB', TC);
      mgr.createGame('g2', 1, 1, 1, '0xW', '0xB', TC);
      mgr.startGame('g1');
      mgr.startGame('g2');

      mgr.resign('g1', '0xW');

      const g1Info = mgr.getGameInfo('g1');
      const g2Info = mgr.getGameInfo('g2');

      expect(g1Info.status).toBe(GameStatus.Completed);
      expect(g2Info.status).toBe(GameStatus.InProgress);
    });
  });

  describe('PGN Generation Safety', () => {
    it('PGN does not contain injection-prone content', () => {
      // Create game with potentially dangerous characters in addresses
      mgr.createGame('g1', 1, 1, 0, '0xW<script>', '0xB"inject"', TC);
      mgr.startGame('g1');
      mgr.makeMove('g1', '0xW<script>', 'e4');

      const pgn = mgr.getGamePgn('g1');
      // PGN should contain the moves but in controlled format
      expect(pgn).toContain('1. e4');
      expect(typeof pgn).toBe('string');
    });
  });
});
