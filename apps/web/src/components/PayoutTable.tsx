'use client';

import { formatUSDC } from '@/lib/utils';

// Dynamic payout tables (basis points, must sum to 10000)
const PAYOUT_8 = [5500, 3000, 1500];
const PAYOUT_16 = [4500, 2500, 1500, 1000, 500];
const PAYOUT_32 = [3800, 2200, 1400, 900, 700, 500, 300, 200];
const PAYOUT_64 = [3000, 1800, 1200, 900, 700, 500, 400, 350, 300, 300, 300, 250];

function getPayoutStructure(fieldSize: number): number[] {
  if (fieldSize <= 2) return [10000];
  if (fieldSize <= 8) return PAYOUT_8;
  if (fieldSize <= 16) return PAYOUT_16;
  if (fieldSize <= 32) return PAYOUT_32;
  return PAYOUT_64;
}

function getPaidSlots(fieldSize: number): number {
  if (fieldSize <= 2) return 1;
  if (fieldSize <= 8) return 3;
  if (fieldSize <= 16) return 5;
  if (fieldSize <= 32) return 8;
  return 12;
}

interface PayoutTableProps {
  fieldSize: number;
  totalPool: number;
  tier?: string;
}

export default function PayoutTable({ fieldSize, totalPool, tier }: PayoutTableProps) {
  const structure = getPayoutStructure(fieldSize);
  const paidSlots = getPaidSlots(fieldSize);
  const rake = tier ? getRakeBps(tier) : 0;
  const playerPool = totalPool * (10000 - rake) / 10000;

  return (
    <div className="border border-chess-border rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 bg-chess-surface border-b border-chess-border">
        <h3 className="text-sm font-medium text-gray-300">
          Prize Distribution ({paidSlots} paid / {fieldSize} players)
        </h3>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-chess-border text-gray-400">
            <th className="text-left py-2 px-4">Place</th>
            <th className="text-right py-2 px-4">%</th>
            <th className="text-right py-2 px-4">Prize</th>
          </tr>
        </thead>
        <tbody>
          {structure.map((bps, i) => (
            <tr
              key={i}
              className="border-b border-chess-border/50 hover:bg-chess-border/20"
            >
              <td className="py-2 px-4">
                <span className="flex items-center gap-2">
                  {i === 0 && <span className="text-chess-gold">1st</span>}
                  {i === 1 && <span className="text-chess-silver">2nd</span>}
                  {i === 2 && <span className="text-chess-bronze">3rd</span>}
                  {i > 2 && <span className="text-gray-400">{getOrdinal(i + 1)}</span>}
                </span>
              </td>
              <td className="text-right py-2 px-4 text-gray-300">
                {(bps / 100).toFixed(1)}%
              </td>
              <td className="text-right py-2 px-4 font-medium text-white">
                {formatUSDC(Math.floor(playerPool * bps / 10000))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getRakeBps(tier: string): number {
  const rakes: Record<string, number> = {
    free: 0, rookie: 1000, bronze: 800, silver: 600, masters: 500, legends: 400,
  };
  return rakes[tier] ?? 0;
}

function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
