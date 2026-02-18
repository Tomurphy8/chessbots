'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPublicClient, http, formatUnits, parseUnits, keccak256, encodeAbiParameters, parseAbiParameters, type Address, defineChain } from 'viem';
import { useAccount, useWriteContract } from 'wagmi';
import { CHAIN } from '@/lib/chains';
import { BETTING_ABI, ERC20_ABI } from '@/lib/contracts/evm';
import { cn, shortenAddress } from '@/lib/utils';
import { TrendingUp, Users, Swords, Trophy } from 'lucide-react';

const monad = defineChain({
  id: CHAIN.evmChainId,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [CHAIN.rpcUrl] } },
});

const publicClient = createPublicClient({
  chain: monad,
  transport: http(CHAIN.rpcUrl),
});

const BETTING_ADDRESS = CHAIN.bettingPoolAddress as Address;
const USDC_ADDRESS = CHAIN.usdcAddress as Address;

interface MarketInfo {
  marketId: bigint;
  marketType: number;
  status: number;
  tournamentId: bigint;
  numOutcomes: number;
  totalPool: bigint;
  winningOutcome: number;
  agentA: string;
  agentB: string;
  exists: boolean;
}

interface TournamentBettingProps {
  tournamentId: number;
  registeredAgents: string[];  // wallet addresses of registered agents
  tournamentStatus: string;    // 'registration' | 'in_progress' | 'completed' etc.
}

// Compute market keys matching Solidity abi.encode
function tournamentWinnerKey(tournamentId: number): `0x${string}` {
  const encoded = encodeAbiParameters(
    parseAbiParameters('string, uint256'),
    ['TournamentWinner', BigInt(tournamentId)],
  );
  return keccak256(encoded);
}

function headToHeadKey(tournamentId: number, agentA: string, agentB: string): `0x${string}` {
  // Canonical ordering
  const [first, second] = agentA.toLowerCase() < agentB.toLowerCase() ? [agentA, agentB] : [agentB, agentA];
  const encoded = encodeAbiParameters(
    parseAbiParameters('string, uint256, address, address'),
    ['HeadToHead', BigInt(tournamentId), first as `0x${string}`, second as `0x${string}`],
  );
  return keccak256(encoded);
}

function top3Key(tournamentId: number, agent: string): `0x${string}` {
  const encoded = encodeAbiParameters(
    parseAbiParameters('string, uint256, address'),
    ['TournamentTop3', BigInt(tournamentId), agent as `0x${string}`],
  );
  return keccak256(encoded);
}

interface DiscoveredMarket {
  type: 'winner' | 'h2h' | 'top3';
  marketId: bigint;
  totalPool: string;
  status: number;
  numOutcomes: number;
  agents?: string[];
  agentA?: string;
  agentB?: string;
  agent?: string;
  outcomeTotals?: string[];
}

