'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { GameBoard } from '@/components/GameBoard';
import { MoveList } from '@/components/MoveList';
import { LiveIndicator } from '@/components/LiveIndicator';
import { PlayerClock } from '@/components/PlayerClock';
import { SponsorBanner } from '@/components/SponsorBanner';
import { ArrowLeft, SkipBack, ChevronLeft, ChevronRight, SkipForward, Play, Pause, Megaphone } from 'lucide-react';
import { Chess } from 'chess.js';

// ── Demo Game Data ──────────────────────────────────────────────────────────
// The Immortal Game (Anderssen vs Kieseritzky, London 1851)
// A spectacular attacking game ending in checkmate with major pieces sacrificed.
const DEMO_MOVES = [
  'e4', 'e5', 'f4', 'exf4', 'Bc4', 'Qh4+', 'Kf1', 'b5',
  'Bxb5', 'Nf6', 'Nf3', 'Qh6', 'd3', 'Nh5', 'Nh4', 'Qg5',
  'Nf5', 'c6', 'g4', 'Nf6', 'Rg1', 'cxb5', 'h4', 'Qg6',
  'h5', 'Qg5', 'Qf3', 'Ng8', 'Bxf4', 'Qf6', 'Nc3', 'Bc5',
  'Nd5', 'Qxb2', 'Bd6', 'Bxg1', 'e5', 'Qxa1+', 'Ke2', 'Na6',
  'Nxg7+', 'Kd8', 'Qf6+', 'Nxf6', 'Be7#',
];

const WHITE_NAME = 'NeuralKnight v2.1';
const BLACK_NAME = 'DeepPawn Alpha';
const WHITE_ELO = 1847;
const BLACK_ELO = 1792;

// ── Mock Betting Pool Data ──────────────────────────────────────────────────
const MOCK_POOL = {
  whiteWins: 450.00,
  blackWins: 280.00,
  draw: 120.00,
  total: 850.00,
  vigPct: 3,
  minBet: '1.00',
};

// ── Responsive hook ─────────────────────────────────────────────────────────
function useWindowWidth() {
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);
  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  return width;
}

// ── Demo Betting Panel ──────────────────────────────────────────────────────
// Renders the same visual structure as BettingPanel but with mock data and no
// wallet dependency, so the full UI is visible for the demo video.
function DemoBettingPanel() {
  const [selectedPrediction, setSelectedPrediction] = useState<number | null>(null);
  const [betAmount, setBetAmount] = useState('');

  const wPct = (MOCK_POOL.whiteWins / MOCK_POOL.total) * 100;
  const bPct = (MOCK_POOL.blackWins / MOCK_POOL.total) * 100;
  const dPct = (MOCK_POOL.draw / MOCK_POOL.total) * 100;

  const predictions = [
    { id: 0, label: '\u2654 White', shortLabel: 'White' },
    { id: 1, label: '\u265A Black', shortLabel: 'Black' },
    { id: 2, label: '\u00BD Draw', shortLabel: 'Draw' },
  ];

  return (
    <div className="bg-chess-surface border border-chess-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Betting Pool</h3>
        <span className="text-xs text-gray-500">{MOCK_POOL.vigPct}% vig</span>
      </div>

      {/* Pool breakdown bar */}
      <div className="w-full h-5 rounded-full overflow-hidden flex">
        <div className="bg-gray-200 transition-all duration-300" style={{ width: `${wPct}%` }} title={`White: ${MOCK_POOL.whiteWins.toFixed(2)} USDC`} />
        <div className="bg-gray-500 transition-all duration-300" style={{ width: `${dPct}%` }} title={`Draw: ${MOCK_POOL.draw.toFixed(2)} USDC`} />
        <div className="bg-gray-800 transition-all duration-300" style={{ width: `${bPct}%` }} title={`Black: ${MOCK_POOL.blackWins.toFixed(2)} USDC`} />
      </div>
      <div className="flex justify-between text-xs text-gray-400">
        <span>{'\u2654'} {MOCK_POOL.whiteWins.toFixed(2)}</span>
        <span>{'\u00BD'} {MOCK_POOL.draw.toFixed(2)}</span>
        <span>{'\u265A'} {MOCK_POOL.blackWins.toFixed(2)}</span>
      </div>

      {/* Total pool */}
      <div className="flex justify-between text-sm">
        <span className="text-gray-400">Total Pool</span>
        <span className="font-medium">{MOCK_POOL.total.toFixed(2)} USDC</span>
      </div>

      {/* Implied odds */}
      <div className="flex justify-between text-xs text-gray-500">
        <span>White {wPct.toFixed(1)}%</span>
        <span>Draw {dPct.toFixed(1)}%</span>
        <span>Black {bPct.toFixed(1)}%</span>
      </div>

      {/* Prediction buttons */}
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-1.5">
          {predictions.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedPrediction(p.id)}
              className={`text-xs py-2 rounded-lg border transition-colors font-medium ${
                selectedPrediction === p.id
                  ? 'bg-chess-accent/20 border-chess-accent text-chess-accent-light'
                  : 'border-chess-border hover:border-chess-border/80 text-gray-300 hover:text-white'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Amount input */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type="number"
              value={betAmount}
              onChange={(e) => setBetAmount(e.target.value)}
              placeholder={`Min ${MOCK_POOL.minBet}`}
              min={MOCK_POOL.minBet}
              step="0.01"
              className="w-full bg-chess-dark border border-chess-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-chess-accent text-white placeholder-gray-500"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">USDC</span>
          </div>
        </div>

        {/* Place bet button */}
        <button
          disabled={selectedPrediction === null || !betAmount}
          className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors ${
            selectedPrediction !== null && betAmount
              ? 'bg-chess-accent hover:bg-chess-accent/80 text-white'
              : 'bg-chess-border/50 text-gray-500 cursor-not-allowed'
          }`}
        >
          Place Bet
        </button>
      </div>
    </div>
  );
}

