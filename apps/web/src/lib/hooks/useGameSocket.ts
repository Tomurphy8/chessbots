'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';
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

const INITIAL_STATE: LiveGameState = {
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
};

/**
 * Connects to the gateway's /spectator WebSocket namespace for real-time game updates.
 * Falls back to HTTP polling if WebSocket fails to connect within 5 seconds.
 */
export function useGameSocket(gameId: string | null, options?: { enabled?: boolean; completed?: boolean }): LiveGameState {
  const [state, setState] = useState<LiveGameState>(INITIAL_STATE);
  const enabled = options?.enabled !== false;
  const completed = options?.completed === true;
  const socketRef = useRef<Socket | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const usingPollingRef = useRef(false);

  // HTTP polling fallback
  const fetchGameState = useCallback(async () => {
    if (!gameId) return;
    try {
      const res = await fetch(`${CHAIN.gatewayUrl}/api/game/${gameId}`);
      if (res.status === 404) {
        setState(prev => ({ ...prev, loading: false, error: null, gameStatus: 'not_found' }));
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

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

  // Start HTTP polling fallback
  const startPolling = useCallback(() => {
    if (usingPollingRef.current || !gameId) return;
    usingPollingRef.current = true;
    console.log('[useGameSocket] Falling back to HTTP polling');
    fetchGameState();
    intervalRef.current = setInterval(fetchGameState, 2000);
  }, [gameId, fetchGameState]);

  useEffect(() => {
    if (!gameId || !enabled) {
      setState(INITIAL_STATE);
      return;
    }

    // Reset state on new gameId
    setState(INITIAL_STATE);
    usingPollingRef.current = false;

    // For completed games, skip WebSocket — just fetch once from the archive
    if (completed) {
      fetchGameState();
      return;
    }

    // Try WebSocket first
    const socket = io(`${CHAIN.gatewayUrl}/spectator`, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: 5,
      timeout: 5000,
    });

    socketRef.current = socket;

    // Connection timeout — fall back to polling after 5s
    const connectTimeout = setTimeout(() => {
      if (!socket.connected && !usingPollingRef.current) {
        console.warn('[useGameSocket] WebSocket connection timeout, falling back to polling');
        socket.disconnect();
        startPolling();
      }
    }, 5000);

    socket.on('connect', () => {
      clearTimeout(connectTimeout);
      console.log('[useGameSocket] Connected to spectator namespace');
      socket.emit('subscribe:game', gameId);

      // Do an initial HTTP fetch to get current state, since WS only pushes deltas
      fetchGameState();
    });

    socket.on('connect_error', (err) => {
      console.warn('[useGameSocket] WebSocket connect error:', err.message);
      // Fall back to polling on connection failure
      if (!usingPollingRef.current) {
        clearTimeout(connectTimeout);
        socket.disconnect();
        startPolling();
      }
    });

    // Real-time game events
    socket.on('game:started', (data: any) => {
      if (data.gameId !== gameId) return;
      setState(prev => ({
        ...prev,
        isLive: true,
        gameStatus: 'in_progress',
        loading: false,
      }));
    });

    socket.on('game:move', (data: any) => {
      if (data.gameId !== gameId) return;
      setState(prev => ({
        ...prev,
        isLive: true,
        currentFen: data.fen || prev.currentFen,
        moves: data.moves || [...prev.moves, data.move].filter(Boolean),
        whiteTimeMs: data.whiteTimeMs ?? prev.whiteTimeMs,
        blackTimeMs: data.blackTimeMs ?? prev.blackTimeMs,
        moveCount: data.moveCount ?? (prev.moveCount + 1),
        gameStatus: 'in_progress',
        loading: false,
      }));
    });

    socket.on('game:ended', (data: any) => {
      if (data.gameId !== gameId) return;
      setState(prev => ({
        ...prev,
        isLive: false,
        currentFen: data.fen || prev.currentFen,
        moves: data.moves || prev.moves,
        gameStatus: 'completed',
        gameResult: data.result || prev.gameResult,
        loading: false,
      }));
    });

    return () => {
      clearTimeout(connectTimeout);
      socket.disconnect();
      socketRef.current = null;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      usingPollingRef.current = false;
    };
  }, [gameId, enabled, completed, fetchGameState, startPolling]);

  return state;
}
