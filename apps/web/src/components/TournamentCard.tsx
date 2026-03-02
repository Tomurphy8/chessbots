'use client';

import Link from 'next/link';
import { cn, tierColor, tierBorderColor, statusBadgeColor, formatStatus } from '@/lib/utils';
import { Trophy, Users, Clock } from 'lucide-react';

function formatTimestamp(unixSec: number): string {
  if (!unixSec) return '';
  const date = new Date(unixSec * 1000);
  const now = Date.now();
  const diff = unixSec * 1000 - now;

  // Future: show countdown
  if (diff > 0) {
    const hours = Math.floor(diff / 3_600_000);
    const mins = Math.floor((diff % 3_600_000) / 60_000);
    if (hours > 24) {
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  }

  // Past: show date
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface TournamentCardProps {
  id: number;
  tier: 'rookie' | 'bronze' | 'silver' | 'masters' | 'legends' | 'free';
  status: string;
  format?: 'swiss' | '1v1' | 'team' | 'league';
  entryFee: number;
  registeredCount: number;
  maxPlayers: number;
  currentRound: number;
  totalRounds: number;
  prizePool: number;
  startTime?: number;
  registrationDeadline?: number;
  contractAddress?: string;
}

export function TournamentCard({
  id, tier, status, format, entryFee, registeredCount, maxPlayers,
  currentRound, totalRounds, prizePool, startTime, registrationDeadline, contractAddress,
}: TournamentCardProps) {
  const href = contractAddress
    ? `/tournaments/${id}?contract=${contractAddress}`
    : `/tournaments/${id}`;
  return (
    <Link href={href}>
      <div className={cn(
        'border rounded-xl p-5 bg-chess-surface hover:bg-chess-surface/80 transition-all cursor-pointer',
        tierBorderColor(tier),
      )}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={cn('text-sm font-semibold uppercase tracking-wide', tierColor(tier))}>
              {tier}
            </span>
            {format && format !== 'swiss' && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-chess-border/50 text-gray-300 uppercase">
                {format}
              </span>
            )}
          </div>
          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', statusBadgeColor(status))}>
            {formatStatus(status)}
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
            <span>
              {status === 'registration' && registrationDeadline
                ? formatTimestamp(registrationDeadline)
                : status === 'completed' && startTime
                ? formatTimestamp(startTime)
                : `${entryFee.toFixed(2)} USDC`}
            </span>
          </div>
          <div className="text-right">
            R{currentRound}/{totalRounds}
          </div>
        </div>
      </div>
    </Link>
  );
}
