'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPublicClient, http, formatUnits, parseUnits, maxUint256, type Address, defineChain } from 'viem';
import { useAccount, useWriteContract, useSwitchChain, useChainId } from 'wagmi';
import { CHAIN } from '@/lib/chains';
import { STAKING_ABI, ERC20_ABI } from '@/lib/contracts/evm';

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

const STAKING_ADDRESS = CHAIN.stakingAddress as Address;
const CHESS_TOKEN_ADDRESS = CHAIN.chessTokenAddress as Address;

const STAKING_TIERS = [
  { threshold: 10_000, discount: 200 },
  { threshold: 50_000, discount: 500 },
  { threshold: 100_000, discount: 800 },
  { threshold: 250_000, discount: 1200 },
  { threshold: 500_000, discount: 1500 },
  { threshold: 1_000_000, discount: 1800 },
  { threshold: 2_500_000, discount: 2100 },
  { threshold: 5_000_000, discount: 2500 },
];

/**
 * Get the current discount tier label based on discount basis points.
 */
export function getDiscountLabel(discountBps: number): string {
  if (discountBps === 0) return 'None';
  return `${(discountBps / 100).toFixed(0)}%`;
}

/**
 * Get the next tier info based on current staked amount.
 */
export function getNextTier(stakedAmount: number): { threshold: number; discount: number } | null {
  for (const tier of STAKING_TIERS) {
    if (stakedAmount < tier.threshold) return tier;
  }
  return null; // Already at max tier
}

export interface StakingState {
  stakedBalance: string;    // formatted CHESS amount
  discountBps: number;      // basis points discount
  totalStaked: string;      // formatted CHESS amount
  chessBalance: string;     // formatted CHESS balance
  needsApproval: boolean;
  loading: boolean;
  isPending: boolean;
  isConfirming: boolean;    // true while waiting for tx to be mined on-chain
  stake: (amount: string) => Promise<void>;
  unstake: (amount: string) => Promise<void>;
  approveChess: (amount: string) => Promise<void>;
  refetch: () => void;
}

export function useStaking(): StakingState {
  const { address: userAddress } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const [stakedBalance, setStakedBalance] = useState('0');
  const [discountBps, setDiscountBps] = useState(0);
  const [totalStaked, setTotalStaked] = useState('0');
  const [chessBalance, setChessBalance] = useState('0');
  const [currentAllowance, setCurrentAllowance] = useState(BigInt(0));
  const [loading, setLoading] = useState(true);
  const [isConfirming, setIsConfirming] = useState(false);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  const { writeContractAsync, isPending } = useWriteContract();

  const ensureCorrectChain = useCallback(async () => {
    if (chainId !== CHAIN.evmChainId) {
      await switchChainAsync({ chainId: CHAIN.evmChainId });
    }
  }, [chainId, switchChainAsync]);

  const refetch = useCallback(() => setFetchTrigger(t => t + 1), []);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);

        // Always fetch totalStaked (no wallet needed)
        const total = await publicClient.readContract({
          address: STAKING_ADDRESS,
          abi: STAKING_ABI,
          functionName: 'totalStaked',
        }) as bigint;
        setTotalStaked(formatUnits(total, 18));

        if (!userAddress || !STAKING_ADDRESS || !CHESS_TOKEN_ADDRESS) {
          setLoading(false);
          return;
        }

        const [staked, discount, balance, allowance] = await Promise.all([
          publicClient.readContract({
            address: STAKING_ADDRESS,
            abi: STAKING_ABI,
            functionName: 'stakedBalance',
            args: [userAddress],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: STAKING_ADDRESS,
            abi: STAKING_ABI,
            functionName: 'getDiscount',
            args: [userAddress],
          }) as Promise<number>,
          publicClient.readContract({
            address: CHESS_TOKEN_ADDRESS,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [userAddress],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: CHESS_TOKEN_ADDRESS,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [userAddress, STAKING_ADDRESS],
          }) as Promise<bigint>,
        ]);

        setStakedBalance(formatUnits(staked, 18));
        setDiscountBps(Number(discount));
        setChessBalance(formatUnits(balance, 18));
        setCurrentAllowance(allowance);
      } catch (e) {
        console.error('Failed to fetch staking data:', e);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [userAddress, fetchTrigger]);

  const needsApproval = currentAllowance === BigInt(0);

  const approveChess = useCallback(async (amount: string) => {
    if (!CHESS_TOKEN_ADDRESS || !STAKING_ADDRESS) return;
    await ensureCorrectChain();

    const hash = await writeContractAsync({
      address: CHESS_TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [STAKING_ADDRESS, maxUint256],
    });

    setIsConfirming(true);
    try {
      await publicClient.waitForTransactionReceipt({ hash });
    } finally {
      setIsConfirming(false);
    }

    refetch();
  }, [writeContractAsync, refetch, ensureCorrectChain]);

  const stake = useCallback(async (amount: string) => {
    if (!STAKING_ADDRESS) return;
    await ensureCorrectChain();
    const parsedAmount = parseUnits(amount, 18);

    const hash = await writeContractAsync({
      address: STAKING_ADDRESS,
      abi: STAKING_ABI,
      functionName: 'stake',
      args: [parsedAmount],
    });

    setIsConfirming(true);
    try {
      await publicClient.waitForTransactionReceipt({ hash });
    } finally {
      setIsConfirming(false);
    }

    refetch();
  }, [STAKING_ADDRESS, writeContractAsync, refetch, ensureCorrectChain]);

  const unstake = useCallback(async (amount: string) => {
    if (!STAKING_ADDRESS) return;
    await ensureCorrectChain();
    const parsedAmount = parseUnits(amount, 18);

    const hash = await writeContractAsync({
      address: STAKING_ADDRESS,
      abi: STAKING_ABI,
      functionName: 'unstake',
      args: [parsedAmount],
    });

    setIsConfirming(true);
    try {
      await publicClient.waitForTransactionReceipt({ hash });
    } finally {
      setIsConfirming(false);
    }

    refetch();
  }, [STAKING_ADDRESS, writeContractAsync, refetch, ensureCorrectChain]);

  return {
    stakedBalance,
    discountBps,
    totalStaked,
    chessBalance,
    needsApproval,
    loading,
    isPending,
    isConfirming,
    stake,
    unstake,
    approveChess,
    refetch,
  };
}
