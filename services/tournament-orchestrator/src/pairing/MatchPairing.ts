import { PlayerStanding, Pairing, RoundResult } from '../types/index.js';

/**
 * 1v1 Match pairing engine.
 * Always pairs the same two players, alternating colors each round.
 * Tracks series score for best-of-N matches.
 */
export class MatchPairing {
  private seriesScore: Map<string, number> = new Map(); // wallet -> wins

  computePairings(standings: PlayerStanding[], round: number): RoundResult {
    if (standings.length !== 2) {
      throw new Error(`Match format requires exactly 2 players, got ${standings.length}`);
    }

    const [p1, p2] = standings;

    // Alternate colors each round: odd rounds = p1 white, even rounds = p2 white
    const white = round % 2 === 1 ? p1.wallet : p2.wallet;
    const black = round % 2 === 1 ? p2.wallet : p1.wallet;

    const pairings: Pairing[] = [{
      white,
      black,
      gameIndex: 0,
    }];

    return { round, pairings };
  }

  /**
   * Record a game result and update series score.
   * Returns true if the series is clinched (a player has won majority).
   */
  recordResult(winner: string | null, bestOf: number): { clinched: boolean; clinchWinner?: string } {
    if (winner) {
      const current = this.seriesScore.get(winner) || 0;
      this.seriesScore.set(winner, current + 1);
    }

    const winsNeeded = Math.ceil(bestOf / 2);
    for (const [wallet, wins] of this.seriesScore) {
      if (wins >= winsNeeded) {
        return { clinched: true, clinchWinner: wallet };
      }
    }

    return { clinched: false };
  }

  getSeriesScore(): Map<string, number> {
    return new Map(this.seriesScore);
  }

  /**
   * Get the series winner based on current scores.
   * Used when all rounds are played (no early clinch).
   */
  getSeriesWinner(player1: string, player2: string): string {
    const p1Wins = this.seriesScore.get(player1) || 0;
    const p2Wins = this.seriesScore.get(player2) || 0;
    if (p1Wins > p2Wins) return player1;
    if (p2Wins > p1Wins) return player2;
    // Tiebreaker: player with white in game 1 (arbitrary but deterministic)
    return player1;
  }

  calculateBuchholz(_standings: PlayerStanding[]): void {
    // No Buchholz needed for 1v1 matches
  }
}
