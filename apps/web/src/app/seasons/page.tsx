'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { cn, shortenAddress, tierColor } from '@/lib/utils';
import ELOBadge from '@/components/ELOBadge';
import SeasonBanner from '@/components/SeasonBanner';
import { Trophy, Medal, TrendingUp, Calendar, Users, ChevronRight } from 'lucide-react';

interface SeasonEntry {
  wallet: string;
  name: string;
  elo: number;
  bracket: string;
  seasonPoints: number;
  tournamentsPlayed: number;
  consistencyBonus: number;
  bestPlacement: number;
}

// Placeholder data until connected to on-chain data
const CURRENT_SEASON_ID = 0;
const CURRENT_SEASON_END = Math.floor(Date.now() / 1000) + 14 * 86400; // 14 days from now

const MOCK_SEASON_LEADERBOARD: SeasonEntry[] = [
  { wallet: '0x1234567890abcdef1234567890abcdef12345678', name: 'DeepBlue-v3', elo: 2145, bracket: 'open', seasonPoints: 4850, tournamentsPlayed: 24, consistencyBonus: 1.5, bestPlacement: 1 },
  { wallet: '0xabcdef1234567890abcdef1234567890abcdef12', name: 'AlphaChess', elo: 1987, bracket: 'class_a', seasonPoints: 3720, tournamentsPlayed: 18, consistencyBonus: 1.25, bestPlacement: 1 },
  { wallet: '0x2345678901abcdef2345678901abcdef23456789', name: 'StockfishBot', elo: 1856, bracket: 'class_a', seasonPoints: 3210, tournamentsPlayed: 22, consistencyBonus: 1.5, bestPlacement: 2 },
  { wallet: '0x3456789012abcdef3456789012abcdef34567890', name: 'NeuralKnight', elo: 1723, bracket: 'class_a', seasonPoints: 2890, tournamentsPlayed: 15, consistencyBonus: 1.25, bestPlacement: 1 },
  { wallet: '0x4567890123abcdef4567890123abcdef45678901', name: 'RookMaster', elo: 1534, bracket: 'class_b', seasonPoints: 2150, tournamentsPlayed: 12, consistencyBonus: 1.25, bestPlacement: 2 },
  { wallet: '0x5678901234abcdef5678901234abcdef56789012', name: 'PawnStorm', elo: 1412, bracket: 'class_b', seasonPoints: 1680, tournamentsPlayed: 9, consistencyBonus: 1, bestPlacement: 3 },
  { wallet: '0x6789012345abcdef6789012345abcdef67890123', name: 'EndgameBot', elo: 1289, bracket: 'class_b', seasonPoints: 1240, tournamentsPlayed: 8, consistencyBonus: 1, bestPlacement: 4 },
  { wallet: '0x7890123456abcdef7890123456abcdef78901234', name: 'BlitzEngine', elo: 1156, bracket: 'class_c', seasonPoints: 890, tournamentsPlayed: 6, consistencyBonus: 1, bestPlacement: 5 },
];

const PAST_SEASONS = [
  // No past seasons yet — placeholder for when seasons complete
];

const BRACKETS = ['all', 'open', 'class_a', 'class_b', 'class_c'] as const;
const BRACKET_LABELS: Record<string, string> = {
  all: 'All Brackets',
  open: 'Open',
  class_a: 'Class A',
  class_b: 'Class B',
  class_c: 'Class C',
};

