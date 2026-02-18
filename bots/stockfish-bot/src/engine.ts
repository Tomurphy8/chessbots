/**
 * Stockfish UCI engine wrapper using the stockfish WASM npm package.
 *
 * Configurable via env vars:
 *   STOCKFISH_DEPTH  — search depth (default 12)
 *   STOCKFISH_ELO    — optional Elo limit (enables UCI_LimitStrength)
 *   MOVE_TIMEOUT_MS  — max think time before sending "stop" (default 5000)
 */

import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';

const STOCKFISH_DEPTH = parseInt(process.env.STOCKFISH_DEPTH || '12', 10);
const STOCKFISH_ELO = process.env.STOCKFISH_ELO
  ? parseInt(process.env.STOCKFISH_ELO, 10)
  : undefined;
const MOVE_TIMEOUT_MS = parseInt(process.env.MOVE_TIMEOUT_MS || '5000', 10);

type MessageHandler = (line: string) => void;

interface StockfishEngine {
  postMessage: (msg: string) => void;
  addMessageListener: (fn: MessageHandler) => void;
  removeMessageListener: (fn: MessageHandler) => void;
}

let engine: StockfishEngine | null = null;

/**
 * Initialize the WASM Stockfish engine. Must be called once before getBestMove().
 */
export async function initEngine(): Promise<void> {
  // The `stockfish` npm package (v16) has a broken "main" field (src/stockfish.js doesn't exist).
  // The actual single-threaded entry is src/stockfish-nnue-16-single.js (CJS module).
  // We use createRequire to load it since our project is ESM.
  const require = createRequire(import.meta.url);
  const sfPath = require.resolve('stockfish/src/stockfish-nnue-16-single.js');
  const wasmPath = join(dirname(sfPath), 'stockfish-nnue-16-single.wasm');

  // The module exports a factory function
  const Stockfish = require(sfPath) as (opts?: Record<string, unknown>) => Promise<StockfishEngine>;

  engine = await Stockfish({
    locateFile: (file: string) => (file.endsWith('.wasm') ? wasmPath : file),
  });

  // Initialize UCI protocol
  await uciCommand('uci', 'uciok');

  // Configure engine settings
  sendCommand('setoption name Hash value 64');
  sendCommand('setoption name Threads value 1');

  if (STOCKFISH_ELO !== undefined) {
    sendCommand('setoption name UCI_LimitStrength value true');
    sendCommand(`setoption name UCI_Elo value ${STOCKFISH_ELO}`);
  }

  await uciCommand('isready', 'readyok');

  console.log(
    `Stockfish initialized (depth=${STOCKFISH_DEPTH}${STOCKFISH_ELO ? `, elo=${STOCKFISH_ELO}` : ''}, timeout=${MOVE_TIMEOUT_MS}ms)`
  );
}

function sendCommand(cmd: string): void {
  if (!engine) throw new Error('Engine not initialized');
  engine.postMessage(cmd);
}

function uciCommand(cmd: string, waitFor: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!engine) return reject(new Error('Engine not initialized'));

    const timeout = setTimeout(
      () => {
        engine!.removeMessageListener(handler);
        reject(new Error(`UCI timeout waiting for "${waitFor}"`));
      },
      10_000,
    );

    const handler: MessageHandler = (line: string) => {
      if (line.startsWith(waitFor)) {
        clearTimeout(timeout);
        engine!.removeMessageListener(handler);
        resolve(line);
      }
    };

    engine.addMessageListener(handler);
    sendCommand(cmd);
  });
}

/**
 * Get the best move for the given FEN position.
 * Returns a UCI move string (e.g. "e2e4", "g1f3", "e7e8q").
 */
export async function getBestMove(fen: string): Promise<string> {
  if (!engine) throw new Error('Engine not initialized');

  sendCommand(`position fen ${fen}`);

  const response = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      // If we hit the timeout, send "stop" — Stockfish will respond with bestmove
      sendCommand('stop');
    }, MOVE_TIMEOUT_MS);

    const handler: MessageHandler = (line: string) => {
      if (line.startsWith('bestmove')) {
        clearTimeout(timeout);
        engine!.removeMessageListener(handler);
        resolve(line);
      }
    };

    engine!.addMessageListener(handler);
    sendCommand(`go depth ${STOCKFISH_DEPTH}`);
  });

  // Parse "bestmove e2e4 ponder d7d5" → "e2e4"
  const parts = response.split(' ');
  const bestMove = parts[1];

  if (!bestMove || bestMove === '(none)') {
    throw new Error(`Stockfish returned no move: "${response}"`);
  }

  return bestMove;
}
