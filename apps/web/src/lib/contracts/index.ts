import { CHAIN } from '@/lib/chains';

// Contract types for Monad deployment
export type TournamentFormat = 'Swiss' | '1v1' | 'Team' | 'League';

export interface TournamentData {
  id: string;
  tier: 'Rookie' | 'Bronze' | 'Silver' | 'Masters' | 'Legends' | 'Free';
  status: 'Registration' | 'InProgress' | 'RoundActive' | 'RoundComplete' | 'Completed' | 'Cancelled';
  format: TournamentFormat;
  entryFee: number; // in USDC (6 decimals)
  maxPlayers: number;
  registeredCount: number;
  currentRound: number;
  totalRounds: number;
  startTime: number;
  registrationDeadline: number;
  prizePool: number;
  authority: string;
  bestOf?: number;        // For 1v1 match format (1, 3, or 5)
  teamSize?: number;      // For team format (e.g. 5)
  challengeTarget?: string; // For 1v1 match challenges
}

export interface AgentData {
  wallet: string;
  name: string;
  agentType: 'OpenClaw' | 'SolanaAgentKit' | 'Custom';
  eloRating: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesDrawn: number;
  gamesLost: number;
  totalEarnings: number;
}

export interface StandingData {
  agent: string;
  score: number;
  buchholz: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesDrawn: number;
  gamesLost: number;
  rank: number;
}

export interface GameData {
  tournamentId: string;
  round: number;
  gameIndex: number;
  white: string;
  black: string;
  status: 'Pending' | 'InProgress' | 'Completed' | 'Aborted';
  result: 'Undecided' | 'WhiteWins' | 'BlackWins' | 'Draw' | 'WhiteForfeit' | 'BlackForfeit';
  moveCount: number;
  pgnHash: string;
}

export interface ProtocolStats {
  totalTournaments: number;
  totalGamesPlayed: number;
  // FE-H1(R7): Keep as string from formatUnits to preserve uint256 precision
  totalPrizeDistributed: string;
}

export interface TokenomicsData {
  pendingBuyback: string;     // USDC (formatted string from formatUnits)
  totalBurned: string;         // CHESS burned (formatted string from formatUnits)
  totalSupply: string;         // CHESS total supply (formatted string from formatUnits)
  totalStaked: string;         // CHESS staked (formatted string from formatUnits)
}

export interface StakingData {
  stakedBalance: string;       // User's staked CHESS (formatted string)
  discountBps: number;         // User's current discount in basis points
  chessBalance: string;        // User's wallet CHESS balance (formatted string)
}

// Referral data (Proposal A)
export interface ReferralData {
  referrer: string;
  earnings: string;           // USDC formatted string
  tournamentsRemaining: number;
}

// Sponsorship data (Proposal C)
export interface SponsorshipData {
  sponsor: string;
  name: string;
  uri: string;
  amount: string;             // USDC formatted string
}

// Bet pool data (Proposal B)
export interface BetPoolData {
  poolId: string;
  tournamentId: string;
  round: number;
  gameIndex: number;
  status: 'Open' | 'Settled' | 'Cancelled';
  totalWhiteWins: string;     // USDC formatted string
  totalBlackWins: string;
  totalDraw: string;
  totalPool: string;
  vigCollected: string;
  winningPrediction?: 'WhiteWins' | 'BlackWins' | 'Draw';
}

export interface BetData {
  prediction: 'WhiteWins' | 'BlackWins' | 'Draw';
  amount: string;             // USDC formatted string
  claimed: boolean;
}

export const CONTRACT_ADDRESS = CHAIN.contractAddress;
export const USDC_ADDRESS = CHAIN.usdcAddress;
export const CHESS_TOKEN_ADDRESS = CHAIN.chessTokenAddress;
export const STAKING_ADDRESS = CHAIN.stakingAddress;
export const BETTING_POOL_ADDRESS = CHAIN.bettingPoolAddress;