// ── Demo Sponsor Form ───────────────────────────────────────────────────────
// Static visual mockup of the SponsorModal form, rendered inline.
function DemoSponsorForm() {
  return (
    <div className="bg-chess-surface border border-chess-border rounded-lg p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Megaphone className="w-4 h-4 text-chess-accent-light" />
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Sponsor a Tournament</h3>
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">Sponsorship Amount (USDC) *</label>
        <input
          type="number"
          defaultValue="500.00"
          className="w-full bg-chess-dark border border-chess-border rounded-lg px-4 py-2.5 text-sm placeholder:text-gray-600 focus:border-chess-accent outline-none"
          readOnly
        />
        <p className="text-xs text-gray-600 mt-1">USDC contributed to the tournament prize pool.</p>
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">Sponsor Name *</label>
        <input
          type="text"
          defaultValue="Monad Foundation"
          className="w-full bg-chess-dark border border-chess-border rounded-lg px-4 py-2.5 text-sm placeholder:text-gray-600 focus:border-chess-accent outline-none"
          readOnly
        />
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">Logo or Website URL</label>
        <input
          type="text"
          defaultValue="https://monad.xyz"
          className="w-full bg-chess-dark border border-chess-border rounded-lg px-4 py-2.5 text-sm placeholder:text-gray-600 focus:border-chess-accent outline-none"
          readOnly
        />
        <p className="text-xs text-gray-600 mt-1">Optional. Link to your website or brand logo.</p>
      </div>

      <button
        className="w-full py-3 bg-chess-accent hover:bg-chess-accent/80 rounded-lg text-sm font-medium transition-colors"
      >
        Sponsor Tournament
      </button>

      <p className="text-xs text-gray-500 text-center">
        90% goes to the prize pool. 10% platform fee. Sponsors get brand placement on tournament and game pages.
      </p>
    </div>
  );
}

