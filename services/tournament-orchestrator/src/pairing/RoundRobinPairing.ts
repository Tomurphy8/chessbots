import { PlayerStanding, Pairing, RoundResult } from '../types/index.js';

/**
 * Round-robin pairing engine for league format.
 * Uses the circle method (Berger tables) to generate a deterministic schedule
 * where every player plays every other player exactly once.
 *
 * N players → (N-1) rounds, each with N/2 pairings.
 * If odd number of players: one bye per round (rotates).
 */
export class RoundRobinPairing {
  // Lock player order on first call — deterministic circle-method schedule
  // requires fixed positions. Standings get re-sorted by score each round,
  // which would break the rotation if we re-read from standings.
  private initialOrder: string[] | null = null;

  /**
   * Generate pairings for a specific round of a round-robin tournament.
   * The schedule is deterministic based on the initial player order.
   *
   * Circle method: Fix player 0, rotate positions 1..N-1.
   * Round r: rotate the array r-1 positions, then pair (0 vs last), (1 vs second-to-last), etc.
   */
  computePairings(standings: PlayerStanding[], round: number): RoundResult {
    // Capture initial order on first call — reuse for all rounds
    if (!this.initialOrder) {
      this.initialOrder = standings.map(s => s.wallet);
    }
    const players = this.initialOrder;

    if (players.length < 2) {
      throw new Error('Need at least 2 players for round-robin');
    }

    // If odd number, add a "BYE" sentinel
    const hasVirtualBye = players.length % 2 !== 0;
    const pool = [...players];
    if (hasVirtualBye) {
      pool.push('BYE');
    }

    const n = pool.length;
    const pairings: Pairing[] = [];
    let bye: string | undefined;

    // Circle method:
    // Fix pool[0], rotate pool[1..n-1] by (round-1) positions
    const fixed = pool[0];
    const rotating = pool.slice(1);

    // Rotate: shift left by (round-1) positions
    const shift = (round - 1) % rotating.length;
    const rotated = [...rotating.slice(shift), ...rotating.slice(0, shift)];

    // Rebuild the array with fixed at position 0
    const arranged = [fixed, ...rotated];

    // Pair: 0 vs n-1, 1 vs n-2, ..., mid pairs
    let gameIndex = 0;
    for (let i = 0; i < n / 2; i++) {
      const p1 = arranged[i];
      const p2 = arranged[n - 1 - i];

      if (p1 === 'BYE') {
        bye = p2;
        continue;
      }
      if (p2 === 'BYE') {
        bye = p1;
        continue;
      }

      // Color assignment: alternate based on round + position
      // Even rounds: first player is white; Odd rounds: second player is white
      // This ensures roughly equal white/black distribution
      const { white, black } = this.assignColors(p1, p2, round, i);
      pairings.push({ white, black, gameIndex });
      gameIndex++;
    }

    return { round, pairings, bye };
  }

  /**
   * Generate the complete schedule for all rounds.
   * Returns all round results at once for planning/display purposes.
   */
  generateFullSchedule(players: string[]): RoundResult[] {
    const standings: PlayerStanding[] = players.map(wallet => ({
      wallet, score: 0, buchholz: 0, gamesPlayed: 0,
      gamesWon: 0, gamesDrawn: 0, gamesLost: 0,
      opponents: [], colors: [],
    }));

    const totalRounds = players.length % 2 === 0 ? players.length - 1 : players.length;
    const schedule: RoundResult[] = [];

    for (let round = 1; round <= totalRounds; round++) {
      schedule.push(this.computePairings(standings, round));
    }

    return schedule;
  }

  private assignColors(
    p1: string,
    p2: string,
    round: number,
    pairIndex: number,
  ): { white: string; black: string } {
    // Alternate colors: if (round + pairIndex) is even, p1 is white
    if ((round + pairIndex) % 2 === 0) {
      return { white: p1, black: p2 };
    }
    return { white: p2, black: p1 };
  }

  calculateBuchholz(standings: PlayerStanding[]): void {
    const scoreMap = new Map(standings.map(p => [p.wallet, p.score]));
    for (const player of standings) {
      player.buchholz = player.opponents
        .filter(opp => opp !== 'BYE')
        .reduce((sum, opp) => sum + (scoreMap.get(opp) || 0), 0);
    }
  }
}