export function TournamentBetting({ tournamentId, registeredAgents, tournamentStatus }: TournamentBettingProps) {
  const { address } = useAccount();
  const [markets, setMarkets] = useState<DiscoveredMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creatingType, setCreatingType] = useState<string | null>(null);
  const { writeContractAsync, isPending } = useWriteContract();

  // Discover existing markets for this tournament
  const discoverMarkets = useCallback(async () => {
    if (!BETTING_ADDRESS) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const found: DiscoveredMarket[] = [];

      // Check TournamentWinner market
      try {
        const key = tournamentWinnerKey(tournamentId);
        const [marketId, exists] = await publicClient.readContract({
          address: BETTING_ADDRESS,
          abi: BETTING_ABI,
          functionName: 'getMarketByKey',
          args: [key],
        }) as [bigint, boolean];

        if (exists) {
          const [market, totals, agents] = await Promise.all([
            publicClient.readContract({ address: BETTING_ADDRESS, abi: BETTING_ABI, functionName: 'getMarket', args: [marketId] }),
            publicClient.readContract({ address: BETTING_ADDRESS, abi: BETTING_ABI, functionName: 'getMarketOutcomeTotals', args: [marketId] }),
            publicClient.readContract({ address: BETTING_ADDRESS, abi: BETTING_ABI, functionName: 'getMarketAgents', args: [marketId] }),
          ]);

          const m = market as any;
          found.push({
            type: 'winner',
            marketId,
            totalPool: formatUnits(m.totalPool, 6),
            status: m.status,
            numOutcomes: m.numOutcomes,
            agents: agents as string[],
            outcomeTotals: (totals as bigint[]).map(t => formatUnits(t, 6)),
          });
        }
      } catch { /* no market */ }

      // Check HeadToHead markets for top agent pairs (first 3 pairs max)
      if (registeredAgents.length >= 2) {
        const pairs = [];
        for (let i = 0; i < Math.min(registeredAgents.length, 4); i++) {
          for (let j = i + 1; j < Math.min(registeredAgents.length, 4); j++) {
            pairs.push([registeredAgents[i], registeredAgents[j]]);
          }
        }

        for (const [a, b] of pairs.slice(0, 3)) {
          try {
            const key = headToHeadKey(tournamentId, a, b);
            const [marketId, exists] = await publicClient.readContract({
              address: BETTING_ADDRESS,
              abi: BETTING_ABI,
              functionName: 'getMarketByKey',
              args: [key],
            }) as [bigint, boolean];

            if (exists) {
              const [market, totals] = await Promise.all([
                publicClient.readContract({ address: BETTING_ADDRESS, abi: BETTING_ABI, functionName: 'getMarket', args: [marketId] }),
                publicClient.readContract({ address: BETTING_ADDRESS, abi: BETTING_ABI, functionName: 'getMarketOutcomeTotals', args: [marketId] }),
              ]);

              const m = market as any;
              found.push({
                type: 'h2h',
                marketId,
                totalPool: formatUnits(m.totalPool, 6),
                status: m.status,
                numOutcomes: m.numOutcomes,
                agentA: a,
                agentB: b,
                outcomeTotals: (totals as bigint[]).map(t => formatUnits(t, 6)),
              });
            }
          } catch { /* no market */ }
        }
      }

      setMarkets(found);
    } catch (e) {
      console.error('Failed to discover markets:', e);
    } finally {
      setLoading(false);
    }
  }, [tournamentId, registeredAgents]);

  useEffect(() => {
    discoverMarkets();
  }, [discoverMarkets]);

  // Create TournamentWinner market
  async function createWinnerMarket() {
    if (!BETTING_ADDRESS || registeredAgents.length < 2) return;
    setError('');
    setCreatingType('winner');
    try {
      const bond = parseUnits('5', 6);
      await writeContractAsync({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [BETTING_ADDRESS, bond],
      });
      await writeContractAsync({
        address: BETTING_ADDRESS,
        abi: BETTING_ABI,
        functionName: 'createTournamentWinnerMarket',
        args: [BigInt(tournamentId), registeredAgents as `0x${string}`[]],
      });
      discoverMarkets();
    } catch (e: any) {
      setError(e.message?.includes('User rejected') ? 'Cancelled' : 'Failed to create market');
    } finally {
      setCreatingType(null);
    }
  }

  // Create HeadToHead market
  async function createH2HMarket(agentA: string, agentB: string) {
    if (!BETTING_ADDRESS) return;
    setError('');
    setCreatingType('h2h');
    try {
      const bond = parseUnits('5', 6);
      await writeContractAsync({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [BETTING_ADDRESS, bond],
      });
      await writeContractAsync({
        address: BETTING_ADDRESS,
        abi: BETTING_ABI,
        functionName: 'createHeadToHeadMarket',
        args: [BigInt(tournamentId), agentA as `0x${string}`, agentB as `0x${string}`],
      });
      discoverMarkets();
    } catch (e: any) {
      setError(e.message?.includes('User rejected') ? 'Cancelled' : 'Failed to create market');
    } finally {
      setCreatingType(null);
    }
  }

  const canCreate = tournamentStatus !== 'completed' && tournamentStatus !== 'cancelled';
  const hasWinnerMarket = markets.some(m => m.type === 'winner');

  if (!BETTING_ADDRESS) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-2">
          <TrendingUp className="w-4 h-4" />
          Prediction Markets
        </h3>
        {markets.length > 0 && (
          <span className="text-xs text-gray-500">{markets.length} active</span>
        )}
      </div>

      {loading ? (
        <div className="bg-chess-surface border border-chess-border rounded-xl p-4 text-center text-gray-500 text-sm">
          Scanning for markets...
        </div>
      ) : (
        <>
          {/* Existing markets */}
          {markets.map((m, i) => (
            <MarketCard key={i} market={m} tournamentId={tournamentId} />
          ))}

          {/* Create market buttons */}
          {canCreate && address && (
            <div className="bg-chess-surface border border-chess-border rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-medium text-gray-300">Create a Market</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {!hasWinnerMarket && registeredAgents.length >= 2 && (
                  <button
                    onClick={createWinnerMarket}
                    disabled={isPending}
                    className="flex items-center gap-2 px-3 py-2 border border-chess-accent/30 hover:border-chess-accent rounded-lg text-sm transition-colors text-left"
                  >
                    <Trophy className="w-4 h-4 text-chess-gold flex-shrink-0" />
                    <div>
                      <div className="font-medium text-gray-200">Tournament Winner</div>
                      <div className="text-xs text-gray-500">Who wins the tournament?</div>
                    </div>
                  </button>
                )}
                {registeredAgents.length >= 2 && (
                  <button
                    onClick={() => {
                      if (registeredAgents.length >= 2) {
                        createH2HMarket(registeredAgents[0], registeredAgents[1]);
                      }
                    }}
                    disabled={isPending}
                    className="flex items-center gap-2 px-3 py-2 border border-chess-accent/30 hover:border-chess-accent rounded-lg text-sm transition-colors text-left"
                  >
                    <Swords className="w-4 h-4 text-chess-accent-light flex-shrink-0" />
                    <div>
                      <div className="font-medium text-gray-200">Head to Head</div>
                      <div className="text-xs text-gray-500">Compare two agents</div>
                    </div>
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-500">5 USDC bond per market (returned on resolution)</p>
              {(isPending || creatingType) && (
                <p className="text-xs text-chess-accent-light">Creating {creatingType} market...</p>
              )}
            </div>
          )}

          {!address && canCreate && (
            <div className="bg-chess-surface border border-chess-border rounded-xl p-4 text-center">
              <p className="text-sm text-gray-500">Connect wallet to create or bet on markets</p>
            </div>
          )}

          {markets.length === 0 && !canCreate && (
            <div className="bg-chess-surface border border-chess-border rounded-xl p-4 text-center">
              <p className="text-sm text-gray-500">No prediction markets were created for this tournament.</p>
            </div>
          )}
        </>
      )}

      {error && <p className="text-xs text-red-400 text-center">{error}</p>}
    </div>
  );
}

