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
}

export type TournamentTier = 'rookie' | 'bronze' | 'silver' | 'masters' | 'legends' | 'free';

export interface TournamentConfig {
  tournamentId: number;
  tier: TournamentTier;
  maxPlayers: number;
  minPlayers: number;
  totalRounds: number;
  timeControl: { baseTimeSeconds: number; incrementSeconds: number };
  /** USDC amount to auto-fund free tournaments (human-readable, e.g. 100 = $100) */
  freeTierPrizeUsdc?: number;
}
