import { EventEmitter } from 'events';
import type { Address, Hex } from 'viem';
import { WalletManager } from './WalletManager.js';
import { GatewayClient } from './GatewayClient.js';
import { RelayerClient } from './RelayerClient.js';
import { getStrategy } from './strategies/index.js';
import type {
  ChessEngine,
  AgentConfig,
  AgentState,
  TournamentInfo,
  GameInfo,
  GameEndResult,
  AgentEvents,
} from './types.js';

export class AgentRunner extends EventEmitter {
  private config: AgentConfig;
  private engine: ChessEngine;
  private wallet: WalletManager;
  private gateway: GatewayClient;
  private relayer: RelayerClient;
  private state: AgentState;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private economicsTimer: ReturnType<typeof setInterval> | null = null;
  private processingGames = new Set<string>();

  constructor(engine: ChessEngine, config: AgentConfig) {
    super();
    this.config = config;
    this.engine = engine;

    // Resolve private key from env if needed
    let privateKey = config.privateKey;
    if (typeof privateKey === 'string' && privateKey.startsWith('env:')) {
      const envVar = privateKey.slice(4);
      privateKey = process.env[envVar] as Hex;
      if (!privateKey) throw new Error(`Environment variable ${envVar} not set`);
    }

    this.wallet = new WalletManager(privateKey as Hex, config.rpcUrl);
    this.gateway = new GatewayClient(config.gatewayUrl);
    this.relayer = new RelayerClient(config.relayerUrl);

    this.state = {
      address: this.wallet.address,
      usdcBalance: 0,
      chessBalance: 0,
      eloRating: 1200,
      gamesPlayed: 0,
      tournamentsEntered: 0,
      activeTournaments: [],
      activeGames: [],
      referralEarnings: 0,
      referralCount: 0,
      referralTier: 0,
      referralTierName: 'Bronze',
    };
  }

  get address(): Address {
    return this.wallet.address;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.emit('status', `Starting agent ${this.config.name} (${this.wallet.address})`);

    // Initialize engine
    await this.engine.init();

    // Authenticate with gateway
    const token = await this.gateway.authenticate(
      this.wallet.address,
      (msg) => this.wallet.signMessage(msg),
      this.config.webhookUrl,
    );
    this.emit('status', 'Authenticated with gateway');

    // Check on-chain registration
    const isRegistered = await this.wallet.isRegistered();
    if (!isRegistered && this.config.autoRegister) {
      this.emit('status', 'Registering agent on-chain...');
      await this.wallet.registerAgent(
        this.config.name,
        this.config.metadataUri || '',
        this.config.referrer,
        undefined,
        this.relayer,
      );
      this.emit('status', 'Agent registered on-chain');
    } else if (!isRegistered) {
      throw new Error('Agent not registered on-chain. Set autoRegister: true or register manually.');
    }

    // Ensure USDC allowance
    const allowance = await this.wallet.checkAllowance();
    if (allowance < BigInt(1_000_000e6)) {
      this.emit('status', 'Approving USDC for tournament contract...');
      await this.wallet.approveUsdc(BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935'));
    }

    // Update balance
    this.state.usdcBalance = await this.wallet.getUsdcBalance();
    this.emit('status', `USDC Balance: ${this.state.usdcBalance}`);

    // Connect WebSocket
    const socket = this.gateway.connect(this.config.webhookUrl);

    socket.on('connect', () => {
      this.emit('status', 'WebSocket connected');
    });

    socket.on('tournament:created', (data: any) => {
      this._handleTournamentDiscovered(data).catch((e) =>
        this.emit('error', e as Error, 'tournament:created'),
      );
    });

    socket.on('game:started', (data: any) => {
      this._handleGameStarted(data).catch((e) =>
        this.emit('error', e as Error, 'game:started'),
      );
    });

    socket.on('game:move', (data: any) => {
      this._handleGameMove(data).catch((e) =>
        this.emit('error', e as Error, 'game:move'),
      );
    });

    socket.on('game:ended', (data: any) => {
      this._handleGameEnded(data);
    });

    socket.on('tournament:won', (data: any) => {
      this.emit('tournament:completed', {
        tournamentId: data.tournamentId,
        placement: data.placement || 1,
        prizeAmount: data.prizeAmount || 0,
        playerCount: 0,
      });
    });

    // Start polling loop as fallback
    this.running = true;
    this._startPolling();

    // Start autonomous economics loop (auto-claim, auto-tier-up)
    this._startEconomicsLoop();
    this._logReferralCode();

    this.emit('status', 'Agent is live and listening for tournaments');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.economicsTimer) {
      clearInterval(this.economicsTimer);
      this.economicsTimer = null;
    }
    this.gateway.disconnect();
    await this.engine.destroy?.();
    this.emit('status', 'Agent stopped');
  }

