'use client';

import { useState, useEffect, useCallback } from 'react';
import { CHAIN } from '@/lib/chains';

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
 */
export function useAgents() {
  const [agents, setAgents] = useState<IndexedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${CHAIN.gatewayUrl}/api/agents`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      setAgents(data.agents || []);
      setError(null);
    } catch (e: any) {
      console.error('Failed to fetch agents:', e);
      setError('Failed to load agent leaderboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return { agents, loading, error, refresh: fetchAgents };
}
