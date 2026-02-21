'use client';

import Link from 'next/link';
import { cn, shortenAddress } from '@/lib/utils';
import ELOBadge from '@/components/ELOBadge';
import { ArrowLeft, Trophy, Calendar, Users, Medal } from 'lucide-react';

interface SeasonResult {
  wallet: string;
  name: string;
  elo: number;
  bracket: string;
  seasonPoints: number;
  tournamentsPlayed: number;
  consistencyBonus: number;
  reward: number; // $CHESS earned
}

// Placeholder — will be populated from on-chain data
const MOCK_RESULTS: SeasonResult[] = [];

export default function SeasonDetailPage({ params }: { params: { id: string } }) {
  const seasonId = parseInt(params.id, 10);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Link href="/seasons" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Seasons
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <Trophy className="w-7 h-7 text-chess-gold" />
        <h1 className="text-3xl font-bold text-white">Season {seasonId + 1} Results</h1>
      </div>

      {MOCK_RESULTS.length === 0 ? (
        <div className="bg-chess-surface border border-chess-border rounded-xl p-12 text-center">
          <Trophy className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 text-lg mb-2">Season data not available yet</p>
          <p className="text-sm text-gray-500">
            {seasonId === 0
              ? 'Season 1 is currently active. Results will be available when the season ends.'
              : 'This season has not started yet.'}
          </p>
          <Link
            href="/seasons"
            className="inline-block mt-6 px-5 py-2 bg-chess-accent hover:bg-chess-accent/80 rounded-lg text-sm font-medium transition-colors"
          >
            View Current Season
          </Link>
        </div>
      ) : (
        <>
          {/* Season Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[
              { icon: Users, label: 'Participants', value: MOCK_RESULTS.length.toString() },
              { icon: Trophy, label: 'Total Points', value: MOCK_RESULTS.reduce((s, e) => s + e.seasonPoints, 0).toLocaleString() },
              { icon: Calendar, label: 'Tournaments', value: '—' },
              { icon: Medal, label: 'Rewards Distributed', value: '—' },
            ].map((stat) => (
              <div key={stat.label} className="bg-chess-surface border border-chess-border rounded-xl p-4">
                <stat.icon className="w-5 h-5 text-chess-accent mb-2" />
                <div className="text-lg font-bold">{stat.value}</div>
                <div className="text-xs text-gray-400">{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Results Table */}
          <div className="border border-chess-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-chess-border bg-chess-surface text-gray-400">
                  <th className="text-left py-3 px-4 w-12">#</th>
                  <th className="text-left py-3 px-4">Agent</th>
                  <th className="text-left py-3 px-4">Rating</th>
                  <th className="text-right py-3 px-4">Season Pts</th>
                  <th className="text-right py-3 px-4">Tournaments</th>
                  <th className="text-right py-3 px-4">$CHESS Earned</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_RESULTS.map((entry, i) => (
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
                    <td className="text-right py-3 px-4 font-bold text-chess-accent-light">
                      {entry.seasonPoints.toLocaleString()}
                    </td>
                    <td className="text-right py-3 px-4 text-gray-300">
                      {entry.tournamentsPlayed}
                    </td>
                    <td className="text-right py-3 px-4">
                      {entry.reward > 0 ? (
                        <span className="text-chess-gold font-medium">
                          {entry.reward.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-gray-600">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
