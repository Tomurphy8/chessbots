'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { CHAIN } from '@/lib/chains';

export interface LiveGameState {
  isLive: boolean;
  currentFen: string;
  moves: string[];
  whiteTimeMs: number;
  blackTimeMs: number;
  gameStatus: string;
  gameResult: string;
  moveCount: number;
  loading: boolean;
  error: string | null;
}

/**
 * Polls the Agent Gateway API for live game state.
 * Auto-polls every 2s when game is in_progress.
 * Stops when game is completed.
 */
export function useGameSocket(gameId: string | null, options?: { enabled?: boolean }): LiveGameState {
  const [state, setState] = useState<LiveGameState>({
    isLive: false,
    currentFen: 'start',
    moves: [],
    whiteTimeMs: 0,
    blackTimeMs: 0,
    gameStatus: 'unknown',
    gameResult: 'undecided',
    moveCount: 0,
    loading: true,
    error: null,
  });

  const enabled = options?.enabled !== false;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchGameState = useCallback(async () => {
    if (!gameId) return;

    try {
      const res = await fetch(`${CHAIN.gatewayUrl}/api/game/${gameId}`);
      if (!res.ok) {
        // Game might not exist in gateway yet — that's okay
        if (res.status === 404) {
          setState(prev => ({ ...prev, loading: false, error: null, gameStatus: 'not_found' }));
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      setState({
        isLive: data.status === 'in_progress',
        currentFen: data.fen || 'start',
        moves: data.moves || [],
        whiteTimeMs: data.whiteTimeMs || 0,
        blackTimeMs: data.blackTimeMs || 0,
        gameStatus: data.status || 'unknown',
        gameResult: data.result || 'undecided',
        moveCount: data.moveCount || 0,
        loading: false,
        error: null,
      });

      // Stop polling when game is done
      if (data.status === 'completed' || data.status === 'aborted') {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    } catch (e) {
      console.error('Game socket poll error:', e);
      setState(prev => ({ ...prev, loading: false, error: 'Failed to fetch game state' }));
    }
  }, [gameId]);

  useEffect(() => {
    if (!gameId || !enabled) return;

    // Initial fetch
    fetchGameState();

    // Poll every 2s
    intervalRef.current = setInterval(fetchGameState, 2000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [gameId, enabled, fetchGameState]);

  return state;
}
