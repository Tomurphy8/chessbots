'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPublicClient, http, formatUnits, parseUnits, type Address, defineChain } from 'viem';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { CHAIN } from '@/lib/chains';
import { BETTING_ABI, ERC20_ABI } from '@/lib/contracts/evm';

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

export interface PoolBreakdown {
  whiteWins: string;
  blackWins: string;
  draw: string;
}

export interface UserBet {
  prediction: number; // 0=WhiteWins, 1=BlackWins, 2=Draw
  predictionName: string;
  amount: string;
  claimed: boolean;
}

export interface BettingPoolResult {
  poolId: bigint | null;
  poolExists: boolean;
  breakdown: PoolBreakdown | null;
  totalPool: string;
  vigBps: number;
  minBet: string;
  userBet: UserBet | null;
  impliedOdds: { white: number; black: number; draw: number };
  loading: boolean;
  // Actions
  placeBet: (prediction: number, amountUsdc: string) => Promise<void>;
  claimWinnings: () => Promise<void>;
  claimRefund: () => Promise<void>;
  isPending: boolean;
  refetch: () => void;
}

const PREDICTION_NAMES = ['White Wins', 'Black Wins', 'Draw'];

export function useBettingPool(
  tournamentId: number,
  round: number,
  gameIndex: number,
): BettingPoolResult {
  const { address: userAddress } = useAccount();
  const [poolId, setPoolId] = useState<bigint | null>(null);
  const [poolExists, setPoolExists] = useState(false);
  const [breakdown, setBreakdown] = useState<PoolBreakdown | null>(null);
  const [totalPool, setTotalPool] = useState('0');
  const [vigBps, setVigBps] = useState(300);
  const [minBet, setMinBet] = useState('1');
  const [userBet, setUserBet] = useState<UserBet | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  const { writeContractAsync, isPending } = useWriteContract();

  const refetch = useCallback(() => setFetchTrigger(t => t + 1), []);

  // Fetch pool data
  useEffect(() => {
    if (!BETTING_ADDRESS) {
      setLoading(false);
      return;
    }

    async function fetchPool() {
      try {
        setLoading(true);

        // Look up pool ID for this game
        const [pid, exists] = await publicClient.readContract({
          address: BETTING_ADDRESS,
          abi: BETTING_ABI,
          functionName: 'getPoolIdForGame',
          args: [BigInt(tournamentId), round, gameIndex],
        }) as [bigint, boolean];

        setPoolId(pid);
        setPoolExists(exists);

        if (!exists) {
          setLoading(false);
          return;
        }

        // Fetch pool breakdown, total, vig, minBet in parallel
        const [bd, total, vig, min] = await Promise.all([
          publicClient.readContract({
            address: BETTING_ADDRESS,
            abi: BETTING_ABI,
            functionName: 'getPoolBreakdown',
            args: [pid],
          }),
          publicClient.readContract({
            address: BETTING_ADDRESS,
            abi: BETTING_ABI,
            functionName: 'getPoolTotal',
            args: [pid],
          }),
          publicClient.readContract({
            address: BETTING_ADDRESS,
            abi: BETTING_ABI,
            functionName: 'vigBps',
          }),
          publicClient.readContract({
            address: BETTING_ADDRESS,
            abi: BETTING_ABI,
            functionName: 'minBetAmount',
          }),
        ]);

        const bdResult = bd as [bigint, bigint, bigint];
        setBreakdown({
          whiteWins: formatUnits(bdResult[0], 6),
          blackWins: formatUnits(bdResult[1], 6),
          draw: formatUnits(bdResult[2], 6),
        });
        setTotalPool(formatUnits(total as bigint, 6));
        setVigBps(Number(vig));
        setMinBet(formatUnits(min as bigint, 6));

        // Fetch user's bet if connected
        if (userAddress) {
          const bet = await publicClient.readContract({
            address: BETTING_ADDRESS,
            abi: BETTING_ABI,
            functionName: 'getBet',
            args: [pid, userAddress],
          }) as [number, bigint, boolean];

          const betAmount = bet[1];
          if (betAmount > BigInt(0)) {
            setUserBet({
              prediction: Number(bet[0]),
              predictionName: PREDICTION_NAMES[Number(bet[0])] || 'Unknown',
              amount: formatUnits(betAmount, 6),
              claimed: bet[2],
            });
          } else {
            setUserBet(null);
          }
        }
      } catch (e) {
        console.error('Failed to fetch betting pool:', e);
      } finally {
        setLoading(false);
      }
    }

    fetchPool();
  }, [tournamentId, round, gameIndex, userAddress, fetchTrigger]);

  // Compute implied odds
  const total = parseFloat(totalPool) || 0;
  const impliedOdds = {
    white: total > 0 ? (parseFloat(breakdown?.whiteWins || '0') / total) * 100 : 33.3,
    black: total > 0 ? (parseFloat(breakdown?.blackWins || '0') / total) * 100 : 33.3,
    draw: total > 0 ? (parseFloat(breakdown?.draw || '0') / total) * 100 : 33.3,
  };

  // Actions
  const placeBet = useCallback(async (prediction: number, amountUsdc: string) => {
    if (!poolId || !BETTING_ADDRESS) return;
    const amount = parseUnits(amountUsdc, 6);

    // Approve USDC first
    await writeContractAsync({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [BETTING_ADDRESS, amount],
    });

    // Place bet
    await writeContractAsync({
      address: BETTING_ADDRESS,
      abi: BETTING_ABI,
      functionName: 'placeBet',
      args: [poolId, prediction, amount],
    });

    refetch();
  }, [poolId, writeContractAsync, refetch]);

  const claimWinnings = useCallback(async () => {
    if (!poolId || !BETTING_ADDRESS) return;
    await writeContractAsync({
      address: BETTING_ADDRESS,
      abi: BETTING_ABI,
      functionName: 'claimWinnings',
      args: [poolId],
    });
    refetch();
  }, [poolId, writeContractAsync, refetch]);

  const claimRefund = useCallback(async () => {
    if (!poolId || !BETTING_ADDRESS) return;
    await writeContractAsync({
      address: BETTING_ADDRESS,
      abi: BETTING_ABI,
      functionName: 'claimRefund',
      args: [poolId],
    });
    refetch();
  }, [poolId, writeContractAsync, refetch]);

  return {
    poolId,
    poolExists,
    breakdown,
    totalPool,
    vigBps,
    minBet,
    userBet,
    impliedOdds,
    loading,
    placeBet,
    claimWinnings,
    claimRefund,
    isPending,
    refetch,
  };
}
