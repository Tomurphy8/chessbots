import { type Address, type PublicClient, type WalletClient, getContract, parseUnits } from 'viem';
import { CHAIN } from '@/lib/chains';

// ABI for the ChessBotsTournament contract
export const CHESSBOTS_ABI = [
  {
    inputs: [{ name: 'tournamentId', type: 'uint256' }],
    name: 'getTournament',
    outputs: [{
      components: [
        { name: 'id', type: 'uint256' },
        { name: 'authority', type: 'address' },
        { name: 'tier', type: 'uint8' },
        { name: 'entryFee', type: 'uint256' },
        { name: 'status', type: 'uint8' },
        { name: 'maxPlayers', type: 'uint8' },
        { name: 'minPlayers', type: 'uint8' },
        { name: 'registeredCount', type: 'uint8' },
        { name: 'currentRound', type: 'uint8' },
        { name: 'totalRounds', type: 'uint8' },
        { name: 'startTime', type: 'int64' },
        { name: 'registrationDeadline', type: 'int64' },
        { name: 'baseTimeSeconds', type: 'uint32' },
        { name: 'incrementSeconds', type: 'uint32' },
        { name: 'winners', type: 'address[3]' },
        { name: 'resultsUri', type: 'string' },
        { name: 'prizeDistributed', type: 'bool' },
        { name: 'exists', type: 'bool' },
      ],
      name: '',
      type: 'tuple',
    }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'wallet', type: 'address' }],
    name: 'getAgent',
    outputs: [{
      components: [
        { name: 'wallet', type: 'address' },
        { name: 'name', type: 'string' },
        { name: 'metadataUri', type: 'string' },
        { name: 'agentType', type: 'uint8' },
        { name: 'eloRating', type: 'uint16' },
        { name: 'gamesPlayed', type: 'uint32' },
        { name: 'gamesWon', type: 'uint32' },
        { name: 'gamesDrawn', type: 'uint32' },
        { name: 'gamesLost', type: 'uint32' },
        { name: 'totalEarnings', type: 'uint64' },
        { name: 'referredBy', type: 'address' },
        { name: 'registered', type: 'bool' },
      ],
      name: '',
      type: 'tuple',
    }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tournamentId', type: 'uint256' },
      { name: 'agent', type: 'address' },
    ],
    name: 'getRegistration',
    outputs: [{
      components: [
        { name: 'agent', type: 'address' },
        { name: 'score', type: 'uint16' },
        { name: 'buchholz', type: 'uint16' },
        { name: 'gamesPlayed', type: 'uint8' },
        { name: 'gamesWon', type: 'uint8' },
        { name: 'gamesDrawn', type: 'uint8' },
        { name: 'gamesLost', type: 'uint8' },
        { name: 'finalRank', type: 'uint8' },
        { name: 'active', type: 'bool' },
        { name: 'exists', type: 'bool' },
      ],
      name: '',
      type: 'tuple',
    }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tournamentId', type: 'uint256' },
      { name: 'round', type: 'uint8' },
      { name: 'gameIndex', type: 'uint8' },
    ],
    name: 'getGame',
    outputs: [{
      components: [
        { name: 'tournamentId', type: 'uint256' },
        { name: 'round', type: 'uint8' },
        { name: 'gameIndex', type: 'uint8' },
        { name: 'white', type: 'address' },
        { name: 'black', type: 'address' },
        { name: 'status', type: 'uint8' },
        { name: 'result', type: 'uint8' },
        { name: 'moveCount', type: 'uint16' },
        { name: 'startedAt', type: 'int64' },
        { name: 'endedAt', type: 'int64' },
        { name: 'pgnHash', type: 'bytes32' },
        { name: 'resultHash', type: 'bytes32' },
        { name: 'arbiter', type: 'address' },
        { name: 'exists', type: 'bool' },
      ],
      name: '',
      type: 'tuple',
    }],
    stateMutability: 'view',
    type: 'function',
  },
  // protocol() — ProtocolState struct (totalGamesPlayed moved to separate slot)
  {
    inputs: [],
    name: 'protocol',
    outputs: [
      { name: 'authority', type: 'address' },
      { name: 'treasury', type: 'address' },
      { name: 'protocolFeeBps', type: 'uint16' },
      { name: 'buybackShareBps', type: 'uint16' },
      { name: 'treasuryShareBps', type: 'uint16' },
      { name: 'totalTournaments', type: 'uint64' },
      { name: 'totalPrizeDistributed', type: 'uint256' },
      { name: 'paused', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  // totalGamesPlayed — separate storage slot
  {
    inputs: [],
    name: 'totalGamesPlayed',
    outputs: [{ name: '', type: 'uint64' }],
    stateMutability: 'view',
    type: 'function',
  },
  // pendingBuyback
  {
    inputs: [],
    name: 'pendingBuyback',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  // tournamentCollected
  {
    inputs: [{ name: 'tournamentId', type: 'uint256' }],
    name: 'tournamentCollected',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  // --- Write functions ---
  {
    inputs: [{ name: 'tournamentId', type: 'uint256' }],
    name: 'registerForTournament',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'metadataUri', type: 'string' },
      { name: 'agentType', type: 'uint8' },
    ],
    name: 'registerAgent',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // executeBuyback — permissionless
  {
    inputs: [{ name: 'minChessOut', type: 'uint256' }],
    name: 'executeBuyback',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // --- Referral V2 functions (Tiers + Extended Cap + Referee Discount) ---
  {
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'metadataUri', type: 'string' },
      { name: 'agentType', type: 'uint8' },
      { name: 'referrer', type: 'address' },
    ],
    name: 'registerAgentWithReferral',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'referralEarnings',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'referralTournamentsRemaining',
    outputs: [{ name: '', type: 'uint16' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'referralCount',
    outputs: [{ name: '', type: 'uint16' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'referrer', type: 'address' }],
    name: 'getReferrerTier',
    outputs: [
      { name: 'tier', type: 'uint8' },
      { name: 'rateBps', type: 'uint16' },
      { name: 'count', type: 'uint16' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'referrer', type: 'address' }],
    name: 'getReferrerTierBps',
    outputs: [{ name: '', type: 'uint16' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'tournamentId', type: 'uint256' }],
    name: 'tournamentReferralBonuses',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'tournamentId', type: 'uint256' }],
    name: 'tournamentRefereeDiscounts',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  // Referral V2 constants
  {
    inputs: [],
    name: 'REFERRAL_FULL_RATE_TOURNAMENTS',
    outputs: [{ name: '', type: 'uint16' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'REFERRAL_LONG_TAIL_BPS',
    outputs: [{ name: '', type: 'uint16' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'REFEREE_DISCOUNT_BPS',
    outputs: [{ name: '', type: 'uint16' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'TIER_BRONZE_BPS',
    outputs: [{ name: '', type: 'uint16' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'TIER_SILVER_BPS',
    outputs: [{ name: '', type: 'uint16' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'TIER_GOLD_BPS',
    outputs: [{ name: '', type: 'uint16' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'claimReferralEarnings',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // --- Sponsorship functions (Proposal C) ---
  {
    inputs: [
      { name: 'tournamentId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'sponsorName', type: 'string' },
      { name: 'sponsorUri', type: 'string' },
    ],
    name: 'sponsorTournament',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'tournamentId', type: 'uint256' }],
    name: 'getSponsor',
    outputs: [{
      components: [
        { name: 'sponsor', type: 'address' },
        { name: 'name', type: 'string' },
        { name: 'uri', type: 'string' },
        { name: 'amount', type: 'uint256' },
      ],
      name: '',
      type: 'tuple',
    }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ERC20 ABI subset for USDC and CHESS
export const ERC20_ABI = [
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalBurned',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ChessStaking ABI
export const STAKING_ABI = [
  {
    inputs: [{ name: 'amount', type: 'uint256' }],
    name: 'stake',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'amount', type: 'uint256' }],
    name: 'unstake',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'getDiscount',
    outputs: [{ name: 'discountBps', type: 'uint16' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'stakedBalance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalStaked',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ChessBettingPool ABI (Proposal B — Spectator Betting)
export const BETTING_ABI = [
  {
    inputs: [
      { name: 'tournamentId', type: 'uint256' },
      { name: 'round', type: 'uint8' },
      { name: 'gameIndex', type: 'uint8' },
    ],
    name: 'createBetPool',
    outputs: [{ name: 'poolId', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'poolId', type: 'uint256' },
      { name: 'prediction', type: 'uint8' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'placeBet',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'poolId', type: 'uint256' }],
    name: 'settleBets',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'poolId', type: 'uint256' }],
    name: 'claimWinnings',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'poolId', type: 'uint256' }],
    name: 'claimRefund',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'poolId', type: 'uint256' }],
    name: 'getPoolTotal',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'poolId', type: 'uint256' },
      { name: 'bettor', type: 'address' },
    ],
    name: 'getBet',
    outputs: [
      { name: 'prediction', type: 'uint8' },
      { name: 'amount', type: 'uint256' },
      { name: 'claimed', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'poolId', type: 'uint256' }],
    name: 'getPoolBreakdown',
    outputs: [
      { name: 'whiteWins', type: 'uint256' },
      { name: 'blackWins', type: 'uint256' },
      { name: 'draw', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tournamentId', type: 'uint256' },
      { name: 'round', type: 'uint8' },
      { name: 'gameIndex', type: 'uint8' },
    ],
    name: 'getPoolIdForGame',
    outputs: [
      { name: 'poolId', type: 'uint256' },
      { name: 'exists', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'vigBps',
    outputs: [{ name: '', type: 'uint16' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'minBetAmount',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export const BetPredictionMap = {
  0: 'WhiteWins',
  1: 'BlackWins',
  2: 'Draw',
} as const;

export function getChessBotContract(address: Address, client: PublicClient) {
  return getContract({ address, abi: CHESSBOTS_ABI, client });
}

export function getUsdcContract(address: Address, client: PublicClient) {
  return getContract({ address, abi: ERC20_ABI, client });
}

export function getChessTokenContract(address: Address, client: PublicClient) {
  return getContract({ address, abi: ERC20_ABI, client });
}

export function getStakingContract(address: Address, client: PublicClient) {
  return getContract({ address, abi: STAKING_ABI, client });
}

export function getBettingContract(address: Address, client: PublicClient) {
  return getContract({ address, abi: BETTING_ABI, client });
}

// Enum mappings matching Solidity contract
export const TierMap = { Rookie: 0, Bronze: 1, Silver: 2, Masters: 3, Legends: 4, Free: 5 } as const;
export const TierNames = ['Rookie', 'Bronze', 'Silver', 'Masters', 'Legends', 'Free'] as const;
export const StatusMap = {
  0: 'Registration',
  1: 'InProgress',
  2: 'RoundActive',
  3: 'RoundComplete',
  4: 'Completed',
  5: 'Cancelled',
} as const;
export const GameResultMap = {
  0: 'Undecided',
  1: 'WhiteWins',
  2: 'BlackWins',
  3: 'Draw',
  4: 'WhiteForfeit',
  5: 'BlackForfeit',
} as const;
export const AgentTypeMap = {
  0: 'OpenClaw',
  1: 'SolanaAgentKit',
  2: 'Custom',
} as const;
