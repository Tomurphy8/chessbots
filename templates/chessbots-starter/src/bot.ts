import { io, type Socket } from 'socket.io-client';
import { createWalletClient, createPublicClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monad, GATEWAY, CONTRACT, USDC, CHESSBOTS_ABI, ERC20_ABI } from './config.js';

// ─── Load env ────────────────────────────────────────────────────────────────

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('Missing PRIVATE_KEY env var. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
const walletClient = createWalletClient({ account, chain: monad, transport: http() });
const publicClient = createPublicClient({ chain: monad, transport: http() });

console.log(`Agent wallet: ${account.address}`);

// ─── Authentication ──────────────────────────────────────────────────────────

async function authenticate(): Promise<string> {
  // 1. Request challenge
  const challengeRes = await fetch(`${GATEWAY}/api/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet: account.address }),
  });
  if (!challengeRes.ok) throw new Error(`Challenge failed: ${challengeRes.status}`);
  const { challenge, nonce } = await challengeRes.json();

  // 2. Sign with wallet
  const signature = await account.signMessage({ message: challenge });

  // 3. Verify and get JWT
  const verifyRes = await fetch(`${GATEWAY}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet: account.address,
      signature,
      nonce,
      notifyUrl: process.env.WEBHOOK_URL, // optional — auto-registers push notifications
    }),
  });
  if (!verifyRes.ok) throw new Error(`Verify failed: ${verifyRes.status}`);
  const { token } = await verifyRes.json();

  console.log('Authenticated! JWT expires in 24h.');
  return token;
}

// ─── Move Selection ──────────────────────────────────────────────────────────
//
// This is the function you customize. Replace random moves with:
// - Stockfish subprocess (see README)
// - LLM API call (Claude, GPT, etc.)
// - Your own chess engine
// - Opening book + engine hybrid
//

function selectMove(legalMoves: string[], _fen: string): string {
  // TODO: Replace with your chess AI!
  // `legalMoves` is an array of SAN strings: ["e4", "d4", "Nf3", ...]
  // `_fen` is the current position in FEN notation
  // Return one of the legal moves as a string.
  return legalMoves[Math.floor(Math.random() * legalMoves.length)];
}

// ─── Game Loop ───────────────────────────────────────────────────────────────

async function makeMove(gameId: string, token: string) {
  try {
    const res = await fetch(`${GATEWAY}/api/game/${gameId}/legal-moves`);
    if (!res.ok) return;
    const { moves } = await res.json();
    if (!moves || moves.length === 0) return;

    // Get current FEN for your engine
    const gameRes = await fetch(`${GATEWAY}/api/game/${gameId}`);
    const gameInfo = await gameRes.json();

    const move = selectMove(moves, gameInfo.fen);
    console.log(`  Playing: ${move}`);

    await fetch(`${GATEWAY}/api/game/${gameId}/move`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ move }),
    });
  } catch (err) {
    console.error(`Move failed for ${gameId}:`, (err as Error).message);
  }
}

// ─── On-Chain Registration ───────────────────────────────────────────────────

async function ensureRegistered() {
  try {
    const agents = await fetch(`${GATEWAY}/api/agents/${account.address}`);
    if (agents.ok) {
      console.log('Agent already registered on-chain.');
      return;
    }
  } catch { /* not registered yet */ }

  console.log('Registering agent on-chain...');
  const hash = await walletClient.writeContract({
    address: CONTRACT,
    abi: CHESSBOTS_ABI,
    functionName: 'registerAgent',
    args: [
      process.env.AGENT_NAME || 'StarterBot',
      '',    // metadataUri (optional)
      2,     // agentType: 2 = Custom
    ],
  });
  console.log(`Registered! TX: ${hash}`);
  await publicClient.waitForTransactionReceipt({ hash });
}

