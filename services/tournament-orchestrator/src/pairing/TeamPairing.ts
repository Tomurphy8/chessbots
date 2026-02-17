import { PlayerStanding, Pairing, RoundResult, TeamStanding } from '../types/index.js';
import { SwissPairing } from './SwissPairing.js';

/**
 * Team pairing engine for team tournaments.
 * Uses Swiss pairing at the team level, then generates individual board pairings
 * for each team match.
 *
 * When two teams are paired, their members are matched by board number:
 * Board 1 (highest rated) vs Board 1, Board 2 vs Board 2, etc.
 */

export interface TeamInfo {
  teamId: number;
  captain: string;
  members: string[]; // Sorted by ELO/registration order (Board 1 = first)
}

// Re-export TeamStanding from types for backward compatibility
export type { TeamStanding } from '../types/index.js';

export class TeamPairing {
  private swissPairing: SwissPairing;
  private teams: TeamInfo[] = [];

  constructor() {
    this.swissPairing = new SwissPairing();
  }

  setTeams(teams: TeamInfo[]): void {
    this.teams = teams;
  }

  /**
   * Compute team-level pairings using Swiss system, then expand into individual board pairings.
   * Returns both team pairings and the expanded individual game pairings.
   */
  computePairings(teamStandings: TeamStanding[], round: number): {
    teamPairings: Array<{ team1: number; team2: number }>;
    roundResult: RoundResult;
    bye?: number; // teamId that gets a bye
  } {
    // Convert team standings to PlayerStanding format for Swiss pairing
    const playerStandings: PlayerStanding[] = teamStandings.map(ts => ({
      wallet: `team-${ts.teamId}`, // Use team ID as wallet for Swiss pairing
      score: ts.points,
      buchholz: 0,
      gamesPlayed: ts.matchesWon + ts.matchesDrawn + ts.matchesLost,
      gamesWon: ts.matchesWon,
      gamesDrawn: ts.matchesDrawn,
      gamesLost: ts.matchesLost,
      opponents: ts.opponents.map(id => `team-${id}`),
      colors: ts.colors,
    }));

    // Get Swiss pairings at team level
    const swissResult = this.swissPairing.computePairings(playerStandings, round);

    // Extract team IDs from Swiss pairings
    const teamPairings: Array<{ team1: number; team2: number }> = [];
    const allBoardPairings: Pairing[] = [];
    let gameIndex = 0;

    for (const pairing of swissResult.pairings) {
      const team1Id = parseInt(pairing.white.replace('team-', ''));
      const team2Id = parseInt(pairing.black.replace('team-', ''));

      teamPairings.push({ team1: team1Id, team2: team2Id });

      // Get team rosters
      const team1 = this.teams.find(t => t.teamId === team1Id);
      const team2 = this.teams.find(t => t.teamId === team2Id);

      if (!team1 || !team2) {
        throw new Error(`Team not found: ${team1Id} or ${team2Id}`);
      }

      // Generate individual board pairings
      const boardCount = Math.min(team1.members.length, team2.members.length);
      for (let board = 0; board < boardCount; board++) {
        // Alternate colors per board: even boards = team1 white, odd boards = team2 white
        const white = board % 2 === 0 ? team1.members[board] : team2.members[board];
        const black = board % 2 === 0 ? team2.members[board] : team1.members[board];

        allBoardPairings.push({ white, black, gameIndex });
        gameIndex++;
      }
    }

    // Handle bye
    let byeTeamId: number | undefined;
    if (swissResult.bye) {
      byeTeamId = parseInt(swissResult.bye.replace('team-', ''));
    }

    return {
      teamPairings,
      roundResult: { round, pairings: allBoardPairings, bye: swissResult.bye },
      bye: byeTeamId,
    };
  }

  /**
   * Resolve individual board results into a team match result.
   * Returns 'win' if team1 won majority of boards, 'loss' if team2 won, 'draw' if tied.
   */
  calculateBuchholz(standings: PlayerStanding[]): void {
    // Team tournaments don't use individual Buchholz
    // Buchholz is calculated at team level via the internal SwissPairing
  }

  static resolveTeamMatch(
    boardResults: Array<{ result: 'white' | 'black' | 'draw'; team1IsWhite: boolean }>,
  ): { team1Result: 'win' | 'loss' | 'draw'; team1BoardWins: number; team2BoardWins: number; draws: number } {
    let team1BoardWins = 0;
    let team2BoardWins = 0;
    let draws = 0;

    for (const board of boardResults) {
      if (board.result === 'draw') {
        draws++;
      } else if (
        (board.result === 'white' && board.team1IsWhite) ||
        (board.result === 'black' && !board.team1IsWhite)
      ) {
        team1BoardWins++;
      } else {
        team2BoardWins++;
      }
    }

    let team1Result: 'win' | 'loss' | 'draw';
    if (team1BoardWins > team2BoardWins) {
      team1Result = 'win';
    } else if (team2BoardWins > team1BoardWins) {
      team1Result = 'loss';
    } else {
      team1Result = 'draw';
    }

    return { team1Result, team1BoardWins, team2BoardWins, draws };
  }
}
