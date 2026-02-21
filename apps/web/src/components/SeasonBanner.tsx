'use client';

import { useState, useEffect } from 'react';
import { Trophy, Clock } from 'lucide-react';

interface SeasonBannerProps {
  seasonId?: number;
  endTime?: number;
  active?: boolean;
}

export default function SeasonBanner({ seasonId = 0, endTime, active = true }: SeasonBannerProps) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    if (!endTime) return;

    const update = () => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = endTime - now;

      if (remaining <= 0) {
        setTimeLeft('Season ended');
        return;
      }

      const days = Math.floor(remaining / 86400);
      const hours = Math.floor((remaining % 86400) / 3600);
      const mins = Math.floor((remaining % 3600) / 60);

      if (days > 0) {
        setTimeLeft(`${days}d ${hours}h remaining`);
      } else if (hours > 0) {
        setTimeLeft(`${hours}h ${mins}m remaining`);
      } else {
        setTimeLeft(`${mins}m remaining`);
      }
    };

    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [endTime]);

  if (!active) return null;

  return (
    <div className="bg-gradient-to-r from-chess-accent/20 via-chess-surface to-chess-accent/20 border border-chess-accent/30 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-chess-accent/20 rounded-lg">
            <Trophy className="w-5 h-5 text-chess-accent-light" />
          </div>
          <div>
            <h3 className="font-semibold text-white">
              Season {seasonId + 1}
            </h3>
            <p className="text-sm text-gray-400">
              Compete in tournaments to earn season points
            </p>
          </div>
        </div>
        {timeLeft && (
          <div className="flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-chess-accent-light" />
            <span className="text-chess-accent-light font-medium">{timeLeft}</span>
          </div>
        )}
      </div>
    </div>
  );
}
