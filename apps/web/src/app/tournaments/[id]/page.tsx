'use client';

import { useState } from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useTournament } from '@/lib/hooks/useChainData';
import { useSponsor } from '@/lib/hooks/useSponsor';
import { useTournamentStandings } from '@/lib/hooks/useTournamentStandings';
import { SponsorBanner } from '@/components/SponsorBanner';
import { StandingsTable } from '@/components/StandingsTable';
import { cn, tierColor, statusBadgeColor, shortenAddress } from '@/lib/utils';
import { Trophy, ArrowLeft, RefreshCw } from 'lucide-react';

export default function TournamentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [activeTab, setActiveTab] = useState<'standings' | 'info'>('standings');
  const tournamentId = parseInt(id);
  const { tournament, loading } = useTournament(tournamentId);
  const { sponsor, hasSponsor, isImageUri } = useSponsor(tournamentId);
  const { standings, loading: standingsLoading, refresh: refreshStandings } = useTournamentStandings(tournamentId);

  if (loading) {
    return (
      <div>
        <Link href="/tournaments" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to tournaments
        </Link>
        <div className="text-center py-16 text-gray-500">Loading tournament from Monad...</div>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div>
        <Link href="/tournaments" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to tournaments
        </Link>
        <div className="text-center py-16 text-gray-500">Tournament not found.</div>
      </div>
    );
  }

  const t = tournament;

  return (
    <div>
      <Link href="/tournaments" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to tournaments
      </Link>

      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-3xl font-bold">Tournament #{id}</h1>
            <span className={cn('text-sm font-semibold uppercase', tierColor(t.tier))}>{t.tier}</span>
            <span className={cn('text-xs px-2 py-0.5 rounded-full', statusBadgeColor(t.status))}>
              {t.status.replace('_', ' ')}
            </span>
          </div>
          <p className="text-gray-400">
            Round {t.currentRound} of {t.totalRounds} &middot; {t.registeredCount} players registered
            &middot; {t.baseTimeSeconds / 60}+{t.incrementSeconds}s time control
          </p>
          {hasSponsor && sponsor && (
            <div className="mt-2">
              <SponsorBanner name={sponsor.name} uri={sponsor.uri} amount={sponsor.amount} isImageUri={isImageUri} compact />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 bg-chess-surface border border-chess-border rounded-xl px-5 py-3">
          <Trophy className="w-5 h-5 text-chess-gold" />
          <div>
            <div className="text-xs text-gray-400">Prize Pool</div>
            <div className="text-lg font-bold text-chess-gold">{t.prizePool.toFixed(2)} USDC</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-chess-border mb-6">
        {(['standings', 'info'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'pb-3 text-sm font-medium capitalize transition-colors border-b-2',
              activeTab === tab
                ? 'text-chess-accent-light border-chess-accent'
                : 'text-gray-400 border-transparent hover:text-white',
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'standings' ? (
        <div>
          {t.status === 'Registration' ? (
            <div className="text-center py-12 text-gray-500">
              <p>Tournament hasn&apos;t started yet. Standings will appear after the first round.</p>
            </div>
          ) : standingsLoading ? (
            <div className="text-center py-12 text-gray-500">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-chess-accent" />
              <p>Loading standings...</p>
            </div>
          ) : standings.length > 0 ? (
            <div>
              <div className="flex justify-end mb-3">
                <button
                  onClick={refreshStandings}
                  className="text-xs text-gray-500 hover:text-chess-accent-light flex items-center gap-1 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
              </div>
              <StandingsTable standings={standings} />
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <p>No standings data available yet.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
              <h3 className="text-sm text-gray-400 mb-2">Tournament Details</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Entry Fee</span><span>{t.entryFee.toFixed(2)} USDC</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Players</span><span>{t.registeredCount} / {t.maxPlayers}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Min Players</span><span>{t.minPlayers}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Rounds</span><span>{t.totalRounds}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Time Control</span><span>{t.baseTimeSeconds / 60}+{t.incrementSeconds}s</span></div>
              </div>
            </div>
            <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
              <h3 className="text-sm text-gray-400 mb-2">Prize Breakdown</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-chess-gold">1st Place</span><span>{(t.prizePool * 0.63).toFixed(2)} USDC</span></div>
                <div className="flex justify-between"><span className="text-chess-silver">2nd Place</span><span>{(t.prizePool * 0.18).toFixed(2)} USDC</span></div>
                <div className="flex justify-between"><span className="text-chess-bronze">3rd Place</span><span>{(t.prizePool * 0.09).toFixed(2)} USDC</span></div>
                <div className="flex justify-between text-gray-500"><span>Protocol Fee</span><span>{(t.prizePool * 0.10).toFixed(2)} USDC</span></div>
              </div>
            </div>
          </div>
          {hasSponsor && sponsor && (
            <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
              <h3 className="text-sm text-gray-400 mb-3">Sponsor</h3>
              <SponsorBanner
                name={sponsor.name}
                uri={sponsor.uri}
                amount={sponsor.amount}
                isImageUri={isImageUri}
              />
            </div>
          )}
          {t.winners[0] !== '0x0000000000000000000000000000000000000000' && (
            <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
              <h3 className="text-sm text-gray-400 mb-2">Winners</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-chess-gold">1st</span><span className="font-mono">{shortenAddress(t.winners[0], 8)}</span></div>
                <div className="flex justify-between"><span className="text-chess-silver">2nd</span><span className="font-mono">{shortenAddress(t.winners[1], 8)}</span></div>
                <div className="flex justify-between"><span className="text-chess-bronze">3rd</span><span className="font-mono">{shortenAddress(t.winners[2], 8)}</span></div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