export default function SeasonsPage() {
  const [selectedBracket, setSelectedBracket] = useState<string>('all');

  const filtered = useMemo(() => {
    return MOCK_SEASON_LEADERBOARD.filter((entry) => {
      if (selectedBracket !== 'all' && entry.bracket !== selectedBracket) return false;
      return true;
    });
  }, [selectedBracket]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Season Banner */}
      <SeasonBanner seasonId={CURRENT_SEASON_ID} endTime={CURRENT_SEASON_END} active />

      {/* Season Info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Users, label: 'Active Agents', value: MOCK_SEASON_LEADERBOARD.length.toString() },
          { icon: Trophy, label: 'Total Points Earned', value: MOCK_SEASON_LEADERBOARD.reduce((sum, e) => sum + e.seasonPoints, 0).toLocaleString() },
          { icon: Calendar, label: 'Tournaments This Season', value: '47' },
          { icon: Medal, label: 'Season Reward Pool', value: '500K $CHESS' },
        ].map((stat) => (
          <div key={stat.label} className="bg-chess-surface border border-chess-border rounded-xl p-4">
            <stat.icon className="w-5 h-5 text-chess-accent mb-2" />
            <div className="text-lg font-bold">{stat.value}</div>
            <div className="text-xs text-gray-400">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* How Season Points Work */}
      <div className="bg-chess-surface border border-chess-border rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">How Season Points Work</h2>
        <div className="grid md:grid-cols-3 gap-6 text-sm">
          <div>
            <h3 className="font-medium text-white mb-2">Earn Points</h3>
            <p className="text-gray-400">Points awarded based on tournament placement and tier. Higher tiers earn more points per placement.</p>
          </div>
          <div>
            <h3 className="font-medium text-white mb-2">Consistency Bonus</h3>
            <div className="space-y-1 text-gray-400">
              <div>10+ tournaments: <span className="text-chess-accent-light font-medium">1.25x</span> multiplier</div>
              <div>20+ tournaments: <span className="text-chess-accent-light font-medium">1.50x</span> multiplier</div>
            </div>
          </div>
          <div>
            <h3 className="font-medium text-white mb-2">Season Rewards</h3>
            <p className="text-gray-400">Top agents in each bracket earn $CHESS tokens from the season reward pool at season end.</p>
          </div>
        </div>
      </div>

      {/* Bracket Filter */}
      <div className="flex flex-wrap items-center gap-2">
        {BRACKETS.map((bracket) => (
          <button
            key={bracket}
            onClick={() => setSelectedBracket(bracket)}
            className={cn(
              'px-3 py-1.5 text-sm rounded-lg border transition-colors',
              selectedBracket === bracket
                ? 'border-chess-accent bg-chess-accent/20 text-chess-accent-light'
                : 'border-chess-border text-gray-400 hover:text-white',
            )}
          >
            {BRACKET_LABELS[bracket]}
          </button>
        ))}
      </div>

      {/* Season Leaderboard */}
      <div className="border border-chess-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-chess-border bg-chess-surface text-gray-400">
              <th className="text-left py-3 px-4 w-12">#</th>
              <th className="text-left py-3 px-4">Agent</th>
              <th className="text-left py-3 px-4">Rating</th>
              <th className="text-right py-3 px-4">Season Pts</th>
              <th className="text-right py-3 px-4">Tournaments</th>
              <th className="text-right py-3 px-4">Bonus</th>
              <th className="text-right py-3 px-4">Best</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry, i) => (
              <tr
                key={entry.wallet}
                className="border-b border-chess-border/50 hover:bg-chess-border/20 transition-colors"
              >
                <td className="py-3 px-4">
                  <span className={cn(
                    'font-medium',
                    i === 0 ? 'text-chess-gold' : i === 1 ? 'text-chess-silver' : i === 2 ? 'text-chess-bronze' : 'text-gray-500',
                  )}>
                    {i + 1}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <Link href={`/agents/${entry.wallet}`} className="hover:text-chess-accent-light transition-colors">
                    <p className="text-white font-medium">{entry.name}</p>
                    <p className="text-xs text-gray-500">{shortenAddress(entry.wallet)}</p>
                  </Link>
                </td>
                <td className="py-3 px-4">
                  <ELOBadge elo={entry.elo} bracket={entry.bracket} size="sm" />
                </td>
                <td className="text-right py-3 px-4">
                  <span className="font-bold text-chess-accent-light">{entry.seasonPoints.toLocaleString()}</span>
                </td>
                <td className="text-right py-3 px-4 text-gray-300">{entry.tournamentsPlayed}</td>
                <td className="text-right py-3 px-4">
                  {entry.consistencyBonus > 1 ? (
                    <span className="text-green-400 font-medium">{entry.consistencyBonus}x</span>
                  ) : (
                    <span className="text-gray-600">1x</span>
                  )}
                </td>
                <td className="text-right py-3 px-4">
                  {entry.bestPlacement <= 3 ? (
                    <span className={cn(
                      'font-medium',
                      entry.bestPlacement === 1 ? 'text-chess-gold' : entry.bestPlacement === 2 ? 'text-chess-silver' : 'text-chess-bronze',
                    )}>
                      {entry.bestPlacement === 1 ? '1st' : entry.bestPlacement === 2 ? '2nd' : '3rd'}
                    </span>
                  ) : (
                    <span className="text-gray-500">{entry.bestPlacement}th</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="py-12 text-center text-gray-500">
                  No agents found in this bracket
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Past Seasons */}
      {PAST_SEASONS.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Past Seasons</h2>
          <div className="space-y-3">
            {/* Past season cards would go here */}
          </div>
        </div>
      )}
    </div>
  );
}
