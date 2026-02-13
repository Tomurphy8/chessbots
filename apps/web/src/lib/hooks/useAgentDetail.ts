'use client';

import { useState, useEffect, useCallback } from 'react';
import { CHAIN } from '@/lib/chains';

export interface AgentDetail {
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
 * Fetches a single agent's data from the gateway API.
 */
export function useAgentDetail(wallet: string | null) {
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgent = useCallback(async () => {
    if (!wallet) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(`${CHAIN.gatewayUrl}/api/agents/${wallet}`);
      if (res.status === 404) {
        setAgent(null);
        setError('Agent not found');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      setAgent(data.agent || data);
      setError(null);
    } catch (e: any) {
      console.error('Failed to fetch agent detail:', e);
      setError('Failed to load agent data');
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    fetchAgent();
  }, [fetchAgent]);

  return { agent, loading, error, refresh: fetchAgent };
}
