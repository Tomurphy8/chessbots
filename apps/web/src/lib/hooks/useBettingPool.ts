'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPublicClient, http, formatUnits, parseUnits, keccak256, encodeAbiParameters, parseAbiParameters, type Address, defineChain } from 'viem';
import { useAccount, useWriteContract } from 'wagmi';
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
  poolId: bigint | null;       // marketId in V2
  poolExists: boolean;
  breakdown: PoolBreakdown | null;
  totalPool: string;
  vigBps: number;
  minBet: string;
  userBet: UserBet | null;
  impliedOdds: { white: number; black: number; draw: number };
  loading: boolean;
  marketStatus: number;        // 0=Open, 1=Resolved, 2=Voided
  // Actions
  placeBet: (prediction: number, amountUsdc: string) => Promise<void>;
  createMarket: () => Promise<void>;
  claimWinnings: () => Promise<void>;
  claimRefund: () => Promise<void>;
  isPending: boolean;
  refetch: () => void;
}

const PREDICTION_NAMES = ['White Wins', 'Black Wins', 'Draw'];

/**
 * Compute the deterministic market key for a GameOutcome market.
 * Must match: keccak256(abi.encode("GameOutcome", tournamentId, round, gameIndex))
 */
function gameOutcomeKey(tournamentId: number, round: number, gameIndex: number): `0x${string}` {
  // Must match Solidity: keccak256(abi.encode("GameOutcome", tournamentId, round, gameIndex))
  const encoded = encodeAbiParameters(
    parseAbiParameters('string, uint256, uint8, uint8'),
    ['GameOutcome', BigInt(tournamentId), round, gameIndex],
  );
  return keccak256(encoded);
}

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
  const [marketStatus, setMarketStatus] = useState(0);

  const { writeContractAsync, isPending } = useWriteContract();

  const refetch = useCallback(() => setFetchTrigger(t => t + 1), []);

  // Compute market key
  const marketKey = useMemo(
    () => gameOutcomeKey(tournamentId, round, gameIndex),
    [tournamentId, round, gameIndex],
  );

  // Fetch market data
  useEffect(() => {
    if (!BETTING_ADDRESS) {
      setLoading(false);
      return;
    }

    async function fetchPool() {
      try {
        setLoading(true);

        // Look up market ID by key
        const [marketId, exists] = await publicClient.readContract({
          address: BETTING_ADDRESS,
          abi: BETTING_ABI,
          functionName: 'getMarketByKey',
          args: [marketKey],
        }) as [bigint, boolean];

        setPoolId(marketId);
        setPoolExists(exists);

        if (!exists) {
          setLoading(false);
          return;
        }

        // Fetch market details, outcome totals, vig, minBet in parallel
        const [market, outcomeTotals, vig, min] = await Promise.all([
          publicClient.readContract({
            address: BETTING_ADDRESS,
            abi: BETTING_ABI,
            functionName: 'getMarket',
            args: [marketId],
          }),
          publicClient.readContract({
            address: BETTING_ADDRESS,
            abi: BETTING_ABI,
            functionName: 'getMarketOutcomeTotals',
            args: [marketId],
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

        // Market is a tuple struct
        const marketData = market as {
          marketType: number;
          status: number;
          tournamentId: bigint;
          round: number;
          gameIndex: number;
          agentA: string;
          agentB: string;
          threshold: number;
          numOutcomes: number;
          winningOutcome: number;
          creator: string;
          totalPool: bigint;
          vigCollected: bigint;
          bondClaimed: boolean;
          exists: boolean;
        };

        setMarketStatus(marketData.status);
        setTotalPool(formatUnits(marketData.totalPool, 6));

        // Outcome totals is uint256[] — for GameOutcome: [white, black, draw]
        const totals = outcomeTotals as bigint[];
        setBreakdown({
          whiteWins: formatUnits(totals[0] || BigInt(0), 6),
          blackWins: formatUnits(totals[1] || BigInt(0), 6),
          draw: formatUnits(totals[2] || BigInt(0), 6),
        });

        setVigBps(Number(vig));
        setMinBet(formatUnits(min as bigint, 6));

        // Fetch user's bet if connected
        if (userAddress) {
          const bet = await publicClient.readContract({
            address: BETTING_ADDRESS,
            abi: BETTING_ABI,
            functionName: 'getBet',
            args: [marketId, userAddress],
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
        console.error('Failed to fetch betting market:', e);
      } finally {
        setLoading(false);
      }
    }

    fetchPool();
  }, [tournamentId, round, gameIndex, userAddress, fetchTrigger, marketKey]);

  // Compute implied odds
  const total = parseFloat(totalPool) || 0;
  const impliedOdds = {
    white: total > 0 ? (parseFloat(breakdown?.whiteWins || '0') / total) * 100 : 33.3,
    black: total > 0 ? (parseFloat(breakdown?.blackWins || '0') / total) * 100 : 33.3,
    draw: total > 0 ? (parseFloat(breakdown?.draw || '0') / total) * 100 : 33.3,
  };

  // Create a new GameOutcome market (requires 5 USDC bond)
  const createMarket = useCallback(async () => {
    if (!BETTING_ADDRESS) return;

    // Approve CREATION_BOND (5 USDC) first
    const bond = parseUnits('5', 6);
    await writeContractAsync({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [BETTING_ADDRESS, bond],
    });

    // Create market
    await writeContractAsync({
      address: BETTING_ADDRESS,
      abi: BETTING_ABI,
      functionName: 'createGameOutcomeMarket',
      args: [BigInt(tournamentId), round, gameIndex],
    });

    refetch();
  }, [tournamentId, round, gameIndex, writeContractAsync, refetch]);

  // Place bet — approve USDC then call placeBet with marketId
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

    // Place bet (V2 uses 'outcome' instead of 'prediction' but same uint8 index)
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
    marketStatus,
    placeBet,
    createMarket,
    claimWinnings,
    claimRefund,
    isPending,
    refetch,
  };
}
