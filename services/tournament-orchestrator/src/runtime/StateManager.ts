import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

/**
 * TO-SM1: Persistent state manager for crash recovery.
 * Serializes orchestrator state to disk after each round,
 * enabling recovery from crashes mid-tournament.
 */

/**
 * Per-player standing snapshot for crash recovery.
 * Must contain all data needed to reconstruct TournamentManager state.
 */
export interface PersistedStanding {
  wallet: string;
  score: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesDrawn: number;
  gamesLost: number;
  opponents: string[];
  colors: string[];
}

export interface TournamentState {
  tournamentId: number;
  tier: string;
  totalRounds: number;
  currentRound: number;
  registeredWallets: string[];
  completedRounds: number[];
  // TO-H1(R7): Track which rounds have had games created on-chain (for mid-round crash recovery)
  roundsCreatedOnChain: number[];
  startedOnChain: boolean;
  finalized: boolean;
  // TO-H3(R7): Track prize distribution separately from finalization
  prizesDistributed: boolean;
  // TO-SM2: Full standings snapshot for crash recovery
  standings: PersistedStanding[];
  // Timestamps for debugging
  startedAt: string;
  lastUpdatedAt: string;
}

export interface OrchestratorState {
  version: 1;
  activeTournaments: Record<number, TournamentState>;
  lastCheckedId: number;
}

const DEFAULT_STATE: OrchestratorState = {
  version: 1,
  activeTournaments: {},
  lastCheckedId: 0,
};

export class StateManager {
  private filePath: string;
  private state: OrchestratorState;

  constructor(stateDir?: string) {
    const dir = stateDir || process.env.STATE_DIR || join(process.cwd(), '.orchestrator');
    this.filePath = join(dir, 'state.json');

    // Ensure directory exists
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.state = this.load();
  }

  private load(): OrchestratorState {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.version === 1) {
          console.log(`[StateManager] Loaded state from ${this.filePath}`);
          return parsed;
        }
        console.warn('[StateManager] Unknown state version, starting fresh');
      }
    } catch (err: any) {
      console.error(`[StateManager] Failed to load state: ${err.message}, starting fresh`);
    }
    return { ...DEFAULT_STATE };
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      // Write to temp file first, then rename (atomic on most filesystems)
      const tmpPath = this.filePath + '.tmp';
      writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf-8');
      const { renameSync, unlinkSync } = require('fs');
      try {
        renameSync(tmpPath, this.filePath);
      } catch (renameErr: any) {
        // TO-H4: Clean up orphaned .tmp file if rename fails
        try { unlinkSync(tmpPath); } catch { /* ignore cleanup error */ }
        throw renameErr;
      }
    } catch (err: any) {
      // TO-H4: Re-throw so callers know persistence failed.
      // This prevents silent state loss where in-memory state diverges from disk.
      console.error(`[StateManager] CRITICAL: Failed to save state: ${err.message}`);
      throw new Error(`State persistence failed: ${err.message}`);
    }
  }

  getState(): OrchestratorState {
    return this.state;
  }

  getLastCheckedId(): number {
    return this.state.lastCheckedId;
  }

  setLastCheckedId(id: number): void {
    this.state.lastCheckedId = id;
    this.save();
  }

  /**
   * Record that a tournament has started being processed.
   */
  startTournament(tournamentId: number, tier: string, totalRounds: number, wallets: string[]): void {
    this.state.activeTournaments[tournamentId] = {
      tournamentId,
      tier,
      totalRounds,
      currentRound: 0,
      registeredWallets: wallets,
      completedRounds: [],
      roundsCreatedOnChain: [],
      startedOnChain: false,
      finalized: false,
      prizesDistributed: false,
      standings: [],
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    };
    this.save();
  }

  /**
   * TO-SM2: Persist full standings snapshot after each round.
   * This enables correct crash recovery with accurate pairings/Buchholz.
   */
  saveStandings(tournamentId: number, standings: PersistedStanding[]): void {
    const t = this.state.activeTournaments[tournamentId];
    if (t) {
      t.standings = standings;
      t.lastUpdatedAt = new Date().toISOString();
      this.save();
    }
  }

  /**
   * Get persisted standings for a tournament (for crash recovery).
   */
  getStandings(tournamentId: number): PersistedStanding[] {
    return this.state.activeTournaments[tournamentId]?.standings || [];
  }

  /**
   * Mark that the tournament was started on-chain.
   */
  markStartedOnChain(tournamentId: number): void {
    const t = this.state.activeTournaments[tournamentId];
    if (t) {
      t.startedOnChain = true;
      t.lastUpdatedAt = new Date().toISOString();
      this.save();
    }
  }

  /**
   * Record completion of a round.
   */
  completeRound(tournamentId: number, round: number): void {
    const t = this.state.activeTournaments[tournamentId];
    if (t) {
      if (!t.completedRounds.includes(round)) {
        t.completedRounds.push(round);
      }
      t.currentRound = round;
      t.lastUpdatedAt = new Date().toISOString();
      this.save();
    }
  }

  /**
   * Mark tournament as finalized.
   */
  finalizeTournament(tournamentId: number): void {
    const t = this.state.activeTournaments[tournamentId];
    if (t) {
      t.finalized = true;
      t.lastUpdatedAt = new Date().toISOString();
      this.save();
    }
  }

  /**
   * Remove a completed/cancelled tournament from active state.
   */
  removeTournament(tournamentId: number): void {
    delete this.state.activeTournaments[tournamentId];
    this.save();
  }

  /**
   * Get tournaments that were in progress when we crashed.
   */
  getRecoverableTournaments(): TournamentState[] {
    return Object.values(this.state.activeTournaments).filter(t => !t.finalized);
  }

  /**
   * Check if a specific round was already completed.
   */
  isRoundCompleted(tournamentId: number, round: number): boolean {
    const t = this.state.activeTournaments[tournamentId];
    return t ? t.completedRounds.includes(round) : false;
  }

  /**
   * TO-H1(R7): Mark that games have been created on-chain for a specific round.
   * This enables recovery from crashes that occur after on-chain game creation
   * but before round completion.
   */
  markRoundCreatedOnChain(tournamentId: number, round: number): void {
    const t = this.state.activeTournaments[tournamentId];
    if (t) {
      if (!t.roundsCreatedOnChain) t.roundsCreatedOnChain = [];
      if (!t.roundsCreatedOnChain.includes(round)) {
        t.roundsCreatedOnChain.push(round);
      }
      t.lastUpdatedAt = new Date().toISOString();
      this.save();
    }
  }

  /**
   * TO-H1(R7): Check if games were already created on-chain for a round.
   */
  isRoundCreatedOnChain(tournamentId: number, round: number): boolean {
    const t = this.state.activeTournaments[tournamentId];
    return t ? (t.roundsCreatedOnChain || []).includes(round) : false;
  }

  /**
   * TO-H3(R7): Mark that prizes have been distributed on-chain.
   * Separate from finalization to handle crashes between the two operations.
   */
  markPrizesDistributed(tournamentId: number): void {
    const t = this.state.activeTournaments[tournamentId];
    if (t) {
      t.prizesDistributed = true;
      t.lastUpdatedAt = new Date().toISOString();
      this.save();
    }
  }
}
