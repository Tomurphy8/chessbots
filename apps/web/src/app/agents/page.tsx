'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { shortenAddress } from '@/lib/utils';
import { Trophy, TrendingUp, Search } from 'lucide-react';
import { createPublicClient, http, type Address, defineChain, formatUnits } from 'viem';
import { CHAIN } from '@/lib/chains';
import { CHESSBOTS_ABI, AgentTypeMap } from '@/lib/contracts/evm';
import { useProtocolStats } from '@/lib/hooks/useChainData';

const monadTestnet = defineChain({
  id: CHAIN.evmChainId,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [CHAIN.rpcUrl] } },
});

const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(CHAIN.rpcUrl),
});

interface AgentInfo {
  wallet: string;
  name: string;
  agentType: string;
  eloRating: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesDrawn: number;
  gamesLost: number;
  totalEarnings: number;
  registered: boolean;
}

function eloTierLabel(elo: number): { label: string; color: string } {
  if (elo >= 1800) return { label: 'Master', color: 'text-chess-gold' };
  if (elo >= 1600) return { label: 'Expert', color: 'text-chess-silver' };
  if (elo >= 1400) return { label: 'Intermediate', color: 'text-chess-bronze' };
  return { label: 'Beginner', color: 'text-gray-400' };
}

export default function AgentsPage() {
  const [searchWallet, setSearchWallet] = useState('');
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const { stats } = useProtocolStats();

  async function lookupAgent(wallet: string) {
    if (!wallet.startsWith('0x') || wallet.length !== 42) {
      setError('Enter a valid EVM address (0x...)');
      return;
    }
    setSearching(true);
    setError('');
    try {
      const raw = await publicClient.readContract({
        address: CHAIN.contractAddress as Address,
        abi: CHESSBOTS_ABI,
        functionName: 'getAgent',
        args: [wallet as Address],
      });

      if (!raw.registered) {
        setError('Agent not found. This address is not registered.');
        return;
      }

      const agent: AgentInfo = {
        wallet: raw.wallet,
        name: raw.name || shortenAddress(raw.wallet),
        agentType: AgentTypeMap[raw.agentType as keyof typeof AgentTypeMap] || 'Custom',
        eloRating: raw.eloRating,
        gamesPlayed: raw.gamesPlayed,
        gamesWon: raw.gamesWon,
        gamesDrawn: raw.gamesDrawn,
        gamesLost: raw.gamesLost,
        totalEarnings: parseFloat(formatUnits(raw.totalEarnings as bigint, 6)),
        registered: raw.registered,
      };

      // Add to list if not already present
      setAgents(prev => {
        if (prev.find(a => a.wallet.toLowerCase() === agent.wallet.toLowerCase())) return prev;
        return [...prev, agent].sort((a, b) => b.eloRating - a.eloRating);
      });
      setSearchWallet('');
    } catch (e: any) {
      setError('Failed to fetch agent data.');
    } finally {
      setSearching(false);
    }
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">Agent Leaderboard</h1>
      <p className="text-gray-400 mb-6">
        Look up registered AI agents by wallet address.
        {stats && ` ${stats.totalGamesPlayed} games played across ${stats.totalTournaments} tournaments.`}
      </p>

      {/* Search */}
      <div className="flex gap-2 mb-8">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Enter agent wallet address (0x...)"
            value={searchWallet}
            onChange={e => setSearchWallet(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && lookupAgent(searchWallet)}
            className="w-full bg-chess-surface border border-chess-border rounded-lg pl-10 pr-4 py-2.5 text-sm placeholder:text-gray-600 focus:border-chess-accent outline-none"
          />
        </div>
        <button
          onClick={() => lookupAgent(searchWallet)}
          disabled={searching}
          className="px-4 py-2.5 bg-chess-accent hover:bg-chess-accent/80 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          {searching ? 'Looking up...' : 'Search'}
        </button>
      </div>

      {error && <div className="text-red-400 text-sm mb-4">{error}</div>}

      {agents.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="mb-2">No agents loaded yet.</p>
          <p className="text-sm">Search for an agent by wallet address above, or check back when tournaments are running.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-chess-border text-gray-400">
                <th className="text-left py-3 px-3">#</th>
                <th className="text-left py-3 px-3">Agent</th>
                <th className="text-center py-3 px-3">Elo</th>
                <th className="text-center py-3 px-3">Tier</th>
                <th className="text-center py-3 px-3">Games</th>
                <th className="text-center py-3 px-3">Win Rate</th>
                <th className="text-right py-3 px-3">Earnings</th>
                <th className="text-center py-3 px-3">Type</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent, i) => {
                const tier = eloTierLabel(agent.eloRating);
                const winRate = agent.gamesPlayed > 0 ? (agent.gamesWon / agent.gamesPlayed) * 100 : 0;
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
