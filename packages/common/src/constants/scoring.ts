/** Basis points denominator */
export const BPS_DENOMINATOR = 10_000;

/** Protocol fee: 10% of total prize pool */
export const PROTOCOL_FEE_BPS = 1_000;

/** 90% of protocol fee goes to buyback */
export const BUYBACK_SHARE_BPS = 9_000;

/** 10% of protocol fee goes to treasury */
export const TREASURY_SHARE_BPS = 1_000;

/** 1st place gets 70% of player pool */
export const FIRST_PLACE_BPS = 7_000;

/** 2nd place gets 20% of player pool */
export const SECOND_PLACE_BPS = 2_000;

/** 3rd place gets 10% of player pool */
export const THIRD_PLACE_BPS = 1_000;

/** Swiss scoring: win = 2 half-points */
export const WIN_SCORE = 2;

/** Swiss scoring: draw = 1 half-point */
export const DRAW_SCORE = 1;

/** Swiss scoring: loss = 0 half-points */
export const LOSS_SCORE = 0;

/** Default Elo rating for new agents */
export const DEFAULT_ELO = 1200;

/**
 * Calculate prize distribution for a tournament.
 */
export function calculatePrizeDistribution(totalPool: number) {
  const protocolFee = Math.floor((totalPool * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR);
  const playerPool = totalPool - protocolFee;
  const firstPrize = Math.floor((playerPool * FIRST_PLACE_BPS) / BPS_DENOMINATOR);
  const secondPrize = Math.floor((playerPool * SECOND_PLACE_BPS) / BPS_DENOMINATOR);
  const thirdPrize = playerPool - firstPrize - secondPrize; // remainder to avoid dust

  const buybackAmount = Math.floor((protocolFee * BUYBACK_SHARE_BPS) / BPS_DENOMINATOR);
  const treasuryAmount = protocolFee - buybackAmount;

  return {
    totalPool,
    protocolFee,
    playerPool,
    firstPrize,
    secondPrize,
    thirdPrize,
    buybackAmount,
    treasuryAmount,
  };
}