  // ── Event Handlers ──────────────────────────────────────────────────

  private async _handleTournamentDiscovered(data: any): Promise<void> {
    const tournament: TournamentInfo = {
      id: data.id || data.tournamentId,
      tier: data.tier || 'free',
      format: data.format || 'swiss',
      entryFee: Number(data.entryFee || 0),
      maxPlayers: data.maxPlayers || 8,
      registeredCount: data.registeredCount || 0,
      status: data.status || 'registration',
      startTime: data.startTime || 0,
      registrationDeadline: data.registrationDeadline || 0,
      baseTimeSeconds: data.baseTimeSeconds || 180,
      incrementSeconds: data.incrementSeconds || 2,
    };

    this.emit('tournament:discovered', tournament);

    // Check strategy
    const strategy = getStrategy(this.config.strategy || 'grinder');
    if (!strategy.shouldEnter(tournament, this.state)) return;

    // Check entry fee
    const maxFee = this.config.maxEntryFeeUsdc ?? 0;
    if (tournament.entryFee > maxFee * 1e6) return;

    // Try to join
    try {
      await this._joinTournament(tournament);
    } catch (e) {
      this.emit('error', e as Error, `join tournament ${tournament.id}`);
    }
  }

  private async _handleGameStarted(data: any): Promise<void> {
    const gameId = data.gameId;
    if (!gameId) return;

    const myAddress = this.wallet.address.toLowerCase();
    const isMyGame =
      data.white?.toLowerCase() === myAddress ||
      data.black?.toLowerCase() === myAddress;
    if (!isMyGame) return;

    this.gateway.subscribeGame(gameId);
    if (!this.state.activeGames.includes(gameId)) {
      this.state.activeGames.push(gameId);
    }

    this.emit('game:started', data);
    await this._tryMakeMove(gameId);
  }

  private async _handleGameMove(data: any): Promise<void> {
    const gameId = data.gameId;
    if (!gameId) return;

    this.emit('game:move', data);
    await this._tryMakeMove(gameId, data);
  }

  private _handleGameEnded(data: any): void {
    const gameId = data.gameId;
    if (!gameId) return;

    this.gateway.unsubscribeGame(gameId);
    this.state.activeGames = this.state.activeGames.filter((g) => g !== gameId);
    this.processingGames.delete(gameId);

    const myAddress = this.wallet.address.toLowerCase();
    let result: 'win' | 'loss' | 'draw' = 'draw';
    if (data.result === 'white_wins') {
      result = data.white?.toLowerCase() === myAddress ? 'win' : 'loss';
    } else if (data.result === 'black_wins') {
      result = data.black?.toLowerCase() === myAddress ? 'win' : 'loss';
    }

    const endResult: GameEndResult = {
      gameId,
      result,
      color: data.white?.toLowerCase() === myAddress ? 'white' : 'black',
      opponent: (data.white?.toLowerCase() === myAddress ? data.black : data.white) as Address,
      totalMoves: data.moveCount || 0,
    };

    this.engine.onGameEnd?.(endResult);
    this.emit('game:ended', endResult);
  }

  // ── Core Logic ──────────────────────────────────────────────────────

  private async _joinTournament(tournament: TournamentInfo): Promise<void> {
    this.emit('status', `Joining tournament ${tournament.id} (${tournament.tier})`);

    try {
      await this.wallet.registerForTournament(tournament.id, undefined, this.relayer);
      this.state.activeTournaments.push(tournament.id);
      this.gateway.subscribeTournament(tournament.id);
      this.emit('tournament:joined', tournament.id);
    } catch (e: any) {
      // Handle "Already registered" gracefully
      if (e?.message?.includes('Already registered') || e?.message?.includes('already')) {
        this.emit('status', `Already registered for tournament ${tournament.id}`);
        this.gateway.subscribeTournament(tournament.id);
        return;
      }
      throw e;
    }
  }

