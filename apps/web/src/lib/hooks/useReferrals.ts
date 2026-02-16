'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPublicClient, http, formatUnits, type Address, defineChain } from 'viem';
import { useAccount, useWriteContract } from 'wagmi';
import { CHAIN } from '@/lib/chains';
import { CHESSBOTS_ABI } from '@/lib/contracts/evm';

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

const TIER_NAMES = ['Bronze', 'Silver', 'Gold'] as const;
const TIER_THRESHOLDS = [0, 10, 25]; // agents needed for each tier

export interface ReferralState {
  earnings: string;           // formatted USDC
  earningsRaw: bigint;
  tournamentsRemaining: number;
  // V2: Tier info
  tier: number;               // 0=Bronze, 1=Silver, 2=Gold
  tierName: string;           // "Bronze" | "Silver" | "Gold"
  rateBps: number;            // current rate in BPS
  ratePercent: string;        // "5%" | "7%" | "10%"
  referralCount: number;      // how many agents referred
  nextTierAt: number;         // agents needed for next tier (0 if max)
  nextTierName: string;       // name of next tier ("" if max)
  loading: boolean;
  isPending: boolean;
  claim: () => Promise<void>;
  refetch: () => void;
}

/**
 * Hook to read referral earnings, tier info, and claim earnings.
 * Referral V2: Tiers (Bronze 5% / Silver 7% / Gold 10%), 25 full-rate + 2% forever, 1% referee discount.
 */
export function useReferrals(): ReferralState {
  const { address } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();
  const [earnings, setEarnings] = useState('0');
  const [earningsRaw, setEarningsRaw] = useState(BigInt(0));
  const [tournamentsRemaining, setTournamentsRemaining] = useState(0);
  const [tier, setTier] = useState(0);
  const [rateBps, setRateBps] = useState(500);
  const [referralCount, setReferralCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  const refetch = useCallback(() => setFetchTrigger(t => t + 1), []);

  useEffect(() => {
    async function fetchData() {
      if (!address) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const [rawEarnings, remaining, tierData] = await Promise.all([
          publicClient.readContract({
            address: CONTRACT,
            abi: CHESSBOTS_ABI,
            functionName: 'referralEarnings',
            args: [address],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: CONTRACT,
            abi: CHESSBOTS_ABI,
            functionName: 'referralTournamentsRemaining',
            args: [address],
          }) as Promise<number>,
          publicClient.readContract({
            address: CONTRACT,
            abi: CHESSBOTS_ABI,
            functionName: 'getReferrerTier',
            args: [address],
          }) as Promise<[number, number, number]>,
        ]);

        setEarningsRaw(rawEarnings);
        setEarnings(formatUnits(rawEarnings, 6)); // USDC 6 decimals
        setTournamentsRemaining(Number(remaining));
        setTier(Number(tierData[0]));
        setRateBps(Number(tierData[1]));
        setReferralCount(Number(tierData[2]));
      } catch (e) {
        console.error('Failed to fetch referral data:', e);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [address, fetchTrigger]);

  const claim = useCallback(async () => {
    await writeContractAsync({
      address: CONTRACT,
      abi: CHESSBOTS_ABI,
      functionName: 'claimReferralEarnings',
    });
    refetch();
  }, [writeContractAsync, refetch]);

  // Calculate next tier info
  const nextTierIndex = tier < 2 ? tier + 1 : -1;
  const nextTierAt = nextTierIndex >= 0 ? TIER_THRESHOLDS[nextTierIndex] - referralCount : 0;
  const nextTierName = nextTierIndex >= 0 ? TIER_NAMES[nextTierIndex] : '';

  return {
    earnings,
    earningsRaw,
    tournamentsRemaining,
    tier,
    tierName: TIER_NAMES[tier] || 'Bronze',
    rateBps,
    ratePercent: `${rateBps / 100}%`,
    referralCount,
    nextTierAt: Math.max(0, nextTierAt),
    nextTierName,
    loading,
    isPending,
    claim,
    refetch,
  };
}
