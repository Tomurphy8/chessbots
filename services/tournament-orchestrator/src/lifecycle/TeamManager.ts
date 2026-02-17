import type { PlayerStanding } from '../types/index.js';
import type { TeamInfo, TeamStanding } from '../pairing/TeamPairing.js';
import { TeamPairing } from '../pairing/TeamPairing.js';

/**
 * TeamManager handles team-level state and match resolution.
 * Tracks team standings, resolves individual board results into team match results,
 * and manages team roster data.
 */
export class TeamManager {
  private teams: Map<number, TeamInfo> = new Map();
  private teamStandings: Map<number, TeamStanding> = new Map();

  registerTeam(teamId: number, captain: string, members: string[]): void {
    if (this.teams.has(teamId)) {
      throw new Error(`Team ${teamId} already registered`);
    }

    const team: TeamInfo = { teamId, captain, members };
    this.teams.set(teamId, team);

    this.teamStandings.set(teamId, {
      teamId,
      captain,
      members,
      matchesWon: 0,
      matchesDrawn: 0,
      matchesLost: 0,
      boardPoints: 0,
      points: 0,
      opponents: [],
      colors: [],
    });
  }

  getTeam(teamId: number): TeamInfo | undefined {
    return this.teams.get(teamId);
  }

  getTeams(): TeamInfo[] {
    return Array.from(this.teams.values());
  }

  getTeamStandings(): TeamStanding[] {
    return Array.from(this.teamStandings.values()).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.boardPoints !== a.boardPoints) return b.boardPoints - a.boardPoints;
      if (b.matchesWon !== a.matchesWon) return b.matchesWon - a.matchesWon;
      return a.teamId - b.teamId;
    });
  }

  /**
   * Resolve a team match from individual board results.
   * Updates team standings accordingly.
   *
   * @param team1Id First team ID
   * @param team2Id Second team ID
   * @param boardResults Array of board results: { result, team1IsWhite }
   */
  resolveTeamMatch(
    team1Id: number,
    team2Id: number,
    boardResults: Array<{ result: 'white' | 'black' | 'draw'; team1IsWhite: boolean }>,
  ): { team1Result: 'win' | 'loss' | 'draw'; team1BoardWins: number; team2BoardWins: number } {
    const resolution = TeamPairing.resolveTeamMatch(boardResults);

    const ts1 = this.teamStandings.get(team1Id);
    const ts2 = this.teamStandings.get(team2Id);
    if (!ts1 || !ts2) throw new Error('Team not found');

    // Update board points
    ts1.boardPoints += resolution.team1BoardWins;
    ts2.boardPoints += resolution.team2BoardWins;

    // Update match results
    ts1.opponents.push(team2Id);
    ts2.opponents.push(team1Id);

    if (resolution.team1Result === 'win') {
      ts1.matchesWon++;
      ts1.points += 3;
      ts2.matchesLost++;
    } else if (resolution.team1Result === 'loss') {
      ts1.matchesLost++;
      ts2.matchesWon++;
      ts2.points += 3;
    } else {
      ts1.matchesDrawn++;
      ts1.points += 1;
      ts2.matchesDrawn++;
      ts2.points += 1;
    }

    return {
      team1Result: resolution.team1Result,
      team1BoardWins: resolution.team1BoardWins,
      team2BoardWins: resolution.team2BoardWins,
    };
  }

  /**
   * Get team-level winners (captains) sorted by standings.
   */
  getWinners(): { first: string; second: string; third: string } {
    const sorted = this.getTeamStandings();
    return {
      first: sorted[0]?.captain || '',
      second: sorted[1]?.captain || '',
      third: sorted[2]?.captain || '',
    };
  }

  /**
   * Find which team an agent belongs to.
   */
  findTeamForAgent(wallet: string): number | undefined {
    for (const [teamId, team] of this.teams) {
      if (team.members.includes(wallet)) return teamId;
    }
    return undefined;
  }
}
