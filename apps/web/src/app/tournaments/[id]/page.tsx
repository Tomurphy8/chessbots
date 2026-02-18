'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTournament } from '@/lib/hooks/useChainData';
import { useSponsor } from '@/lib/hooks/useSponsor';
import { useTournamentStandings } from '@/lib/hooks/useTournamentStandings';
import { SponsorBanner } from '@/components/SponsorBanner';
import { StandingsTable } from '@/components/StandingsTable';
import { cn, tierColor, statusBadgeColor, shortenAddress } from '@/lib/utils';
import { Trophy, ArrowLeft, RefreshCw, UserPlus, CheckCircle, Megaphone, ExternalLink, Play } from 'lucide-react';
import { CHAIN } from '@/lib/chains';
import { useAccount } from 'wagmi';
import { useJoinTournament } from '@/lib/hooks/useJoinTournament';
import { useTournamentGames } from '@/lib/hooks/useTournamentGames';
import { SponsorModal } from '@/components/SponsorModal';

export default function TournamentDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [activeTab, setActiveTab] = useState<'standings' | 'games' | 'info'>('standings');
  const [showSponsorModal, setShowSponsorModal] = useState(false);
  const tournamentId = parseInt(id);
  const { address } = useAccount();
  const { tournament, loading } = useTournament(tournamentId);
  const { sponsor, hasSponsor, isImageUri } = useSponsor(tournamentId);
  const { standings, loading: standingsLoading, refresh: refreshStandings } = useTournamentStandings(tournamentId);
  const joinTournament = useJoinTournament(tournamentId, tournament?.entryFee ?? 0);

  const hasGames = !!tournament && tournament.currentRound > 0;
  const { games: tournamentGames, loading: gamesLoading } = useTournamentGames(
    tournamentId,
    tournament?.currentRound ?? 0,
    tournament?.registeredCount ?? 0,
    hasGames,
  );

  // Group games by round
  const gamesByRound = tournamentGames.reduce<Record<number, typeof tournamentGames>>((acc, g) => {
    (acc[g.round] ??= []).push(g);
    return acc;
  }, {});

  const canJoin = address && tournament && tournament.status === 'registration' && tournament.registeredCount < tournament.maxPlayers;

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

  // Format-aware prize breakdown
  function getPrizeBreakdown(format: string, prizePool: number) {
    switch (format) {
      case '1v1':
        return [
          { label: 'Winner', pct: 0.90, color: 'text-chess-gold' },
          { label: 'Protocol Fee', pct: 0.10, color: 'text-gray-500' },
        ];
      case 'league':
        return [
          { label: '1st Place', pct: 0.45, color: 'text-chess-gold' },
          { label: '2nd Place', pct: 0.27, color: 'text-chess-silver' },
          { label: '3rd Place', pct: 0.18, color: 'text-chess-bronze' },
          { label: 'Protocol Fee', pct: 0.10, color: 'text-gray-500' },
        ];
      case 'team':
        return [
          { label: '1st Place (Captain)', pct: 0.63, color: 'text-chess-gold' },
          { label: '2nd Place (Captain)', pct: 0.18, color: 'text-chess-silver' },
          { label: '3rd Place (Captain)', pct: 0.09, color: 'text-chess-bronze' },
          { label: 'Protocol Fee', pct: 0.10, color: 'text-gray-500' },
        ];
      default: // swiss
        return [
          { label: '1st Place', pct: 0.63, color: 'text-chess-gold' },
          { label: '2nd Place', pct: 0.18, color: 'text-chess-silver' },
          { label: '3rd Place', pct: 0.09, color: 'text-chess-bronze' },
          { label: 'Protocol Fee', pct: 0.10, color: 'text-gray-500' },
        ];
    }
  }

  const prizeBreakdown = getPrizeBreakdown(t.format, t.prizePool);
  const is1v1 = t.format === '1v1';
  const isTeam = t.format === 'team';
  const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

  return (
    <div>
      {/* Sponsor Banner — full width at top */}
      {hasSponsor && sponsor && (
        <div className="-mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 mb-4 bg-chess-surface/80 border-b border-chess-border/50">
          <SponsorBanner name={sponsor.name} uri={sponsor.uri} amount={sponsor.amount} isImageUri={isImageUri} />
        </div>
      )}

      <Link href="/tournaments" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to tournaments
      </Link>

      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-3xl font-bold">
              {is1v1 ? 'Match' : isTeam ? 'Team Tournament' : t.format === 'league' ? 'League' : 'Tournament'} #{id}
            </h1>
            <span className={cn('text-sm font-semibold uppercase', tierColor(t.tier))}>{t.tier}</span>
            {t.format && t.format !== 'swiss' && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-chess-border/50 text-gray-300 uppercase">
                {t.format}
              </span>
            )}
            <span className={cn('text-xs px-2 py-0.5 rounded-full', statusBadgeColor(t.status))}>
              {t.status.replace('_', ' ')}
            </span>
          </div>
          <p className="text-gray-400">
            {is1v1 && t.bestOf > 0
              ? <>Best of {t.bestOf} &middot; Game {t.currentRound} of {t.totalRounds}</>
              : <>Round {t.currentRound} of {t.totalRounds}</>
            }
            {' '}&middot; {t.registeredCount} {isTeam ? 'teams' : 'players'} registered
            &middot; {t.baseTimeSeconds / 60}+{t.incrementSeconds}s time control
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-chess-surface border border-chess-border rounded-xl px-5 py-3">
            <Trophy className="w-5 h-5 text-chess-gold" />
            <div>
              <div className="text-xs text-gray-400">Prize Pool</div>
              <div className="text-lg font-bold text-chess-gold">{t.prizePool.toFixed(2)} USDC</div>
            </div>
          </div>

          {/* Join Tournament */}
          {canJoin && !joinTournament.success && (
            <div className="flex flex-col gap-2">
              {joinTournament.needsApproval ? (
                <button
                  onClick={joinTournament.approve}
                  disabled={joinTournament.approving}
                  className="px-5 py-3 bg-yellow-600 hover:bg-yellow-500 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {joinTournament.approving ? 'Approving...' : `Approve ${t.entryFee.toFixed(2)} USDC`}
                </button>
              ) : (
                <button
                  onClick={joinTournament.join}
                  disabled={joinTournament.isPending}
                  className="px-5 py-3 bg-chess-accent hover:bg-chess-accent/80 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  <UserPlus className="w-4 h-4" />
                  {joinTournament.isPending ? 'Joining...' : 'Join Tournament'}
                </button>
              )}
              {joinTournament.error && (
                <p className="text-red-400 text-xs max-w-[200px]">{joinTournament.error}</p>
              )}
            </div>
          )}
          {joinTournament.success && (
            <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
              <CheckCircle className="w-5 h-5" />
              Joined!
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-chess-border mb-6">
        {(['standings', 'games', 'info'] as const).map((tab) => (
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
      ) : activeTab === 'games' ? (
        <div>
          {!hasGames ? (
            <div className="text-center py-12 text-gray-500">
              <p>No games have been played yet.</p>
            </div>
          ) : gamesLoading ? (
            <div className="text-center py-12 text-gray-500">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-chess-accent" />
              <p>Loading games...</p>
            </div>
          ) : tournamentGames.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p>No game data available yet.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.keys(gamesByRound)
                .map(Number)
                .sort((a, b) => b - a)
                .map(round => (
                  <div key={round}>
                    <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
                      Round {round}
                    </h3>
                    <div className="space-y-2">
                      {gamesByRound[round].map(game => {
                        const resultLabel =
                          game.resultName === 'WhiteWins' || game.resultName === 'BlackForfeit' ? '1 - 0'
                          : game.resultName === 'BlackWins' || game.resultName === 'WhiteForfeit' ? '0 - 1'
                          : game.resultName === 'Draw' ? '\u00BD - \u00BD'
                          : game.status === 1 ? 'In Progress'
                          : game.status === 0 ? 'Pending'
                          : '\u2014';
                        const isFinished = game.status === 2;
                        return (
                          <Link
                            key={game.gameId}
                            href={`/tournaments/${id}/games/${game.gameId}`}
                            className="flex items-center justify-between bg-chess-surface border border-chess-border rounded-lg px-4 py-3 hover:border-chess-accent/50 transition-colors group"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="text-xs text-gray-500 w-6 shrink-0">G{game.gameIndex + 1}</span>
                              <span className="text-sm truncate">
                                <span className="text-white">{shortenAddress(game.white)}</span>
                                <span className="text-gray-500 mx-2">vs</span>
                                <span className="text-white">{shortenAddress(game.black)}</span>
                              </span>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <span className="text-xs text-gray-500">{game.moveCount} moves</span>
                              <span className={cn(
                                'text-sm font-medium',
                                isFinished ? 'text-chess-gold' : 'text-gray-400',
                              )}>
                                {resultLabel}
                              </span>
                              {isFinished && (
                                <Play className="w-4 h-4 text-chess-accent-light opacity-0 group-hover:opacity-100 transition-opacity" />
                              )}
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
              <h3 className="text-sm text-gray-400 mb-2">Tournament Details</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Format</span><span className="capitalize">{t.format === '1v1' ? '1v1 Match' : t.format}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Entry Fee</span><span>{t.entryFee.toFixed(2)} USDC</span></div>
                <div className="flex justify-between"><span className="text-gray-500">{isTeam ? 'Teams' : 'Players'}</span><span>{t.registeredCount} / {t.maxPlayers}</span></div>
                {!is1v1 && <div className="flex justify-between"><span className="text-gray-500">Min {isTeam ? 'Teams' : 'Players'}</span><span>{t.minPlayers}</span></div>}
                {is1v1 && t.bestOf > 0 && <div className="flex justify-between"><span className="text-gray-500">Best Of</span><span>{t.bestOf}</span></div>}
                {isTeam && t.teamSize > 0 && <div className="flex justify-between"><span className="text-gray-500">Team Size</span><span>{t.teamSize} players</span></div>}
                <div className="flex justify-between"><span className="text-gray-500">{is1v1 ? 'Games' : 'Rounds'}</span><span>{t.totalRounds}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Time Control</span><span>{t.baseTimeSeconds / 60}+{t.incrementSeconds}s</span></div>
              </div>
            </div>
            <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
              <h3 className="text-sm text-gray-400 mb-2">Prize Breakdown</h3>
              <div className="space-y-2 text-sm">
                {prizeBreakdown.map((item) => (
                  <div key={item.label} className="flex justify-between">
                    <span className={item.color}>{item.label}</span>
                    <span>{(t.prizePool * item.pct).toFixed(2)} USDC</span>
                  </div>
                ))}
              </div>
              {isTeam && (
                <p className="text-xs text-gray-500 mt-3">Prizes distributed to team captains. Members split off-chain.</p>
              )}
            </div>
          </div>
          <a
            href={`${CHAIN.explorerUrl}/address/${CHAIN.contractAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 py-3 bg-chess-surface border border-chess-border hover:border-chess-accent rounded-xl text-sm font-medium text-gray-400 hover:text-white transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            View Tournament Results On-Chain
          </a>
          {address && !hasSponsor && (
            <button
              onClick={() => setShowSponsorModal(true)}
              className="w-full py-3 bg-chess-surface border border-chess-border hover:border-chess-accent rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              <Megaphone className="w-4 h-4 text-chess-accent" />
              Sponsor This Tournament
            </button>
          )}
          {t.winners[0] !== ZERO_ADDR && (
            <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
              <h3 className="text-sm text-gray-400 mb-2">{is1v1 ? 'Winner' : 'Winners'}</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-chess-gold">{is1v1 ? 'Winner' : '1st'}</span>
                  <a href={`${CHAIN.explorerUrl}/address/${t.winners[0]}`} target="_blank" rel="noopener noreferrer" className="font-mono text-chess-accent-light hover:text-white transition-colors inline-flex items-center gap-1">
                    {shortenAddress(t.winners[0], 8)} <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                {!is1v1 && t.winners[1] !== ZERO_ADDR && (
                  <div className="flex justify-between">
                    <span className="text-chess-silver">2nd</span>
                    <a href={`${CHAIN.explorerUrl}/address/${t.winners[1]}`} target="_blank" rel="noopener noreferrer" className="font-mono text-chess-accent-light hover:text-white transition-colors inline-flex items-center gap-1">
                      {shortenAddress(t.winners[1], 8)} <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
                {!is1v1 && t.winners[2] !== ZERO_ADDR && (
                  <div className="flex justify-between">
                    <span className="text-chess-bronze">3rd</span>
                    <a href={`${CHAIN.explorerUrl}/address/${t.winners[2]}`} target="_blank" rel="noopener noreferrer" className="font-mono text-chess-accent-light hover:text-white transition-colors inline-flex items-center gap-1">
                      {shortenAddress(t.winners[2], 8)} <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sponsor Modal */}
      <SponsorModal
        isOpen={showSponsorModal}
        onClose={() => setShowSponsorModal(false)}
        tournamentId={tournamentId}
        onSuccess={() => window.location.reload()}
      />
    </div>
  );
}
