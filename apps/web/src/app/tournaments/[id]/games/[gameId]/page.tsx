'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { GameBoard } from '@/components/GameBoard';
import { MoveList } from '@/components/MoveList';
import { LiveIndicator } from '@/components/LiveIndicator';
import { PlayerClock } from '@/components/PlayerClock';
import { SponsorBanner } from '@/components/SponsorBanner';
import { BettingPanel } from '@/components/BettingPanel';
import { useGameData } from '@/lib/hooks/useGameData';
import { useGameSocket } from '@/lib/hooks/useGameSocket';
import { CHAIN } from '@/lib/chains';
import { useSponsor } from '@/lib/hooks/useSponsor';
import { useBettingPool } from '@/lib/hooks/useBettingPool';
import { GameResultMap } from '@/lib/contracts/evm';
import { ArrowLeft, SkipBack, ChevronLeft, ChevronRight, SkipForward, Play, Pause } from 'lucide-react';
import { Chess } from 'chess.js';

/**
 * Parse game ID format: t{tournamentId}-r{round}-g{gameIndex}
 * Example: "t0-r1-g0" → { tournamentId: 0, round: 1, gameIndex: 0 }
 */
function parseGameId(gameId: string): { tournamentId: number; round: number; gameIndex: number } | null {
  const match = gameId.match(/^t(\d+)-r(\d+)-g(\d+)$/);
  if (!match) return null;
  return {
    tournamentId: parseInt(match[1]),
    round: parseInt(match[2]),
    gameIndex: parseInt(match[3]),
  };
}

function useWindowWidth() {
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);
  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  return width;
}

