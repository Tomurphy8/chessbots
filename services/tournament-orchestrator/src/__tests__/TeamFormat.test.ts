import { describe, it, expect, beforeEach } from 'vitest';
import { TeamPairing, type TeamInfo } from '../pairing/TeamPairing.js';
import type { TeamStanding } from '../types/index.js';

function makeTeams(count: number, membersPerTeam: number): TeamInfo[] {
  const teams: TeamInfo[] = [];
  for (let i = 0; i < count; i++) {
    const members: string[] = [];
    for (let j = 0; j < membersPerTeam; j++) {
      members.push(`0xTeam${i}Player${j}`);
    }
    teams.push({ teamId: i, captain: members[0], members });
  }
  return teams;
}

function makeTeamStandings(teams: TeamInfo[]): TeamStanding[] {
  return teams.map(t => ({
    teamId: t.teamId,
    captain: t.captain,
    members: t.members,
    matchesWon: 0,
    matchesDrawn: 0,
    matchesLost: 0,
    boardPoints: 0,
    points: 0,
    opponents: [],
    colors: [],
  }));
}

describe('TeamPairing', () => {
  let pairing: TeamPairing;

  beforeEach(() => {
    pairing = new TeamPairing();
  });

  it('produces correct board pairings for 2 teams of 3', () => {
    const teams = makeTeams(2, 3);
    pairing.setTeams(teams);

    const standings = makeTeamStandings(teams);
    const result = pairing.computePairings(standings, 1);

    expect(result.teamPairings.length).toBe(1);
    expect(result.roundResult.pairings.length).toBe(3); // 3 boards per team match
    expect(result.bye).toBeUndefined();
  });

  it('produces correct board pairings for 4 teams of 2', () => {
    const teams = makeTeams(4, 2);
    pairing.setTeams(teams);

    const standings = makeTeamStandings(teams);
    const result = pairing.computePairings(standings, 1);

    expect(result.teamPairings.length).toBe(2); // 4 teams = 2 matches
    expect(result.roundResult.pairings.length).toBe(4); // 2 boards × 2 matches
  });

  it('handles bye with odd number of teams', () => {
    const teams = makeTeams(3, 2);
    pairing.setTeams(teams);

    const standings = makeTeamStandings(teams);
    const result = pairing.computePairings(standings, 1);

    expect(result.teamPairings.length).toBe(1); // 1 match + 1 bye
    expect(result.bye).toBeDefined();
    expect([0, 1, 2]).toContain(result.bye);
  });

  it('alternates colors per board within a team match', () => {
    const teams = makeTeams(2, 4);
    pairing.setTeams(teams);

    const standings = makeTeamStandings(teams);
    const result = pairing.computePairings(standings, 1);

    const boardPairings = result.roundResult.pairings;
    // Board 0 (even): team1 member white
    // Board 1 (odd): team2 member white
    // etc.
    expect(boardPairings[0].white).toBe(teams[0].members[0]); // team0 board0 is white
    expect(boardPairings[1].white).toBe(teams[1].members[1]); // team1 board1 is white
    expect(boardPairings[2].white).toBe(teams[0].members[2]); // team0 board2 is white
    expect(boardPairings[3].white).toBe(teams[1].members[3]); // team1 board3 is white
  });

  it('assigns sequential game indices', () => {
    const teams = makeTeams(4, 3);
    pairing.setTeams(teams);

    const standings = makeTeamStandings(teams);
    const result = pairing.computePairings(standings, 1);

    const indices = result.roundResult.pairings.map(p => p.gameIndex);
    for (let i = 0; i < indices.length; i++) {
      expect(indices[i]).toBe(i);
    }
  });
});

describe('TeamPairing.resolveTeamMatch', () => {
  it('team1 wins with majority of boards', () => {
    const result = TeamPairing.resolveTeamMatch([
      { result: 'white', team1IsWhite: true },  // team1 wins
      { result: 'black', team1IsWhite: true },   // team2 wins
      { result: 'white', team1IsWhite: true },   // team1 wins
    ]);

    expect(result.team1Result).toBe('win');
    expect(result.team1BoardWins).toBe(2);
    expect(result.team2BoardWins).toBe(1);
    expect(result.draws).toBe(0);
  });

  it('team2 wins when they have majority', () => {
    const result = TeamPairing.resolveTeamMatch([
      { result: 'black', team1IsWhite: true },   // team2 wins
      { result: 'white', team1IsWhite: false },   // team2 wins (team2 is white)
      { result: 'draw', team1IsWhite: true },      // draw
    ]);

    expect(result.team1Result).toBe('loss');
    expect(result.team1BoardWins).toBe(0);
    expect(result.team2BoardWins).toBe(2);
    expect(result.draws).toBe(1);
  });

  it('draw when board wins are equal', () => {
    const result = TeamPairing.resolveTeamMatch([
      { result: 'white', team1IsWhite: true },  // team1 wins
      { result: 'black', team1IsWhite: true },   // team2 wins
      { result: 'draw', team1IsWhite: true },     // draw
    ]);

    expect(result.team1Result).toBe('draw');
    expect(result.team1BoardWins).toBe(1);
    expect(result.team2BoardWins).toBe(1);
    expect(result.draws).toBe(1);
  });

  it('all draws is a draw', () => {
    const result = TeamPairing.resolveTeamMatch([
      { result: 'draw', team1IsWhite: true },
      { result: 'draw', team1IsWhite: false },
    ]);

    expect(result.team1Result).toBe('draw');
    expect(result.team1BoardWins).toBe(0);
    expect(result.team2BoardWins).toBe(0);
    expect(result.draws).toBe(2);
  });

  it('handles team1 as black correctly', () => {
    const result = TeamPairing.resolveTeamMatch([
      { result: 'black', team1IsWhite: false },  // team1 is black, black wins → team1 wins
      { result: 'white', team1IsWhite: false },   // team1 is black, white wins → team2 wins
    ]);

    expect(result.team1Result).toBe('draw');
    expect(result.team1BoardWins).toBe(1);
    expect(result.team2BoardWins).toBe(1);
  });

  it('clean sweep', () => {
    const result = TeamPairing.resolveTeamMatch([
      { result: 'white', team1IsWhite: true },
      { result: 'black', team1IsWhite: false },
      { result: 'white', team1IsWhite: true },
      { result: 'black', team1IsWhite: false },
      { result: 'white', team1IsWhite: true },
    ]);

    expect(result.team1Result).toBe('win');
    expect(result.team1BoardWins).toBe(5);
    expect(result.team2BoardWins).toBe(0);
  });
});
