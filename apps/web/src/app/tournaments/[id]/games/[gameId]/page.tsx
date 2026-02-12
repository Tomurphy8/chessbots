'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { GameBoard } from '@/components/GameBoard';
import { MoveList } from '@/components/MoveList';
import { shortenAddress } from '@/lib/utils';
import { ArrowLeft, SkipBack, ChevronLeft, ChevronRight, SkipForward, Play, Pause, Download } from 'lucide-react';
import { Chess } from 'chess.js';

const MOCK_PGN = `[Event "ChessBots Tournament #2"]
[Site "Solana Devnet"]
[Date "2026.02.09"]
[Round "3"]
[White "DeepClaw-v3"]
[Black "NeuralKnight"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 1-0`;

export default function GameViewerPage({ params }: { params: { id: string; gameId: string } }) {
  const [game] = useState(() => {
    const g = new Chess();
    g.loadPgn(MOCK_PGN);
    return g;
  });
  const [moveIndex, setMoveIndex] = useState(-1);
  const [displayFen, setDisplayFen] = useState('start');
  const [isPlaying, setIsPlaying] = useState(false);

  const history = game.history();
  const totalMoves = history.length;

  const goToMove = useCallback((index: number) => {
    const clamped = Math.max(-1, Math.min(index, totalMoves - 1));
    setMoveIndex(clamped);
    const replay = new Chess();
    for (let i = 0; i <= clamped; i++) {
      replay.move(history[i]);
    }
    setDisplayFen(replay.fen());
  }, [history, totalMoves]);

  useEffect(() => {
    if (!isPlaying) return;
    if (moveIndex >= totalMoves - 1) { setIsPlaying(false); return; }
    const timer = setTimeout(() => goToMove(moveIndex + 1), 800);
    return () => clearTimeout(timer);
  }, [isPlaying, moveIndex, totalMoves, goToMove]);

  return (
    <div>
      <Link href={`/tournaments/${params.id}`} className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to tournament
      </Link>

      <h1 className="text-2xl font-bold mb-1">Game #{parseInt(params.gameId) + 1}</h1>
      <p className="text-gray-400 mb-6">Tournament #{params.id} &middot; Round 3</p>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Board */}
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center justify-between w-full max-w-[480px]">
            <div>
              <span className="text-sm font-medium">DeepClaw-v3</span>
              <span className="text-xs text-gray-500 ml-2">(White)</span>
            </div>
            <span className="text-sm font-bold text-chess-gold">1 - 0</span>
            <div>
              <span className="text-sm font-medium">NeuralKnight</span>
              <span className="text-xs text-gray-500 ml-2">(Black)</span>
            </div>
          </div>

          <GameBoard fen={displayFen} boardWidth={480} />

          {/* Controls */}
          <div className="flex items-center gap-2">
            <button onClick={() => goToMove(-1)} className="p-2 rounded hover:bg-chess-border/50" title="Start">
              <SkipBack className="w-4 h-4" />
            </button>
            <button onClick={() => goToMove(moveIndex - 1)} className="p-2 rounded hover:bg-chess-border/50" title="Back">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
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
        </div>

        {/* Sidebar */}
        <div className="flex-1 space-y-4">
          <MoveList moves={history} currentMoveIndex={moveIndex} onMoveClick={goToMove} />

          <div className="bg-chess-surface border border-chess-border rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Game Info</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="text-gray-400">White</div>
              <div>DeepClaw-v3</div>
              <div className="text-gray-400">Black</div>
              <div>NeuralKnight</div>
              <div className="text-gray-400">Result</div>
              <div className="text-chess-gold font-medium">White wins (1-0)</div>
              <div className="text-gray-400">Moves</div>
              <div>{totalMoves}</div>
              <div className="text-gray-400">Time Control</div>
              <div>5+3 Blitz</div>
            </div>
          </div>

          <button className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
            <Download className="w-4 h-4" />
            Download PGN
          </button>
        </div>
      </div>
    </div>
  );
}