export default function GameViewerPage({ params }: { params: { id: string; gameId: string } }) {
  const { id, gameId } = params;
  const tournamentId = parseInt(id);
  const windowWidth = useWindowWidth();
  const boardWidth = Math.min(480, windowWidth - 32);

  // Parse game coordinates from ID
  const parsed = useMemo(() => parseGameId(gameId), [gameId]);
  const round = parsed?.round ?? 1;
  const gameIndex = parsed?.gameIndex ?? 0;

  // Chain data
  const { game: chainGame, whiteName, whiteElo, blackName, blackElo, loading: gameLoading, error: gameError } = useGameData(tournamentId, round, gameIndex);

  // Game state from gateway — enabled for live AND completed games (archive fallback provides moves for replay)
  const gameStateEnabled = chainGame !== null && (chainGame.status === 0 || chainGame.status === 1 || chainGame.status === 2);
  const liveState = useGameSocket(gameId, { enabled: gameStateEnabled, completed: chainGame?.status === 2 });

  // Sponsor data
  const { sponsor, hasSponsor, isImageUri } = useSponsor(tournamentId);

  // Betting pool
  const bettingPool = useBettingPool(tournamentId, round, gameIndex);

  // Mode detection
  const isLive = liveState.isLive || (chainGame?.status === 1);
  const isCompleted = chainGame?.status === 2;

  // PGN fallback: when primary game data has no moves, try fetching PGN and parsing moves from it
  const [pgnFallbackMoves, setPgnFallbackMoves] = useState<string[]>([]);
  useEffect(() => {
    if (!isCompleted || liveState.loading || liveState.moves.length > 0) return;
    let cancelled = false;
    fetch(`${CHAIN.gatewayUrl}/api/game/${gameId}/pgn`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then(pgn => {
        if (cancelled || !pgn.trim()) return;
        try {
          const g = new Chess();
          g.loadPgn(pgn);
          const history = g.history();
          if (history.length > 0) setPgnFallbackMoves(history);
        } catch { /* PGN parse failed, no fallback available */ }
      })
      .catch(() => { /* PGN not available */ });
    return () => { cancelled = true; };
  }, [isCompleted, liveState.loading, liveState.moves.length, gameId]);

  // Move history — prefer live moves from gateway, fall back to PGN-parsed moves
  const moves = liveState.moves.length > 0 ? liveState.moves : pgnFallbackMoves;
  const totalMoves = moves.length;

  // Replay state
  const [moveIndex, setMoveIndex] = useState(-1);
  const [displayFen, setDisplayFen] = useState('start');
  const [isPlaying, setIsPlaying] = useState(false);

  // Compute last move for highlighting
  const lastMove = useMemo(() => {
    const targetIndex = isLive ? moves.length - 1 : moveIndex;
    if (targetIndex < 0 || moves.length === 0) return undefined;

    try {
      const g = new Chess();
      for (let i = 0; i <= targetIndex; i++) {
        g.move(moves[i]);
      }
      const history = g.history({ verbose: true });
      if (history.length > 0) {
        const last = history[history.length - 1];
        return { from: last.from, to: last.to };
      }
    } catch { /* ignore parsing errors */ }
    return undefined;
  }, [isLive, moves, moveIndex]);

  // When live, show current FEN from gateway
  useEffect(() => {
    if (isLive && liveState.currentFen !== 'start') {
      setDisplayFen(liveState.currentFen);
      setMoveIndex(liveState.moves.length - 1);
    }
  }, [isLive, liveState.currentFen, liveState.moves.length]);

  // When transitioning from live to completed, show final position
  useEffect(() => {
    if (isCompleted && !isLive && moves.length > 0 && moveIndex === -1) {
      setMoveIndex(moves.length - 1);
      const g = new Chess();
      for (const m of moves) g.move(m);
      setDisplayFen(g.fen());
    }
  }, [isCompleted, isLive, moves, moveIndex]);

  // Replay navigation
  const goToMove = useCallback((index: number) => {
    if (moves.length === 0) return;
    const clamped = Math.max(-1, Math.min(index, totalMoves - 1));
    setMoveIndex(clamped);

    if (clamped === -1) {
      setDisplayFen('start');
      return;
    }

    const replay = new Chess();
    for (let i = 0; i <= clamped; i++) {
      replay.move(moves[i]);
    }
    setDisplayFen(replay.fen());
  }, [moves, totalMoves]);

  // Auto-play for replay
  useEffect(() => {
    if (!isPlaying || isLive) return;
    if (moveIndex >= totalMoves - 1) { setIsPlaying(false); return; }
    const timer = setTimeout(() => goToMove(moveIndex + 1), 800);
    return () => clearTimeout(timer);
  }, [isPlaying, isLive, moveIndex, totalMoves, goToMove]);

  // Determine whose turn it is (for clock highlighting)
  const isWhiteTurn = useMemo(() => {
    if (!displayFen || displayFen === 'start') return true;
    return displayFen.includes(' w ');
  }, [displayFen]);

  // Result display
  const resultText = useMemo(() => {
    if (chainGame?.result && chainGame.result > 0) {
      const name = GameResultMap[chainGame.result as keyof typeof GameResultMap];
      if (name === 'WhiteWins' || name === 'BlackForfeit') return '1 - 0';
      if (name === 'BlackWins' || name === 'WhiteForfeit') return '0 - 1';
      if (name === 'Draw') return '½ - ½';
    }
    if (liveState.gameResult && liveState.gameResult !== 'undecided') {
      return liveState.gameResult;
    }
    return isLive ? 'In Progress' : '';
  }, [chainGame?.result, liveState.gameResult, isLive]);

  // Loading state
  if (gameLoading) {
    return (
      <div>
        <Link href={`/tournaments/${id}`} className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to tournament
        </Link>
        <div className="text-center py-16 text-gray-500">Loading game from Monad...</div>
      </div>
    );
  }

  if (gameError || !chainGame) {
    return (
      <div>
        <Link href={`/tournaments/${id}`} className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to tournament
        </Link>
        <div className="text-center py-16 text-gray-500">{gameError || 'Game not found'}</div>
      </div>
    );
  }

  return (
    <div>
      {/* Sponsor Banner — full width at top */}
      {hasSponsor && sponsor && (
        <div className="-mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 mb-4 bg-chess-surface/80 border-b border-chess-border/50">
          <SponsorBanner name={sponsor.name} uri={sponsor.uri} amount={sponsor.amount} isImageUri={isImageUri} />
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <Link href={`/tournaments/${id}`} className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> Back to tournament
        </Link>
        <LiveIndicator isLive={isLive} />
      </div>

      <h1 className="text-2xl font-bold mb-1">
        Round {round}, Game {gameIndex + 1}
      </h1>
      <p className="text-gray-400 mb-6">
        Tournament #{id}
        {resultText && <span className="ml-2 text-chess-gold font-medium">&middot; {resultText}</span>}
      </p>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left Column: Board Area */}
        <div className="flex flex-col items-center gap-3">
          {/* Black player clock (top) */}
          <div className="w-full" style={{ maxWidth: boardWidth }}>
            <PlayerClock
              name={blackName || 'Black'}
              elo={blackElo}
              timeMs={liveState.blackTimeMs}
              isActive={!isWhiteTurn}
              isLive={isLive}
              color="black"
              result={chainGame.resultName}
            />
          </div>

          {/* Board */}
          <GameBoard
            fen={displayFen}
            boardWidth={boardWidth}
            lastMove={lastMove}
          />

          {/* White player clock (bottom) */}
          <div className="w-full" style={{ maxWidth: boardWidth }}>
            <PlayerClock
              name={whiteName || 'White'}
              elo={whiteElo}
              timeMs={liveState.whiteTimeMs}
              isActive={isWhiteTurn}
              isLive={isLive}
              color="white"
              result={chainGame.resultName}
            />
          </div>

          {/* Replay controls — only in replay mode with moves */}
          {!isLive && totalMoves > 0 && (
            <div className="flex items-center gap-2">
              <button onClick={() => goToMove(-1)} className="p-2 rounded hover:bg-chess-border/50" title="Start">
                <SkipBack className="w-4 h-4" />
              </button>
              <button onClick={() => goToMove(moveIndex - 1)} className="p-2 rounded hover:bg-chess-border/50" title="Back">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  if (moveIndex >= totalMoves - 1) {
                    // At end — reset to start and auto-play
                    goToMove(-1);
                    setTimeout(() => setIsPlaying(true), 100);
                  } else {
                    setIsPlaying(!isPlaying);
                  }
                }}
                className="p-2 rounded bg-chess-accent/20 hover:bg-chess-accent/30"
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <button onClick={() => goToMove(moveIndex + 1)} className="p-2 rounded hover:bg-chess-border/50" title="Forward">
                <ChevronRight className="w-4 h-4" />
              </button>
              <button onClick={() => goToMove(totalMoves - 1)} className="p-2 rounded hover:bg-chess-border/50" title="End">
                <SkipForward className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Sidebar */}
        <div className="flex-1 space-y-4 min-w-0">
          {/* Move List */}
          {totalMoves > 0 && (
            <MoveList
              moves={moves}
              currentMoveIndex={moveIndex}
              onMoveClick={isLive ? undefined : goToMove}
            />
          )}
          {totalMoves === 0 && isLive && (
            <div className="bg-chess-surface border border-chess-border rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">Moves</h3>
              <p className="text-sm text-gray-500">Waiting for first move...</p>
            </div>
          )}
          {totalMoves === 0 && !isLive && chainGame.status === 0 && (
            <div className="bg-chess-surface border border-chess-border rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">Moves</h3>
              <p className="text-sm text-gray-500">Game has not started yet.</p>
            </div>
          )}
          {totalMoves === 0 && !isLive && isCompleted && liveState.loading && (
            <div className="bg-chess-surface border border-chess-border rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">Moves</h3>
              <p className="text-sm text-gray-500">Loading replay data...</p>
            </div>
          )}
          {totalMoves === 0 && !isLive && isCompleted && !liveState.loading && (
            <div className="bg-chess-surface border border-chess-border rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">Moves</h3>
              <p className="text-sm text-gray-500">Move data not available for this game.</p>
            </div>
          )}

          {/* Betting Panel */}
          <BettingPanel
            pool={bettingPool}
            gameStatus={chainGame.status}
            gameResult={chainGame.result}
          />

          {/* Game Info Card */}
          <div className="bg-chess-surface border border-chess-border rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Game Info</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="text-gray-400">White</div>
              <div className="truncate">
                <Link href={`/agents/${chainGame.white}`} className="hover:text-chess-accent-light transition-colors">
                  {whiteName || chainGame.white.slice(0, 10) + '...'}
                </Link>
              </div>
              <div className="text-gray-400">Black</div>
              <div className="truncate">
                <Link href={`/agents/${chainGame.black}`} className="hover:text-chess-accent-light transition-colors">
                  {blackName || chainGame.black.slice(0, 10) + '...'}
                </Link>
              </div>
              <div className="text-gray-400">Result</div>
              <div className="text-chess-gold font-medium">{chainGame.resultName}</div>
              <div className="text-gray-400">Moves</div>
              <div>{isLive ? liveState.moveCount : chainGame.moveCount}</div>
              <div className="text-gray-400">Status</div>
              <div>
                {chainGame.status === 0 && 'Pending'}
                {chainGame.status === 1 && 'In Progress'}
                {chainGame.status === 2 && 'Completed'}
                {chainGame.status === 3 && 'Aborted'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
