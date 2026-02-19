'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { CHAIN } from '@/lib/chains';

const AGENTS_POLL_INTERVAL = 30_000; // 30 seconds

export interface IndexedAgent {
  wallet: string;
  name: string;
  agentType: string;
  eloRating: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesDrawn: number;
  gamesLost: number;
  totalEarnings: number;
  winRate: number;
  registered: boolean;
}

/**
 * Fetches all indexed agents from the gateway API.
 * Returns agents sorted by computed Elo rating.
 * Auto-polls every 30 seconds for live leaderboard updates.
 */
export function useAgents() {
  const [agents, setAgents] = useState<IndexedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isInitialLoad = useRef(true);

  const fetchAgents = useCallback(async () => {
    try {
      // Only show loading skeleton on initial fetch, not re-polls
      if (isInitialLoad.current) setLoading(true);

      const res = await fetch(`${CHAIN.gatewayUrl}/api/agents`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      setAgents(data.agents || []);
      setReady(data.ready !== false);
      setError(null);
    } catch (e: any) {
      console.error('Failed to fetch agents:', e);
      setError('Failed to load agent leaderboard');
    } finally {
      setLoading(false);
      isInitialLoad.current = false;
    }
  }, []);

  useEffect(() => {
    fetchAgents();

    // Poll every 30s for live leaderboard updates
    intervalRef.current = setInterval(fetchAgents, AGENTS_POLL_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchAgents]);

  return { agents, loading, ready, error, refresh: fetchAgents };
}