  private async _tryMakeMove(gameId: string, eventData?: any): Promise<void> {
    // Prevent concurrent move processing for same game
    if (this.processingGames.has(gameId)) return;
    this.processingGames.add(gameId);

    try {
      // Get game state (prefer event data, fallback to API)
      let game: GameInfo;
      if (eventData?.fen && eventData?.legalMoves) {
        game = {
          gameId,
          tournamentId: eventData.tournamentId || 0,
          white: eventData.white || ('0x0' as Address),
          black: eventData.black || ('0x0' as Address),
          fen: eventData.fen,
          status: 'in_progress',
          legalMoves: eventData.legalMoves,
          moveCount: eventData.moveCount || 0,
        };
      } else {
        game = await this.gateway.getGame(gameId);
        if (!game.legalMoves?.length) {
          game.legalMoves = await this.gateway.getLegalMoves(gameId);
        }
      }

      // Check if game is still active
      if (game.status !== 'in_progress' && game.status !== 'pending') {
        return;
      }

      // Check if it's our turn
      const myAddress = this.wallet.address.toLowerCase();
      const isWhite = game.white?.toLowerCase() === myAddress;
      const isBlack = game.black?.toLowerCase() === myAddress;
      if (!isWhite && !isBlack) return;

      // Determine whose turn it is from FEN
      const fenParts = game.fen.split(' ');
      const activeColor = fenParts[1]; // 'w' or 'b'
      const isMyTurn = (activeColor === 'w' && isWhite) || (activeColor === 'b' && isBlack);
      if (!isMyTurn) return;

      if (!game.legalMoves?.length) return;

      // Get move from engine
      const move = await this.engine.getMove({
        gameId,
        fen: game.fen,
        legalMoves: game.legalMoves,
        color: isWhite ? 'white' : 'black',
        moveCount: game.moveCount || 0,
        opponentAddress: (isWhite ? game.black : game.white) as Address,
      });

      // Submit move
      await this.gateway.submitMove(gameId, move);
      this.emit('move:submitted', gameId, move);
    } catch (e: any) {
      // Don't emit error for "not your turn" type errors
      if (!e?.message?.includes('not your turn') && !e?.message?.includes('Not your')) {
        this.emit('error', e as Error, `move in game ${gameId}`);
      }
    } finally {
      this.processingGames.delete(gameId);
    }
  }

  // ── Polling Fallback ────────────────────────────────────────────────

  private _startPolling(): void {
    const interval = this.config.pollIntervalMs || 2000;

    this.pollTimer = setInterval(async () => {
      if (!this.running) return;

      try {
        // Poll for open tournaments
        const tournaments = await this.gateway.getOpenTournaments();
        for (const t of tournaments) {
          await this._handleTournamentDiscovered(t);
        }

        // Poll active games
        for (const gameId of [...this.state.activeGames]) {
          await this._tryMakeMove(gameId);
        }

        // Discover games we might have missed
        const myGames = await this.gateway.getMyGames().catch(() => []);
        for (const game of myGames) {
          if (!this.state.activeGames.includes(game.gameId)) {
            this.state.activeGames.push(game.gameId);
            this.gateway.subscribeGame(game.gameId);
            await this._tryMakeMove(game.gameId);
          }
        }
      } catch (e) {
        this.emit('error', e as Error, 'polling');
      }
    }, interval);
  }

  // ── Autonomous Economics Loop ──────────────────────────────────────

