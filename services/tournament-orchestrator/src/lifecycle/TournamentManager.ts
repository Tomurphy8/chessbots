import { SwissPairing } from '../pairing/SwissPairing.js';
import { createPairingEngine, type PairingEngine } from '../pairing/PairingFactory.js';
import { createScoringStrategy, type ScoringStrategy } from './ScoringStrategy.js';
import { PlayerStanding, RoundResult, TournamentConfig } from '../types/index.js';

export class TournamentManager {
  private config: TournamentConfig;
  private standings: Map<string, PlayerStanding> = new Map();
  private currentRound = 0;
  private pairingEngine: PairingEngine;
  private scoringStrategy: ScoringStrategy;

  constructor(config: TournamentConfig) {
    this.config = config;
    // Use format-aware pairing and scoring if format is set, otherwise default to Swiss
    this.pairingEngine = createPairingEngine(config.format || 'swiss');
    this.scoringStrategy = createScoringStrategy(config.format || 'swiss');
  }

  registerPlayer(wallet: string): void {
    if (this.standings.has(wallet)) throw new Error(`Player ${wallet} already registered`);
    this.standings.set(wallet, {
      wallet, score: 0, buchholz: 0, gamesPlayed: 0, gamesWon: 0,
      gamesDrawn: 0, gamesLost: 0, opponents: [], colors: [],
    });
  }

  /**
   * TO-SM2: Restore full standings from a persisted snapshot (crash recovery).
   * This restores scores, opponents, colors, and game stats so that
   * Swiss pairing and Buchholz calculations are correct on resume.
   */
  restoreStandings(standings: Array<{
    wallet: string; score: number; gamesPlayed: number;
    gamesWon: number; gamesDrawn: number; gamesLost: number;
    opponents: string[]; colors: ('white' | 'black')[];
  }>, completedRound: number): void {
    this.standings.clear();
    for (const s of standings) {
      this.standings.set(s.wallet, {
        wallet: s.wallet,
        score: s.score,
        buchholz: 0, // Will be recalculated by getStandings()
        gamesPlayed: s.gamesPlayed,
        gamesWon: s.gamesWon,
        gamesDrawn: s.gamesDrawn,
        gamesLost: s.gamesLost,
        opponents: [...s.opponents],
        colors: [...s.colors] as ('white' | 'black')[],
      });
    }
    this.currentRound = completedRound;
  }

  getStandings(): PlayerStanding[] {
    const all = Array.from(this.standings.values());
    this.pairingEngine.calculateBuchholz(all);
    return this.scoringStrategy.sortStandings(all);
  }

  startNextRound(): RoundResult {
    this.currentRound++;
    if (this.currentRound > this.config.totalRounds) throw new Error('All rounds completed');
    const result = this.pairingEngine.computePairings(this.getStandings(), this.currentRound);
    for (const pairing of result.pairings) {
      this.standings.get(pairing.white)?.colors.push('white');
      this.standings.get(pairing.black)?.colors.push('black');
    }
    return result;
  }

  recordGameResult(white: string, black: string, result: 'white' | 'black' | 'draw'): void {
    const w = this.standings.get(white);
    const b = this.standings.get(black);
    if (!w || !b) throw new Error('Player not found');
    w.opponents.push(black);
    b.opponents.push(white);
    w.gamesPlayed++;
    b.gamesPlayed++;

    // Use scoring strategy for point values
    if (result === 'white') {
      w.score += this.scoringStrategy.winPoints;
      b.score += this.scoringStrategy.lossPoints;
      w.gamesWon++;
      b.gamesLost++;
    } else if (result === 'black') {
      b.score += this.scoringStrategy.winPoints;
      w.score += this.scoringStrategy.lossPoints;
      b.gamesWon++;
      w.gamesLost++;
    } else {
      w.score += this.scoringStrategy.drawPoints;
      b.score += this.scoringStrategy.drawPoints;
      w.gamesDrawn++;
      b.gamesDrawn++;
    }
  }

  recordBye(wallet: string): void {
    const p = this.standings.get(wallet);
    if (!p) throw new Error('Player not found');
    p.score += this.scoringStrategy.winPoints;
    p.gamesPlayed++;
    p.gamesWon++;
    // TO-H1: Track bye as a sentinel opponent so Buchholz and
    // opponent-history checks remain accurate. A "BYE" sentinel
    // will resolve to score 0 in Buchholz calculation (which is
    // the correct weight for a forfeit win). Also record a color
    // entry so color-balancing stays in sync with gamesPlayed.
    p.opponents.push('BYE');
    p.colors.push('white');
  }

  getWinners(): { first: string; second: string; third: string } {
    const sorted = this.getStandings();
    const format = this.config.format || 'swiss';

    if (format === 'match') {
      // Match: only 1 winner
      return {
        first: sorted[0]?.wallet || '',
        second: '',
        third: '',
      };
    }

    return {
      first: sorted[0]?.wallet || '',
      second: sorted[1]?.wallet || '',
      third: sorted[2]?.wallet || '',
    };
  }

  /**
   * TO-C2: Advance the internal round counter to a specific round.
   * Used during crash recovery to sync the counter with already-completed rounds
   * so that startNextRound() will produce the correct next round number.
   */
  advanceToRound(round: number): void {
    if (round > this.currentRound) {
      this.currentRound = round;
    }
  }

  getFormat(): string { return this.config.format || 'swiss'; }
  getCurrentRound(): number { return this.currentRound; }
  isComplete(): boolean { return this.currentRound >= this.config.totalRounds; }
  getPairingEngine(): PairingEngine { return this.pairingEngine; }
}