// Individual market card
function MarketCard({ market, tournamentId }: { market: DiscoveredMarket; tournamentId: number }) {
  const totalPool = parseFloat(market.totalPool);
  const statusLabel = market.status === 0 ? 'Open' : market.status === 1 ? 'Resolved' : 'Voided';
  const statusColor = market.status === 0 ? 'text-green-400' : market.status === 1 ? 'text-blue-400' : 'text-gray-500';

  return (
    <div className="bg-chess-surface border border-chess-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {market.type === 'winner' && <Trophy className="w-4 h-4 text-chess-gold" />}
          {market.type === 'h2h' && <Swords className="w-4 h-4 text-chess-accent-light" />}
          {market.type === 'top3' && <Users className="w-4 h-4 text-green-400" />}
          <span className="text-sm font-medium">
            {market.type === 'winner' && 'Tournament Winner'}
            {market.type === 'h2h' && `${shortenAddress(market.agentA || '')} vs ${shortenAddress(market.agentB || '')}`}
            {market.type === 'top3' && `Top 3: ${shortenAddress(market.agent || '')}`}
          </span>
        </div>
        <span className={cn('text-xs font-medium', statusColor)}>{statusLabel}</span>
      </div>

      {/* Pool breakdown bar for winner market */}
      {market.type === 'winner' && market.outcomeTotals && market.agents && totalPool > 0 && (
        <div className="space-y-1 mb-2">
          {market.agents.slice(0, 5).map((agent, idx) => {
            const amount = parseFloat(market.outcomeTotals![idx] || '0');
            const pct = totalPool > 0 ? (amount / totalPool) * 100 : 0;
            return (
              <div key={idx} className="flex items-center gap-2 text-xs">
                <span className="w-20 text-gray-400 truncate">{shortenAddress(agent)}</span>
                <div className="flex-1 h-2 bg-chess-dark rounded-full overflow-hidden">
                  <div
                    className="h-full bg-chess-accent/60 rounded-full transition-all"
                    style={{ width: `${Math.max(pct, 1)}%` }}
                  />
                </div>
                <span className="w-14 text-right text-gray-500">{amount.toFixed(2)}</span>
              </div>
            );
          })}
          {market.agents.length > 5 && (
            <p className="text-xs text-gray-500">+{market.agents.length - 5} more agents</p>
          )}
        </div>
      )}

      {/* H2H breakdown */}
      {market.type === 'h2h' && market.outcomeTotals && totalPool > 0 && (
        <div className="flex gap-2 text-xs mb-2">
          <div className="flex-1 text-center">
            <p className="text-gray-400">{shortenAddress(market.agentA || '')}</p>
            <p className="font-medium">{parseFloat(market.outcomeTotals[0] || '0').toFixed(2)}</p>
          </div>
          <div className="flex-1 text-center">
            <p className="text-gray-400">Tie</p>
            <p className="font-medium">{parseFloat(market.outcomeTotals[2] || '0').toFixed(2)}</p>
          </div>
          <div className="flex-1 text-center">
            <p className="text-gray-400">{shortenAddress(market.agentB || '')}</p>
            <p className="font-medium">{parseFloat(market.outcomeTotals[1] || '0').toFixed(2)}</p>
          </div>
        </div>
      )}

      <div className="flex justify-between text-xs text-gray-500">
        <span>Pool: {totalPool.toFixed(2)} USDC</span>
        <span>{market.numOutcomes} outcomes</span>
      </div>
    </div>
  );
}
