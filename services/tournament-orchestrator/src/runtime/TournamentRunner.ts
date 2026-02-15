import { keccak256, toHex, getAddress, type Address } from 'viem';
import { TournamentManager } from '../lifecycle/TournamentManager.js';
import { MonadClient } from '../chains/client.js';
import { ChessEngineClient } from './ChessEngineClient.js';
import { StateManager } from './StateManager.js';
import type { TournamentConfig, Pairing } from '../types/index.js';

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

// TO-R1: Unified result mapping with validation
const RESULT_MAP: Record<string, { label: 'white' | 'black' | 'draw'; enum: number }> = {
  'white_wins': { label: 'white', enum: 1 },
  'WhiteWins': { label: 'white', enum: 1 },
  'black_wins': { label: 'black', enum: 2 },
  'BlackWins': { label: 'black', enum: 2 },
  'draw': { label: 'draw', enum: 3 },
  'Draw': { label: 'draw', enum: 3 },
};

function mapResult(result: string): 'white' | 'black' | 'draw' {
  const mapped = RESULT_MAP[result];
  if (!mapped) {
    console.warn(`  Unknown result "${result}", defaulting to draw`);
    return 'draw';
  }
  return mapped.label;
}

function resultToEnum(result: string): number {
  return RESULT_MAP[result]?.enum ?? 0;
}

/**
 * Full tournament lifecycle runner.
 * Orchestrates: on-chain state → chess engine games → result submission → prize distribution.
 * TO-R2: Includes comprehensive error handling, input validation, and recovery logic.
 */
export class TournamentRunner {
  private chain: MonadClient;
  private engine: ChessEngineClient;
  private manager: TournamentManager;
  private config: TournamentConfig;
  private stateManager?: StateManager;
  private gatewayUrl?: string;
  private serviceKey?: string;

  constructor(
    chain: MonadClient,
    engine: ChessEngineClient,
    config: TournamentConfig,
    stateManager?: StateManager,
    gatewayUrl?: string,
    serviceKey?: string,
  ) {
    this.chain = chain;
    this.engine = engine;
    this.config = config;
    this.manager = new TournamentManager(config);
    this.stateManager = stateManager;
    this.gatewayUrl = gatewayUrl;
    this.serviceKey = serviceKey;
  }

