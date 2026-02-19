import { FastifyInstance, FastifyRequest } from 'fastify';
import { GameManager } from '../../engine/GameManager.js';
import { Server as SocketServer } from 'socket.io';
import { z } from 'zod';
import { timingSafeEqual } from 'crypto';

// Input validation schemas with proper bounds
const GAME_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

const MoveSchema = z.object({
  player: z.string().regex(ADDRESS_REGEX),
  move: z.string().min(2).max(10),
  signature: z.string().max(132).optional(), // Not verified by engine — gateway handles auth
  timestamp: z.number().optional(),
});

const ResignSchema = z.object({
  player: z.string().regex(ADDRESS_REGEX),
});

const CreateGameSchema = z.object({
  gameId: z.string().regex(GAME_ID_REGEX),
  tournamentId: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  round: z.number().int().min(0).max(10000),
  gameIndex: z.number().int().min(0).max(10000),
  white: z.string().regex(ADDRESS_REGEX),
  black: z.string().regex(ADDRESS_REGEX),
  baseTimeSeconds: z.number().int().min(1).max(86400), // CE-H5: bounded
  incrementSeconds: z.number().int().min(0).max(300),  // CE-H5: bounded
}).refine(data => data.white.toLowerCase() !== data.black.toLowerCase(), {
  message: 'White and black must be different players',
});

// CE-C2: Service auth middleware
// FIXED: No longer bypasses auth when key is unset — denies all mutating requests
function serviceAuth(request: FastifyRequest): boolean {
  const apiKey = process.env.SERVICE_API_KEY;
  if (!apiKey) return false; // DENY if no key configured (fail-closed)
  const provided = request.headers['x-service-key'];
  if (typeof provided !== 'string' || !provided) return false;
  // Timing-safe comparison to prevent timing attacks
  if (provided.length !== apiKey.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(apiKey));
}

function validateGameId(gameId: string): boolean {
  return GAME_ID_REGEX.test(gameId);
}

export function registerGameRoutes(app: FastifyInstance, gameManager: GameManager, io: SocketServer) {
  // POST routes require service auth
  app.post('/api/game', async (request, reply) => {
    if (!serviceAuth(request)) return reply.status(403).send({ error: 'Unauthorized' });
    try {
      const body = CreateGameSchema.parse(request.body);
      const info = gameManager.createGame(body.gameId, body.tournamentId, body.round, body.gameIndex, body.white, body.black, { baseTimeSeconds: body.baseTimeSeconds, incrementSeconds: body.incrementSeconds });
      return reply.send(info);
    } catch (err: any) {
      if (err.name === 'ZodError') return reply.status(400).send({ error: 'Invalid input' });
      return reply.status(400).send({ error: err.message || 'Failed to create game' });
    }
  });

  app.post('/api/game/:gameId/start', async (request, reply) => {
    if (!serviceAuth(request)) return reply.status(403).send({ error: 'Unauthorized' });
    const { gameId } = request.params as { gameId: string };
    if (!validateGameId(gameId)) return reply.status(400).send({ error: 'Invalid game ID' });
    try {
      const info = gameManager.startGame(gameId);
      io.to(`game:${gameId}`).emit('game:started', info);
      return reply.send(info);
    } catch (err: any) {
      return reply.status(404).send({ error: 'Game not found' });
    }
  });

  app.post('/api/game/:gameId/move', async (request, reply) => {
    if (!serviceAuth(request)) return reply.status(403).send({ error: 'Unauthorized' });
    const { gameId } = request.params as { gameId: string };
    if (!validateGameId(gameId)) return reply.status(400).send({ error: 'Invalid game ID' });
    try {
      const body = MoveSchema.parse(request.body);
      const result = gameManager.makeMove(gameId, body.player, body.move);
      if (result.success) {
        // Include white/black/legalMoves so bots don't need HTTP calls in the game loop
        const legalMoves = result.info.result === 'undecided' ? gameManager.getLegalMoves(gameId) : [];
        io.to(`game:${gameId}`).emit('game:move', {
          gameId, move: body.move, fen: result.info.fen, moveCount: result.info.moveCount,
          whiteTimeMs: result.info.whiteTimeMs, blackTimeMs: result.info.blackTimeMs,
          white: result.info.white, black: result.info.black, legalMoves,
        });
        if (result.info.result !== 'undecided') {
          io.to(`game:${gameId}`).emit('game:ended', result.info);
          io.to(`tournament:${result.info.tournamentId}`).emit('game:ended', result.info);
        }
      }
      return reply.send(result);
    } catch (err: any) {
      if (err.name === 'ZodError') return reply.status(400).send({ error: 'Invalid input' });
      return reply.status(404).send({ error: 'Game not found' });
    }
  });

  app.get('/api/game/:gameId', async (request, reply) => {
    const { gameId } = request.params as { gameId: string };
    if (!validateGameId(gameId)) return reply.status(400).send({ error: 'Invalid game ID' });
    try {
      return reply.send(gameManager.getGameInfo(gameId));
    } catch {
      return reply.status(404).send({ error: 'Game not found' });
    }
  });

  app.get('/api/game/:gameId/legal-moves', async (request, reply) => {
    const { gameId } = request.params as { gameId: string };
    if (!validateGameId(gameId)) return reply.status(400).send({ error: 'Invalid game ID' });
    try {
      return reply.send({ moves: gameManager.getLegalMoves(gameId) });
    } catch {
      return reply.status(404).send({ error: 'Game not found' });
    }
  });

  app.get('/api/game/:gameId/pgn', async (request, reply) => {
    const { gameId } = request.params as { gameId: string };
    if (!validateGameId(gameId)) return reply.status(400).send({ error: 'Invalid game ID' });
    try {
      return reply.type('text/plain').send(gameManager.getGamePgn(gameId));
    } catch {
      return reply.status(404).send({ error: 'Game not found' });
    }
  });

  // CE-C3: Fixed resign with validation and conditional event emission
  app.post('/api/game/:gameId/resign', async (request, reply) => {
    if (!serviceAuth(request)) return reply.status(403).send({ error: 'Unauthorized' });
    const { gameId } = request.params as { gameId: string };
    if (!validateGameId(gameId)) return reply.status(400).send({ error: 'Invalid game ID' });
    try {
      const { player } = ResignSchema.parse(request.body);
      const { info, applied } = gameManager.resign(gameId, player);
      if (applied) {
        io.to(`game:${gameId}`).emit('game:ended', info);
        io.to(`tournament:${info.tournamentId}`).emit('game:ended', info);
      }
      return reply.send({ ...info, resignApplied: applied });
    } catch (err: any) {
      if (err.name === 'ZodError') return reply.status(400).send({ error: 'Invalid input' });
      return reply.status(404).send({ error: 'Game not found' });
    }
  });

  app.get('/api/games/active', async (_request, reply) => reply.send(gameManager.getActiveGames()));
  app.get('/api/games/all', async (_request, reply) => reply.send({ games: gameManager.getAllGames() }));
  app.get('/api/health', async (_request, reply) => reply.send({
    status: 'ok',
    service: 'chess-engine',
    uptime: process.uptime(),
    activeGames: gameManager.getActiveGames().length,
  }));
}
