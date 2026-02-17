import type { PlayerStanding } from '../types/index.js';

/**
 * LeagueManager handles league-specific logic:
 * - 3/1/0 point system (win/draw/loss)
 * - Division metadata (name, season, promotion/relegation zones)
 * - Final standings with promotion/relegation recommendations
 */

export interface DivisionConfig {
  divisionName: string;
  season: number;
  promotionZone: number; // Top N get promoted
  relegationZone: number; // Bottom N get relegated
}

export interface LeagueStandingEntry {
  wallet: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number; // 3*W + 1*D
  boardDiff: number; // Game wins - game losses (like goal difference)
  isPromotionZone: boolean;
  isRelegationZone: boolean;
}

export class LeagueManager {
  private division?: DivisionConfig;

  setDivision(config: DivisionConfig): void {
    this.division = config;
  }

  /**
   * Convert raw PlayerStanding (with league 3/1/0 scoring) into a formatted league table.
   * The `score` field in PlayerStanding already uses league points (3/1/0) when using LeagueScoring.
   */
  buildLeagueTable(standings: PlayerStanding[]): LeagueStandingEntry[] {
    const sorted = [...standings].sort((a, b) => {
      // Primary: points (already in standings as `score`)
      if (b.score !== a.score) return b.score - a.score;
      // Secondary: wins
      if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon;
      // Tertiary: board difference (W-L)
      const aDiff = a.gamesWon - a.gamesLost;
      const bDiff = b.gamesWon - b.gamesLost;
      if (bDiff !== aDiff) return bDiff - aDiff;
      // Quaternary: Buchholz
      if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
      // Final: deterministic by wallet
      return a.wallet.toLowerCase() < b.wallet.toLowerCase() ? -1 : 1;
    });

    const totalPlayers = sorted.length;
    const promoZone = this.division?.promotionZone ?? 2;
    const relegZone = this.division?.relegationZone ?? 2;

    return sorted.map((s, i) => ({
      wallet: s.wallet,
      played: s.gamesPlayed,
      won: s.gamesWon,
      drawn: s.gamesDrawn,
      lost: s.gamesLost,
      points: s.score, // Already league points (3/1/0) from LeagueScoring
      boardDiff: s.gamesWon - s.gamesLost,
      isPromotionZone: i < promoZone,
      isRelegationZone: i >= totalPlayers - relegZone,
    }));
  }

  /**
   * Get promotion and relegation recommendations at season end.
   */
  getPromotionRelegation(standings: PlayerStanding[]): {
    promoted: string[];
    relegated: string[];
  } {
    const table = this.buildLeagueTable(standings);
    return {
      promoted: table.filter(e => e.isPromotionZone).map(e => e.wallet),
      relegated: table.filter(e => e.isRelegationZone).map(e => e.wallet),
    };
  }

  getDivision(): DivisionConfig | undefined {
    return this.division;
  }
}
