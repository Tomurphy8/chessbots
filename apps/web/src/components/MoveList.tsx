'use client';

import { cn } from '@/lib/utils';

interface MoveListProps {
  moves: string[];
  currentMoveIndex: number;
  onMoveClick?: (index: number) => void;
}

export function MoveList({ moves, currentMoveIndex, onMoveClick }: MoveListProps) {
  const pairs: { num: number; white: string; black?: string }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({
      num: Math.floor(i / 2) + 1,
      white: moves[i],
      black: moves[i + 1],
    });
  }

  return (
    <div className="bg-chess-surface border border-chess-border rounded-lg p-3 max-h-[480px] overflow-y-auto">
      <h3 className="text-sm font-semibold text-gray-400 mb-2 uppercase tracking-wide">Moves</h3>
      <div className="space-y-0.5">
        {pairs.map((pair) => (
          <div key={pair.num} className="flex text-sm font-mono">
            <span className="w-8 text-gray-500 shrink-0">{pair.num}.</span>
            <button
              onClick={() => onMoveClick?.((pair.num - 1) * 2)}
              className={cn(
                'w-20 text-left px-1 rounded hover:bg-chess-border/50',
                currentMoveIndex === (pair.num - 1) * 2 && 'bg-chess-accent/20 text-chess-accent-light',
              )}
            >
              {pair.white}
            </button>
            {pair.black && (
              <button
                onClick={() => onMoveClick?.((pair.num - 1) * 2 + 1)}
                className={cn(
                  'w-20 text-left px-1 rounded hover:bg-chess-border/50',
                  currentMoveIndex === (pair.num - 1) * 2 + 1 && 'bg-chess-accent/20 text-chess-accent-light',
                )}
              >
                {pair.black}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
