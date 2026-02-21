import { Server as SocketServer, type Socket } from 'socket.io';
import { io as SocketClient, type Socket as ClientSocket } from 'socket.io-client';
import { verifyToken } from '../auth/jwt.js';
import { CONFIG } from '../config.js';
import { type Address } from 'viem';
import type { WebhookRegistry } from '../indexer/WebhookRegistry.js';

// GW-WS1: Input validation and subscription caps
const GAME_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const TOURNAMENT_ID_REGEX = /^[0-9]{1,10}$/;
const MAX_GAME_SUBS_PER_SOCKET = 20;
const MAX_TOURNAMENT_SUBS_PER_SOCKET = 10;

// Spectator namespace limits (more restrictive — no auth)
const MAX_SPECTATOR_GAME_SUBS = 5;
const MAX_SPECTATOR_TOURNAMENT_SUBS = 3;

interface AuthenticatedSocket extends Socket {
  wallet?: Address;
  subscribedGames?: Set<string>;
  subscribedTournaments?: Set<string>;
}

interface SpectatorSocket extends Socket {
  subscribedGames?: Set<string>;
  subscribedTournaments?: Set<string>;
}

export class SocketBridge {
  private agentServer: SocketServer;
  private engineClient: ClientSocket;
  private webhookRegistry: WebhookRegistry | null;
  private trackedGames = new Set<string>();
  private trackedTournaments = new Set<string>();
  // GW-WS2: Reference counting for tracked games/tournaments cleanup
  private gameRefCount = new Map<string, number>();
  private tournamentRefCount = new Map<string, number>();
  // Track game participants so we can push game:move directly to wallets
  private gameParticipants = new Map<string, { white: string; black: string }>();
  // Games already notified via notifyGameStarted() — suppress engine relay duplicate
  private notifiedGames = new Set<string>();
  // Diagnostic counters for health endpoint
  public diagnostics = {
    notifyGameStarted: 0,
    gameMoveRelayed: 0,
    walletPushSent: 0,
    gameEndedRelayed: 0,
    autoJoinSuccess: 0,
    autoJoinEmpty: 0,
  };

  constructor(agentServer: SocketServer, webhookRegistry?: WebhookRegistry) {
    this.agentServer = agentServer;
    this.webhookRegistry = webhookRegistry ?? null;

    // GW-WS3: Connect to chess engine with service auth
    this.engineClient = SocketClient(CONFIG.chessEngineUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity,
      auth: {
        serviceApiKey: CONFIG.serviceApiKey,
      },
      extraHeaders: {
        'x-service-api-key': CONFIG.serviceApiKey,
      },
    });

