'use client';

import { formatUSDC } from '@/lib/utils';
import { Flame } from 'lucide-react';

interface BountyEntry {
  agent: string;
  name: string;
  bounty: number;
}

interface BountyTrackerProps {
  entries: BountyEntry[];
  totalBountyPool: number;
}

export default function BountyTracker({ entries, totalBountyPool }: BountyTrackerProps) {
  const sorted = [...entries].sort((a, b) => b.bounty - a.bounty);
  const maxBounty = sorted[0]?.bounty || 1;

  return (
    <div className="border border-chess-border rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 bg-chess-surface border-b border-chess-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-orange-400" />
          <h3 className="text-sm font-medium text-gray-300">Bounty Tracker</h3>
        </div>
        <span className="text-xs text-gray-500">
          Pool: {formatUSDC(totalBountyPool)}
        </span>
      </div>
      <div className="divide-y divide-chess-border/50">
        {sorted.map((entry, i) => (
          <div
            key={entry.agent}
            className="px-4 py-2.5 flex items-center gap-3 hover:bg-chess-border/20"
          >
            <span className="text-xs text-gray-500 w-5 text-center">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{entry.name}</p>
              <div className="mt-1 h-1.5 bg-chess-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-orange-500 to-red-500 rounded-full transition-all"
                  style={{ width: `${(entry.bounty / maxBounty) * 100}%` }}
                />
              </div>
            </div>
            <span className="text-sm font-medium text-orange-400">
              {formatUSDC(entry.bounty)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
