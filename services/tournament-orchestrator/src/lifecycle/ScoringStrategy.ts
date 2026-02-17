import type { PlayerStanding, TournamentFormat } from '../types/index.js';

/**
 * Scoring strategy interface.
 * Different formats use different point systems:
 * - Swiss: Win=2, Draw=1, Loss=0
 * - Match: Win=2, Draw=1, Loss=0 (same as Swiss, but series score matters)
 * - League: Win=3, Draw=1, Loss=0 (football-style)
 * - Team: Win=3, Draw=1, Loss=0 (at team level)
 */
export interface ScoringStrategy {
  readonly winPoints: number;
  readonly drawPoints: number;
  readonly lossPoints: number;

  /** Sort standings according to format-specific rules */
  sortStandings(standings: PlayerStanding[]): PlayerStanding[];

  /** Get top N winners from sorted standings */
  getWinners(standings: PlayerStanding[], count: number): string[];
}

/**
 * Swiss scoring: Win=2, Draw=1, Loss=0
 * Tiebreaker: Score → Buchholz → Deterministic (wallet address)
 */
export class SwissScoring implements ScoringStrategy {
  readonly winPoints = 2;
  readonly drawPoints = 1;
  readonly lossPoints = 0;

  sortStandings(standings: PlayerStanding[]): PlayerStanding[] {
    return [...standings].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
      return a.wallet.toLowerCase() < b.wallet.toLowerCase() ? -1 : 1;
    });
  }

  getWinners(standings: PlayerStanding[], count: number): string[] {
    const sorted = this.sortStandings(standings);
    return sorted.slice(0, count).map(s => s.wallet);
  }
}

/**
 * Match scoring: Win=2, Draw=1, Loss=0
 * Only 2 players. Winner is determined by series score, not individual games.
 * Returns only 1 winner (2nd and 3rd are empty).
 */
export class MatchScoring implements ScoringStrategy {
  readonly winPoints = 2;
  readonly drawPoints = 1;
  readonly lossPoints = 0;

  sortStandings(standings: PlayerStanding[]): PlayerStanding[] {
    return [...standings].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon;
      return a.wallet.toLowerCase() < b.wallet.toLowerCase() ? -1 : 1;
    });
  }

  getWinners(standings: PlayerStanding[], _count: number): string[] {
    const sorted = this.sortStandings(standings);
    // Match: only 1 winner, others are empty
    return [sorted[0]?.wallet || ''];
  }
}

/**
 * League scoring: Win=3, Draw=1, Loss=0
 * Tiebreaker: Points → Wins → Head-to-head → Buchholz → Wallet
 * Returns top 3 winners.
 */
export class LeagueScoring implements ScoringStrategy {
  readonly winPoints = 3;
  readonly drawPoints = 1;
  readonly lossPoints = 0;

  sortStandings(standings: PlayerStanding[]): PlayerStanding[] {
    return [...standings].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon;
      if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
      return a.wallet.toLowerCase() < b.wallet.toLowerCase() ? -1 : 1;
    });
  }

  getWinners(standings: PlayerStanding[], count: number): string[] {
    const sorted = this.sortStandings(standings);
    return sorted.slice(0, count).map(s => s.wallet);
  }
}

/**
 * Team scoring: Win=3, Draw=1, Loss=0 (at team level)
 * Same as League scoring since it's applied at the team level.
 */
export class TeamScoring implements ScoringStrategy {
  readonly winPoints = 3;
  readonly drawPoints = 1;
  readonly lossPoints = 0;

  sortStandings(standings: PlayerStanding[]): PlayerStanding[] {
    return [...standings].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon;
      if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
      return a.wallet.toLowerCase() < b.wallet.toLowerCase() ? -1 : 1;
    });
  }

  getWinners(standings: PlayerStanding[], count: number): string[] {
    const sorted = this.sortStandings(standings);
    return sorted.slice(0, count).map(s => s.wallet);
  }
}

/**
 * Factory: create the appropriate scoring strategy for a format.
 */
export function createScoringStrategy(format: TournamentFormat): ScoringStrategy {
  switch (format) {
    case 'swiss': return new SwissScoring();
    case 'match': return new MatchScoring();
    case 'league': return new LeagueScoring();
    case 'team': return new TeamScoring();
    default: return new SwissScoring();
  }
}
