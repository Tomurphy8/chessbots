import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { checkMoveRateLimit, checkPublicRateLimit } from '../middleware/rateLimit.js';
import { CONFIG } from '../config.js';
import * as engine from '../proxy/chessEngine.js';
import type { GameArchive } from '../indexer/GameArchive.js';

const GAME_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

const MoveSchema = z.object({
  move: z.string().min(2).max(10),
});

function validateGameId(gameId: string): boolean {
  return typeof gameId === 'string' && GAME_ID_REGEX.test(gameId);
}

export function registerGameRoutes(app: FastifyInstance, gameArchive: GameArchive) {
  // GET /api/game/:gameId - Get game state (engine first, archive fallback)
  app.get('/api/game/:gameId', async (request, reply) => {
    if (!checkPublicRateLimit(request)) return reply.status(429).send({ error: 'Rate limited' });
    const { gameId } = request.params as { gameId: string };
    if (!validateGameId(gameId)) return reply.status(400).send({ error: 'Invalid game ID' });

    // Try chess engine first (live/recent games)
    try {
      const info = await engine.getGameInfo(gameId);
      return reply.send(info);
    } catch {
      // Engine doesn't have it — try archive
    }

    // Fallback: check game archive (completed games persisted by orchestrator)
    const archived = gameArchive.get(gameId);
    if (archived) {
      return reply.send(gameArchive.toGameInfo(archived));
    }

    return reply.status(404).send({ error: 'Game not found' });
  });

  // POST /api/game/:gameId/archive - Store completed game data (service-key auth only)
  app.post('/api/game/:gameId/archive', async (request, reply) => {
    const { gameId } = request.params as { gameId: string };
    if (!validateGameId(gameId)) return reply.status(400).send({ error: 'Invalid game ID' });

    // Service-key auth: only the orchestrator can archive games
    const serviceKey = request.headers['x-service-key'] as string;
    if (!serviceKey || serviceKey !== CONFIG.serviceApiKey) {
      return reply.status(403).send({ error: 'Unauthorized' });
    }

    try {
      const body = request.body as any;
      if (!body || !body.gameId) {
        return reply.status(400).send({ error: 'Missing game data' });
      }

      gameArchive.store({
        gameId: body.gameId,
        tournamentId: body.tournamentId || 0,
        round: body.round || 0,
        gameIndex: body.gameIndex || 0,
        white: body.white || '',
        black: body.black || '',
        pgn: body.pgn || '',
        moves: body.moves || [],
        result: body.result || '',
        moveCount: body.moveCount || 0,
        fen: body.fen || '',
      });

      return reply.send({ ok: true });
    } catch {
      return reply.status(400).send({ error: 'Invalid archive data' });
    }
  });

  // GET /api/game/:gameId/legal-moves - Get legal moves for current position (public)
  app.get('/api/game/:gameId/legal-moves', async (request, reply) => {
    if (!checkPublicRateLimit(request)) return reply.status(429).send({ error: 'Rate limited' });
    const { gameId } = request.params as { gameId: string };
    if (!validateGameId(gameId)) return reply.status(400).send({ error: 'Invalid game ID' });
    try {
      const result = await engine.getLegalMoves(gameId);
      return reply.send(result);
    } catch {
      return reply.status(404).send({ error: 'Game not found' });
    }
  });

  // GET /api/game/:gameId/pgn - Get game PGN (engine first, archive fallback)
  app.get('/api/game/:gameId/pgn', async (request, reply) => {
    if (!checkPublicRateLimit(request)) return reply.status(429).send({ error: 'Rate limited' });
    const { gameId } = request.params as { gameId: string };
    if (!validateGameId(gameId)) return reply.status(400).send({ error: 'Invalid game ID' });

    // Try engine first
    try {
      const pgn = await engine.getGamePgn(gameId);
      return reply.type('text/plain').send(pgn);
    } catch {
      // Engine doesn't have it — try archive
    }

    // Fallback: check archive
    const archived = gameArchive.get(gameId);
    if (archived && archived.pgn) {
      return reply.type('text/plain').send(archived.pgn);
    }

    return reply.status(404).send({ error: 'Game not found' });
  });

  // POST /api/game/:gameId/move - Submit a move (auth required)
  app.post('/api/game/:gameId/move', { preHandler: [requireAuth] }, async (request, reply) => {
    const { gameId } = request.params as { gameId: string };
    if (!validateGameId(gameId)) return reply.status(400).send({ error: 'Invalid game ID' });
    const wallet = request.wallet!;

    try {
      const body = MoveSchema.parse(request.body);

      // 1. Rate limit check
      if (!checkMoveRateLimit(gameId, wallet)) {
        return reply.status(429).send({ error: 'Rate limited: 1 move per second per game' });
      }

      // 2. Verify agent is a player in this game
      let gameInfo;
      try {
        gameInfo = await engine.getGameInfo(gameId);
      } catch {
        return reply.status(404).send({ error: 'Game not found' });
      }

      const isWhite = gameInfo.white.toLowerCase() === wallet.toLowerCase();
      const isBlack = gameInfo.black.toLowerCase() === wallet.toLowerCase();

      if (!isWhite && !isBlack) {
        return reply.status(403).send({ error: 'You are not a player in this game' });
      }

      // 3. Forward to chess engine
      const result = await engine.submitMove(gameId, wallet, body.move);
      return reply.send(result);
    } catch (err: any) {
      if (err.name === 'ZodError') return reply.status(400).send({ error: 'Invalid input' });
      return reply.status(400).send({ error: 'Move failed' });
    }
  });

  // POST /api/game/:gameId/resign - Resign from a game (auth required)
  app.post('/api/game/:gameId/resign', { preHandler: [requireAuth] }, async (request, reply) => {
    const { gameId } = request.params as { gameId: string };
    if (!validateGameId(gameId)) return reply.status(400).send({ error: 'Invalid game ID' });
    const wallet = request.wallet!;

    // Verify agent is a player
    let gameInfo;
    try {
      gameInfo = await engine.getGameInfo(gameId);
    } catch {
      return reply.status(404).send({ error: 'Game not found' });
    }

    if (gameInfo.white.toLowerCase() !== wallet.toLowerCase() &&
        gameInfo.black.toLowerCase() !== wallet.toLowerCase()) {
      return reply.status(403).send({ error: 'You are not a player in this game' });
    }

    try {
      const result = await engine.submitResign(gameId, wallet);
      return reply.send(result);
    } catch {
      return reply.status(400).send({ error: 'Resign failed' });
    }
  });

  // GET /api/my/games - List agent's active games (auth required)
  app.get('/api/my/games', { preHandler: [requireAuth] }, async (request, reply) => {
    const wallet = request.wallet!;
    try {
      const allActive = await engine.getActiveGames();
      const myGames = allActive.filter(
        (g) => g.white.toLowerCase() === wallet.toLowerCase() ||
               g.black.toLowerCase() === wallet.toLowerCase()
      );
      return reply.send(myGames);
    } catch {
      return reply.status(500).send({ error: 'Failed to fetch active games' });
    }
  });
}
