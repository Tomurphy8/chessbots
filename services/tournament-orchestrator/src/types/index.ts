export interface PlayerStanding {
  wallet: string;
  score: number;
  buchholz: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesDrawn: number;
  gamesLost: number;
  opponents: string[];
  colors: ('white' | 'black')[];
}

export interface Pairing {
  white: string;
  black: string;
  gameIndex: number;
}

export interface RoundResult {
  round: number;
  pairings: Pairing[];
  bye?: string;
}

export interface ChainConfig {
  rpcUrl: string;
  contractAddress: string;
  usdcAddress: string;
  chessTokenAddress: string;
  stakingAddress: string;
  privateKey: string;
  // V4 Economics contracts
  v4ContractAddress?: string;
  revenueRouterAddress?: string;
  eloContractAddress?: string;
  seasonContractAddress?: string;
}

export type TournamentTier = 'rookie' | 'bronze' | 'silver' | 'masters' | 'legends' | 'free';
export type TournamentFormat = 'swiss' | 'match' | 'team' | 'league';

export interface TournamentConfig {
  tournamentId: number;
  tier: TournamentTier;
  format: TournamentFormat;
  maxPlayers: number;
  minPlayers: number;
  totalRounds: number;
  timeControl: { baseTimeSeconds: number; incrementSeconds: number };
  /** USDC amount to auto-fund free tournaments (human-readable, e.g. 100 = $100) */
  freeTierPrizeUsdc?: number;
  /** For match format: number of games in the series (1, 3, or 5) */
  bestOf?: number;
  /** For team format: number of players per team */
  teamSize?: number;
  /** Whether this tournament is on the V4 contract */
  useV4?: boolean;
  /** Bracket filter (0=Open, 1=Unrated, 2=ClassC, 3=ClassB, 4=ClassA) */
  bracket?: number;
}

/** Team standing for team tournaments */
export interface TeamStanding {
  teamId: number;
  captain: string;
  members: string[];
  matchesWon: number;
  matchesDrawn: number;
  matchesLost: number;
  boardPoints: number;
  points: number;
  /** Opponent team IDs (for Swiss pairing at team level) */
  opponents: number[];
  /** Team "color" for each round (for Swiss color-balancing) */
  colors: ('white' | 'black')[];
}

/** League standing extends player standing with league-specific points */
export interface LeagueStanding extends PlayerStanding {
  /** League points: 3 for win, 1 for draw, 0 for loss */
  leaguePoints: number;
}