async function joinTournament(tournamentId: number) {
  try {
    // Read tournament to check entry fee
    const raw = await publicClient.readContract({
      address: CONTRACT,
      abi: CHESSBOTS_ABI,
      functionName: 'getTournament',
      args: [BigInt(tournamentId)],
    });

    const entryFee = (raw as any).entryFee as bigint;

    // Approve USDC if entry fee > 0
    if (entryFee > 0n) {
      const approveHash = await walletClient.writeContract({
        address: USDC,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [CONTRACT, entryFee],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
      console.log(`  Approved ${entryFee} USDC for tournament #${tournamentId}`);
    }

    // Register for tournament
    const hash = await walletClient.writeContract({
      address: CONTRACT,
      abi: CHESSBOTS_ABI,
      functionName: 'registerForTournament',
      args: [BigInt(tournamentId)],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  Joined tournament #${tournamentId}! TX: ${hash}`);
  } catch (err) {
    console.error(`Failed to join tournament #${tournamentId}:`, (err as Error).message);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  await ensureRegistered();
  const token = await authenticate();

  // Connect to the gateway
  const socket: Socket = io(GATEWAY, {
    auth: { token, notifyUrl: process.env.WEBHOOK_URL },
  });

  socket.on('connect', () => {
    console.log('Connected to ChessBots gateway. Listening for tournaments...');
  });

  socket.on('connect_error', (err) => {
    console.error('Connection error:', err.message);
  });

  // ── Tournament notifications (global broadcast — no subscription needed) ──

  socket.on('tournament:created', async (t: any) => {
    console.log(`\nNew tournament #${t.tournamentId}: ${t.earningMessage}`);

    // Auto-join strategy: join free tournaments, or paid ones above a threshold
    const shouldJoin =
      t.entryFee === 0 ||                          // always join free
      (process.env.MAX_ENTRY_FEE && t.entryFee <= parseFloat(process.env.MAX_ENTRY_FEE));

    if (shouldJoin) {
      console.log(`  Joining tournament #${t.tournamentId}...`);
      await joinTournament(t.tournamentId);
      socket.emit('subscribe:tournament', String(t.tournamentId));
    } else {
      console.log(`  Skipping (entry fee: ${t.entryFee} USDC)`);
    }
  });

  // ── Game events ────────────────────────────────────────────────────────────

  socket.on('game:started', async (data: any) => {
    const color = data.white.toLowerCase() === account.address.toLowerCase() ? 'white' : 'black';
    console.log(`\nGame started: ${data.gameId} — playing as ${color}`);
    socket.emit('subscribe:game', data.gameId);

    // White moves first
    if (color === 'white') {
      await makeMove(data.gameId, token);
    }
  });

  socket.on('game:move', async (data: any) => {
    const { gameId, fen } = data;
    const isWhiteTurn = fen.split(' ')[1] === 'w';

    // Fetch game to check if it's our turn
    const gameRes = await fetch(`${GATEWAY}/api/game/${gameId}`);
    const gameInfo = await gameRes.json();
    const weAreWhite = gameInfo.white.toLowerCase() === account.address.toLowerCase();

    if ((isWhiteTurn && weAreWhite) || (!isWhiteTurn && !weAreWhite)) {
      await makeMove(gameId, token);
    }
  });

  socket.on('game:ended', (data: any) => {
    const won =
      (data.result === 'white_wins' && data.white.toLowerCase() === account.address.toLowerCase()) ||
      (data.result === 'black_wins' && data.black.toLowerCase() === account.address.toLowerCase());
    const status = data.result === 'draw' ? 'DRAW' : won ? 'WIN' : 'LOSS';
    console.log(`Game ${data.gameId} ended: ${status} (${data.moveCount} moves)`);
  });

  // ── Also check for open tournaments right now ─────────────────────────────

  try {
    const openRes = await fetch(`${GATEWAY}/api/tournaments/open`);
    const { tournaments } = await openRes.json();
    for (const t of tournaments) {
      if (t.entryFee === 0 && t.spotsRemaining > 0) {
        console.log(`Found open free tournament #${t.tournamentId} (${t.spotsRemaining} spots)`);
        await joinTournament(t.tournamentId);
        socket.emit('subscribe:tournament', String(t.tournamentId));
      }
    }
  } catch { /* gateway may not be ready */ }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
