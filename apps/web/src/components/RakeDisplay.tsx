'use client';

import { cn, tierColor } from '@/lib/utils';

const rakeTable: Record<string, number> = {
  free: 0,
  rookie: 10,
  bronze: 8,
  silver: 6,
  masters: 5,
  legends: 4,
};

interface RakeDisplayProps {
  tier: string;
  compact?: boolean;
}

export default function RakeDisplay({ tier, compact = false }: RakeDisplayProps) {
  const rake = rakeTable[tier] ?? 0;

  if (compact) {
    return (
      <span className="text-xs text-gray-500">
        {rake}% rake
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-gray-400">Protocol fee:</span>
      <span className={cn('font-medium', tierColor(tier))}>
        {rake}%
      </span>
      {rake === 0 && (
        <span className="text-xs text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">
          Free
        </span>
      )}
    </div>
  );
}
