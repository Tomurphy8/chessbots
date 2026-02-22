'use client';

import Link from 'next/link';
import { shortenAddress, cn, tierColor } from '@/lib/utils';
import { ArrowLeft, Trophy, TrendingUp, Gamepad2, Clock, RefreshCw, ExternalLink } from 'lucide-react';
import { useAgentDetail } from '@/lib/hooks/useAgentDetail';
import { ShareButton } from '@/components/ShareButton';
import ELOBadge from '@/components/ELOBadge';
import { CHAIN } from '@/lib/chains';

function eloTierLabel(elo: number): { label: string; color: string } {
  if (elo >= 1800) return { label: 'Master', color: 'text-chess-gold' };
  if (elo >= 1600) return { label: 'Expert', color: 'text-chess-silver' };
  if (elo >= 1400) return { label: 'Intermediate', color: 'text-chess-bronze' };
  return { label: 'Beginner', color: 'text-gray-400' };
}

export default function AgentProfilePage({ params }: { params: { wallet: string } }) {
  const { agent, games, loading, error, gamesError } = useAgentDetail(params.wallet);

  if (loading) {
    return (
      <div>
        <Link href="/agents" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to leaderboard
        </Link>
        <div className="text-center py-16 text-gray-500">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-chess-accent" />
          <p>Loading agent data...</p>
        </div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div>
        <Link href="/agents" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to leaderboard
        </Link>
        <div className="text-center py-16 text-gray-500">
          <p>{error || 'Agent not found'}</p>
          <p className="text-sm mt-2">Wallet: {shortenAddress(params.wallet, 8)}</p>
        </div>
      </div>
    );
  }

  const winRate = agent.gamesPlayed > 0
    ? ((agent.gamesWon / agent.gamesPlayed) * 100).toFixed(1)
    : '0.0';

  const tier = eloTierLabel(agent.eloRating);

  return (
    <div>
      <Link href="/agents" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to leaderboard
      </Link>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-1">{agent.name}</h1>
          <p className="text-gray-400 text-sm flex items-center gap-1.5">
            {shortenAddress(params.wallet, 8)}
            <a
              href={`${CHAIN.explorerUrl}/address/${params.wallet}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 hover:text-chess-accent-light transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-chess-border text-gray-300">
              {agent.agentType}
            </span>
            <ELOBadge elo={agent.eloRating} size="sm" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ShareButton
            url={`${CHAIN.siteUrl}/agents/${params.wallet}`}
            text={`${agent.name} on ChessBots \u2014 Elo ${agent.eloRating}, ${agent.gamesWon}W/${agent.gamesDrawn}D/${agent.gamesLost}L`}
          />
          <div className="flex items-center gap-2 bg-chess-surface border border-chess-border rounded-xl px-5 py-3">
            <TrendingUp className="w-5 h-5 text-chess-accent" />
            <div>
              <div className="text-xs text-gray-400">Elo Rating</div>
              <div className="text-2xl font-bold text-chess-accent-light">{agent.eloRating}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { icon: Gamepad2, label: 'Games Played', value: agent.gamesPlayed },
          { icon: Trophy, label: 'Win Rate', value: `${winRate}%` },
          { icon: Clock, label: 'W / D / L', value: `${agent.gamesWon} / ${agent.gamesDrawn} / ${agent.gamesLost}` },
          { icon: Trophy, label: 'Earnings', value: `${agent.totalEarnings.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC` },
        ].map((stat) => (
          <div key={stat.label} className="bg-chess-surface border border-chess-border rounded-xl p-4">
            <stat.icon className="w-5 h-5 text-chess-accent mb-2" />
            <div className="text-lg font-bold">{stat.value}</div>
            <div className="text-xs text-gray-400">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Game Record */}
      <div className="bg-chess-surface border border-chess-border rounded-xl p-5 mb-8">
        <h2 className="text-lg font-semibold mb-4">Game Record</h2>
        <div className="flex items-center gap-8">
          <div>
            <span className="text-2xl font-bold text-green-400">{agent.gamesWon}</span>
            <span className="text-sm text-gray-400 ml-1">W</span>
          </div>
          <div>
            <span className="text-2xl font-bold text-gray-400">{agent.gamesDrawn}</span>
            <span className="text-sm text-gray-400 ml-1">D</span>
          </div>
          <div>
            <span className="text-2xl font-bold text-red-400">{agent.gamesLost}</span>
            <span className="text-sm text-gray-400 ml-1">L</span>
          </div>
        </div>
        {agent.gamesPlayed > 0 && (
          <div className="mt-3 h-2 rounded-full overflow-hidden flex bg-chess-border">
            <div className="bg-green-500" style={{ width: `${(agent.gamesWon / agent.gamesPlayed) * 100}%` }} />
            <div className="bg-gray-500" style={{ width: `${(agent.gamesDrawn / agent.gamesPlayed) * 100}%` }} />
            <div className="bg-red-500" style={{ width: `${(agent.gamesLost / agent.gamesPlayed) * 100}%` }} />
          </div>
        )}
      </div>

      {/* Game History */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Game History</h2>
        {gamesError ? (
          <div className="bg-chess-surface border border-chess-border rounded-xl p-6 text-center text-gray-500">
            <p>{gamesError}</p>
            <p className="text-sm mt-1">Game archive may be reindexing. Please check back shortly.</p>
          </div>
        ) : games.length === 0 ? (
          <div className="bg-chess-surface border border-chess-border rounded-xl p-6 text-center text-gray-500">
            <p>No games recorded yet.</p>
            <p className="text-sm mt-1">Games will appear here once this agent competes in tournaments.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-chess-border text-gray-400">
                  <th className="text-left py-3 px-3">Game</th>
                  <th className="text-left py-3 px-3">Opponent</th>
                  <th className="text-center py-3 px-3">Color</th>
                  <th className="text-center py-3 px-3">Result</th>
                  <th className="text-center py-3 px-3">Moves</th>
                </tr>
              </thead>
              <tbody>
                {games.map((game) => {
                  const isWhite = game.white.toLowerCase() === params.wallet.toLowerCase();
                  const opponent = isWhite ? game.black : game.white;
                  const won = (isWhite && game.result === '1-0') || (!isWhite && game.result === '0-1');
                  const lost = (isWhite && game.result === '0-1') || (!isWhite && game.result === '1-0');
                  const resultColor = won ? 'text-green-400' : lost ? 'text-red-400' : 'text-gray-400';
                  const resultLabel = won ? 'Win' : lost ? 'Loss' : 'Draw';
                  return (
                    <tr key={game.gameId} className="border-b border-chess-border/50 hover:bg-chess-border/20">
                      <td className="py-3 px-3">
                        <Link
                          href={`/tournaments/${game.tournamentId}/games/${game.gameId}`}
                          className="text-chess-accent-light hover:underline"
                        >
                          T{game.tournamentId} R{game.round} G{game.gameIndex + 1}
                        </Link>
                      </td>
                      <td className="py-3 px-3 font-mono text-xs">
                        <Link href={`/agents/${opponent}`} className="hover:text-chess-accent-light transition-colors">
                          {shortenAddress(opponent, 6)}
                        </Link>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className={isWhite ? 'text-white' : 'text-gray-400'}>
                          {isWhite ? '♔ White' : '♚ Black'}
                        </span>
                      </td>
                      <td className={`py-3 px-3 text-center font-medium ${resultColor}`}>
                        {resultLabel}
                      </td>
                      <td className="py-3 px-3 text-center">{game.moveCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
