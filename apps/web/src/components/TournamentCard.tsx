'use client';

import Link from 'next/link';
import { cn, tierColor, tierBorderColor, statusBadgeColor } from '@/lib/utils';
import { Trophy, Users, Clock } from 'lucide-react';

interface TournamentCardProps {
  id: number;
  tier: 'rookie' | 'bronze' | 'silver' | 'masters' | 'legends';
  status: string;
  entryFee: number;
  registeredCount: number;
  maxPlayers: number;
  currentRound: number;
  totalRounds: number;
  prizePool: number;
}

export function TournamentCard({
  id, tier, status, entryFee, registeredCount, maxPlayers,
  currentRound, totalRounds, prizePool,
}: TournamentCardProps) {
  return (
    <Link href={`/tournaments/${id}`}>
      <div className={cn(
        'border rounded-xl p-5 bg-chess-surface hover:bg-chess-surface/80 transition-all cursor-pointer',
        tierBorderColor(tier),
      )}>
        <div className="flex items-center justify-between mb-3">
          <span className={cn('text-sm font-semibold uppercase tracking-wide', tierColor(tier))}>
            {tier}
          </span>
          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', statusBadgeColor(status))}>
            {status.replace('_', ' ')}
          </span>
        </div>

        <div className="text-lg font-bold mb-1">
          Tournament #{id}
        </div>

        <div className="flex items-center gap-1 mb-4">
          <Trophy className="w-4 h-4 text-chess-gold" />
          <span className="text-chess-gold font-semibold">{prizePool.toFixed(2)} USDC</span>
        </div>

        <div className="grid grid-cols-3 gap-3 text-sm text-gray-400">
          <div className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" />
            <span>{registeredCount}/{maxPlayers}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            <span>{entryFee.toFixed(2)} USDC</span>
          </div>
          <div className="text-right">
            R{currentRound}/{totalRounds}
          </div>
        </div>
      </div>
    </Link>
  );
}
