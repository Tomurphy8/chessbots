import type { TournamentTier } from '../types/tournament.js';

export interface TierConfig {
  name: string;
  tier: TournamentTier;
  entryFeeUsdc: number;
  entryFeeLamports: number;
  minPlayers: number;
  maxPlayers: number;
  minRounds: number;
  maxRounds: number;
}

export const TIER_CONFIGS: Record<TournamentTier, TierConfig> = {
  rookie: {
    name: 'Rookie',
    tier: 'rookie',
    entryFeeUsdc: 0.1,
    entryFeeLamports: 100_000,
    minPlayers: 8,
    maxPlayers: 32,
    minRounds: 2,
    maxRounds: 4,
  },
  bronze: {
    name: 'Bronze',
    tier: 'bronze',
    entryFeeUsdc: 50,
    entryFeeLamports: 50_000_000,
    minPlayers: 4,
    maxPlayers: 32,
    minRounds: 3,
    maxRounds: 5,
  },
  silver: {
    name: 'Silver',
    tier: 'silver',
    entryFeeUsdc: 100,
    entryFeeLamports: 100_000_000,
    minPlayers: 4,
    maxPlayers: 32,
    minRounds: 4,
    maxRounds: 5,
  },
  masters: {
    name: 'Masters',
    tier: 'masters',
    entryFeeUsdc: 250,
    entryFeeLamports: 250_000_000,
    minPlayers: 4,
    maxPlayers: 64,
    minRounds: 5,
    maxRounds: 6,
  },
  legends: {
    name: 'Legends',
    tier: 'legends',
    entryFeeUsdc: 500,       // minimum — custom fee set per tournament
    entryFeeLamports: 500_000_000,
    minPlayers: 4,
    maxPlayers: 64,
    minRounds: 5,
    maxRounds: 6,
  },
};
