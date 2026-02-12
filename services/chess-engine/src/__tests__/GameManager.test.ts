import { describe, it, expect, beforeEach } from 'vitest';
import { GameManager } from '../engine/GameManager.js';
import { GameStatus, GameResult, TimeControl } from '../types/index.js';

const TC: TimeControl = { baseTimeSeconds: 300, incrementSeconds: 5 };

describe('GameManager', () => {
  let mgr: GameManager;

  beforeEach(() => {
    mgr = new GameManager();
  });

  it('creates a game and returns info', () => {
    const info = mgr.createGame('g1', 1, 1, 0, '0xW', '0xB', TC);
    expect(info.gameId).toBe('g1');
    expect(info.white).toBe('0xW');
    expect(info.black).toBe('0xB');
    expect(info.status).toBe(GameStatus.Pending);
  });

  it('throws on duplicate gameId', () => {
    mgr.createGame('g1', 1, 1, 0, '0xW', '0xB', TC);
    expect(() => mgr.createGame('g1', 1, 1, 0, '0xA', '0xC', TC)).toThrow('already exists');
  });

  it('starts a game', () => {
    mgr.createGame('g1', 1, 1, 0, '0xW', '0xB', TC);
    const info = mgr.startGame('g1');
    expect(info.status).toBe(GameStatus.InProgress);
  });

  it('makes a valid move', () => {
    mgr.createGame('g1', 1, 1, 0, '0xW', '0xB', TC);
    mgr.startGame('g1');
    const { success, info } = mgr.makeMove('g1', '0xW', 'e4');
    expect(success).toBe(true);
    expect(info.moveCount).toBe(1);
  });

  it('resign ends game', () => {
    mgr.createGame('g1', 1, 1, 0, '0xW', '0xB', TC);
    mgr.startGame('g1');
    const { info, applied } = mgr.resign('g1', '0xW');
    expect(applied).toBe(true);
    expect(info.status).toBe(GameStatus.Completed);
    expect(info.result).toBe(GameResult.BlackWins);
  });

  it('gets game info', () => {
    mgr.createGame('g1', 1, 1, 0, '0xW', '0xB', TC);
    const info = mgr.getGameInfo('g1');
    expect(info.gameId).toBe('g1');
  });

  it('throws for nonexistent game', () => {
    expect(() => mgr.getGameInfo('nope')).toThrow('not found');
  });

  it('gets legal moves', () => {
    mgr.createGame('g1', 1, 1, 0, '0xW', '0xB', TC);
    mgr.startGame('g1');
    const moves = mgr.getLegalMoves('g1');
    expect(moves.length).toBe(20);
  });

  it('gets PGN', () => {
    mgr.createGame('g1', 1, 1, 0, '0xW', '0xB', TC);
    mgr.startGame('g1');
    mgr.makeMove('g1', '0xW', 'e4');
    const pgn = mgr.getGamePgn('g1');
    expect(pgn).toContain('1. e4');
  });

  it('reports game over correctly', () => {
    mgr.createGame('g1', 1, 1, 0, '0xW', '0xB', TC);
    mgr.startGame('g1');
    expect(mgr.isGameOver('g1')).toBe(false);
    mgr.resign('g1', '0xW');
    expect(mgr.isGameOver('g1')).toBe(true);
  });

  it('lists active games only', () => {
    mgr.createGame('g1', 1, 1, 0, '0xW', '0xB', TC);
    mgr.createGame('g2', 1, 1, 1, '0xA', '0xC', TC);
    mgr.startGame('g1');
    mgr.startGame('g2');
    mgr.resign('g1', '0xW');

    const active = mgr.getActiveGames();
    expect(active.length).toBe(1);
    expect(active[0].gameId).toBe('g2');
  });

  it('removes a game', () => {
    mgr.createGame('g1', 1, 1, 0, '0xW', '0xB', TC);
    mgr.removeGame('g1');
    expect(() => mgr.getGameInfo('g1')).toThrow('not found');
  });
});
