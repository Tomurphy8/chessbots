'use client';

import { useState, useCallback } from 'react';
import { useAccount, useWriteContract } from 'wagmi';
import { parseUnits, type Address } from 'viem';
import { CHAIN } from '@/lib/chains';
import { CHESSBOTS_ABI } from '@/lib/contracts/evm';
import { useUsdcApproval } from '@/lib/hooks/useUsdcApproval';

const CONTRACT = CHAIN.contractAddress as Address;

export interface JoinTournamentState {
  join: () => Promise<void>;
  needsApproval: boolean;
  approve: () => Promise<void>;
  isPending: boolean;
  approving: boolean;
  error: string | null;
  success: boolean;
}

/**
 * Hook to handle tournament registration with USDC approval flow.
 * @param tournamentId - The tournament ID to join
 * @param entryFee - The entry fee in USDC (already formatted, e.g. "5.00")
 */
export function useJoinTournament(tournamentId: number, entryFee: number): JoinTournamentState {
  const { address } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // USDC approval check against the main contract address
  const entryFeeStr = entryFee > 0 ? entryFee.toFixed(6) : '0';
  const approval = useUsdcApproval(CHAIN.contractAddress, entryFeeStr);

  const approve = useCallback(async () => {
    try {
      setError(null);
      // Approve slightly more than needed to avoid rounding issues
      await approval.approve(entryFeeStr);
    } catch (e: any) {
      setError(e.shortMessage || e.message || 'Approval failed');
    }
  }, [approval, entryFeeStr]);

  const join = useCallback(async () => {
    if (!address) {
      setError('Connect your wallet first');
      return;
    }

    try {
      setError(null);
      await writeContractAsync({
        address: CONTRACT,
        abi: CHESSBOTS_ABI,
        functionName: 'registerForTournament',
        args: [BigInt(tournamentId)],
      });
      setSuccess(true);
    } catch (e: any) {
      setError(e.shortMessage || e.message || 'Registration failed');
    }
  }, [address, tournamentId, writeContractAsync]);

  return {
    join,
    needsApproval: entryFee > 0 && approval.needsApproval,
    approve,
    isPending,
    approving: approval.isPending,
    error,
    success,
  };
}
