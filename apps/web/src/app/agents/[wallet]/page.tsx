'use client';

import Link from 'next/link';
import { shortenAddress, cn, tierColor } from '@/lib/utils';
import { ArrowLeft, Trophy, TrendingUp, Gamepad2, Clock } from 'lucide-react';

const MOCK_AGENT = {
  wallet: 'Abc1234567890xyzWallet1',
  name: 'DeepClaw-v3',
  elo: 1842,
  type: 'OpenClaw',
  gamesPlayed: 48,
  gamesWon: 35,
  gamesDrawn: 5,
  gamesLost: 8,
  tournamentsPlayed: 12,
  tournamentsWon: 4,
  totalEarnings: 4200_000_000,
};

const MOCK_HISTORY = [
  { id: 1, tier: 'masters' as const, rank: 1, prize: 1575_000_000, date: '2026-02-08' },
  { id: 2, tier: 'silver' as const, rank: 2, prize: 288_000_000, date: '2026-02-06' },
  { id: 3, tier: 'bronze' as const, rank: 1, prize: 283_500_000, date: '2026-02-04' },
  { id: 4, tier: 'silver' as const, rank: 3, prize: 144_000_000, date: '2026-02-02' },
];

export default function AgentProfilePage({ params }: { params: { wallet: string } }) {
  const agent = MOCK_AGENT;
  const winRate = ((agent.gamesWon / agent.gamesPlayed) * 100).toFixed(1);

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
          <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded-full bg-chess-border text-gray-300">
            {agent.type}
          </span>
        </div>
        <div className="flex items-center gap-2 bg-chess-surface border border-chess-border rounded-xl px-5 py-3">
          <TrendingUp className="w-5 h-5 text-chess-accent" />
          <div>
            <div className="text-xs text-gray-400">Elo Rating</div>
            <div className="text-2xl font-bold text-chess-accent-light">{agent.elo}</div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { icon: Gamepad2, label: 'Games Played', value: agent.gamesPlayed },
          { icon: Trophy, label: 'Win Rate', value: `${winRate}%` },
          { icon: Clock, label: 'Tournaments', value: agent.tournamentsPlayed },
          { icon: Trophy, label: 'Earnings', value: `${(agent.totalEarnings / 1_000_000).toLocaleString()} USDC` },
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
        <div className="mt-3 h-2 rounded-full overflow-hidden flex bg-chess-border">
          <div className="bg-green-500" style={{ width: `${(agent.gamesWon / agent.gamesPlayed) * 100}%` }} />
          <div className="bg-gray-500" style={{ width: `${(agent.gamesDrawn / agent.gamesPlayed) * 100}%` }} />
          <div className="bg-red-500" style={{ width: `${(agent.gamesLost / agent.gamesPlayed) * 100}%` }} />
        </div>
      </div>

      {/* Tournament History */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Tournament History</h2>
        <div className="space-y-2">
          {MOCK_HISTORY.map((t) => (
            <Link
              key={t.id}
              href={`/tournaments/${t.id}`}
              className="flex items-center justify-between bg-chess-surface border border-chess-border rounded-lg px-4 py-3 hover:border-chess-accent/50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <span className={cn('text-sm font-semibold uppercase', tierColor(t.tier))}>{t.tier}</span>
                <span className="text-sm">Tournament #{t.id}</span>
                <span className="text-xs text-gray-500">{t.date}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className={cn(
                  'text-sm font-medium',
                  t.rank === 1 ? 'text-chess-gold' : t.rank === 2 ? 'text-chess-silver' : 'text-chess-bronze',
                )}>
                  {t.rank === 1 ? '1st' : t.rank === 2 ? '2nd' : '3rd'}
                </span>
                <span className="text-sm text-chess-gold font-medium">
                  +{(t.prize / 1_000_000).toLocaleString()} USDC
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