  /**
   * Run a complete tournament from start to finish.
   * Assumes tournament is already created on-chain and players are registered.
   */
  async run(registeredWallets: string[]): Promise<void> {
    // TO-R3: Validate all wallet addresses
    for (const wallet of registeredWallets) {
      if (!ADDRESS_REGEX.test(wallet)) {
        throw new Error(`Invalid wallet address: ${wallet}`);
      }
    }

    if (registeredWallets.length < 2) {
      throw new Error('Need at least 2 players for a tournament');
    }

    const tournamentId = BigInt(this.config.tournamentId);
    console.log(`\n========================================`);
    console.log(`  Tournament #${this.config.tournamentId} - ${this.config.tier.toUpperCase()}`);
    console.log(`  Players: ${registeredWallets.length}`);
    console.log(`  Rounds: ${this.config.totalRounds}`);
    console.log(`========================================\n`);

    // TO-SM2: Check if we have persisted standings for crash recovery
    const persistedStandings = this.stateManager?.getStandings(this.config.tournamentId);
    if (persistedStandings && persistedStandings.length > 0) {
      // Restore full standings (scores, opponents, colors) from disk
      const completedRounds = this.stateManager!.getState().activeTournaments[this.config.tournamentId]?.completedRounds || [];
      const maxCompleted = completedRounds.length > 0 ? Math.max(...completedRounds) : 0;
      console.log(`  Restoring standings from crash recovery (${persistedStandings.length} players, ${maxCompleted} rounds completed)`);
      this.manager.restoreStandings(
        persistedStandings.map(s => ({ ...s, colors: s.colors as ('white' | 'black')[] })),
        maxCompleted,
      );
    } else {
      // Fresh start: register all players in the manager (normalize addresses)
      for (const wallet of registeredWallets) {
        this.manager.registerPlayer(getAddress(wallet));
      }
    }

    // TO-H2(R7): Only initialize state if this tournament is not already tracked (crash recovery safe).
    // Previously, startTournament() was called unconditionally, which destroyed restored crash
    // recovery data (completedRounds, standings, startedOnChain) immediately after loading them.
    const existingState = this.stateManager?.getState().activeTournaments[this.config.tournamentId];
    if (!existingState) {
      this.stateManager?.startTournament(this.config.tournamentId, this.config.tier, this.config.totalRounds, registeredWallets);
    }

    // Auto-fund free-tier tournaments with USDC before starting
    if (this.config.tier === 'free' && this.config.freeTierPrizeUsdc && this.config.freeTierPrizeUsdc > 0) {
      const alreadyFunded = existingState?.fundedOnChain || false;
      if (alreadyFunded) {
        console.log('Free tier tournament already funded on-chain (crash recovery), skipping.\n');
      } else {
        const amountRaw = BigInt(Math.round(this.config.freeTierPrizeUsdc * 1e6));
        console.log(`Funding free tournament with ${this.config.freeTierPrizeUsdc} USDC (${amountRaw} raw)...`);

        // Ensure USDC allowance is sufficient
        const currentAllowance = await this.chain.getUsdcAllowance();
        if (currentAllowance < amountRaw) {
          const approveAmount = amountRaw * 10n; // Approve 10x to avoid repeated approvals
          console.log(`  USDC allowance insufficient (${currentAllowance}), approving ${approveAmount}...`);
          await this.chain.approveUsdc(approveAmount);
        }

        await this.chain.fundTournament(tournamentId, amountRaw);
        this.stateManager?.markFundedOnChain(this.config.tournamentId);
        console.log(`Free tournament funded with ${this.config.freeTierPrizeUsdc} USDC.\n`);
      }
    }

    // TO-C1: Only start tournament on-chain if not already started (crash recovery safe)
    const alreadyStartedOnChain = existingState?.startedOnChain || false;
    if (alreadyStartedOnChain) {
      console.log('Tournament already started on-chain (crash recovery), skipping startTournament call.\n');
    } else {
      console.log('Starting tournament on-chain...');
      try {
        await this.chain.startTournament(tournamentId);
        console.log('Tournament started on-chain.\n');
        this.stateManager?.markStartedOnChain(this.config.tournamentId);
      } catch (err: any) {
        console.error(`Failed to start tournament on-chain: ${err.message}`);
        throw err;
      }
    }

    // Re-read tournament from chain to get totalRounds (calculated on-chain during startTournament)
    if (this.config.totalRounds === 0) {
      const onChainTournament = await this.chain.getTournament(tournamentId);
      if (onChainTournament.totalRounds > 0) {
        this.config.totalRounds = onChainTournament.totalRounds;
        console.log(`  Updated totalRounds from chain: ${this.config.totalRounds}`);
      } else {
        throw new Error('totalRounds is still 0 after starting tournament — cannot run rounds');
      }
    }

    // Run each round
    for (let round = 1; round <= this.config.totalRounds; round++) {
      console.log(`--- Round ${round} of ${this.config.totalRounds} ---`);

      // TO-C2: Skip rounds already completed (crash recovery).
      // We must also advance TournamentManager's internal round counter
      // so startNextRound() produces the correct round number.
      if (this.stateManager?.isRoundCompleted(this.config.tournamentId, round)) {
        console.log(`  Round ${round} already completed (recovered from state), skipping.`);
        // Advance the internal round counter to stay in sync
        this.manager.advanceToRound(round);
        continue;
      }

      try {
        await this.runRound(tournamentId, round);
        // TO-SM2: Persist full standings snapshot after each round for crash recovery
        const currentStandings = this.manager.getStandings();
        this.stateManager?.saveStandings(this.config.tournamentId, currentStandings.map(s => ({
          wallet: s.wallet,
          score: s.score,
          gamesPlayed: s.gamesPlayed,
          gamesWon: s.gamesWon,
          gamesDrawn: s.gamesDrawn,
          gamesLost: s.gamesLost,
          opponents: s.opponents,
          colors: s.colors,
        })));
        // TO-SM: Persist round completion
        this.stateManager?.completeRound(this.config.tournamentId, round);
      } catch (err: any) {
        console.error(`\n  ROUND ${round} FAILED: ${err.message}`);
        console.error('  Tournament may be in inconsistent state. Manual intervention required.');
        throw err;
      }
    }

    // Finalize tournament
    // TO-H3(R7): Check if already finalized on-chain (idempotency for crash recovery).
    // If we crash after finalizeTournament succeeds but before state is updated,
    // re-calling finalizeTournament would revert on-chain. Check persisted state first.
    const alreadyFinalized = this.stateManager?.getState().activeTournaments[this.config.tournamentId]?.finalized || false;
    const alreadyDistributed = this.stateManager?.getState().activeTournaments[this.config.tournamentId]?.prizesDistributed || false;

    const winners = this.manager.getWinners();

    if (alreadyFinalized) {
      console.log('Tournament already finalized on-chain (crash recovery), skipping.');
    } else {
      console.log('Finalizing tournament on-chain...');
      try {
        await this.chain.finalizeTournament(
          tournamentId,
          [getAddress(winners.first) as Address, getAddress(winners.second) as Address, getAddress(winners.third) as Address],
          `chessbots://tournament/${this.config.tournamentId}/results`,
        );
        this.stateManager?.finalizeTournament(this.config.tournamentId);
      } catch (err: any) {
        console.error(`Failed to finalize tournament: ${err.message}`);
        throw err;
      }
    }

    // Distribute prizes
    if (alreadyDistributed) {
      console.log('Prizes already distributed (crash recovery), skipping.');
    } else {
      console.log('Distributing prizes...');
      try {
        await this.chain.distributePrizes(tournamentId);
        this.stateManager?.markPrizesDistributed(this.config.tournamentId);
      } catch (err: any) {
        console.error(`Failed to distribute prizes: ${err.message}`);
        throw err;
      }
    }

    // TO-SM: Remove from active state (tournament fully complete)
    this.stateManager?.removeTournament(this.config.tournamentId);

    console.log('\n========================================');
    console.log('  Tournament Complete!');
    console.log(`  1st: ${winners.first.slice(0, 10)}...`);
    console.log(`  2nd: ${winners.second.slice(0, 10)}...`);
    console.log(`  3rd: ${winners.third.slice(0, 10)}...`);
    console.log('========================================\n');
  }

