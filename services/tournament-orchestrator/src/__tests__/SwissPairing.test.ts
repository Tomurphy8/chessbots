import { describe, it, expect } from 'vitest';
import { SwissPairing } from '../pairing/SwissPairing.js';
import type { PlayerStanding } from '../types/index.js';

function makePlayer(wallet: string, score = 0, opponents: string[] = [], colors: ('white' | 'black')[] = []): PlayerStanding {
  return {
    wallet, score, buchholz: 0,
    gamesPlayed: opponents.length, gamesWon: 0, gamesDrawn: 0, gamesLost: 0,
    opponents, colors,
  };
}

describe('SwissPairing', () => {
  const pairing = new SwissPairing();

  it('pairs even number of players with no byes', () => {
    const players = [
      makePlayer('0xA'), makePlayer('0xB'),
      makePlayer('0xC'), makePlayer('0xD'),
    ];
    const result = pairing.computePairings(players, 1);
    expect(result.pairings.length).toBe(2);
    expect(result.bye).toBeUndefined();
    expect(result.round).toBe(1);
  });

  it('gives a bye with odd number of players', () => {
    const players = [
      makePlayer('0xA'), makePlayer('0xB'), makePlayer('0xC'),
    ];
    const result = pairing.computePairings(players, 1);
    expect(result.pairings.length).toBe(1);
    expect(result.bye).toBeTruthy();
  });

  it('each player appears in exactly one pairing', () => {
    const players = [
      makePlayer('0xA'), makePlayer('0xB'),
      makePlayer('0xC'), makePlayer('0xD'),
      makePlayer('0xE'), makePlayer('0xF'),
    ];
    const result = pairing.computePairings(players, 1);
    const allPaired = new Set<string>();
    for (const p of result.pairings) {
      allPaired.add(p.white);
      allPaired.add(p.black);
    }
    expect(allPaired.size).toBe(6);
  });

  it('assigns sequential gameIndex', () => {
    const players = [
      makePlayer('0xA'), makePlayer('0xB'),
      makePlayer('0xC'), makePlayer('0xD'),
    ];
    const result = pairing.computePairings(players, 1);
    expect(result.pairings[0].gameIndex).toBe(0);
    expect(result.pairings[1].gameIndex).toBe(1);
  });

  it('groups by score and pairs within groups', () => {
    const players = [
      makePlayer('0xA', 4), makePlayer('0xB', 4),
      makePlayer('0xC', 2), makePlayer('0xD', 2),
      makePlayer('0xE', 0), makePlayer('0xF', 0),
    ];
    const result = pairing.computePairings(players, 2);
    expect(result.pairings.length).toBe(3);

    // Top score group should be paired together
    const topPairing = result.pairings[0];
    const topWallets = [topPairing.white, topPairing.black].sort();
    expect(topWallets).toEqual(['0xA', '0xB']);
  });

  it('alternates colors when possible', () => {
    const players = [
      makePlayer('0xA', 0, [], ['white']),
      makePlayer('0xB', 0, [], ['black']),
    ];
    const result = pairing.computePairings(players, 2);
    const p = result.pairings[0];
    // 0xA had white last, so should get black. 0xB had black, should get white.
    expect(p.white).toBe('0xB');
    expect(p.black).toBe('0xA');
  });

  it('avoids re-pairing opponents from previous rounds', () => {
    // A already played B, C already played D
    const players = [
      makePlayer('0xA', 2, ['0xB'], ['white']),
      makePlayer('0xB', 0, ['0xA'], ['black']),
      makePlayer('0xC', 2, ['0xD'], ['white']),
      makePlayer('0xD', 0, ['0xC'], ['black']),
    ];
    const result = pairing.computePairings(players, 2);
    for (const p of result.pairings) {
      // Neither pairing should be a repeat
      const isAB = (p.white === '0xA' && p.black === '0xB') || (p.white === '0xB' && p.black === '0xA');
      const isCD = (p.white === '0xC' && p.black === '0xD') || (p.white === '0xD' && p.black === '0xC');
      expect(isAB).toBe(false);
      expect(isCD).toBe(false);
    }
  });

  it('handles 2 players', () => {
    const players = [makePlayer('0xA'), makePlayer('0xB')];
    const result = pairing.computePairings(players, 1);
    expect(result.pairings.length).toBe(1);
    expect(result.bye).toBeUndefined();
  });

  it('calculates Buchholz scores', () => {
    const standings = [
      makePlayer('0xA', 4, ['0xB', '0xC']),
      makePlayer('0xB', 2, ['0xA']),
      makePlayer('0xC', 0, ['0xA']),
    ];
    pairing.calculateBuchholz(standings);
    // A's Buchholz = B's score + C's score = 2 + 0 = 2
    expect(standings[0].buchholz).toBe(2);
    // B's Buchholz = A's score = 4
    expect(standings[1].buchholz).toBe(4);
    // C's Buchholz = A's score = 4
    expect(standings[2].buchholz).toBe(4);
  });
});
