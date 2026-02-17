import { describe, it, expect, beforeEach } from 'vitest';
import { RoundRobinPairing } from '../pairing/RoundRobinPairing.js';
import { LeagueScoring } from '../lifecycle/ScoringStrategy.js';
import type { PlayerStanding } from '../types/index.js';

function makeStandings(wallets: string[]): PlayerStanding[] {
  return wallets.map(wallet => ({
    wallet, score: 0, buchholz: 0, gamesPlayed: 0,
    gamesWon: 0, gamesDrawn: 0, gamesLost: 0,
    opponents: [], colors: [],
  }));
}

describe('RoundRobinPairing', () => {
  let pairing: RoundRobinPairing;

  beforeEach(() => {
    pairing = new RoundRobinPairing();
  });

  it('generates correct number of rounds for 4 players', () => {
    const players = ['A', 'B', 'C', 'D'];
    const schedule = pairing.generateFullSchedule(players);
    expect(schedule.length).toBe(3); // 4 players = 3 rounds
  });

  it('generates correct number of rounds for 6 players', () => {
    const players = ['A', 'B', 'C', 'D', 'E', 'F'];
    const schedule = pairing.generateFullSchedule(players);
    expect(schedule.length).toBe(5); // 6 players = 5 rounds
  });

  it('every player faces every other exactly once', () => {
    const wallets = ['0xA', '0xB', '0xC', '0xD'];
    const schedule = pairing.generateFullSchedule(wallets);

    // Collect all matchups as sorted pairs
    const matchups = new Set<string>();
    for (const round of schedule) {
      for (const p of round.pairings) {
        const pair = [p.white, p.black].sort().join('-');
        matchups.add(pair);
      }
    }

    // 4 players → C(4,2) = 6 unique matchups
    expect(matchups.size).toBe(6);
  });

  it('produces deterministic schedule regardless of score order', () => {
    // Round 1: fresh standings
    const standings1 = makeStandings(['0xA', '0xB', '0xC', '0xD']);
    const r1 = pairing.computePairings(standings1, 1);

    // Round 2: reshuffle standings by score (simulate different scoring)
    const standings2 = makeStandings(['0xC', '0xA', '0xD', '0xB']); // Different order
    standings2[0].score = 3; // C scored highest
    standings2[1].score = 1;
    standings2[2].score = 1;
    standings2[3].score = 0;

    const r2 = pairing.computePairings(standings2, 2);

    // The key test: round 2 should produce different pairings than round 1,
    // but the schedule should be based on the initial player order locked in round 1,
    // NOT on the re-sorted standings.
    // Verify no duplicate matchups between rounds
    const r1Matchups = r1.pairings.map(p => [p.white, p.black].sort().join('-'));
    const r2Matchups = r2.pairings.map(p => [p.white, p.black].sort().join('-'));

    for (const m of r2Matchups) {
      expect(r1Matchups).not.toContain(m);
    }
  });

  it('handles bye with odd number of players', () => {
    const standings = makeStandings(['0xA', '0xB', '0xC']);
    const r1 = pairing.computePairings(standings, 1);

    expect(r1.pairings.length).toBe(1); // 1 game + 1 bye
    expect(r1.bye).toBeTruthy();
    expect(['0xA', '0xB', '0xC']).toContain(r1.bye);
  });

  it('bye rotates across rounds with odd players', () => {
    const wallets = ['0xA', '0xB', '0xC'];
    const standings = makeStandings(wallets);

    const byes: string[] = [];
    for (let round = 1; round <= 3; round++) {
      const result = pairing.computePairings(standings, round);
      if (result.bye) byes.push(result.bye);
    }

    // Each player should get a bye exactly once in 3 rounds
    expect(byes.length).toBe(3);
    expect(new Set(byes).size).toBe(3);
  });

  it('all players play in each round (no player left out except bye)', () => {
    const wallets = ['0xA', '0xB', '0xC', '0xD'];
    const standings = makeStandings(wallets);

    for (let round = 1; round <= 3; round++) {
      const result = pairing.computePairings(standings, round);
      const players = new Set<string>();
      for (const p of result.pairings) {
        players.add(p.white);
        players.add(p.black);
      }
      // All 4 players should be in the pairings (even count, no bye)
      expect(players.size).toBe(4);
    }
  });
});

describe('LeagueScoring', () => {
  it('uses win=3, draw=1, loss=0', () => {
    const scoring = new LeagueScoring();
    expect(scoring.winPoints).toBe(3);
    expect(scoring.drawPoints).toBe(1);
    expect(scoring.lossPoints).toBe(0);
  });

  it('sorts by score then wins then buchholz', () => {
    const scoring = new LeagueScoring();
    const standings: PlayerStanding[] = [
      { wallet: '0xA', score: 6, buchholz: 2, gamesPlayed: 3, gamesWon: 2, gamesDrawn: 0, gamesLost: 1, opponents: [], colors: [] },
      { wallet: '0xB', score: 6, buchholz: 3, gamesPlayed: 3, gamesWon: 2, gamesDrawn: 0, gamesLost: 1, opponents: [], colors: [] },
      { wallet: '0xC', score: 9, buchholz: 0, gamesPlayed: 3, gamesWon: 3, gamesDrawn: 0, gamesLost: 0, opponents: [], colors: [] },
    ];

    const sorted = scoring.sortStandings(standings);
    expect(sorted[0].wallet).toBe('0xC'); // Highest score
    expect(sorted[1].wallet).toBe('0xB'); // Same score as A, higher Buchholz
    expect(sorted[2].wallet).toBe('0xA');
  });
});

describe('RoundRobinPairing - Buchholz', () => {
  it('calculates Buchholz correctly', () => {
    const pairing = new RoundRobinPairing();
    const standings: PlayerStanding[] = [
      { wallet: '0xA', score: 3, buchholz: 0, gamesPlayed: 1, gamesWon: 1, gamesDrawn: 0, gamesLost: 0, opponents: ['0xB'], colors: ['white'] },
      { wallet: '0xB', score: 0, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 0, gamesLost: 1, opponents: ['0xA'], colors: ['black'] },
    ];

    pairing.calculateBuchholz(standings);
    expect(standings[0].buchholz).toBe(0); // Opponent B has 0 points
    expect(standings[1].buchholz).toBe(3); // Opponent A has 3 points
  });

  it('excludes BYE opponents from Buchholz', () => {
    const pairing = new RoundRobinPairing();
    const standings: PlayerStanding[] = [
      { wallet: '0xA', score: 3, buchholz: 0, gamesPlayed: 2, gamesWon: 2, gamesDrawn: 0, gamesLost: 0, opponents: ['0xB', 'BYE'], colors: ['white', 'white'] },
      { wallet: '0xB', score: 0, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 0, gamesLost: 1, opponents: ['0xA'], colors: ['black'] },
    ];

    pairing.calculateBuchholz(standings);
    expect(standings[0].buchholz).toBe(0); // Only counts 0xB (score 0), BYE excluded
  });
});
