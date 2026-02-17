import { describe, it, expect, beforeEach } from 'vitest';
import { TournamentManager } from '../lifecycle/TournamentManager.js';
import type { TournamentConfig } from '../types/index.js';

const CONFIG: TournamentConfig = {
  tournamentId: 1,
  tier: 'rookie',
  format: 'swiss',
  maxPlayers: 8,
  minPlayers: 4,
  totalRounds: 3,
  timeControl: { baseTimeSeconds: 300, incrementSeconds: 5 },
};

const wallets = [
  '0xPlayer1', '0xPlayer2', '0xPlayer3', '0xPlayer4',
  '0xPlayer5', '0xPlayer6', '0xPlayer7', '0xPlayer8',
];

describe('TournamentManager', () => {
  let mgr: TournamentManager;

  beforeEach(() => {
    mgr = new TournamentManager(CONFIG);
  });

  it('registers players', () => {
    for (const w of wallets) mgr.registerPlayer(w);
    const standings = mgr.getStandings();
    expect(standings.length).toBe(8);
    expect(standings.every(s => s.score === 0)).toBe(true);
  });

  it('throws on duplicate registration', () => {
    mgr.registerPlayer('0xPlayer1');
    expect(() => mgr.registerPlayer('0xPlayer1')).toThrow('already registered');
  });

  it('starts a round and produces pairings', () => {
    for (const w of wallets) mgr.registerPlayer(w);
    const result = mgr.startNextRound();
    expect(result.round).toBe(1);
    expect(result.pairings.length).toBe(4); // 8 players = 4 games
    expect(result.bye).toBeUndefined();
  });

  it('gives a bye with odd number of players', () => {
    for (const w of wallets.slice(0, 7)) mgr.registerPlayer(w);
    const result = mgr.startNextRound();
    expect(result.pairings.length).toBe(3); // 6 paired + 1 bye
    expect(result.bye).toBeTruthy();
  });

  it('records game results correctly', () => {
    for (const w of wallets) mgr.registerPlayer(w);
    const round = mgr.startNextRound();

    // White wins all games
    for (const p of round.pairings) {
      mgr.recordGameResult(p.white, p.black, 'white');
    }

    const standings = mgr.getStandings();
    // Winners should have score 2, losers 0
    const winners = standings.filter(s => s.score === 2);
    const losers = standings.filter(s => s.score === 0);
    expect(winners.length).toBe(4);
    expect(losers.length).toBe(4);
  });

  it('records draw results', () => {
    for (const w of wallets.slice(0, 2)) mgr.registerPlayer(w);
    mgr.startNextRound();
    mgr.recordGameResult('0xPlayer1', '0xPlayer2', 'draw');

    const standings = mgr.getStandings();
    expect(standings[0].score).toBe(1);
    expect(standings[1].score).toBe(1);
    expect(standings[0].gamesDrawn).toBe(1);
  });

  it('records bye correctly', () => {
    mgr.registerPlayer('0xPlayer1');
    mgr.registerPlayer('0xPlayer2');
    mgr.registerPlayer('0xPlayer3');
    const round = mgr.startNextRound();
    if (round.bye) mgr.recordBye(round.bye);

    const standings = mgr.getStandings();
    const byePlayer = standings.find(s => s.wallet === round.bye);
    expect(byePlayer?.score).toBe(2);
    expect(byePlayer?.gamesWon).toBe(1);
  });

  it('runs a full 3-round tournament', () => {
    for (const w of wallets) mgr.registerPlayer(w);

    for (let r = 0; r < 3; r++) {
      const round = mgr.startNextRound();
      if (round.bye) mgr.recordBye(round.bye);
      for (const p of round.pairings) {
        mgr.recordGameResult(p.white, p.black, 'white');
      }
    }

    expect(mgr.isComplete()).toBe(true);
    expect(mgr.getCurrentRound()).toBe(3);
  });

  it('throws when exceeding total rounds', () => {
    for (const w of wallets) mgr.registerPlayer(w);
    for (let r = 0; r < 3; r++) {
      const round = mgr.startNextRound();
      for (const p of round.pairings) {
        mgr.recordGameResult(p.white, p.black, 'white');
      }
    }
    expect(() => mgr.startNextRound()).toThrow('All rounds completed');
  });

  it('returns winners in correct order', () => {
    for (const w of wallets.slice(0, 4)) mgr.registerPlayer(w);

    const round = mgr.startNextRound();
    // Manually set outcomes so we know who wins
    for (const p of round.pairings) {
      mgr.recordGameResult(p.white, p.black, 'white');
    }

    const winners = mgr.getWinners();
    expect(winners.first).toBeTruthy();
    expect(winners.second).toBeTruthy();
    expect(winners.third).toBeTruthy();
    // First should have a higher or equal score to second
    const standings = mgr.getStandings();
    expect(standings[0].score).toBeGreaterThanOrEqual(standings[1].score);
  });

  it('calculates Buchholz tiebreaker', () => {
    for (const w of wallets.slice(0, 4)) mgr.registerPlayer(w);

    const round = mgr.startNextRound();
    // P1 beats P2, P3 beats P4
    mgr.recordGameResult(round.pairings[0].white, round.pairings[0].black, 'white');
    mgr.recordGameResult(round.pairings[1].white, round.pairings[1].black, 'white');

    const standings = mgr.getStandings();
    // All winners have same score=2, but Buchholz should differentiate
    const withBuchholz = standings.filter(s => s.buchholz > 0);
    expect(withBuchholz.length).toBeGreaterThan(0);
  });

  it('tracks opponents list', () => {
    mgr.registerPlayer('0xPlayer1');
    mgr.registerPlayer('0xPlayer2');
    mgr.startNextRound();
    mgr.recordGameResult('0xPlayer1', '0xPlayer2', 'white');

    const standings = mgr.getStandings();
    const p1 = standings.find(s => s.wallet === '0xPlayer1')!;
    expect(p1.opponents).toContain('0xPlayer2');
  });
});
