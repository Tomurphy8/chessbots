'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPublicClient, http, formatUnits, type Address, defineChain } from 'viem';
import { CHAIN } from '@/lib/chains';
import { CHESSBOTS_ABI, CHESSBOTS_V4_ABI, ERC20_ABI, STAKING_ABI, TierNames, StatusMap, AgentTypeMap, FormatMap } from '@/lib/contracts/evm';
import type { ProtocolStats, TokenomicsData } from '@/lib/contracts/index';

const monad = defineChain({
  id: CHAIN.evmChainId,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [CHAIN.rpcUrl] } },
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
});

const publicClient = createPublicClient({
  chain: monad,
  transport: http(CHAIN.rpcUrl),
});

const CONTRACT = CHAIN.contractAddress as Address;

// ─── Polling Intervals ───────────────────────────────────────────────────────
const PROTOCOL_POLL_INTERVAL = 60_000;    // 60 seconds (dashboard stats)
const TOURNAMENT_LIST_POLL_INTERVAL = 30_000; // 30 seconds (tournament list)
const TOURNAMENT_DETAIL_POLL_INTERVAL = 15_000; // 15 seconds (active tournament detail)

// ─── Protocol Stats ──────────────────────────────────────────────────────────

export function useProtocolStats() {
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      // Sum stats across current V3 + V4 + legacy contracts for cumulative totals
      const v4 = CHAIN.v4ContractAddress;
      const allContracts = [CONTRACT, ...(v4 ? [v4 as Address] : []), ...CHAIN.legacyContracts.map(a => a as Address)];

      const calls = allContracts.flatMap(addr => [
        { address: addr, abi: CHESSBOTS_ABI, functionName: 'protocol' as const },
        { address: addr, abi: CHESSBOTS_ABI, functionName: 'totalGamesPlayed' as const },
      ]);

      const results = await publicClient.multicall({ contracts: calls, allowFailure: true });

      let totalTournaments = 0;
      let totalGamesPlayed = 0;
      let totalPrizeDistributed = BigInt(0);

      for (let i = 0; i < allContracts.length; i++) {
        const protocolResult = results[i * 2];
        const gamesResult = results[i * 2 + 1];

        if (protocolResult.status === 'success') {
          const protocol = protocolResult.result as unknown as any[];
          totalTournaments += Number(protocol[5]);
          totalPrizeDistributed += protocol[6] as bigint;
        }
        if (gamesResult.status === 'success') {
          totalGamesPlayed += Number(gamesResult.result);
        }
      }

      setStats({
        totalTournaments,
        totalGamesPlayed,
        totalPrizeDistributed: formatUnits(totalPrizeDistributed, 6),
      });
    } catch (e) {
      console.error('Failed to fetch protocol stats:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    intervalRef.current = setInterval(fetchStats, PROTOCOL_POLL_INTERVAL);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchStats]);

  return { stats, loading };
}

// ─── Tournament List ─────────────────────────────────────────────────────────

export interface TournamentListItem {
  id: number;
  tier: 'rookie' | 'bronze' | 'silver' | 'masters' | 'legends' | 'free';
  status: string;
  format: 'swiss' | '1v1' | 'team' | 'league';
  entryFee: number;
  maxPlayers: number;
  registeredCount: number;
  currentRound: number;
  totalRounds: number;
  prizePool: number;
  startTime: number;
  registrationDeadline: number;
  contractAddress: string;
}

// Helper to parse a raw tournament struct into a TournamentListItem
function parseTournamentResult(t: any, contractAddr: string): TournamentListItem | null {
  if (!t.exists) return null;
  const tierName = (TierNames[t.tier] || 'Unknown').toLowerCase() as TournamentListItem['tier'];
  const rawStatus = StatusMap[t.status as keyof typeof StatusMap] || 'Unknown';
  const entryFee = parseFloat(formatUnits(t.entryFee as bigint, 6));
  const prizePool = entryFee * t.registeredCount;
  const formatRaw = t.format;
  const formatName = (formatRaw != null ? FormatMap[formatRaw as keyof typeof FormatMap] : 'Swiss') || 'Swiss';

  return {
    id: Number(t.id),
    tier: tierName,
    status: rawStatus === 'Registration' ? 'registration'
      : rawStatus === 'RoundActive' ? 'round_active'
      : rawStatus === 'RoundComplete' ? 'round_complete'
      : rawStatus === 'InProgress' ? 'in_progress'
      : rawStatus === 'Completed' ? 'completed'
      : rawStatus === 'Cancelled' ? 'cancelled'
      : String(rawStatus).toLowerCase(),
    format: formatName.toLowerCase() as TournamentListItem['format'],
    entryFee,
    maxPlayers: t.maxPlayers,
    registeredCount: t.registeredCount,
    currentRound: t.currentRound,
    totalRounds: t.totalRounds,
    prizePool,
    startTime: Number(t.startTime),
    registrationDeadline: Number(t.registrationDeadline),
    contractAddress: contractAddr,
  };
}

const V3_CONTRACT = CHAIN.v3ContractAddress as Address;
const isV4 = (addr: string) => addr.toLowerCase() === CONTRACT.toLowerCase();

export function useTournaments() {
  const [tournaments, setTournaments] = useState<TournamentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTournaments = useCallback(async () => {
    try {
      // Query protocol() from both V4 and V3 to get total tournament counts
      const [v4Protocol, v3Protocol] = await Promise.all([
        publicClient.readContract({ address: CONTRACT, abi: CHESSBOTS_V4_ABI, functionName: 'protocol' }),
        V3_CONTRACT
          ? publicClient.readContract({ address: V3_CONTRACT, abi: CHESSBOTS_ABI, functionName: 'protocol' }).catch(() => null)
          : Promise.resolve(null),
      ]);

      const v4Total = Number(v4Protocol[5]);
      const v3Total = v3Protocol ? Number((v3Protocol as any)[5]) : 0;

      if (v4Total === 0 && v3Total === 0) { setLoading(false); return; }

      // Build V4 multicall (last 50)
      const v4Start = Math.max(0, v4Total - 50);
      const v4Ids = Array.from({ length: v4Total - v4Start }, (_, i) => v4Total - 1 - i);
      const v4Calls = v4Ids.map(id => ({
        address: CONTRACT,
        abi: CHESSBOTS_V4_ABI,
        functionName: 'getTournament' as const,
        args: [BigInt(id)] as const,
      }));

      // Build V3 multicall (last 50)
      const v3Start = Math.max(0, v3Total - 50);
      const v3Ids = Array.from({ length: v3Total - v3Start }, (_, i) => v3Total - 1 - i);
      const v3Calls = V3_CONTRACT ? v3Ids.map(id => ({
        address: V3_CONTRACT,
        abi: CHESSBOTS_ABI,
        functionName: 'getTournament' as const,
        args: [BigInt(id)] as const,
      })) : [];

      const [v4Results, v3Results] = await Promise.all([
        v4Calls.length > 0 ? publicClient.multicall({ contracts: v4Calls, allowFailure: true }) : [],
        v3Calls.length > 0 ? publicClient.multicall({ contracts: v3Calls, allowFailure: true }) : [],
      ]);

      const items: TournamentListItem[] = [];

      // Process V4 results
      for (const r of v4Results) {
        if (r.status !== 'success') continue;
        const item = parseTournamentResult(r.result as any, CONTRACT);
        if (item) items.push(item);
      }

      // Process V3 results
      for (const r of v3Results) {
        if (r.status !== 'success') continue;
        const item = parseTournamentResult(r.result as any, V3_CONTRACT);
        if (item) items.push(item);
      }

      // Sort by startTime desc (most recent first), then by ID desc
      items.sort((a, b) => b.startTime - a.startTime || b.id - a.id);

      setTournaments(items);
    } catch (e) {
      console.error('Failed to fetch tournaments:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTournaments();
    intervalRef.current = setInterval(fetchTournaments, TOURNAMENT_LIST_POLL_INTERVAL);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchTournaments]);

  return { tournaments, loading, refetch: fetchTournaments };
}

// ─── Single Tournament ───────────────────────────────────────────────────────

export interface TournamentDetail {
  id: number;
  tier: string;
  status: string;
  format: string;
  entryFee: number;
  maxPlayers: number;
  minPlayers: number;
  registeredCount: number;
  currentRound: number;
  totalRounds: number;
  prizePool: number;
  startTime: number;
  registrationDeadline: number;
  baseTimeSeconds: number;
  incrementSeconds: number;
  winners: string[];
  prizeDistributed: boolean;
  bestOf: number;
  teamSize: number;
  challengeTarget: string;
}

export function useTournament(id: number, contractAddress?: string) {
  const [tournament, setTournament] = useState<TournamentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTournament = useCallback(async () => {
    try {
      const addr = (contractAddress || CONTRACT) as Address;
      const useV4Abi = isV4(addr);
      const abi = useV4Abi ? CHESSBOTS_V4_ABI : CHESSBOTS_ABI;

      const [t, collected] = await Promise.all([
        publicClient.readContract({
          address: addr, abi, functionName: 'getTournament',
          args: [BigInt(id)],
        }),
        publicClient.readContract({
          address: addr, abi, functionName: 'tournamentCollected',
          args: [BigInt(id)],
        }).catch(() => BigInt(0)),
      ]);
      if (!(t as any).exists) { setLoading(false); return; }

      const tAny = t as any;
      const tierName = (TierNames[tAny.tier] || 'Unknown').toLowerCase();
      const rawStatus = StatusMap[tAny.status as keyof typeof StatusMap] || 'Unknown';
      const status = rawStatus === 'Registration' ? 'registration'
        : rawStatus === 'RoundActive' ? 'round_active'
        : rawStatus === 'RoundComplete' ? 'round_complete'
        : rawStatus === 'InProgress' ? 'in_progress'
        : rawStatus.toLowerCase();
      const entryFee = parseFloat(formatUnits(tAny.entryFee as bigint, 6));

      const collectedPool = parseFloat(formatUnits(collected as bigint, 6));
      const prizePool = collectedPool > 0 ? collectedPool : entryFee * tAny.registeredCount;

      const formatRaw = tAny.format;
      const formatName = (formatRaw != null ? FormatMap[formatRaw as keyof typeof FormatMap] : 'Swiss') || 'Swiss';

      // V4 uses getRankedPlayers() instead of struct winners field
      let winners: string[];
      if (useV4Abi) {
        const ranked = await publicClient.readContract({
          address: addr, abi: CHESSBOTS_V4_ABI, functionName: 'getRankedPlayers',
          args: [BigInt(id)],
        }).catch(() => [] as string[]);
        const r = ranked as string[];
        winners = [
          r[0] || '0x0000000000000000000000000000000000000000',
          r[1] || '0x0000000000000000000000000000000000000000',
          r[2] || '0x0000000000000000000000000000000000000000',
        ];
      } else {
        winners = [...tAny.winners];
      }

      setTournament({
        id: Number(tAny.id),
        tier: tierName,
        status,
        format: formatName.toLowerCase(),
        entryFee,
        maxPlayers: tAny.maxPlayers,
        minPlayers: tAny.minPlayers,
        registeredCount: tAny.registeredCount,
        currentRound: tAny.currentRound,
        totalRounds: tAny.totalRounds,
        prizePool,
        startTime: Number(tAny.startTime),
        registrationDeadline: Number(tAny.registrationDeadline),
        baseTimeSeconds: tAny.baseTimeSeconds,
        incrementSeconds: tAny.incrementSeconds,
        winners,
        prizeDistributed: tAny.prizeDistributed,
        bestOf: tAny.bestOf || 0,
        teamSize: tAny.teamSize || 0,
        challengeTarget: tAny.challengeTarget || '0x0000000000000000000000000000000000000000',
      });
    } catch (e) {
      console.error('Failed to fetch tournament:', e);
    } finally {
      setLoading(false);
    }
  }, [id, contractAddress]);

  useEffect(() => {
    fetchTournament();
    intervalRef.current = setInterval(fetchTournament, TOURNAMENT_DETAIL_POLL_INTERVAL);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchTournament]);

  return { tournament, loading };
}

// ─── Tokenomics ──────────────────────────────────────────────────────────────

export function useTokenomics() {
  const [data, setData] = useState<TokenomicsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      try {
        const chessAddr = CHAIN.chessTokenAddress as Address;
        const stakingAddr = CHAIN.stakingAddress as Address;
        if (!chessAddr || !stakingAddr) { setLoading(false); return; }

        const [pendingBuyback, totalBurned, totalSupply, totalStaked] = await Promise.all([
          publicClient.readContract({ address: CONTRACT, abi: CHESSBOTS_ABI, functionName: 'pendingBuyback' }),
          publicClient.readContract({ address: chessAddr, abi: ERC20_ABI, functionName: 'totalBurned' }).catch(() => BigInt(0)),
          publicClient.readContract({ address: chessAddr, abi: ERC20_ABI, functionName: 'totalSupply' }),
          publicClient.readContract({ address: stakingAddr, abi: STAKING_ABI, functionName: 'totalStaked' }).catch(() => BigInt(0)),
        ]);

        // FE-C1: Use formatUnits for BigInt-safe conversion (prevents precision loss)
        setData({
          pendingBuyback: formatUnits(pendingBuyback as bigint, 6),    // USDC 6 decimals
          totalBurned: formatUnits(totalBurned as bigint, 18),          // CHESS 18 decimals
          totalSupply: formatUnits(totalSupply as bigint, 18),          // CHESS 18 decimals
          totalStaked: formatUnits(totalStaked as bigint, 18),          // CHESS 18 decimals
        });
      } catch (e) {
        console.error('Failed to fetch tokenomics:', e);
      } finally {
        setLoading(false);
      }
    }
    fetch();
  }, []);

  return { data, loading };
}
