import { io, type Socket } from 'socket.io-client';
import type { Address } from 'viem';
import type { TournamentInfo, GameInfo } from './types.js';

const DEFAULT_GATEWAY = 'https://agent-gateway-production.up.railway.app';

export class GatewayClient {
  private baseUrl: string;
  private token: string | null = null;
  private socket: Socket | null = null;

  constructor(gatewayUrl?: string) {
    this.baseUrl = (gatewayUrl || DEFAULT_GATEWAY).replace(/\/$/, '');
  }

  // ── Authentication ──────────────────────────────────────────────────

  async authenticate(
    address: Address,
    signMessage: (msg: string) => Promise<string>,
    webhookUrl?: string,
  ): Promise<string> {
    // Step 1: Get challenge nonce
    const challengeRes = await this._fetch('/api/auth/challenge', {
      method: 'POST',
      body: JSON.stringify({ address }),
    });
    const { nonce } = challengeRes;

    // Step 2: Sign and verify
    const signature = await signMessage(nonce);
    const verifyRes = await this._fetch('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ address, signature, notifyUrl: webhookUrl }),
    });

    this.token = verifyRes.token as string;
    return this.token!;
  }

  // ── Tournament Discovery ────────────────────────────────────────────

  async getOpenTournaments(): Promise<TournamentInfo[]> {
    const res = await this._fetch('/api/tournaments/open');
    return res.tournaments || [];
  }

  async getTournament(id: number): Promise<TournamentInfo> {
    return this._fetch(`/api/tournaments/${id}`);
  }

  async getRecentTournaments(): Promise<TournamentInfo[]> {
    const res = await this._fetch('/api/tournaments');
    return res.tournaments || [];
  }

  // ── Game Interaction ────────────────────────────────────────────────

  async getGame(gameId: string): Promise<GameInfo> {
    return this._fetch(`/api/game/${gameId}`);
  }

  async getLegalMoves(gameId: string): Promise<string[]> {
    const res = await this._fetch(`/api/game/${gameId}/legal-moves`);
    return res.legalMoves || [];
  }

  async submitMove(gameId: string, move: string): Promise<void> {
    await this._fetch(`/api/game/${gameId}/move`, {
      method: 'POST',
      body: JSON.stringify({ move }),
      auth: true,
    });
  }

  async resignGame(gameId: string): Promise<void> {
    await this._fetch(`/api/game/${gameId}/resign`, {
      method: 'POST',
      auth: true,
    });
  }

  async getMyGames(): Promise<GameInfo[]> {
    const res = await this._fetch('/api/my/games', { auth: true });
    return res.games || [];
  }

  async getActiveGames(): Promise<GameInfo[]> {
    const res = await this._fetch('/api/games/active');
    return res.games || [];
  }

  // ── WebSocket ───────────────────────────────────────────────────────

  connect(webhookUrl?: string): Socket {
    if (this.socket?.connected) return this.socket;

    this.socket = io(this.baseUrl, {
      auth: { token: this.token, notifyUrl: webhookUrl },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    return this.socket;
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  subscribeGame(gameId: string): void {
    this.socket?.emit('subscribe:game', gameId);
  }

  unsubscribeGame(gameId: string): void {
    this.socket?.emit('unsubscribe:game', gameId);
  }

  subscribeTournament(tournamentId: number): void {
    this.socket?.emit('subscribe:tournament', tournamentId);
  }

  unsubscribeTournament(tournamentId: number): void {
    this.socket?.emit('unsubscribe:tournament', tournamentId);
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  // ── Internal ────────────────────────────────────────────────────────

  private async _fetch(
    path: string,
    opts: { method?: string; body?: string; auth?: boolean } = {},
  ): Promise<any> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (opts.auth && this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Gateway ${opts.method || 'GET'} ${path} failed (${res.status}): ${text}`);
    }

    return res.json();
  }
}
