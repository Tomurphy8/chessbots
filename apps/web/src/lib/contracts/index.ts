import { CHAIN } from '@/lib/chains';

// Contract types for Monad deployment
export interface TournamentData {
  id: string;
  tier: 'Rookie' | 'Bronze' | 'Silver' | 'Masters' | 'Legends' | 'Free';
  status: 'Registration' | 'InProgress' | 'RoundActive' | 'RoundComplete' | 'Completed' | 'Cancelled';
  entryFee: number; // in USDC (6 decimals)
  maxPlayers: number;
  registeredCount: number;
  currentRound: number;
  totalRounds: number;
  startTime: number;
  registrationDeadline: number;
  prizePool: number;
  authority: string;
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

export const CONTRACT_ADDRESS = CHAIN.contractAddress;
export const USDC_ADDRESS = CHAIN.usdcAddress;
export const CHESS_TOKEN_ADDRESS = CHAIN.chessTokenAddress;
export const STAKING_ADDRESS = CHAIN.stakingAddress;