    this.setupEngineListeners();
    this.setupAgentServer();
    this.setupSpectatorNamespace();
  }

  private setupEngineListeners() {
    this.engineClient.on('connect', () => {
      console.log('[SocketBridge] Connected to chess engine');
      // Re-join all tracked rooms on reconnect
      for (const gameId of this.trackedGames) {
        this.engineClient.emit('join:game', gameId);
      }
      for (const tournamentId of this.trackedTournaments) {
        this.engineClient.emit('join:tournament', tournamentId);
      }
    });

    this.engineClient.on('disconnect', () => {
      console.log('[SocketBridge] Disconnected from chess engine, will reconnect...');
    });

    // Bridge events from chess engine to agent-facing rooms AND spectator namespace
    this.engineClient.on('game:started', (data: any) => {
      // Skip relay for games already notified via notifyGameStarted() to prevent
      // duplicate game:started events (which cause bots to re-trigger move logic)
      if (this.notifiedGames.has(data.gameId)) return;
      this.agentServer.to(`game:${data.gameId}`).emit('game:started', data);
      this.agentServer.of('/spectator').to(`game:${data.gameId}`).emit('game:started', data);
    });

    this.engineClient.on('game:move', (data: any) => {
      this.diagnostics.gameMoveRelayed++;
      this.agentServer.to(`game:${data.gameId}`).emit('game:move', data);
      this.agentServer.of('/spectator').to(`game:${data.gameId}`).emit('game:move', data);
      // Belt-and-suspenders: also push game:move directly to both players by wallet.
      // This ensures agents receive turn notifications even if their socket missed
      // the room join (race condition, reconnection, etc.). Agents deduplicate by
      // checking whose turn it is via FEN, so duplicate delivery is harmless.
      const gameInfo = this.gameParticipants.get(data.gameId);
      if (gameInfo) {
        this.diagnostics.walletPushSent += 2;
        this.emitToWallet(gameInfo.white, 'game:move', data);
        this.emitToWallet(gameInfo.black, 'game:move', data);
      }
    });

    this.engineClient.on('game:ended', (data: any) => {
      this.diagnostics.gameEndedRelayed++;
      this.agentServer.to(`game:${data.gameId}`).emit('game:ended', data);
      this.agentServer.of('/spectator').to(`game:${data.gameId}`).emit('game:ended', data);
      if (data.tournamentId) {
        this.agentServer.to(`tournament:${data.tournamentId}`).emit('game:ended', data);
        this.agentServer.of('/spectator').to(`tournament:${data.tournamentId}`).emit('game:ended', data);
      }
      // Also push game:ended directly to wallets and clean up participants map
      const gameInfo = this.gameParticipants.get(data.gameId);
      if (gameInfo) {
        this.emitToWallet(gameInfo.white, 'game:ended', data);
        this.emitToWallet(gameInfo.black, 'game:ended', data);
        this.gameParticipants.delete(data.gameId);
      }
      this.notifiedGames.delete(data.gameId);
    });
  }

  private setupAgentServer() {
    // JWT authentication middleware for Socket.IO
    this.agentServer.use(async (socket: AuthenticatedSocket, next) => {
      const token = socket.handshake.auth?.token
        || socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        return next(new Error('Authentication required. Provide token in auth.token or Authorization header.'));
      }

      const payload = await verifyToken(token);
      if (!payload) {
        return next(new Error('Invalid or expired token. Re-authenticate via /api/auth/challenge.'));
      }

      socket.wallet = payload.sub as Address;
      socket.subscribedGames = new Set();
      socket.subscribedTournaments = new Set();

      // Auto-register webhook if notifyUrl provided in handshake (zero-friction)
      const notifyUrl = socket.handshake.auth?.notifyUrl;
      if (notifyUrl && typeof notifyUrl === 'string' && this.webhookRegistry) {
        const result = this.webhookRegistry.register(socket.wallet, notifyUrl);
        if (!result.ok) {
          console.warn(`[SocketBridge] Webhook auto-register failed for ${socket.wallet.slice(0, 10)}...: ${result.error}`);
        }
      }

      next();
    });

    this.agentServer.on('connection', (socket: AuthenticatedSocket) => {
      const wallet = socket.wallet!;
      console.log(`[SocketBridge] Agent connected: ${wallet}`);

      // Auto-join wallet-specific room for targeted notifications (e.g. win alerts)
      socket.join(`wallet:${wallet.toLowerCase()}`);

      // Subscribe to game events
      socket.on('subscribe:game', (gameId: string) => {
        if (typeof gameId !== 'string' || !GAME_ID_REGEX.test(gameId)) return;
        // GW-WS1: Enforce per-socket subscription cap
        if (socket.subscribedGames!.size >= MAX_GAME_SUBS_PER_SOCKET) {
          socket.emit('error', { message: `Max ${MAX_GAME_SUBS_PER_SOCKET} game subscriptions per connection` });
          return;
        }
        if (socket.subscribedGames!.has(gameId)) return; // already subscribed
        socket.join(`game:${gameId}`);
        socket.subscribedGames!.add(gameId);

        // Track on engine side with reference counting
        const count = this.gameRefCount.get(gameId) || 0;
        this.gameRefCount.set(gameId, count + 1);
        if (!this.trackedGames.has(gameId)) {
          this.trackedGames.add(gameId);
          this.engineClient.emit('join:game', gameId);
        }
      });

      // Subscribe to tournament events
      socket.on('subscribe:tournament', (tournamentId: string) => {
        if (typeof tournamentId !== 'string' || !TOURNAMENT_ID_REGEX.test(tournamentId)) return;
        // GW-WS1: Enforce per-socket subscription cap
        if (socket.subscribedTournaments!.size >= MAX_TOURNAMENT_SUBS_PER_SOCKET) {
          socket.emit('error', { message: `Max ${MAX_TOURNAMENT_SUBS_PER_SOCKET} tournament subscriptions per connection` });
          return;
        }
        if (socket.subscribedTournaments!.has(tournamentId)) return; // already subscribed
        socket.join(`tournament:${tournamentId}`);
        socket.subscribedTournaments!.add(tournamentId);

        const count = this.tournamentRefCount.get(tournamentId) || 0;
        this.tournamentRefCount.set(tournamentId, count + 1);
        if (!this.trackedTournaments.has(tournamentId)) {
          this.trackedTournaments.add(tournamentId);
          this.engineClient.emit('join:tournament', tournamentId);
        }
      });

      // Unsubscribe with ref counting cleanup
      socket.on('unsubscribe:game', (gameId: string) => {
        if (!socket.subscribedGames!.has(gameId)) return;
        socket.leave(`game:${gameId}`);
        socket.subscribedGames!.delete(gameId);
        this.decrementGameRef(gameId);
      });

      socket.on('unsubscribe:tournament', (tournamentId: string) => {
        if (!socket.subscribedTournaments!.has(tournamentId)) return;
        socket.leave(`tournament:${tournamentId}`);
        socket.subscribedTournaments!.delete(tournamentId);
        this.decrementTournamentRef(tournamentId);
      });

      // GW-WS2: Cleanup all subscriptions on disconnect
      socket.on('disconnect', () => {
        console.log(`[SocketBridge] Agent disconnected: ${wallet}`);
        // Decrement ref counts for all subscriptions this socket held
        for (const gameId of socket.subscribedGames || []) {
          this.decrementGameRef(gameId);
        }
        for (const tournamentId of socket.subscribedTournaments || []) {
          this.decrementTournamentRef(tournamentId);
        }
        // Auto-unregister webhook on disconnect (ephemeral — re-registers on reconnect)
        if (socket.handshake.auth?.notifyUrl && this.webhookRegistry) {
          this.webhookRegistry.unregister(wallet);
        }
      });
    });
  }

  /**
   * Spectator namespace — no authentication required.
   * Allows frontend viewers to subscribe to live game/tournament events.
   * More restrictive subscription caps than agent namespace.
   */
  private setupSpectatorNamespace() {
    const spectator = this.agentServer.of('/spectator');

    spectator.on('connection', (socket: SpectatorSocket) => {
      socket.subscribedGames = new Set();
      socket.subscribedTournaments = new Set();
      console.log(`[SocketBridge] Spectator connected: ${socket.id}`);

      socket.on('subscribe:game', (gameId: string) => {
        if (typeof gameId !== 'string' || !GAME_ID_REGEX.test(gameId)) return;
        if (socket.subscribedGames!.size >= MAX_SPECTATOR_GAME_SUBS) {
          socket.emit('error', { message: `Max ${MAX_SPECTATOR_GAME_SUBS} game subscriptions per spectator` });
          return;
        }
        if (socket.subscribedGames!.has(gameId)) return;
        socket.join(`game:${gameId}`);
        socket.subscribedGames!.add(gameId);

        // Track on engine side with shared ref counting
        const count = this.gameRefCount.get(gameId) || 0;
        this.gameRefCount.set(gameId, count + 1);
        if (!this.trackedGames.has(gameId)) {
          this.trackedGames.add(gameId);
          this.engineClient.emit('join:game', gameId);
        }
      });

      socket.on('subscribe:tournament', (tournamentId: string) => {
        if (typeof tournamentId !== 'string' || !TOURNAMENT_ID_REGEX.test(tournamentId)) return;
        if (socket.subscribedTournaments!.size >= MAX_SPECTATOR_TOURNAMENT_SUBS) {
          socket.emit('error', { message: `Max ${MAX_SPECTATOR_TOURNAMENT_SUBS} tournament subscriptions per spectator` });
          return;
        }
        if (socket.subscribedTournaments!.has(tournamentId)) return;
        socket.join(`tournament:${tournamentId}`);
        socket.subscribedTournaments!.add(tournamentId);

        const count = this.tournamentRefCount.get(tournamentId) || 0;
        this.tournamentRefCount.set(tournamentId, count + 1);
        if (!this.trackedTournaments.has(tournamentId)) {
          this.trackedTournaments.add(tournamentId);
          this.engineClient.emit('join:tournament', tournamentId);
        }
      });

      socket.on('unsubscribe:game', (gameId: string) => {
        if (!socket.subscribedGames!.has(gameId)) return;
        socket.leave(`game:${gameId}`);
        socket.subscribedGames!.delete(gameId);
        this.decrementGameRef(gameId);
      });

      socket.on('unsubscribe:tournament', (tournamentId: string) => {
        if (!socket.subscribedTournaments!.has(tournamentId)) return;
        socket.leave(`tournament:${tournamentId}`);
        socket.subscribedTournaments!.delete(tournamentId);
        this.decrementTournamentRef(tournamentId);
      });

      socket.on('disconnect', () => {
        console.log(`[SocketBridge] Spectator disconnected: ${socket.id}`);
        for (const gameId of socket.subscribedGames || []) {
          this.decrementGameRef(gameId);
        }
        for (const tournamentId of socket.subscribedTournaments || []) {
          this.decrementTournamentRef(tournamentId);
        }
      });
    });

    console.log('[SocketBridge] Spectator namespace /spectator ready (no auth required)');
  }

  /**
   * Broadcast an event to ALL connected agents and spectators.
   * No room subscription required — every socket receives it.
   */
  broadcastToAllAgents(event: string, data: any): void {
    this.agentServer.emit(event, data);
    this.agentServer.of('/spectator').emit(event, data);
  }

  /**
   * Emit an event to a specific wallet's socket(s).
   * Uses wallet-based rooms for targeted delivery (e.g. win notifications).
   */
  emitToWallet(wallet: string, event: string, data: any): void {
    this.agentServer.to(`wallet:${wallet.toLowerCase()}`).emit(event, data);
  }

  /**
   * Emit an event to all sockets subscribed to a tournament room.
   * Used for tournament lifecycle events (completed, etc.).
   */
  broadcastToTournament(tournamentId: number | string, event: string, data: any): void {
    this.agentServer.to(`tournament:${tournamentId}`).emit(event, data);
    this.agentServer.of('/spectator').to(`tournament:${tournamentId}`).emit(event, data);
  }

  /**
   * Pre-subscribe to a game room on the chess engine and push game:started
   * directly to the participating players by wallet. Called by the orchestrator
   * via /api/internal/game-started so agents learn about games immediately
   * (solves the chicken-and-egg problem where agents can't subscribe to a game
   * room before they know the gameId, but the event fires before they know it).
   */
  notifyGameStarted(gameId: string, white: string, black: string, tournamentId?: number): void {
    this.diagnostics.notifyGameStarted++;
    // Mark as notified so the engine relay doesn't duplicate the event
    this.notifiedGames.add(gameId);
    console.log(`[SocketBridge] notifyGameStarted: ${gameId} white=${white.slice(0,10)} black=${black.slice(0,10)}`);
    // 1. Pre-subscribe to this game room on the chess engine so future
    //    game:move and game:ended events relay through the bridge.
    if (!this.trackedGames.has(gameId)) {
      this.trackedGames.add(gameId);
      this.gameRefCount.set(gameId, (this.gameRefCount.get(gameId) || 0) + 1);
      this.engineClient.emit('join:game', gameId);
    }

    // 2. Track participants so game:move can be pushed directly to wallets
    this.gameParticipants.set(gameId, { white, black });

    // 3. Auto-join BOTH players' sockets into the game room on the gateway side.
    //    This eliminates the race condition where subscribe:game (async) hasn't been
    //    processed yet when game:move fires after white's first move.
    //    Without this, black's socket misses game:move and never knows it's their turn.
    for (const wallet of [white, black]) {
      const walletRoom = `wallet:${wallet.toLowerCase()}`;
      const gameRoom = `game:${gameId}`;
      const sockets = this.agentServer.in(walletRoom).fetchSockets();
      // fetchSockets returns a Promise — fire-and-forget but fast (local adapter)
      (sockets as unknown as Promise<any[]>).then((matched) => {
        if (matched.length > 0) {
          this.diagnostics.autoJoinSuccess++;
          for (const s of matched) {
            s.join(gameRoom);
            if (s.subscribedGames) {
              s.subscribedGames.add(gameId);
            }
          }
          const count = this.gameRefCount.get(gameId) || 0;
          this.gameRefCount.set(gameId, count + matched.length);
        } else {
          this.diagnostics.autoJoinEmpty++;
          console.log(`[SocketBridge] auto-join: no sockets found for ${wallet.slice(0,10)} in ${walletRoom}`);
        }
      }).catch(() => { this.diagnostics.autoJoinEmpty++; });
    }

    // 4. Build the game:started payload
    const data = { gameId, white, black, tournamentId };

    // 5. Push directly to both players by wallet
    this.emitToWallet(white, 'game:started', data);
    this.emitToWallet(black, 'game:started', data);

    // 6. Also deliver via webhook for offline agents
    if (this.webhookRegistry) {
      this.webhookRegistry.deliverToWallets([white, black], 'game:started', data);
    }
  }

  getConnectedAgentCount(): number {
    return this.agentServer.sockets.sockets.size;
  }

  isEngineConnected(): boolean {
    return this.engineClient.connected;
  }

  // GW-WS2: Reference counting helpers
  private decrementGameRef(gameId: string) {
    const count = (this.gameRefCount.get(gameId) || 1) - 1;
    if (count <= 0) {
      this.gameRefCount.delete(gameId);
      this.trackedGames.delete(gameId);
      this.engineClient.emit('leave:game', gameId);
    } else {
      this.gameRefCount.set(gameId, count);
    }
  }

  private decrementTournamentRef(tournamentId: string) {
    const count = (this.tournamentRefCount.get(tournamentId) || 1) - 1;
    if (count <= 0) {
      this.tournamentRefCount.delete(tournamentId);
      this.trackedTournaments.delete(tournamentId);
      this.engineClient.emit('leave:tournament', tournamentId);
    } else {
      this.tournamentRefCount.set(tournamentId, count);
    }
  }

  destroy() {
    this.engineClient.disconnect();
  }
}
