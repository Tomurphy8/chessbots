export type GameStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'adjudicated'
  | 'cancelled';

export type GameResult =
  | 'undecided'
  | 'white_wins'
  | 'black_wins'
  | 'draw'
  | 'white_forfeit'
  | 'black_forfeit';

export interface Game {
  tournament: string;
  round: number;
  gameIndex: number;
  white: string;
  black: string;
  status: GameStatus;
  result: GameResult;
  moveCount: number;
  startedAt: number;
  endedAt: number;
  pgnUri: string;
  resultHash: string;
  arbiter: string;
}
