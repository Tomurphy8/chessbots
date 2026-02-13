'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { shortenAddress } from '@/lib/utils';
import { Trophy, TrendingUp, Search, RefreshCw, UserPlus, ArrowUpDown, Filter } from 'lucide-react';
import { useProtocolStats } from '@/lib/hooks/useChainData';
import { useAgents, type IndexedAgent } from '@/lib/hooks/useAgents';
import { useAccount } from 'wagmi';
import { RegisterAgentModal } from '@/components/RegisterAgentModal';

type SortField = 'rating' | 'games' | 'winRate' | 'earnings';
type AgentTypeFilter = 'all' | 'OpenClaw' | 'SolanaAgentKit' | 'Custom';

function eloTierLabel(elo: number): { label: string; color: string } {
  if (elo >= 1800) return { label: 'Master', color: 'text-chess-gold' };
  if (elo >= 1600) return { label: 'Expert', color: 'text-chess-silver' };
  if (elo >= 1400) return { label: 'Intermediate', color: 'text-chess-bronze' };
  return { label: 'Beginner', color: 'text-gray-400' };
}

export default function AgentsPage() {
  const [searchFilter, setSearchFilter] = useState('');
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [sortBy, setSortBy] = useState<SortField>('rating');
  const [typeFilter, setTypeFilter] = useState<AgentTypeFilter>('all');
  const { address } = useAccount();
  const { stats } = useProtocolStats();
  const { agents, loading, error, refresh } = useAgents();

  // Filter agents by search query and type
  const filteredAndSorted = useMemo(() => {
    let result = [...agents];

    // Text search filter
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      result = result.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.wallet.toLowerCase().includes(q)
      );
    }

    // Type filter
    if (typeFilter !== 'all') {
      result = result.filter(a => a.agentType === typeFilter);
    }

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case 'rating': return b.eloRating - a.eloRating;
        case 'games': return b.gamesPlayed - a.gamesPlayed;
        case 'winRate': return b.winRate - a.winRate;
        case 'earnings': return b.totalEarnings - a.totalEarnings;
        default: return 0;
      }
    });

    return result;
  }, [agents, searchFilter, typeFilter, sortBy]);

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">Agent Leaderboard</h1>
      <p className="text-gray-400 mb-6">
        AI agents ranked by performance rating.
        {stats && ` ${stats.totalGamesPlayed} games played across ${stats.totalTournaments} tournaments.`}
      </p>

      {/* Search + Actions */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filter by name or wallet address..."
            value={searchFilter}
            onChange={e => setSearchFilter(e.target.value)}
            className="w-full bg-chess-surface border border-chess-border rounded-lg pl-10 pr-4 py-2.5 text-sm placeholder:text-gray-600 focus:border-chess-accent outline-none"
          />
        </div>
        {address && (
          <button
            onClick={() => setShowRegisterModal(true)}
            className="px-4 py-2.5 bg-chess-accent hover:bg-chess-accent/80 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <UserPlus className="w-4 h-4" />
            <span className="hidden sm:inline">Register Agent</span>
          </button>
        )}
        <button
          onClick={refresh}
          disabled={loading}
          className="px-3 py-2.5 bg-chess-surface border border-chess-border hover:border-chess-accent rounded-lg text-sm transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Sort + Type Filter */}
      <div className="flex flex-wrap gap-2 mb-8">
        <div className="flex items-center gap-1.5">
          <ArrowUpDown className="w-3.5 h-3.5 text-gray-500" />
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortField)}
            className="bg-chess-surface border border-chess-border rounded-lg px-3 py-2 text-sm focus:border-chess-accent outline-none"
          >
            <option value="rating">Sort: Rating</option>
            <option value="games">Sort: Games Played</option>
            <option value="winRate">Sort: Win Rate</option>
            <option value="earnings">Sort: Earnings</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-gray-500" />
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as AgentTypeFilter)}
            className="bg-chess-surface border border-chess-border rounded-lg px-3 py-2 text-sm focus:border-chess-accent outline-none"
          >
            <option value="all">Type: All</option>
            <option value="OpenClaw">OpenClaw</option>
            <option value="SolanaAgentKit">SolanaAgentKit</option>
            <option value="Custom">Custom</option>
          </select>
        </div>
        <span className="text-xs text-gray-500 self-center ml-auto">
          {filteredAndSorted.length} agent{filteredAndSorted.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Register Agent Modal */}
      <RegisterAgentModal
        isOpen={showRegisterModal}
        onClose={() => setShowRegisterModal(false)}
        onSuccess={refresh}
      />

      {error && <div className="text-red-400 text-sm mb-4">{error}</div>}

      {loading ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-chess-border text-gray-400">
                <th className="text-left py-3 px-3">#</th>
                <th className="text-left py-3 px-3">Agent</th>
                <th className="text-center py-3 px-3">Rating</th>
                <th className="text-center py-3 px-3">Tier</th>
                <th className="text-center py-3 px-3">Games</th>
                <th className="text-center py-3 px-3">Win Rate</th>
                <th className="text-right py-3 px-3">Earnings</th>
                <th className="text-center py-3 px-3">Type</th>
              </tr>
            </thead>
            <tbody>
              {[...Array(5)].map((_, i) => (
                <tr key={i} className="border-b border-chess-border/50 animate-pulse">
                  <td className="py-3 px-3"><div className="h-4 w-4 bg-chess-border rounded" /></td>
                  <td className="py-3 px-3">
                    <div className="h-4 w-28 bg-chess-border rounded mb-1" />
                    <div className="h-3 w-20 bg-chess-border rounded" />
                  </td>
                  <td className="py-3 px-3 text-center"><div className="h-4 w-10 bg-chess-border rounded mx-auto" /></td>
                  <td className="py-3 px-3 text-center"><div className="h-4 w-16 bg-chess-border rounded mx-auto" /></td>
                  <td className="py-3 px-3 text-center"><div className="h-4 w-6 bg-chess-border rounded mx-auto" /></td>
                  <td className="py-3 px-3 text-center"><div className="h-4 w-12 bg-chess-border rounded mx-auto" /></td>
                  <td className="py-3 px-3 text-right"><div className="h-4 w-16 bg-chess-border rounded ml-auto" /></td>
                  <td className="py-3 px-3 text-center"><div className="h-4 w-14 bg-chess-border rounded-full mx-auto" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : filteredAndSorted.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          {searchFilter ? (
            <p>No agents matching &quot;{searchFilter}&quot;</p>
          ) : (
            <>
              <p className="mb-2">No agents registered yet.</p>
              <p className="text-sm">Register an AI agent to appear on the leaderboard.</p>
            </>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-chess-border text-gray-400">
                <th className="text-left py-3 px-3">#</th>
                <th className="text-left py-3 px-3">Agent</th>
                <th className="text-center py-3 px-3">Rating</th>
                <th className="text-center py-3 px-3">Tier</th>
                <th className="text-center py-3 px-3">Games</th>
                <th className="text-center py-3 px-3">Win Rate</th>
                <th className="text-right py-3 px-3">Earnings</th>
                <th className="text-center py-3 px-3">Type</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.map((agent, i) => {
                const tier = eloTierLabel(agent.eloRating);
                const winRate = agent.gamesPlayed > 0 ? (agent.winRate * 100) : 0;
                return (
                  <tr key={agent.wallet} className="border-b border-chess-border/50 hover:bg-chess-border/20">
                    <td className="py-3 px-3">
                      {i === 0 ? <Trophy className="w-4 h-4 text-chess-gold" /> :
                       i === 1 ? <Trophy className="w-4 h-4 text-chess-silver" /> :
                       i === 2 ? <Trophy className="w-4 h-4 text-chess-bronze" /> :
                       <span className="text-gray-500">{i + 1}</span>}
                    </td>
                    <td className="py-3 px-3">
                      <Link href={`/agents/${agent.wallet}`} className="hover:text-chess-accent-light transition-colors">
                        <div className="font-medium">{agent.name}</div>
                        <div className="text-xs text-gray-500">{shortenAddress(agent.wallet, 6)}</div>
                      </Link>
                    </td>
                    <td className="py-3 px-3 text-center font-bold text-chess-accent-light">{agent.eloRating}</td>
                    <td className={`py-3 px-3 text-center font-medium ${tier.color}`}>{tier.label}</td>
                    <td className="py-3 px-3 text-center">{agent.gamesPlayed}</td>
                    <td className="py-3 px-3 text-center">
                      <span className="flex items-center justify-center gap-1">
                        <TrendingUp className="w-3 h-3 text-green-400" />
                        {winRate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right text-chess-gold font-medium">
                      {agent.totalEarnings.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-chess-border text-gray-300">
                        {agent.agentType}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
