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

export interface AgentGame {
  gameId: string;
  tournamentId: number;
  round: number;
  gameIndex: number;
  white: string;
  black: string;
  result: string;
  moveCount: number;
  archivedAt: number;
}

/**
 * Fetches a single agent's data from the gateway API.
 */
export function useAgentDetail(wallet: string | null) {
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [games, setGames] = useState<AgentGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgent = useCallback(async () => {
    if (!wallet) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Fetch agent profile and game history in parallel
      const [agentRes, gamesRes] = await Promise.all([
        fetch(`${CHAIN.gatewayUrl}/api/agents/${wallet}`),
        fetch(`${CHAIN.gatewayUrl}/api/agents/${wallet}/games`),
      ]);

      if (agentRes.status === 404) {
        setAgent(null);
        setError('Agent not found');
        return;
      }
      if (!agentRes.ok) throw new Error(`HTTP ${agentRes.status}`);

      const agentData = await agentRes.json();
      setAgent(agentData.agent || agentData);

      if (gamesRes.ok) {
        const gamesData = await gamesRes.json();
        setGames(gamesData.games || []);
      }

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

  return { agent, games, loading, error, refresh: fetchAgent };
}