  private async runRound(tournamentId: bigint, round: number): Promise<void> {
    // 1. Compute pairings
    const roundResult = this.manager.startNextRound();
    console.log(`  Pairings: ${roundResult.pairings.length} games`);
    if (roundResult.bye) {
      console.log(`  Bye: ${roundResult.bye.slice(0, 10)}...`);
      this.manager.recordBye(roundResult.bye);
    }

    // TO-R6: Create engine games FIRST, then commit on-chain.
    // This prevents on-chain state from referencing games that don't exist on the engine.
    // If engine creation fails, we haven't committed anything on-chain yet.

    // 2. Create and start games on chess engine (must succeed first)
    console.log('  Creating games on chess engine...');
    const gameIds = await this.engine.createRoundGames(
      this.config.tournamentId,
      round,
      roundResult.pairings,
      this.config.timeControl,
    );
    console.log(`  ${gameIds.length} games started on engine.`);

    // 3. Create games on-chain (now that engine is ready)
    // TO-H1(R7): Check if games were already created on-chain for this round (crash recovery).
    // If we crash after on-chain creation but before completion, we must not re-create.
    const roundAlreadyCreatedOnChain = this.stateManager?.isRoundCreatedOnChain(this.config.tournamentId, round) || false;
    if (roundAlreadyCreatedOnChain) {
      console.log('  Games already created on-chain for this round (crash recovery), skipping.');
    } else {
      console.log('  Submitting pairings on-chain...');
      await this.chain.batchCreateAndStartGames(
        tournamentId,
        round,
        roundResult.pairings,
      );
      // Persist that on-chain creation succeeded for this round
      this.stateManager?.markRoundCreatedOnChain(this.config.tournamentId, round);
    }

    // 4. Wait for all games to complete
    console.log('  Waiting for games to complete...');
    const gameResults = await this.engine.waitForGamesCompletion(gameIds);

    // 5. Process results with validation
    const chainResults: Array<{
      gameIndex: number;
      result: number;
      pgnHash: `0x${string}`;
      resultHash: `0x${string}`;
      moveCount: number;
    }> = [];

    for (const pairing of roundResult.pairings) {
      const gameId = `t${this.config.tournamentId}-r${round}-g${pairing.gameIndex}`;
      const gameInfo = gameResults.get(gameId);

      if (gameInfo) {
        // TO-R4: Validate result is a known value
        const resultEnum = resultToEnum(gameInfo.result);
        if (resultEnum === 0) {
          console.warn(`  Game ${gameId}: unknown result "${gameInfo.result}", treating as draw`);
        }

        const result = mapResult(gameInfo.result);
        this.manager.recordGameResult(pairing.white, pairing.black, result);

        // Generate hashes for on-chain submission
        const pgnHash = keccak256(toHex(gameInfo.pgn || gameId)) as `0x${string}`;
        const resultHash = keccak256(toHex(`${gameId}:${gameInfo.result}`)) as `0x${string}`;

        chainResults.push({
          gameIndex: pairing.gameIndex,
          result: resultEnum || 3, // Default to draw if unknown
          pgnHash,
          resultHash,
          moveCount: gameInfo.moveCount || 0,
        });
      } else {
        // TO-R5: Handle missing game results — default to draw
        console.warn(`  Game ${gameId}: no result received, defaulting to draw`);
        this.manager.recordGameResult(pairing.white, pairing.black, 'draw');
        const pgnHash = keccak256(toHex(gameId)) as `0x${string}`;
        const resultHash = keccak256(toHex(`${gameId}:timeout_draw`)) as `0x${string}`;
        chainResults.push({
          gameIndex: pairing.gameIndex,
          result: 3, // Draw
          pgnHash,
          resultHash,
          moveCount: 0,
        });
      }
    }

    // 5b. Archive completed games to gateway for persistence
    if (this.gatewayUrl) {
      await this.archiveGames(roundResult.pairings, round, gameResults);
    }

    // 6. Submit round results on-chain
    const standings = this.manager.getStandings();
    const isLastRound = round === this.config.totalRounds;

    console.log('  Submitting results on-chain...');
    await this.chain.executeRound(
      tournamentId,
      round,
      chainResults,
      standings.map(s => ({
        ...s,
        gamesPlayed: s.gamesPlayed,
        gamesWon: s.gamesWon,
        gamesDrawn: s.gamesDrawn,
        gamesLost: s.gamesLost,
      })),
      !isLastRound, // advance = true if not the last round
    );

    // Print standings
    console.log(`\n  Standings after round ${round}:`);
    standings.forEach((s, i) => {
      console.log(`    ${i + 1}. ${s.wallet.slice(0, 10)}... Score: ${s.score} Buchholz: ${s.buchholz}`);
    });
    console.log('');
  }

