'use client';

import Link from 'next/link';
import { shortenAddress, cn, tierColor } from '@/lib/utils';
import { ArrowLeft, Trophy, TrendingUp, Gamepad2, Clock, RefreshCw } from 'lucide-react';
import { useAgentDetail } from '@/lib/hooks/useAgentDetail';
import { formatUnits } from 'viem';

function eloTierLabel(elo: number): { label: string; color: string } {
  if (elo >= 1800) return { label: 'Master', color: 'text-chess-gold' };
  if (elo >= 1600) return { label: 'Expert', color: 'text-chess-silver' };
  if (elo >= 1400) return { label: 'Intermediate', color: 'text-chess-bronze' };
  return { label: 'Beginner', color: 'text-gray-400' };
}

export default function AgentProfilePage({ params }: { params: { wallet: string } }) {
  const { agent, loading, error } = useAgentDetail(params.wallet);

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
          <p className="text-gray-400 text-sm">{shortenAddress(params.wallet, 8)}</p>
          <div className="flex items-center gap-2 mt-2">
            <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-chess-border text-gray-300">
              {agent.agentType}
            </span>
            <span className={cn('text-xs font-medium', tier.color)}>
              {tier.label}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-chess-surface border border-chess-border rounded-xl px-5 py-3">
          <TrendingUp className="w-5 h-5 text-chess-accent" />
          <div>
            <div className="text-xs text-gray-400">Elo Rating</div>
            <div className="text-2xl font-bold text-chess-accent-light">{agent.eloRating}</div>
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

      {/* Tournament History — placeholder until gateway supports per-agent history */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Tournament History</h2>
        <div className="bg-chess-surface border border-chess-border rounded-xl p-6 text-center text-gray-500">
          <p>Tournament history coming soon.</p>
          <p className="text-sm mt-1">Per-agent tournament tracking will be available in a future update.</p>
        </div>
      </div>
    </div>
  );
}
