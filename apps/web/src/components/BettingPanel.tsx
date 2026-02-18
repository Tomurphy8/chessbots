'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { cn } from '@/lib/utils';
import type { BettingPoolResult } from '@/lib/hooks/useBettingPool';

interface BettingPanelProps {
  pool: BettingPoolResult;
  gameStatus: number; // 0=Pending, 1=InProgress, 2=Completed, 3=Aborted
  gameResult?: number; // 0=Undecided, 1=WhiteWins, 2=BlackWins, 3=Draw, etc.
}

const PREDICTIONS = [
  { id: 0, label: '♔ White', shortLabel: 'White' },
  { id: 1, label: '♚ Black', shortLabel: 'Black' },
  { id: 2, label: '½ Draw', shortLabel: 'Draw' },
] as const;

function PoolBar({ breakdown, total }: { breakdown: { whiteWins: string; blackWins: string; draw: string }; total: number }) {
  if (total <= 0) {
    return (
      <div className="w-full h-5 rounded-full bg-chess-border/30 overflow-hidden">
        <div className="h-full w-full flex">
          <div className="flex-1 bg-gray-600/30" />
          <div className="flex-1 bg-gray-500/30" />
          <div className="flex-1 bg-gray-400/30" />
        </div>
      </div>
    );
  }

  const white = parseFloat(breakdown.whiteWins);
  const black = parseFloat(breakdown.blackWins);
  const draw = parseFloat(breakdown.draw);
  const wPct = (white / total) * 100;
  const bPct = (black / total) * 100;
  const dPct = (draw / total) * 100;

  return (
    <div className="w-full h-5 rounded-full overflow-hidden flex">
      {wPct > 0 && (
        <div
          className="bg-gray-200 transition-all duration-300"
          style={{ width: `${wPct}%` }}
          title={`White: ${white.toFixed(2)} USDC`}
        />
      )}
      {dPct > 0 && (
        <div
          className="bg-gray-500 transition-all duration-300"
          style={{ width: `${dPct}%` }}
          title={`Draw: ${draw.toFixed(2)} USDC`}
        />
      )}
      {bPct > 0 && (
        <div
          className="bg-gray-800 transition-all duration-300"
          style={{ width: `${bPct}%` }}
          title={`Black: ${black.toFixed(2)} USDC`}
        />
      )}
    </div>
  );
}

