export interface GameInfo {
  gameId: string;
  tournamentId: number;
  round: number;
  gameIndex: number;
  white: string;
  black: string;
  status: GameStatus;
  result: GameResult;
  fen: string;
  moves: string[];
  moveCount: number;
  startedAt: number;
  timeControl: TimeControl;
  whiteTimeMs: number;
  blackTimeMs: number;
}

export interface TimeControl {
  baseTimeSeconds: number;
  incrementSeconds: number;
}

export enum GameStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  Completed = 'completed',
  Adjudicated = 'adjudicated',
}

export enum GameResult {
  Undecided = 'undecided',
  WhiteWins = 'white_wins',
  BlackWins = 'black_wins',
  Draw = 'draw',
  WhiteForfeit = 'white_forfeit',
  BlackForfeit = 'black_forfeit',
}

export interface MoveRequest {
  gameId: string;
  player: string;
  move: string;
  signature: string;
  timestamp: number;
}

export interface MoveResponse {
  success: boolean;
  fen?: string;
  moveNumber?: number;
  gameOver?: boolean;
  result?: GameResult;
  error?: string;
}
