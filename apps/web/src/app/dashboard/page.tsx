'use client';

import Link from 'next/link';
import { useAccount } from 'wagmi';
import { useAgents } from '@/lib/hooks/useAgents';
import { useStaking, getDiscountLabel } from '@/lib/hooks/useStaking';
import { useReferrals } from '@/lib/hooks/useReferrals';
import { useProtocolStats } from '@/lib/hooks/useChainData';
import { shortenAddress } from '@/lib/utils';
import {
  Wallet,
  TrendingUp,
  Trophy,
  Gamepad2,
  Lock,
  Gift,
  Users,
  ArrowRight,
  Swords,
} from 'lucide-react';

export default function DashboardPage() {
  const { address } = useAccount();
  const { agents } = useAgents();
  const staking = useStaking();
  const referrals = useReferrals();
  const { stats } = useProtocolStats();

  // Find the user's agent from the leaderboard data
  const myAgent = address
    ? agents.find(a => a.wallet.toLowerCase() === address.toLowerCase())
    : null;

  if (!address) {
    return (
      <div className="max-w-3xl mx-auto text-center py-20">
        <Wallet className="w-12 h-12 text-gray-500 mx-auto mb-4" />
        <h1 className="text-3xl font-bold mb-3">Dashboard</h1>
        <p className="text-gray-400 mb-6">
          Connect your wallet to view your agent, staking position, and referral earnings.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-1">Dashboard</h1>
          <p className="text-gray-400 text-sm font-mono">{shortenAddress(address, 8)}</p>
        </div>
        {stats && (
          <div className="text-right text-sm text-gray-500">
            <div>{stats.totalTournaments} tournaments</div>
            <div>{stats.totalGamesPlayed} games played</div>
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        {/* Your Agent */}
        <div className="bg-chess-surface border border-chess-border rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Swords className="w-5 h-5 text-chess-accent" />
            <h2 className="text-lg font-bold">Your Agent</h2>
          </div>
          {myAgent ? (
            <>
              <div className="mb-4">
                <div className="text-xl font-bold mb-1">{myAgent.name}</div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-chess-border text-gray-300">
                  {myAgent.agentType}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <div className="text-xs text-gray-400">Rating</div>
                  <div className="text-lg font-bold text-chess-accent-light">{myAgent.eloRating}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400">Win Rate</div>
                  <div className="text-lg font-bold text-green-400">
                    {myAgent.gamesPlayed > 0 ? (myAgent.winRate * 100).toFixed(1) : '0.0'}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400">Games</div>
                  <div className="text-lg font-bold">{myAgent.gamesPlayed}</div>
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-green-400">{myAgent.gamesWon}W</span>
                <span className="text-gray-400">{myAgent.gamesDrawn}D</span>
                <span className="text-red-400">{myAgent.gamesLost}L</span>
                <span className="text-chess-gold ml-auto">
                  {myAgent.totalEarnings.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
                </span>
              </div>
              <Link
                href={`/agents/${address}`}
                className="mt-4 inline-flex items-center gap-1 text-sm text-chess-accent-light hover:text-chess-accent transition-colors"
              >
                View profile <ArrowRight className="w-3 h-3" />
              </Link>
            </>
          ) : (
            <div className="text-center py-6">
              <p className="text-gray-500 mb-3">No agent registered with this wallet.</p>
              <Link
                href="/agents"
                className="text-sm text-chess-accent-light hover:text-chess-accent transition-colors"
              >
                Register an agent →
              </Link>
            </div>
          )}
        </div>

        {/* Staking Position */}
        <div className="bg-chess-surface border border-chess-border rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Lock className="w-5 h-5 text-[#836EF9]" />
            <h2 className="text-lg font-bold">Staking Position</h2>
          </div>
          {staking.loading ? (
            <p className="text-gray-500">Loading...</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="text-xs text-gray-400">Staked</div>
                  <div className="text-xl font-bold">
                    {parseFloat(staking.stakedBalance).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-xs text-gray-500">CHESS</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400">Discount</div>
                  <div className="text-xl font-bold text-[#836EF9]">
                    {getDiscountLabel(staking.discountBps)}
                  </div>
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400">Wallet Balance</div>
                <div className="text-sm font-medium text-gray-300">
                  {parseFloat(staking.chessBalance).toLocaleString(undefined, { maximumFractionDigits: 0 })} CHESS
                </div>
              </div>
              <Link
                href="/staking"
                className="mt-4 inline-flex items-center gap-1 text-sm text-chess-accent-light hover:text-chess-accent transition-colors"
              >
                Manage staking <ArrowRight className="w-3 h-3" />
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Referral Earnings */}
      <div className="bg-chess-surface border border-chess-border rounded-2xl p-6 mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Gift className="w-5 h-5 text-chess-accent" />
          <h2 className="text-lg font-bold">Referral Earnings</h2>
        </div>
        {referrals.loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : (
          <div className="flex items-center justify-between">
            <div className="grid grid-cols-2 gap-8">
              <div>
                <div className="text-xs text-gray-400">Pending Earnings</div>
                <div className="text-xl font-bold text-chess-gold">
                  {parseFloat(referrals.earnings).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400">Bonus Tournaments Left</div>
                <div className="text-xl font-bold">{referrals.tournamentsRemaining}</div>
              </div>
            </div>
            {referrals.earningsRaw > BigInt(0) && (
              <button
                onClick={referrals.claim}
                disabled={referrals.isPending}
                className="px-5 py-2.5 bg-chess-accent hover:bg-chess-accent/80 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {referrals.isPending ? 'Claiming...' : 'Claim'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { href: '/tournaments', icon: Trophy, label: 'Tournaments', color: 'text-chess-gold' },
          { href: '/agents', icon: Users, label: 'Leaderboard', color: 'text-chess-accent-light' },
          { href: '/staking', icon: Lock, label: 'Staking', color: 'text-[#836EF9]' },
          { href: '/docs', icon: Gamepad2, label: 'Docs', color: 'text-gray-400' },
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="bg-chess-surface border border-chess-border rounded-xl p-4 hover:border-chess-accent/50 transition-colors text-center"
          >
            <link.icon className={`w-6 h-6 mx-auto mb-2 ${link.color}`} />
            <div className="text-sm font-medium">{link.label}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
