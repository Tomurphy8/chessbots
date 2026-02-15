'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPublicClient, http, parseUnits, type Address, defineChain } from 'viem';
import { useAccount, useWriteContract } from 'wagmi';
import { CHAIN } from '@/lib/chains';
import { ERC20_ABI } from '@/lib/contracts/evm';

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

const USDC_ADDRESS = CHAIN.usdcAddress as Address;

export interface UsdcApprovalResult {
  needsApproval: boolean;
  currentAllowance: bigint;
  approve: (amount: string) => Promise<void>;
  isPending: boolean;
  loading: boolean;
  refetch: () => void;
}

export function useUsdcApproval(spender: string, requiredAmount?: string): UsdcApprovalResult {
  const { address: userAddress } = useAccount();
  const [currentAllowance, setCurrentAllowance] = useState<bigint>(BigInt(0));
  const [loading, setLoading] = useState(true);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  const { writeContractAsync, isPending } = useWriteContract();

  const refetch = useCallback(() => setFetchTrigger(t => t + 1), []);

  useEffect(() => {
    if (!userAddress || !spender || !USDC_ADDRESS) {
      setLoading(false);
      return;
    }

    async function fetchAllowance() {
      try {
        setLoading(true);
        const allowance = await publicClient.readContract({
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [userAddress as Address, spender as Address],
        }) as bigint;

        setCurrentAllowance(allowance);
      } catch (e) {
        console.error('Failed to fetch USDC allowance:', e);
      } finally {
        setLoading(false);
      }
    }

    fetchAllowance();
  }, [userAddress, spender, fetchTrigger]);

  const requiredBigInt = requiredAmount ? parseUnits(requiredAmount, 6) : BigInt(0);
  const needsApproval = currentAllowance < requiredBigInt;

  const approve = useCallback(async (amount: string) => {
    if (!spender) return;
    const parsedAmount = parseUnits(amount, 6);

    await writeContractAsync({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender as Address, parsedAmount],
    });

    refetch();
  }, [spender, writeContractAsync, refetch]);

  return {
    needsApproval,
    currentAllowance,
    approve,
    isPending,
    loading,
    refetch,
  };
}
