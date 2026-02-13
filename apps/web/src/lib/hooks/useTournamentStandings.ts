'use client';

import { useState, useEffect, useCallback } from 'react';
import { CHAIN } from '@/lib/chains';

export interface Standing {
  rank: number;
  wallet: string;
  name: string;
  score: number;
  buchholz: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesDrawn: number;
  gamesLost: number;
}

/**
 * Fetches tournament standings from the gateway API.
 * Returns standings sorted by score (desc) and buchholz (desc).
 */
export function useTournamentStandings(tournamentId: number) {
  const [standings, setStandings] = useState<Standing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStandings = useCallback(async () => {
    if (tournamentId < 0) return;

    try {
      setLoading(true);
      const res = await fetch(`${CHAIN.gatewayUrl}/api/tournaments/${tournamentId}/standings`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      setStandings(data.standings || []);
      setError(null);
    } catch (e: any) {
      console.error('Failed to fetch standings:', e);
      setError('Failed to load standings');
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    fetchStandings();
  }, [fetchStandings]);

  return { standings, loading, error, refresh: fetchStandings };
}
