'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPublicClient, http, formatUnits, type Address, defineChain } from 'viem';
import { CHAIN } from '@/lib/chains';
import { CHESSBOTS_ABI, ERC20_ABI, STAKING_ABI, TierNames, StatusMap, AgentTypeMap, FormatMap } from '@/lib/contracts/evm';
import type { ProtocolStats, TokenomicsData } from '@/lib/contracts/index';

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
      const [protocol, totalGames] = await Promise.all([
        publicClient.readContract({ address: CONTRACT, abi: CHESSBOTS_ABI, functionName: 'protocol' }),
        publicClient.readContract({ address: CONTRACT, abi: CHESSBOTS_ABI, functionName: 'totalGamesPlayed' }),
      ]);
      setStats({
        totalTournaments: Number(protocol[5]),
        totalGamesPlayed: Number(totalGames),
        // FE-H1(R7): Keep as string from formatUnits to preserve uint256 precision
        totalPrizeDistributed: formatUnits(protocol[6] as bigint, 6),
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
}

export function useTournaments() {
  const [tournaments, setTournaments] = useState<TournamentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTournaments = useCallback(async () => {
    try {
      const protocol = await publicClient.readContract({
        address: CONTRACT, abi: CHESSBOTS_ABI, functionName: 'protocol',
      });
      const total = Number(protocol[5]);
      if (total === 0) { setLoading(false); return; }

      // Tournaments are 0-indexed: IDs range from 0 to total-1
      const start = Math.max(0, total - 50);
      const items: TournamentListItem[] = [];

      for (let i = total - 1; i >= start; i--) {
        try {
          const t = await publicClient.readContract({
            address: CONTRACT, abi: CHESSBOTS_ABI, functionName: 'getTournament',
            args: [BigInt(i)],
          });
          if (!t.exists) continue;

          const tierName = (TierNames[t.tier] || 'Unknown').toLowerCase() as TournamentListItem['tier'];
          const rawStatus = StatusMap[t.status as keyof typeof StatusMap] || 'Unknown';
          // FE-C2: Use formatUnits for safe uint256→number conversion (prevents BigInt precision loss)
          const entryFee = parseFloat(formatUnits(t.entryFee as bigint, 6));
          const prizePool = entryFee * t.registeredCount;

          // V3 format field — defaults to 'swiss' if missing (V2 compat)
          const formatRaw = (t as any).format;
          const formatName = (formatRaw != null ? FormatMap[formatRaw as keyof typeof FormatMap] : 'Swiss') || 'Swiss';

          items.push({
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
          });
        } catch { /* skip */ }
      }

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

export function useTournament(id: number) {
  const [tournament, setTournament] = useState<TournamentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTournament = useCallback(async () => {
    try {
      const t = await publicClient.readContract({
        address: CONTRACT, abi: CHESSBOTS_ABI, functionName: 'getTournament',
        args: [BigInt(id)],
      });
      if (!t.exists) { setLoading(false); return; }

      const tierName = (TierNames[t.tier] || 'Unknown').toLowerCase();
      const rawStatus = StatusMap[t.status as keyof typeof StatusMap] || 'Unknown';
      const status = rawStatus === 'Registration' ? 'registration'
        : rawStatus === 'RoundActive' ? 'round_active'
        : rawStatus === 'RoundComplete' ? 'round_complete'
        : rawStatus === 'InProgress' ? 'in_progress'
        : rawStatus.toLowerCase();
      // FE-C2: Use formatUnits for safe uint256→number conversion
      const entryFee = parseFloat(formatUnits(t.entryFee as bigint, 6));

      // V3 format fields — defaults for V2 compat
      const tAny = t as any;
      const formatRaw = tAny.format;
      const formatName = (formatRaw != null ? FormatMap[formatRaw as keyof typeof FormatMap] : 'Swiss') || 'Swiss';

      setTournament({
        id: Number(t.id),
        tier: tierName,
        status,
        format: formatName.toLowerCase(),
        entryFee,
        maxPlayers: t.maxPlayers,
        minPlayers: t.minPlayers,
        registeredCount: t.registeredCount,
        currentRound: t.currentRound,
        totalRounds: t.totalRounds,
        prizePool: entryFee * t.registeredCount,
        startTime: Number(t.startTime),
        registrationDeadline: Number(t.registrationDeadline),
        baseTimeSeconds: t.baseTimeSeconds,
        incrementSeconds: t.incrementSeconds,
        winners: [...t.winners],
        prizeDistributed: t.prizeDistributed,
        bestOf: tAny.bestOf || 0,
        teamSize: tAny.teamSize || 0,
        challengeTarget: tAny.challengeTarget || '0x0000000000000000000000000000000000000000',
      });
    } catch (e) {
      console.error('Failed to fetch tournament:', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchTournament();
    // Poll every 15s — tournament detail pages need faster updates (round changes, winners)
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
