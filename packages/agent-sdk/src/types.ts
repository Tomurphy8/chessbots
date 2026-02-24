import type { Hex, Address, Chain } from 'viem';

// ── Chess Engine Interface ────────────────────────────────────────────────
// Implement this to plug in any chess engine (Stockfish, LLM, custom AI)

export interface ChessEngine {
  /** Initialize the engine (called once at startup) */
  init(): Promise<void>;

  /** Select a move given the current game state */
  getMove(params: GetMoveParams): Promise<string>;

  /** Called when a game ends (for learning/logging) */
  onGameEnd?(result: GameEndResult): void;

  /** Called when a tournament ends */
  onTournamentEnd?(result: TournamentEndResult): void;

  /** Cleanup (called on shutdown) */
  destroy?(): Promise<void>;
}

export interface GetMoveParams {
  gameId: string;
  fen: string;
  legalMoves: string[];
  color: 'white' | 'black';
  moveCount: number;
  opponentAddress: Address;
  timeRemaining?: number;
  opponentTimeRemaining?: number;
}

export interface GameEndResult {
  gameId: string;
  result: 'win' | 'loss' | 'draw';
  color: 'white' | 'black';
  opponent: Address;
  totalMoves: number;
}

export interface TournamentEndResult {
  tournamentId: number;
  placement: number;
  prizeAmount: number;
  playerCount: number;
}

// ── Agent Config ──────────────────────────────────────────────────────────

export interface AgentConfig {
  /** Agent display name (registered on-chain) */
  name: string;

  /** Private key (hex) or 'env:PRIVATE_KEY' to read from env */
  privateKey: Hex | string;

  /** Gateway URL (defaults to production) */
  gatewayUrl?: string;

  /** Monad RPC URL */
  rpcUrl?: string;

  /** Relayer URL for gasless meta-transactions (defaults to production) */
  relayerUrl?: string;

  /** Strategy for tournament selection */
  strategy?: StrategyName;

  /** Maximum entry fee in USDC (6 decimals). 0 = free only */
  maxEntryFeeUsdc?: number;

  /** Minimum tier to enter */
  minTier?: TierName;

  /** Maximum tier to enter */
  maxTier?: TierName;

  /** Tournament formats to enter */
  formats?: FormatName[];

  /** Polling interval in ms (default: 2000) */
  pollIntervalMs?: number;

  /** Referrer address for on-chain referral */
  referrer?: Address;

  /** Webhook URL for push notifications */
  webhookUrl?: string;

  /** Auto-register for agent on-chain if not registered */
  autoRegister?: boolean;

  /** Metadata URI for agent profile */
  metadataUri?: string;

  /** Autonomous economics configuration */
  economics?: EconomicsConfig;
}

// ── Autonomous Economics ─────────────────────────────────────────────────

export interface EconomicsConfig {
  /** Enable autonomous referral earnings claiming (default: true) */
  autoClaimEarnings?: boolean;

  /** Minimum USDC earnings to trigger a claim (default: 1.0) */
  claimThresholdUsdc?: number;

  /** Enable automatic tier progression: free → rookie → bronze → ... (default: true) */
  autoTierUp?: boolean;

  /** How often to run the economics loop in ms (default: 300_000 = 5 min) */
  economicsIntervalMs?: number;

  /** Reserve ratio: fraction of balance to keep as safety margin (default: 0.2) */
  reserveRatio?: number;
}

// ── Strategy ──────────────────────────────────────────────────────────────

export type StrategyName = 'grinder' | 'value' | 'climber' | 'whale';

export interface Strategy {
  name: StrategyName;
  shouldEnter(tournament: TournamentInfo, agentState: AgentState): boolean;
}

// ── Tournament & Game Types ───────────────────────────────────────────────

export type TierName = 'free' | 'rookie' | 'bronze' | 'silver' | 'masters' | 'legends';
export type FormatName = 'swiss' | 'match' | 'league' | 'team';

/** Tournament tier entry fees in USDC */
export const TIER_ENTRY_FEES: Record<TierName, number> = {
  free: 0,
  rookie: 5,
  bronze: 50,
  silver: 100,
  masters: 250,
  legends: 500,
};

export interface TournamentInfo {
  id: number;
  tier: TierName;
  format: FormatName;
  entryFee: number;        // USDC (6 decimals)
  maxPlayers: number;
  registeredCount: number;
  status: string;
  startTime: number;
  registrationDeadline: number;
  baseTimeSeconds: number;
  incrementSeconds: number;
}

export interface GameInfo {
  gameId: string;
  tournamentId: number;
  white: Address;
  black: Address;
  fen: string;
  status: string;
  legalMoves: string[];
  moveCount: number;
  result?: string;
}

export interface AgentState {
  address: Address;
  usdcBalance: number;
  chessBalance: number;
  eloRating: number;
  gamesPlayed: number;
  tournamentsEntered: number;
  activeTournaments: number[];
  activeGames: string[];
  /** Accumulated referral earnings in USDC (unclaimed) */
  referralEarnings: number;
  /** Number of agents referred */
  referralCount: number;
  /** Referral tier: 0=Bronze, 1=Silver, 2=Gold */
  referralTier: number;
  /** Referral tier name */
  referralTierName: string;
}

// ── Events ────────────────────────────────────────────────────────────────

export interface AgentEvents {
  'tournament:discovered': (tournament: TournamentInfo) => void;
  'tournament:joined': (tournamentId: number) => void;
  'tournament:completed': (result: TournamentEndResult) => void;
  'game:started': (game: GameInfo) => void;
  'game:move': (game: GameInfo) => void;
  'game:ended': (result: GameEndResult) => void;
  'move:submitted': (gameId: string, move: string) => void;
  'error': (error: Error, context?: string) => void;
  'status': (message: string) => void;
  /** Referral earnings claimed */
  'economics:claimed': (amount: number) => void;
  /** Agent auto-progressed to a higher tournament tier */
  'economics:tierUp': (oldMaxFee: number, newMaxFee: number, reason: string) => void;
  /** Economics loop status update */
  'economics:status': (message: string) => void;
}
