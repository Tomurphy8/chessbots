/** Basis points denominator */
export const BPS_DENOMINATOR = 10_000;

/** Swiss scoring: win = 2 half-points */
export const WIN_SCORE = 2;

/** Swiss scoring: draw = 1 half-point */
export const DRAW_SCORE = 1;

/** Swiss scoring: loss = 0 half-points */
export const LOSS_SCORE = 0;

/** Default Elo rating for new agents */
export const DEFAULT_ELO = 1200;

// ── V4: Progressive Rake ─────────────────────────────────────────────
// Higher stakes = lower rake percentage

import type { TournamentTier } from '../types/tournament.js';

export const RAKE_BPS: Record<TournamentTier, number> = {
  free: 0,
  rookie: 1000,   // 10%
  bronze: 800,    // 8%
  silver: 600,    // 6%
  masters: 500,   // 5%
  legends: 400,   // 4%
};

/** Get rake in basis points for a tier */
export function getRakeBps(tier: TournamentTier): number {
  return RAKE_BPS[tier] ?? 1000;
}

// ── V4: Dynamic Payout Tables ─────────────────────────────────────────
// Payout percentages in basis points, indexed by field size bracket

/** 8-player bracket: 3 paid positions */
export const PAYOUT_8 = [5500, 3000, 1500] as const;

/** 16-player bracket: 5 paid positions */
export const PAYOUT_16 = [4500, 2500, 1500, 1000, 500] as const;

/** 32-player bracket: 8 paid positions */
export const PAYOUT_32 = [3800, 2200, 1400, 900, 700, 500, 300, 200] as const;

/** 64-player bracket: 12 paid positions */
export const PAYOUT_64 = [3000, 1800, 1200, 900, 700, 500, 400, 350, 300, 300, 300, 250] as const;

/** Get payout structure for a given field size */
export function getPayoutStructure(fieldSize: number): readonly number[] {
  if (fieldSize <= 2) return [10000]; // winner takes all
  if (fieldSize <= 8) return PAYOUT_8;
  if (fieldSize <= 16) return PAYOUT_16;
  if (fieldSize <= 32) return PAYOUT_32;
  return PAYOUT_64;
}

/** Get number of paid positions for a given field size */
export function getPaidSlots(fieldSize: number): number {
  if (fieldSize <= 2) return 1;
  if (fieldSize <= 8) return 3;
  if (fieldSize <= 16) return 5;
  if (fieldSize <= 32) return 8;
  return 12;
}

/**
 * V4: Calculate prize distribution with dynamic payouts and progressive rake.
 */
export function calculatePrizeDistribution(totalPool: number, fieldSize: number, tier: TournamentTier) {
  const rakeBps = getRakeBps(tier);
  const protocolFee = Math.floor((totalPool * rakeBps) / BPS_DENOMINATOR);
  const playerPool = totalPool - protocolFee;

  const payoutBps = getPayoutStructure(fieldSize);
  const prizes: number[] = [];
  let distributed = 0;

  for (let i = 0; i < payoutBps.length - 1; i++) {
    const amount = Math.floor((playerPool * payoutBps[i]) / BPS_DENOMINATOR);
    prizes.push(amount);
    distributed += amount;
  }
  // Last slot absorbs rounding dust
  prizes.push(playerPool - distributed);

  // Revenue split: 80% burn, 10% season rewards, 10% treasury
  const burnAmount = Math.floor((protocolFee * 8000) / BPS_DENOMINATOR);
  const seasonAmount = Math.floor((protocolFee * 1000) / BPS_DENOMINATOR);
  const treasuryAmount = protocolFee - burnAmount - seasonAmount;

  return {
    totalPool,
    protocolFee,
    playerPool,
    prizes,
    paidSlots: payoutBps.length,
    rakeBps,
    burnAmount,
    seasonAmount,
    treasuryAmount,
  };
}