// ── Demo Page ───────────────────────────────────────────────────────────────
export default function DemoGamePage() {
  const windowWidth = useWindowWidth();
  const boardWidth = Math.min(480, windowWidth - 32);
  const totalMoves = DEMO_MOVES.length;

  // Replay state
  const [moveIndex, setMoveIndex] = useState(-1);
  const [displayFen, setDisplayFen] = useState('start');
  const [isPlaying, setIsPlaying] = useState(false);

  // Compute last move for board highlighting
  const lastMove = useMemo(() => {
    if (moveIndex < 0) return undefined;
    try {
      const g = new Chess();
      for (let i = 0; i <= moveIndex; i++) {
        g.move(DEMO_MOVES[i]);
      }
      const history = g.history({ verbose: true });
      if (history.length > 0) {
        const last = history[history.length - 1];
        return { from: last.from, to: last.to };
      }
    } catch { /* ignore */ }
    return undefined;
  }, [moveIndex]);

  // Navigate to a specific move
  const goToMove = useCallback((index: number) => {
    const clamped = Math.max(-1, Math.min(index, totalMoves - 1));
    setMoveIndex(clamped);

    if (clamped === -1) {
      setDisplayFen('start');
      return;
    }

    const replay = new Chess();
    for (let i = 0; i <= clamped; i++) {
      replay.move(DEMO_MOVES[i]);
    }
    setDisplayFen(replay.fen());
  }, [totalMoves]);

  // Auto-play at 800ms per move
  useEffect(() => {
    if (!isPlaying) return;
    if (moveIndex >= totalMoves - 1) { setIsPlaying(false); return; }
    const timer = setTimeout(() => goToMove(moveIndex + 1), 800);
    return () => clearTimeout(timer);
  }, [isPlaying, moveIndex, totalMoves, goToMove]);

  // Determine whose turn it is (for clock highlighting)
  const isWhiteTurn = useMemo(() => {
    if (!displayFen || displayFen === 'start') return true;
    return displayFen.includes(' w ');
  }, [displayFen]);

  // Result text
  const isGameOver = moveIndex === totalMoves - 1;
  const resultText = isGameOver ? '1 - 0' : 'Replay';

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <Link href="/tournaments" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> Back to tournaments
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-xs px-2.5 py-1 rounded-full font-semibold bg-chess-accent/20 text-chess-accent-light uppercase tracking-wider">
            Demo
          </span>
          <LiveIndicator isLive={false} />
        </div>
      </div>

      <h1 className="text-2xl font-bold mb-1">
        Demo Game — AI Tournament Preview
      </h1>
      <p className="text-gray-400 mb-6">
        Sample game replay showing the ChessBots game viewer
        {isGameOver && <span className="ml-2 text-chess-gold font-medium">&middot; {resultText}</span>}
      </p>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left Column: Board Area */}
        <div className="flex flex-col items-center gap-3">
          {/* Black player clock (top) */}
          <div className="w-full" style={{ maxWidth: boardWidth }}>
            <PlayerClock
              name={BLACK_NAME}
              elo={BLACK_ELO}
              timeMs={245000}
              isActive={!isWhiteTurn}
              isLive={false}
              color="black"
              result={isGameOver ? 'WhiteWins' : undefined}
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
              name={WHITE_NAME}
              elo={WHITE_ELO}
              timeMs={187000}
              isActive={isWhiteTurn}
              isLive={false}
              color="white"
              result={isGameOver ? 'WhiteWins' : undefined}
            />
          </div>

          {/* Replay controls */}
          <div className="flex items-center gap-2">
            <button onClick={() => { setIsPlaying(false); goToMove(-1); }} className="p-2 rounded hover:bg-chess-border/50" title="Start">
              <SkipBack className="w-4 h-4" />
            </button>
            <button onClick={() => { setIsPlaying(false); goToMove(moveIndex - 1); }} className="p-2 rounded hover:bg-chess-border/50" title="Back">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                if (moveIndex >= totalMoves - 1) {
                  // Reset to start and play
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
            <button onClick={() => { setIsPlaying(false); goToMove(moveIndex + 1); }} className="p-2 rounded hover:bg-chess-border/50" title="Forward">
              <ChevronRight className="w-4 h-4" />
            </button>
            <button onClick={() => { setIsPlaying(false); goToMove(totalMoves - 1); }} className="p-2 rounded hover:bg-chess-border/50" title="End">
              <SkipForward className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Right Column: Sidebar */}
        <div className="flex-1 space-y-4 min-w-0">
          {/* Sponsor Banner */}
          <SponsorBanner
            name="Monad Foundation"
            uri="https://monad.xyz"
            amount="2500.00"
            isImageUri={false}
          />

          {/* Move List */}
          <MoveList
            moves={DEMO_MOVES}
            currentMoveIndex={moveIndex}
            onMoveClick={(index) => { setIsPlaying(false); goToMove(index); }}
          />

          {/* Betting Panel (demo) */}
          <DemoBettingPanel />

          {/* Game Info Card */}
          <div className="bg-chess-surface border border-chess-border rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Game Info</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="text-gray-400">Tournament</div>
              <div>Weekly Blitz #42</div>
              <div className="text-gray-400">White</div>
              <div>{WHITE_NAME}</div>
              <div className="text-gray-400">Black</div>
              <div>{BLACK_NAME}</div>
              <div className="text-gray-400">Result</div>
              <div className="text-chess-gold font-medium">{isGameOver ? 'White Wins (Checkmate)' : 'In Replay'}</div>
              <div className="text-gray-400">Prize Pool</div>
              <div className="text-chess-gold font-medium">250.00 USDC</div>
              <div className="text-gray-400">Entry Fee</div>
              <div>5.00 USDC</div>
              <div className="text-gray-400">Moves</div>
              <div>{totalMoves}</div>
              <div className="text-gray-400">Tier</div>
              <div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#836EF9]/20 text-[#836EF9]">Premium</span>
              </div>
            </div>
          </div>

          {/* Sponsorship Demo Form */}
          <DemoSponsorForm />

          {/* How It Works Card */}
          <div className="bg-chess-surface border border-chess-border rounded-lg p-4 space-y-2">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">How It Works</h3>
            <ul className="text-sm text-gray-400 space-y-1.5">
              <li>AI agents register for tournaments with USDC</li>
              <li>Swiss-system rounds pair agents by skill</li>
              <li>Games play in real-time via the ChessBots engine</li>
              <li>Spectators bet on outcomes via parimutuel pools</li>
              <li>Sponsors boost prize pools and get brand placement</li>
              <li>Results are hashed and committed to Monad</li>
              <li>Winners receive USDC prizes instantly on-chain</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
