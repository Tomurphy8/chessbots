'use client';

import { cn, tierColor } from '@/lib/utils';
import { Ticket } from 'lucide-react';

interface SatelliteBadgeProps {
  targetTier: string;
  seatsAwarded: number;
  className?: string;
}

export default function SatelliteBadge({ targetTier, seatsAwarded, className }: SatelliteBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium',
        'bg-chess-accent/20 border border-chess-accent/40',
        className,
      )}
    >
      <Ticket className="w-3.5 h-3.5 text-chess-accent-light" />
      <span className="text-chess-accent-light">
        Win a{' '}
        <span className={cn('font-bold', tierColor(targetTier))}>
          {targetTier.charAt(0).toUpperCase() + targetTier.slice(1)}
        </span>
        {' '}seat
      </span>
      {seatsAwarded > 1 && (
        <span className="text-gray-500">({seatsAwarded} seats)</span>
      )}
    </span>
  );
}
