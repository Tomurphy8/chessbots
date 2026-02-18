'use client';

import { useState, useCallback } from 'react';
import { useAccount, useWriteContract } from 'wagmi';
import { type Address } from 'viem';
import { CHAIN } from '@/lib/chains';
import { CHESSBOTS_ABI } from '@/lib/contracts/evm';

const CONTRACT = CHAIN.contractAddress as Address;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

export interface CreateTournamentParams {
  format: 'swiss' | 'match' | 'league';
  tier: number;           // 0=Rookie, 1=Bronze, 2=Silver, 3=Masters, 4=Legends, 5=Free
  maxPlayers: number;
  minPlayers: number;
  baseTimeSeconds: number;
  incrementSeconds: number;
  bestOf?: number;        // Match only (1, 3, or 5)
  opponent?: string;      // Match only — optional target address
}

export interface CreateTournamentState {
  create: (params: CreateTournamentParams) => Promise<void>;
  isPending: boolean;
  error: string | null;
  success: boolean;
}

const FORMAT_MAP: Record<string, number> = {
  swiss: 0,
  match: 1,
  league: 3,
};

/**
 * Hook to create a new tournament on-chain.
 * Any registered agent can create a tournament — the orchestrator (protocol authority)
 * will pick it up automatically via the watch loop.
 */
export function useCreateTournament(): CreateTournamentState {
  const { address } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const create = useCallback(async (params: CreateTournamentParams) => {
    if (!address) {
      setError('Connect your wallet first');
      return;
    }

    try {
      setError(null);
      setSuccess(false);

      const now = Math.floor(Date.now() / 1000);
      const registrationDeadline = BigInt(now + 120); // 2 minutes
      const startTime = BigInt(now + 180);            // 3 minutes

      if (params.format === 'match') {
        // 1v1 match — use createMatchChallenge
        const opponent = params.opponent?.trim() as Address || ZERO_ADDRESS;
        await writeContractAsync({
          address: CONTRACT,
          abi: CHESSBOTS_ABI,
          functionName: 'createMatchChallenge',
          args: [
            params.tier,
            startTime,
            registrationDeadline,
            params.baseTimeSeconds,
            params.incrementSeconds,
            params.bestOf || 3,
            opponent,
          ],
        });
      } else {
        // Swiss or League — use createTournament
        const formatIndex = FORMAT_MAP[params.format] ?? 0;
        await writeContractAsync({
          address: CONTRACT,
          abi: CHESSBOTS_ABI,
          functionName: 'createTournament',
          args: [
            params.tier,
            formatIndex,
            params.maxPlayers,
            params.minPlayers,
            startTime,
            registrationDeadline,
            params.baseTimeSeconds,
            params.incrementSeconds,
          ],
        });
      }

      setSuccess(true);
    } catch (e: any) {
      setError(e.shortMessage || e.message || 'Tournament creation failed');
    }
  }, [address, writeContractAsync]);

  return {
    create,
    isPending,
    error,
    success,
  };
}
