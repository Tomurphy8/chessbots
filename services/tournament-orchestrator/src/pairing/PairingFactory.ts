import type { TournamentFormat } from '../types/index.js';
import { SwissPairing } from './SwissPairing.js';
import { MatchPairing } from './MatchPairing.js';
import { RoundRobinPairing } from './RoundRobinPairing.js';
import { TeamPairing } from './TeamPairing.js';

/**
 * Common interface for pairing engines.
 * All engines produce pairings from standings for a given round.
 */
export interface PairingEngine {
  computePairings(standings: any[], round: number): any;
  calculateBuchholz(standings: any[]): void;
}

/**
 * Factory that returns the appropriate pairing engine based on tournament format.
 */
export function createPairingEngine(format: TournamentFormat): PairingEngine {
  switch (format) {
    case 'swiss':
      return new SwissPairing();
    case 'match':
      return new MatchPairing();
    case 'league':
      return new RoundRobinPairing();
    case 'team':
      return new TeamPairing();
    default:
      throw new Error(`Unknown tournament format: ${format}`);
  }
}