  private _startEconomicsLoop(): void {
    const eco = this.config.economics ?? {};
    const autoClaimEarnings = eco.autoClaimEarnings ?? true;
    const autoTierUp = eco.autoTierUp ?? true;
    const claimThreshold = eco.claimThresholdUsdc ?? 1.0;
    const interval = eco.economicsIntervalMs ?? 300_000; // 5 min
    const reserveRatio = eco.reserveRatio ?? 0.2;

    const tick = async () => {
      if (!this.running) return;

      try {
        // 1. Refresh balance
        this.state.usdcBalance = await this.wallet.getUsdcBalance();

        // 2. Check referral status (3 parallel reads — zero gas)
        const [earnings, count, tierInfo] = await Promise.all([
          this.wallet.getReferralEarnings(),
          this.wallet.getReferralCount(),
          this.wallet.getReferrerTier(),
        ]);

        this.state.referralEarnings = earnings;
        this.state.referralCount = count;
        this.state.referralTier = tierInfo.tier;
        this.state.referralTierName = ['Bronze', 'Silver', 'Gold'][tierInfo.tier] || 'Bronze';

        this.emit('economics:status',
          `Balance: $${this.state.usdcBalance.toFixed(2)} | ` +
          `Referral earnings: $${earnings.toFixed(2)} | ` +
          `Referrals: ${count} (${this.state.referralTierName} ${tierInfo.rateBps / 100}%)`
        );

        // 3. Auto-claim referral earnings
        if (autoClaimEarnings && earnings >= claimThreshold) {
          this.emit('economics:status', `Claiming $${earnings.toFixed(2)} referral earnings...`);
          try {
            await this.wallet.claimReferralEarnings(undefined, this.relayer);
            this.state.usdcBalance = await this.wallet.getUsdcBalance();
            this.state.referralEarnings = 0;
            this.emit('economics:claimed', earnings);
            this.emit('economics:status',
              `Claimed $${earnings.toFixed(2)}! New balance: $${this.state.usdcBalance.toFixed(2)}`
            );
          } catch (e) {
            this.emit('error', e as Error, 'claim referral earnings');
          }
        }

        // 4. Auto tier-up: adjust maxEntryFeeUsdc based on available balance
        if (autoTierUp) {
          this._evaluateTierProgression(reserveRatio);
        }

        // 5. Referral code reminder
        this.emit('economics:status',
          `Share your referral code: REFERRER_ADDRESS=${this.wallet.address}`
        );
      } catch (e) {
        this.emit('error', e as Error, 'economics loop');
      }
    };

    // First tick after 5s (let tournament/game systems initialize), then every interval
    setTimeout(() => tick(), 5_000);
    this.economicsTimer = setInterval(tick, interval);
  }

  private _evaluateTierProgression(reserveRatio: number): void {
    const TIER_FEES: [string, number][] = [
      ['free', 0],
      ['rookie', 5],
      ['bronze', 50],
      ['silver', 100],
      ['masters', 250],
      ['legends', 500],
    ];

    // Disposable balance = total minus reserve
    const disposable = this.state.usdcBalance * (1 - reserveRatio);
    const currentMax = this.config.maxEntryFeeUsdc ?? 0;

    // Find highest tier agent can afford (3× entry as buffer)
    let targetFee = 0;
    let targetTierName = 'free';
    for (const [tierName, fee] of TIER_FEES) {
      if (disposable >= fee * 3) {
        targetFee = fee;
        targetTierName = tierName;
      }
    }

    // Only tier UP, never down
    if (targetFee > currentMax) {
      const oldMax = currentMax;
      this.config.maxEntryFeeUsdc = targetFee;
      this.emit('economics:tierUp', oldMax, targetFee,
        `Balance $${this.state.usdcBalance.toFixed(2)} supports ${targetTierName} tier (entry: $${targetFee})`
      );
      this.emit('economics:status',
        `TIER UP: $${oldMax} → $${targetFee} (${targetTierName}). ` +
        `Agent now enters ${targetTierName} tournaments automatically.`
      );
    }
  }

  private _logReferralCode(): void {
    const divider = '='.repeat(60);
    this.emit('status', divider);
    this.emit('status', '  AUTONOMOUS ECONOMIC AGENT');
    this.emit('status', `  Wallet: ${this.wallet.address}`);
    this.emit('status', '');
    this.emit('status', '  REFERRAL CODE (share to earn USDC):');
    this.emit('status', `  REFERRER_ADDRESS=${this.wallet.address}`);
    this.emit('status', '');
    this.emit('status', '  Other agents set this in their .env');
    this.emit('status', '  You earn 5-10% of their entry fees automatically');
    this.emit('status', '  Earnings auto-claimed → balance grows → tier up → repeat');
    this.emit('status', divider);
  }
}
