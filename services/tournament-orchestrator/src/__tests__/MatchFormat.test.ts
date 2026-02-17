import { describe, it, expect, beforeEach } from 'vitest';
import { MatchPairing } from '../pairing/MatchPairing.js';
import type { PlayerStanding } from '../types/index.js';

function makeStandings(wallets: string[]): PlayerStanding[] {
  return wallets.map(wallet => ({
    wallet, score: 0, buchholz: 0, gamesPlayed: 0,
    gamesWon: 0, gamesDrawn: 0, gamesLost: 0,
    opponents: [], colors: [],
  }));
}

describe('MatchPairing', () => {
  let pairing: MatchPairing;
  const p1 = '0xPlayer1';
  const p2 = '0xPlayer2';

  beforeEach(() => {
    pairing = new MatchPairing();
  });

  it('produces exactly 1 game per round for 2 players', () => {
    const standings = makeStandings([p1, p2]);
    const result = pairing.computePairings(standings, 1);
    expect(result.pairings.length).toBe(1);
    expect(result.bye).toBeUndefined();
  });

  it('throws with wrong number of players', () => {
    const standings = makeStandings([p1, p2, '0xPlayer3']);
    expect(() => pairing.computePairings(standings, 1)).toThrow('exactly 2 players');
  });

  it('alternates colors each round', () => {
    const standings = makeStandings([p1, p2]);

    const r1 = pairing.computePairings(standings, 1);
    expect(r1.pairings[0].white).toBe(p1); // Odd round: p1 white
    expect(r1.pairings[0].black).toBe(p2);

    const r2 = pairing.computePairings(standings, 2);
    expect(r2.pairings[0].white).toBe(p2); // Even round: p2 white
    expect(r2.pairings[0].black).toBe(p1);

    const r3 = pairing.computePairings(standings, 3);
    expect(r3.pairings[0].white).toBe(p1); // Odd round: p1 white again
  });

  it('tracks series score correctly', () => {
    const { clinched } = pairing.recordResult(p1, 3);
    expect(clinched).toBe(false);
    expect(pairing.getSeriesScore().get(p1)).toBe(1);

    pairing.recordResult(p2, 3);
    expect(pairing.getSeriesScore().get(p2)).toBe(1);
  });

  it('detects early clinch in best-of-3', () => {
    const r1 = pairing.recordResult(p1, 3);
    expect(r1.clinched).toBe(false);

    const r2 = pairing.recordResult(p1, 3);
    expect(r2.clinched).toBe(true);
    expect(r2.clinchWinner).toBe(p1);
  });

  it('detects early clinch in best-of-5', () => {
    pairing.recordResult(p1, 5); // p1: 1 win
    pairing.recordResult(p2, 5); // p2: 1 win
    pairing.recordResult(p1, 5); // p1: 2 wins

    const r4 = pairing.recordResult(p1, 5); // p1: 3 wins → clinch!
    expect(r4.clinched).toBe(true);
    expect(r4.clinchWinner).toBe(p1);
  });

  it('does not clinch on draws', () => {
    pairing.recordResult(null, 3); // draw
    pairing.recordResult(null, 3); // draw

    const r3 = pairing.recordResult(p1, 3); // p1: 1 win
    expect(r3.clinched).toBe(false);
  });

  it('no clinch until majority in best-of-5', () => {
    pairing.recordResult(p1, 5); // p1: 1
    const r2 = pairing.recordResult(p1, 5); // p1: 2
    expect(r2.clinched).toBe(false); // Need 3 of 5

    const r3 = pairing.recordResult(p1, 5); // p1: 3
    expect(r3.clinched).toBe(true);
  });

  it('getSeriesWinner returns correct winner', () => {
    pairing.recordResult(p1, 3);
    pairing.recordResult(p2, 3);
    pairing.recordResult(p1, 3);

    const winner = pairing.getSeriesWinner(p1, p2);
    expect(winner).toBe(p1);
  });

  it('getSeriesWinner uses tiebreaker on equal scores', () => {
    pairing.recordResult(p1, 3);
    pairing.recordResult(p2, 3);
    // Tied 1-1, tiebreaker returns p1 (player with white in game 1)
    const winner = pairing.getSeriesWinner(p1, p2);
    expect(winner).toBe(p1);
  });

  it('Buchholz is a no-op for matches', () => {
    const standings = makeStandings([p1, p2]);
    standings[0].buchholz = 5;
    pairing.calculateBuchholz(standings);
    // Should not modify (no-op)
    expect(standings[0].buchholz).toBe(5);
  });
});
