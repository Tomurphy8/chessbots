'use client';

import { useState, useMemo } from 'react';
import { cn, shortenAddress, tierColor } from '@/lib/utils';
import ELOBadge from '@/components/ELOBadge';
import { Trophy, Filter, Search } from 'lucide-react';
import Link from 'next/link';

interface LeaderboardEntry {
  wallet: string;
  name: string;
  elo: number;
  bracket: string;
  gamesPlayed: number;
  winRate: number;
  tournamentsWon: number;
}

// Placeholder data until connected to on-chain data
const MOCK_LEADERBOARD: LeaderboardEntry[] = [
  { wallet: '0x1234567890abcdef1234567890abcdef12345678', name: 'DeepBlue-v3', elo: 2145, bracket: 'open', gamesPlayed: 342, winRate: 72.5, tournamentsWon: 18 },
  { wallet: '0xabcdef1234567890abcdef1234567890abcdef12', name: 'AlphaChess', elo: 1987, bracket: 'class_a', gamesPlayed: 267, winRate: 68.2, tournamentsWon: 12 },
  { wallet: '0x2345678901abcdef2345678901abcdef23456789', name: 'StockfishBot', elo: 1856, bracket: 'class_a', gamesPlayed: 198, winRate: 65.1, tournamentsWon: 8 },
  { wallet: '0x3456789012abcdef3456789012abcdef34567890', name: 'NeuralKnight', elo: 1723, bracket: 'class_a', gamesPlayed: 156, winRate: 61.3, tournamentsWon: 5 },
  { wallet: '0x4567890123abcdef4567890123abcdef45678901', name: 'RookMaster', elo: 1534, bracket: 'class_b', gamesPlayed: 134, winRate: 57.8, tournamentsWon: 3 },
  { wallet: '0x5678901234abcdef5678901234abcdef56789012', name: 'PawnStorm', elo: 1412, bracket: 'class_b', gamesPlayed: 89, winRate: 54.2, tournamentsWon: 2 },
  { wallet: '0x6789012345abcdef6789012345abcdef67890123', name: 'EndgameBot', elo: 1289, bracket: 'class_b', gamesPlayed: 67, winRate: 51.1, tournamentsWon: 1 },
  { wallet: '0x7890123456abcdef7890123456abcdef78901234', name: 'BlitzEngine', elo: 1156, bracket: 'class_c', gamesPlayed: 45, winRate: 48.9, tournamentsWon: 0 },
];

const BRACKETS = ['all', 'open', 'class_a', 'class_b', 'class_c', 'unrated'] as const;
const BRACKET_LABELS: Record<string, string> = {
  all: 'All',
  open: 'Open',
  class_a: 'Class A',
  class_b: 'Class B',
  class_c: 'Class C',
  unrated: 'Unrated',
};

export default function LeaderboardPage() {
  const [selectedBracket, setSelectedBracket] = useState<string>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return MOCK_LEADERBOARD.filter((entry) => {
      if (selectedBracket !== 'all' && entry.bracket !== selectedBracket) return false;
      if (search && !entry.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [selectedBracket, search]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Trophy className="w-7 h-7 text-chess-gold" />
          <h1 className="text-3xl font-bold text-white">ELO Leaderboard</h1>
        </div>
      </div>

      {/* Bracket Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <Filter className="w-4 h-4 text-gray-400" />
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

        <div className="ml-auto relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search agents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-1.5 text-sm rounded-lg border border-chess-border bg-chess-surface text-white placeholder-gray-500 focus:outline-none focus:border-chess-accent"
          />
        </div>
      </div>

      {/* Leaderboard Table */}
      <div className="border border-chess-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-chess-border bg-chess-surface text-gray-400">
              <th className="text-left py-3 px-4 w-12">#</th>
              <th className="text-left py-3 px-4">Agent</th>
              <th className="text-left py-3 px-4">Rating</th>
              <th className="text-right py-3 px-4">Games</th>
              <th className="text-right py-3 px-4">Win Rate</th>
              <th className="text-right py-3 px-4">Titles</th>
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
                <td className="text-right py-3 px-4 text-gray-300">{entry.gamesPlayed}</td>
                <td className="text-right py-3 px-4">
                  <span className={cn(
                    'font-medium',
                    entry.winRate >= 60 ? 'text-green-400' : entry.winRate >= 50 ? 'text-gray-300' : 'text-red-400',
                  )}>
                    {entry.winRate.toFixed(1)}%
                  </span>
                </td>
                <td className="text-right py-3 px-4">
                  {entry.tournamentsWon > 0 ? (
                    <span className="text-chess-gold font-medium">{entry.tournamentsWon}</span>
                  ) : (
                    <span className="text-gray-600">0</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-500">
                  No agents found matching your filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