export function BettingPanel({ pool, gameStatus, gameResult }: BettingPanelProps) {
  const { address } = useAccount();
  const [selectedPrediction, setSelectedPrediction] = useState<number | null>(null);
  const [betAmount, setBetAmount] = useState('');
  const [error, setError] = useState('');

  // If no market exists, offer to create one
  if (!pool.poolExists && !pool.loading) {
    return (
      <div className="bg-chess-surface border border-chess-border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">Betting</h3>
        {address && gameStatus < 2 ? (
          <div className="space-y-2">
            <p className="text-sm text-gray-500">No betting market for this game yet.</p>
            <button
              onClick={async () => {
                setError('');
                try {
                  await pool.createMarket();
                } catch (e: any) {
                  setError(e.message?.includes('User rejected') ? 'Transaction cancelled' : 'Failed to create market');
                }
              }}
              disabled={pool.isPending}
              className="w-full py-2 rounded-lg text-sm font-medium bg-chess-accent hover:bg-chess-accent/80 text-white transition-colors"
            >
              {pool.isPending ? 'Creating...' : 'Create Market (5 USDC bond)'}
            </button>
            <p className="text-xs text-gray-500 text-center">Bond is returned when the market resolves</p>
            {error && <p className="text-xs text-red-400 text-center">{error}</p>}
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            {gameStatus >= 2 ? 'Game has ended — no market was created.' : 'Connect wallet to create a betting market.'}
          </p>
        )}
      </div>
    );
  }

  if (pool.loading) {
    return (
      <div className="bg-chess-surface border border-chess-border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">Betting</h3>
        <p className="text-sm text-gray-500">Loading pool data...</p>
      </div>
    );
  }

  const total = parseFloat(pool.totalPool);
  // V2: also check market status (0=Open, 1=Resolved, 2=Voided)
  const mStatus = 'marketStatus' in pool ? (pool as any).marketStatus : undefined;
  const isPoolOpen = gameStatus < 2 && (mStatus === undefined || mStatus === 0);
  const isSettled = gameStatus === 2 || mStatus === 1;
  const isCancelled = gameStatus === 3 || mStatus === 2;

  // Determine if user won
  const userWon = pool.userBet && isSettled && gameResult !== undefined && (
    (gameResult === 1 && pool.userBet.prediction === 0) || // WhiteWins
    (gameResult === 2 && pool.userBet.prediction === 1) || // BlackWins
    (gameResult === 3 && pool.userBet.prediction === 2) || // Draw
    (gameResult === 5 && pool.userBet.prediction === 0) || // BlackForfeit = White wins
    (gameResult === 4 && pool.userBet.prediction === 1)    // WhiteForfeit = Black wins
  );

  async function handlePlaceBet() {
    if (selectedPrediction === null || !betAmount) return;
    setError('');

    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount < parseFloat(pool.minBet)) {
      setError(`Minimum bet is ${pool.minBet} USDC`);
      return;
    }

    try {
      await pool.placeBet(selectedPrediction, betAmount);
      setBetAmount('');
      setSelectedPrediction(null);
    } catch (e: any) {
      setError(e.message?.includes('User rejected') ? 'Transaction cancelled' : 'Failed to place bet');
    }
  }

  async function handleClaim() {
    setError('');
    try {
      await pool.claimWinnings();
    } catch (e: any) {
      setError('Failed to claim');
    }
  }

  async function handleRefund() {
    setError('');
    try {
      await pool.claimRefund();
    } catch (e: any) {
      setError('Failed to claim refund');
    }
  }

  return (
    <div className="bg-chess-surface border border-chess-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Betting Pool</h3>
        <span className="text-xs text-gray-500">{pool.vigBps / 100}% vig</span>
      </div>

      {/* Pool breakdown bar */}
      {pool.breakdown && (
        <>
          <PoolBar breakdown={pool.breakdown} total={total} />
          <div className="flex justify-between text-xs text-gray-400">
            <span>♔ {parseFloat(pool.breakdown.whiteWins).toFixed(2)}</span>
            <span>½ {parseFloat(pool.breakdown.draw).toFixed(2)}</span>
            <span>♚ {parseFloat(pool.breakdown.blackWins).toFixed(2)}</span>
          </div>
        </>
      )}

      {/* Total pool */}
      <div className="flex justify-between text-sm">
        <span className="text-gray-400">Total Pool</span>
        <span className="font-medium">{total.toFixed(2)} USDC</span>
      </div>

      {/* Implied odds */}
      <div className="flex justify-between text-xs text-gray-500">
        <span>White {pool.impliedOdds.white.toFixed(1)}%</span>
        <span>Draw {pool.impliedOdds.draw.toFixed(1)}%</span>
        <span>Black {pool.impliedOdds.black.toFixed(1)}%</span>
      </div>

      {/* User's existing bet */}
      {pool.userBet && (
        <div className={cn(
          'rounded-lg px-3 py-2 text-sm',
          userWon ? 'bg-green-900/30 border border-green-700/40' :
          isSettled && !userWon ? 'bg-red-900/20 border border-red-700/30' :
          'bg-chess-accent/10 border border-chess-accent/20'
        )}>
          <div className="flex justify-between items-center">
            <span className="text-gray-300">
              Your bet: <span className="font-medium">{parseFloat(pool.userBet.amount).toFixed(2)} USDC</span>
            </span>
            <span className="text-xs font-medium text-chess-accent-light">{pool.userBet.predictionName}</span>
          </div>
        </div>
      )}

      {/* Actions based on state */}
      {!address && isPoolOpen && (
        <p className="text-sm text-gray-500 text-center py-2">Connect wallet to place a bet</p>
      )}

      {address && isPoolOpen && !pool.userBet && (
        <div className="space-y-2">
          {/* Prediction buttons */}
          <div className="grid grid-cols-3 gap-1.5">
            {PREDICTIONS.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedPrediction(p.id)}
                className={cn(
                  'text-xs py-2 rounded-lg border transition-colors font-medium',
                  selectedPrediction === p.id
                    ? 'bg-chess-accent/20 border-chess-accent text-chess-accent-light'
                    : 'border-chess-border hover:border-chess-border/80 text-gray-300 hover:text-white',
                )}
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
                placeholder={`Min ${pool.minBet}`}
                min={pool.minBet}
                step="0.01"
                className="w-full bg-chess-dark border border-chess-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-chess-accent text-white placeholder-gray-500"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">USDC</span>
            </div>
          </div>

          {/* Place bet button */}
          <button
            onClick={handlePlaceBet}
            disabled={selectedPrediction === null || !betAmount || pool.isPending}
            className={cn(
              'w-full py-2.5 rounded-lg text-sm font-medium transition-colors',
              selectedPrediction !== null && betAmount
                ? 'bg-chess-accent hover:bg-chess-accent/80 text-white'
                : 'bg-chess-border/50 text-gray-500 cursor-not-allowed',
            )}
          >
            {pool.isPending ? 'Confirming...' : 'Place Bet'}
          </button>
        </div>
      )}

      {/* Claim winnings */}
      {userWon && !pool.userBet?.claimed && (
        <button
          onClick={handleClaim}
          disabled={pool.isPending}
          className="w-full py-2.5 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-500 text-white transition-colors"
        >
          {pool.isPending ? 'Claiming...' : 'Claim Winnings'}
        </button>
      )}

      {/* Settled, lost */}
      {isSettled && pool.userBet && !userWon && !pool.userBet.claimed && (
        <p className="text-sm text-gray-500 text-center py-1">Better luck next time</p>
      )}

      {/* Already claimed */}
      {pool.userBet?.claimed && (
        <p className="text-xs text-gray-500 text-center">Claimed</p>
      )}

      {/* Cancelled — refund */}
      {isCancelled && pool.userBet && !pool.userBet.claimed && (
        <button
          onClick={handleRefund}
          disabled={pool.isPending}
          className="w-full py-2.5 rounded-lg text-sm font-medium bg-chess-accent hover:bg-chess-accent/80 text-white transition-colors"
        >
          {pool.isPending ? 'Claiming...' : 'Claim Refund'}
        </button>
      )}

      {/* Error display */}
      {error && <p className="text-xs text-red-400 text-center">{error}</p>}
    </div>
  );
}
