'use client';

import { useState, useEffect, useCallback } from 'react';
import { CHAIN } from '@/lib/chains';

export interface LeaderboardEntry {
  wallet: string;
  name: string;
  referralCount: number;
  totalEarnings: string;
  tier: string;
}

export function useReferralLeaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  const refetch = useCallback(() => setFetchTrigger(t => t + 1), []);

  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`${CHAIN.gatewayUrl}/api/referral-leaderboard`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setEntries(data);
      } catch (e: any) {
        console.error('Failed to fetch referral leaderboard:', e);
        setError(e.message || 'Failed to load leaderboard');
        setEntries([]);
      } finally {
        setLoading(false);
      }
    }

    fetchLeaderboard();
  }, [fetchTrigger]);

  return { entries, loading, error, refetch };
}
