'use client';

import { useState, useEffect } from 'react';
import { createPublicClient, http, type Address, defineChain } from 'viem';
import { CHAIN } from '@/lib/chains';
import { CHESSBOTS_ABI, GameResultMap } from '@/lib/contracts/evm';

const monadTestnet = defineChain({
  id: CHAIN.evmChainId,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [CHAIN.rpcUrl] } },
});

const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(CHAIN.rpcUrl),
});

const CONTRACT = CHAIN.contractAddress as Address;

export interface GameChainData {
  tournamentId: number;
  round: number;
  gameIndex: number;
  white: string;
  black: string;
  status: number;       // 0=Pending, 1=InProgress, 2=Completed, 3=Aborted
  result: number;       // 0=Undecided, 1=WhiteWins, ...
  resultName: string;
  moveCount: number;
  exists: boolean;
}

export interface GameDataResult {
  game: GameChainData | null;
  whiteName: string;
  whiteElo: number;
  blackName: string;
  blackElo: number;
  loading: boolean;
  error: string | null;
}

export function useGameData(tournamentId: number, round: number, gameIndex: number): GameDataResult {
  const [game, setGame] = useState<GameChainData | null>(null);
  const [whiteName, setWhiteName] = useState('');
  const [whiteElo, setWhiteElo] = useState(0);
  const [blackName, setBlackName] = useState('');
  const [blackElo, setBlackElo] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        const gameData = await publicClient.readContract({
          address: CONTRACT,
          abi: CHESSBOTS_ABI,
          functionName: 'getGame',
          args: [BigInt(tournamentId), round, gameIndex],
        }) as any;

        if (!gameData.exists) {
          setError('Game not found');
          setGame(null);
          setLoading(false);
          return;
        }

        const gameInfo: GameChainData = {
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
        };
        setGame(gameInfo);

        // Fetch agent names in parallel
        const [whiteAgent, blackAgent] = await Promise.all([
          publicClient.readContract({
            address: CONTRACT,
            abi: CHESSBOTS_ABI,
            functionName: 'getAgent',
            args: [gameData.white as Address],
          }).catch(() => null),
          publicClient.readContract({
            address: CONTRACT,
            abi: CHESSBOTS_ABI,
            functionName: 'getAgent',
            args: [gameData.black as Address],
          }).catch(() => null),
        ]);

        if (whiteAgent) {
          const wa = whiteAgent as any;
          setWhiteName(wa.name || '');
          setWhiteElo(Number(wa.eloRating || 0));
        }
        if (blackAgent) {
          const ba = blackAgent as any;
          setBlackName(ba.name || '');
          setBlackElo(Number(ba.eloRating || 0));
        }
      } catch (e) {
        console.error('Failed to fetch game data:', e);
        setError('Failed to load game');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [tournamentId, round, gameIndex]);

  return { game, whiteName, whiteElo, blackName, blackElo, loading, error };
}
