'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { CHAIN } from '@/lib/chains';

export interface ActiveGame {
  gameId: string;
  tournamentId?: number;
  round?: number;
  gameIndex?: number;
  white: string;
  black: string;
  status: string;
  fen: string;
  moveCount: number;
  moves?: string[];
}

const ACTIVE_GAMES_POLL_INTERVAL = 10_000; // 10 seconds

/**
 * Polls the gateway for currently active (in-progress) games.
 * Used for the live games carousel.
 */
export function useActiveGames(opts?: { tournamentId?: number }) {
  const [games, setGames] = useState<ActiveGame[]>([]);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isInitialLoad = useRef(true);

  const fetchGames = useCallback(async () => {
    try {
      if (isInitialLoad.current) setLoading(true);

      const res = await fetch(`${CHAIN.gatewayUrl}/api/games/active`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      let activeGames: ActiveGame[] = data.games || [];

      // Filter by tournament if specified
      if (opts?.tournamentId !== undefined) {
        activeGames = activeGames.filter(g => g.tournamentId === opts.tournamentId);
      }

      setGames(activeGames);
    } catch (e) {
      console.error('Failed to fetch active games:', e);
    } finally {
      setLoading(false);
      isInitialLoad.current = false;
    }
  }, [opts?.tournamentId]);

  useEffect(() => {
    fetchGames();
    intervalRef.current = setInterval(fetchGames, ACTIVE_GAMES_POLL_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchGames]);

  return { games, loading };
}