  /**
   * Archive completed game data to the gateway for persistence.
   * Best-effort: failures are logged but don't block tournament progress.
   */
  private async archiveGames(
    pairings: Pairing[],
    round: number,
    gameResults: Map<string, any>,
  ): Promise<void> {
    for (const pairing of pairings) {
      const gameId = `t${this.config.tournamentId}-r${round}-g${pairing.gameIndex}`;
      const gameInfo = gameResults.get(gameId);
      if (!gameInfo) continue;

      try {
        const res = await fetch(`${this.gatewayUrl}/api/game/${gameId}/archive`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-service-key': this.serviceKey || '',
          },
          body: JSON.stringify({
            gameId,
            tournamentId: this.config.tournamentId,
            round,
            gameIndex: pairing.gameIndex,
            white: pairing.white,
            black: pairing.black,
            pgn: gameInfo.pgn || '',
            moves: gameInfo.moves || [],
            result: gameInfo.result || '',
            moveCount: gameInfo.moveCount || 0,
            fen: gameInfo.fen || '',
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (res.ok) {
          console.log(`  Archived game ${gameId} to gateway`);
        } else {
          console.warn(`  Failed to archive ${gameId}: HTTP ${res.status}`);
        }
      } catch (err: any) {
        console.warn(`  Failed to archive ${gameId}: ${err.message}`);
      }
    }
  }
}
