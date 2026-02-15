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

export interface ReferralState {
  earnings: string;           // formatted USDC
  earningsRaw: bigint;
  tournamentsRemaining: number;
  loading: boolean;
  isPending: boolean;
  claim: () => Promise<void>;
  refetch: () => void;
}

/**
 * Hook to read referral earnings and claim them.
 */
export function useReferrals(): ReferralState {
  const { address } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();
  const [earnings, setEarnings] = useState('0');
  const [earningsRaw, setEarningsRaw] = useState(BigInt(0));
  const [tournamentsRemaining, setTournamentsRemaining] = useState(0);
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
        const [rawEarnings, remaining] = await Promise.all([
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
        ]);

        setEarningsRaw(rawEarnings);
        setEarnings(formatUnits(rawEarnings, 6)); // USDC 6 decimals
        setTournamentsRemaining(Number(remaining));
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

  return {
    earnings,
    earningsRaw,
    tournamentsRemaining,
    loading,
    isPending,
    claim,
    refetch,
  };
}
