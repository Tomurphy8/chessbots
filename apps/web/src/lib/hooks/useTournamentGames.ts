'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPublicClient, http, type Address, defineChain } from 'viem';
import { CHAIN } from '@/lib/chains';
import { CHESSBOTS_ABI, GameResultMap } from '@/lib/contracts/evm';

const monad = defineChain({
  id: CHAIN.evmChainId,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [CHAIN.rpcUrl] } },
});

const publicClient = createPublicClient({
  chain: monad,
  transport: http(CHAIN.rpcUrl),
});

const CONTRACT = CHAIN.contractAddress as Address;

export interface TournamentGame {
  gameId: string;
  tournamentId: number;
  round: number;
  gameIndex: number;
  white: string;
  black: string;
  status: number;
  result: number;
  resultName: string;
  moveCount: number;
  exists: boolean;
}

/**
 * Fetches all games for a tournament from on-chain data.
 * Iterates rounds (1 to currentRound) and game indices (0 to gamesPerRound-1).
 */
export function useTournamentGames(
  tournamentId: number,
  currentRound: number,
  registeredCount: number,
  enabled: boolean = true,
) {
  const [games, setGames] = useState<TournamentGame[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGames = useCallback(async () => {
    if (!enabled || currentRound === 0) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const gamesPerRound = Math.floor(registeredCount / 2);
      if (gamesPerRound === 0) { setLoading(false); return; }

      const allGames: TournamentGame[] = [];

      for (let round = 1; round <= currentRound; round++) {
        // Fetch all games in this round in parallel
        const promises = Array.from({ length: gamesPerRound }, (_, gi) =>
          publicClient.readContract({
            address: CONTRACT,
            abi: CHESSBOTS_ABI,
            functionName: 'getGame',
            args: [BigInt(tournamentId), round, gi],
          }).catch(() => null)
        );

        const results = await Promise.all(promises);

        for (const gameData of results) {
          if (!gameData || !gameData.exists) continue;
          allGames.push({
            gameId: `t${tournamentId}-r${gameData.round}-g${gameData.gameIndex}`,
            tournamentId: Number(gameData.tournamentId),
            round: Number(gameData.round),
            gameIndex: Number(gameData.gameIndex),
            white: gameData.white,
            black: gameData.black,
            status: Number(gameData.status),
            result: Number(gameData.result),
            resultName: GameResultMap[Number(gameData.result) as keyof typeof GameResultMap] || 'Undecided',
            moveCount: Number(gameData.moveCount),
            exists: gameData.exists,
          });
        }
      }

      setGames(allGames);
    } catch (e) {
      console.error('Failed to fetch tournament games:', e);
    } finally {
      setLoading(false);
    }
  }, [tournamentId, currentRound, registeredCount, enabled]);

  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  return { games, loading, refresh: fetchGames };
}
