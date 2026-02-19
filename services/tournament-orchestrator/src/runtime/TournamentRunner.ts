import { keccak256, toHex, getAddress, type Address } from 'viem';
import { TournamentManager } from '../lifecycle/TournamentManager.js';
import { MonadClient } from '../chains/client.js';
import { ChessEngineClient } from './ChessEngineClient.js';
import { StateManager } from './StateManager.js';
import { MatchPairing } from '../pairing/MatchPairing.js';
import { TeamPairing, type TeamInfo } from '../pairing/TeamPairing.js';
import type { TournamentConfig, Pairing, TeamStanding } from '../types/index.js';

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

  // Match format: series tracking for early clinch
  private matchClinched = false;
  private matchWinner: string | null = null;

  // Team format: team-level standings and roster data
  private teamStandings: TeamStanding[] = [];
  private teams: TeamInfo[] = [];

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
    const format = this.config.format || 'swiss';
    console.log(`\n========================================`);
    console.log(`  Tournament #${this.config.tournamentId} - ${this.config.tier.toUpperCase()} [${format.toUpperCase()}]`);
    console.log(`  Players: ${registeredWallets.length}`);
    console.log(`  Rounds: ${this.config.totalRounds}`);
    if (format === 'match' && this.config.bestOf) console.log(`  Best of: ${this.config.bestOf}`);
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

    // Team format: load team rosters from chain and set up team standings
    if (format === 'team') {
      await this.initTeams(tournamentId);
    }

    // TO-H2(R7): Only initialize state if this tournament is not already tracked (crash recovery safe).
    // Previously, startTournament() was called unconditionally, which destroyed restored crash
    // recovery data (completedRounds, standings, startedOnChain) immediately after loading them.
    const existingState = this.stateManager?.getState().activeTournaments[this.config.tournamentId];
    if (!existingState) {
      this.stateManager?.startTournament(this.config.tournamentId, this.config.tier, this.config.totalRounds, registeredWallets);
    }

    // Check on-chain status to determine if funding/starting has already happened
    const onChainState = await this.chain.getTournament(tournamentId);
    const alreadyStartedOnChain = existingState?.startedOnChain || onChainState.status >= 2;
    const alreadyFunded = existingState?.fundedOnChain || onChainState.status >= 2;

    // Auto-fund free-tier tournaments with USDC before starting
    if (this.config.tier === 'free' && this.config.freeTierPrizeUsdc && this.config.freeTierPrizeUsdc > 0) {
      if (alreadyFunded) {
        console.log('Free tier tournament already funded on-chain, skipping.\n');
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
    if (alreadyStartedOnChain) {
      console.log('Tournament already started on-chain, skipping startTournament call.\n');
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
        // Team format uses its own round logic
        if (format === 'team') {
          await this.runTeamRound(tournamentId, round);
        } else {
          await this.runRound(tournamentId, round);
        }
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

        // Match format: check for early series clinch after each round
        if (this.matchClinched) {
          console.log(`\n  Series clinched by ${this.matchWinner?.slice(0, 10)}... after round ${round}`);
          break;
        }
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

    // Determine winners based on format
    let winners: { first: string; second: string; third: string };
    if (format === 'team') {
      winners = this.getTeamWinners();
    } else {
      winners = this.manager.getWinners();
    }

    // Format-aware winner addresses:
    // Match format uses address(0) for 2nd/3rd since only 1 winner
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
    const winnersArray: [Address, Address, Address] = [
      winners.first ? getAddress(winners.first) as Address : ZERO_ADDRESS,
      winners.second ? getAddress(winners.second) as Address : ZERO_ADDRESS,
      winners.third ? getAddress(winners.third) as Address : ZERO_ADDRESS,
    ];

    if (alreadyFinalized) {
      console.log('Tournament already finalized on-chain (crash recovery), skipping.');
    } else {
      console.log('Finalizing tournament on-chain...');
      try {
        await this.chain.finalizeTournament(
          tournamentId,
          winnersArray,
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

    // Notify gateway of tournament completion so agents are informed of winnings
    if (this.gatewayUrl) {
      const winnersPayload = [
        winners.first && { wallet: winners.first, place: 1, prize: 0 },
        winners.second && { wallet: winners.second, place: 2, prize: 0 },
        winners.third && { wallet: winners.third, place: 3, prize: 0 },
      ].filter(Boolean);

      fetch(`${this.gatewayUrl}/api/internal/tournament-completed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-service-key': this.serviceKey || '' },
        body: JSON.stringify({
          tournamentId: this.config.tournamentId,
          winners: winnersPayload,
        }),
        signal: AbortSignal.timeout(5000),
      }).catch(err => console.error(`Failed to notify gateway of tournament completion: ${(err as Error).message}`));
    }

    console.log('\n========================================');
    console.log(`  Tournament Complete! [${format.toUpperCase()}]`);
    console.log(`  1st: ${winners.first ? winners.first.slice(0, 10) + '...' : 'N/A'}`);
    if (format !== 'match') {
      console.log(`  2nd: ${winners.second ? winners.second.slice(0, 10) + '...' : 'N/A'}`);
      console.log(`  3rd: ${winners.third ? winners.third.slice(0, 10) + '...' : 'N/A'}`);
    }
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

    // 5b. Match format: track series score and check for early clinch
    if (this.config.format === 'match' && this.config.bestOf && roundResult.pairings.length === 1) {
      const pairing = roundResult.pairings[0];
      const gameId = `t${this.config.tournamentId}-r${round}-g${pairing.gameIndex}`;
      const gameInfo = gameResults.get(gameId);
      const result = gameInfo ? mapResult(gameInfo.result) : 'draw';
      const winner = result === 'white' ? pairing.white : result === 'black' ? pairing.black : null;

      const matchPairing = this.manager.getPairingEngine() as MatchPairing;
      const { clinched, clinchWinner } = matchPairing.recordResult(winner, this.config.bestOf);
      if (clinched) {
        this.matchClinched = true;
        this.matchWinner = clinchWinner || null;
      }
    }

    // 5c. Archive completed games to gateway for persistence
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

  // ── Team Format Support ──────────────────────────────────────────────────

  /**
   * Load team rosters from chain and initialize team-level standings.
   * Called once at the start of team-format tournaments.
   */
  private async initTeams(tournamentId: bigint): Promise<void> {
    console.log('  Loading team rosters from chain...');
    this.teams = await this.chain.loadAllTeams(tournamentId);
    console.log(`  Loaded ${this.teams.length} teams`);

    // Configure the TeamPairing engine with roster data
    const teamPairing = this.manager.getPairingEngine() as TeamPairing;
    teamPairing.setTeams(this.teams);

    // Initialize team standings
    this.teamStandings = this.teams.map(team => ({
      teamId: team.teamId,
      captain: team.captain,
      members: team.members,
      matchesWon: 0,
      matchesDrawn: 0,
      matchesLost: 0,
      boardPoints: 0,
      points: 0,
      opponents: [],
      colors: [],
    }));
  }

  /**
   * Run a single round for team-format tournaments.
   * Uses TeamPairing for team-level Swiss pairing, then creates board games,
   * aggregates board results into team results, and submits on-chain.
   */
  private async runTeamRound(tournamentId: bigint, round: number): Promise<void> {
    const teamPairing = this.manager.getPairingEngine() as TeamPairing;

    // 1. Compute team-level pairings (Swiss at team level → expanded board pairings)
    const { teamPairings, roundResult, bye: byeTeamId } = teamPairing.computePairings(
      this.teamStandings,
      round,
    );

    console.log(`  Team pairings: ${teamPairings.length} matches, ${roundResult.pairings.length} board games`);

    // Handle team bye
    if (byeTeamId !== undefined) {
      const byeTeam = this.teamStandings.find(ts => ts.teamId === byeTeamId);
      if (byeTeam) {
        console.log(`  Bye: Team ${byeTeamId} (captain ${byeTeam.captain.slice(0, 10)}...)`);
        byeTeam.matchesWon++;
        byeTeam.points += 3; // Full win for bye
      }
    }

    // Track colors for team standings (needed for Swiss pairing)
    for (const tp of teamPairings) {
      const ts1 = this.teamStandings.find(ts => ts.teamId === tp.team1);
      const ts2 = this.teamStandings.find(ts => ts.teamId === tp.team2);
      if (ts1) { ts1.opponents.push(tp.team2); ts1.colors.push('white'); }
      if (ts2) { ts2.opponents.push(tp.team1); ts2.colors.push('black'); }
    }

    // 2. Create and start board games on chess engine
    console.log('  Creating board games on chess engine...');
    const gameIds = await this.engine.createRoundGames(
      this.config.tournamentId,
      round,
      roundResult.pairings,
      this.config.timeControl,
    );
    console.log(`  ${gameIds.length} board games started on engine.`);

    // 3. Create games on-chain
    const roundAlreadyCreatedOnChain = this.stateManager?.isRoundCreatedOnChain(this.config.tournamentId, round) || false;
    if (roundAlreadyCreatedOnChain) {
      console.log('  Games already created on-chain for this round (crash recovery), skipping.');
    } else {
      console.log('  Submitting board pairings on-chain...');
      await this.chain.batchCreateAndStartGames(tournamentId, round, roundResult.pairings);
      this.stateManager?.markRoundCreatedOnChain(this.config.tournamentId, round);
    }

    // 4. Wait for all board games to complete
    console.log('  Waiting for board games to complete...');
    const gameResults = await this.engine.waitForGamesCompletion(gameIds);

    // 5. Process individual board results
    const chainResults: Array<{
      gameIndex: number; result: number;
      pgnHash: `0x${string}`; resultHash: `0x${string}`; moveCount: number;
    }> = [];

    // Collect board results per team pairing for aggregation
    const boardResultsByMatch = new Map<string, Array<{ result: 'white' | 'black' | 'draw'; team1IsWhite: boolean }>>();
    for (const tp of teamPairings) {
      boardResultsByMatch.set(`${tp.team1}-${tp.team2}`, []);
    }

    for (const pairing of roundResult.pairings) {
      const gameId = `t${this.config.tournamentId}-r${round}-g${pairing.gameIndex}`;
      const gameInfo = gameResults.get(gameId);

      const result = gameInfo ? mapResult(gameInfo.result) : 'draw';
      const resultEnum = gameInfo ? resultToEnum(gameInfo.result) : 3;

      // Record individual game result in TournamentManager (for on-chain standings)
      this.manager.recordGameResult(pairing.white, pairing.black, result);

      // Determine which team match this board belongs to
      for (const tp of teamPairings) {
        const team1 = this.teams.find(t => t.teamId === tp.team1);
        const team2 = this.teams.find(t => t.teamId === tp.team2);
        if (!team1 || !team2) continue;

        const isTeam1White = team1.members.includes(pairing.white);
        const isTeam2White = team2.members.includes(pairing.white);
        if (isTeam1White || isTeam2White) {
          const key = `${tp.team1}-${tp.team2}`;
          boardResultsByMatch.get(key)?.push({
            result,
            team1IsWhite: isTeam1White,
          });
          break;
        }
      }

      const pgnHash = keccak256(toHex(gameInfo?.pgn || gameId)) as `0x${string}`;
      const resultHash = keccak256(toHex(`${gameId}:${gameInfo?.result || 'draw'}`)) as `0x${string}`;
      chainResults.push({
        gameIndex: pairing.gameIndex,
        result: resultEnum || 3,
        pgnHash,
        resultHash,
        moveCount: gameInfo?.moveCount || 0,
      });
    }

    // 6. Aggregate board results into team match results
    for (const tp of teamPairings) {
      const key = `${tp.team1}-${tp.team2}`;
      const boards = boardResultsByMatch.get(key) || [];
      const { team1Result, team1BoardWins, team2BoardWins } = TeamPairing.resolveTeamMatch(boards);

      const ts1 = this.teamStandings.find(ts => ts.teamId === tp.team1);
      const ts2 = this.teamStandings.find(ts => ts.teamId === tp.team2);

      if (ts1 && ts2) {
        ts1.boardPoints += team1BoardWins;
        ts2.boardPoints += team2BoardWins;

        if (team1Result === 'win') {
          ts1.matchesWon++; ts1.points += 3;
          ts2.matchesLost++;
          console.log(`  Team ${tp.team1} beats Team ${tp.team2} (${team1BoardWins}-${team2BoardWins})`);
        } else if (team1Result === 'loss') {
          ts2.matchesWon++; ts2.points += 3;
          ts1.matchesLost++;
          console.log(`  Team ${tp.team2} beats Team ${tp.team1} (${team2BoardWins}-${team1BoardWins})`);
        } else {
          ts1.matchesDrawn++; ts1.points += 1;
          ts2.matchesDrawn++; ts2.points += 1;
          console.log(`  Team ${tp.team1} draws Team ${tp.team2} (${team1BoardWins}-${team2BoardWins})`);
        }
      }
    }

    // 7. Archive games
    if (this.gatewayUrl) {
      await this.archiveGames(roundResult.pairings, round, gameResults);
    }

    // 8. Submit round results on-chain (individual player standings)
    // We need to advance the TournamentManager's round counter since we bypassed startNextRound
    this.manager.advanceToRound(round);
    const standings = this.manager.getStandings();
    const isLastRound = round === this.config.totalRounds;

    console.log('  Submitting results on-chain...');
    await this.chain.executeRound(
      tournamentId, round, chainResults,
      standings.map(s => ({
        ...s, gamesPlayed: s.gamesPlayed, gamesWon: s.gamesWon,
        gamesDrawn: s.gamesDrawn, gamesLost: s.gamesLost,
      })),
      !isLastRound,
    );

    // Print team standings
    console.log(`\n  Team standings after round ${round}:`);
    const sortedTeams = [...this.teamStandings].sort((a, b) => b.points - a.points || b.boardPoints - a.boardPoints);
    sortedTeams.forEach((ts, i) => {
      console.log(`    ${i + 1}. Team ${ts.teamId} (${ts.captain.slice(0, 10)}...) Pts: ${ts.points} W/D/L: ${ts.matchesWon}/${ts.matchesDrawn}/${ts.matchesLost} Boards: ${ts.boardPoints}`);
    });
    console.log('');
  }

  /**
   * Get winners for team format tournaments.
   * Returns team captains (members[0]) sorted by team points then board points.
   */
  private getTeamWinners(): { first: string; second: string; third: string } {
    const sorted = [...this.teamStandings].sort((a, b) =>
      b.points - a.points || b.boardPoints - a.boardPoints || b.matchesWon - a.matchesWon,
    );
    return {
      first: sorted[0]?.captain || '',
      second: sorted[1]?.captain || '',
      third: sorted[2]?.captain || '',
    };
  }
}
