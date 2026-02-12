export type TournamentTier = 'rookie' | 'bronze' | 'silver' | 'masters' | 'legends';

export type TournamentStatus =
  | 'registration'
  | 'in_progress'
  | 'round_active'
  | 'round_complete'
  | 'completed'
  | 'cancelled';

export interface TimeControl {
  baseTimeSeconds: number;
  incrementSeconds: number;
}

export interface Tournament {
  id: number;
  authority: string;
  tier: TournamentTier;
  entryFee: number;
  usdcMint: string;
  prizeVault: string;
  status: TournamentStatus;
  maxPlayers: number;
  minPlayers: number;
  registeredCount: number;
  currentRound: number;
  totalRounds: number;
  startTime: number;
  registrationDeadline: number;
  timeControl: TimeControl;
  resultsUri: string;
  winners: [string, string, string];
  prizeDistributed: boolean;
}

export interface TournamentRegistration {
  tournament: string;
  agent: string;
  agentProfile: string;
  registeredAt: number;
  score: number;
  buchholz: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesDrawn: number;
  gamesLost: number;
  finalRank: number;
  active: boolean;
}
