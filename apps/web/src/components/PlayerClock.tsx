'use client';

import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface PlayerClockProps {
  name: string;
  elo?: number;
  timeMs: number;
  isActive: boolean;
  isLive: boolean;
  color: 'white' | 'black';
  result?: string;
}

function formatTime(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function PlayerClock({ name, elo, timeMs, isActive, isLive, color, result }: PlayerClockProps) {
  const [displayTime, setDisplayTime] = useState(timeMs);
  const lastUpdateRef = useRef(Date.now());

  // Sync from prop
  useEffect(() => {
    setDisplayTime(timeMs);
    lastUpdateRef.current = Date.now();
  }, [timeMs]);

  // Tick down locally for smooth display when active + live
  useEffect(() => {
    if (!isActive || !isLive || timeMs <= 0) return;

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastUpdateRef.current;
      const remaining = Math.max(0, timeMs - elapsed);
      setDisplayTime(remaining);
    }, 100);

    return () => clearInterval(interval);
  }, [isActive, isLive, timeMs]);

  const isWhite = color === 'white';
  const pieceIcon = isWhite ? '♔' : '♚';

  // Determine score display based on result
  let scoreDisplay = '';
  if (result && result !== 'undecided' && result !== 'Undecided') {
    if (result === 'WhiteWins' || result === 'BlackForfeit') {
      scoreDisplay = isWhite ? '1' : '0';
    } else if (result === 'BlackWins' || result === 'WhiteForfeit') {
      scoreDisplay = isWhite ? '0' : '1';
    } else if (result === 'Draw') {
      scoreDisplay = '½';
    }
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between px-4 py-2.5 rounded-lg border transition-colors',
        isActive && isLive
          ? 'bg-chess-accent/15 border-chess-accent/40'
          : 'bg-chess-surface border-chess-border/50',
      )}
    >
      <div className="flex items-center gap-3">
        <span className="text-xl">{pieceIcon}</span>
        <div>
          <span className="text-sm font-medium">{name || 'Unknown'}</span>
          {elo !== undefined && elo > 0 && (
            <span className="text-xs text-gray-500 ml-2">({elo})</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {scoreDisplay && (
          <span className="text-sm font-bold text-chess-gold">{scoreDisplay}</span>
        )}
        <span
          className={cn(
            'font-mono text-lg tabular-nums',
            isActive && isLive ? 'text-chess-accent-light' : 'text-gray-300',
            displayTime < 30000 && isActive && isLive && 'text-red-400',
          )}
        >
          {formatTime(displayTime)}
        </span>
      </div>
    </div>
  );
}
