import { io, type Socket } from 'socket.io-client';
import { createWalletClient, createPublicClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monad, GATEWAY, CONTRACT, USDC, CHESSBOTS_ABI, ERC20_ABI } from './config.js';
import { initEngine, getBestMove } from './engine.js';

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

// ─── Move Selection (Stockfish) ──────────────────────────────────────────────

async function selectMove(legalMoves: string[], fen: string): Promise<string> {
  try {
    const uciMove = await getBestMove(fen);
    return uciMove; // Gateway accepts both UCI and SAN notation
  } catch (err) {
    console.error('Stockfish failed, falling back to random:', (err as Error).message);
    return legalMoves[Math.floor(Math.random() * legalMoves.length)];
  }
}

// ─── Game Loop ───────────────────────────────────────────────────────────────

async function makeMove(gameId: string, token: string) {
  try {
    const res = await fetch(`${GATEWAY}/api/game/${gameId}/legal-moves`);
    if (!res.ok) return;
    const { moves } = await res.json();
    if (!moves || moves.length === 0) return;

    // Get current FEN for Stockfish
    const gameRes = await fetch(`${GATEWAY}/api/game/${gameId}`);
    const gameInfo = await gameRes.json();

    const move = await selectMove(moves, gameInfo.fen);
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

  const agentName = process.env.AGENT_NAME || 'StockfishBot';
  const referrer = process.env.REFERRER_ADDRESS;

  if (referrer && /^0x[a-fA-F0-9]{40}$/.test(referrer)) {
    // Register with referral — both you and the referrer earn rewards:
    // • You get 1% discount on tournament entry fees (first 25 tournaments)
    // • Referrer earns 5-10% of your entry fees (based on their referral tier)
    console.log(`Registering with referral (referrer: ${referrer})...`);
    const hash = await walletClient.writeContract({
      address: CONTRACT,
      abi: CHESSBOTS_ABI,
      functionName: 'registerAgentWithReferral',
      args: [agentName, '', 2, referrer as `0x${string}`],
    });
    console.log(`Registered with referral! TX: ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
  } else {
    console.log('Registering agent on-chain...');
    const hash = await walletClient.writeContract({
      address: CONTRACT,
      abi: CHESSBOTS_ABI,
      functionName: 'registerAgent',
      args: [agentName, '', 2],
    });
    console.log(`Registered! TX: ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
  }

  // Referral program info — earn USDC by referring other agents!
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  💰 EARN USDC: Refer other agents to ChessBots!`);
  console.log(`  Share your address as their REFERRER_ADDRESS:`);
  console.log(`  ${account.address}`);
  console.log(`  • Bronze (1-9 referrals): 5% of their entry fees`);
  console.log(`  • Silver (10-24 referrals): 7% of their entry fees`);
  console.log(`  • Gold (25+ referrals): 10% of their entry fees`);
  console.log(`  Learn more: https://chessbots.io/earn`);
  console.log(`${'─'.repeat(60)}\n`);
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
  // Initialize Stockfish WASM engine
  await initEngine();

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

    // Auto-join strategy: join free tournaments, or paid ones below a threshold
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

  // Track games we've already started handling to prevent duplicate game:started events
  const startedGames = new Set<string>();

  socket.on('game:started', async (data: any) => {
    // Only react to games we're actually participating in
    const myAddr = account.address.toLowerCase();
    const isParticipant = data.white?.toLowerCase() === myAddr || data.black?.toLowerCase() === myAddr;
    if (!isParticipant) return;

    // Deduplicate — gateway may deliver game:started via multiple paths
    if (startedGames.has(data.gameId)) return;
    startedGames.add(data.gameId);

    const color = data.white.toLowerCase() === myAddr ? 'white' : 'black';
    console.log(`\nGame started: ${data.gameId} — playing as ${color}`);
    socket.emit('subscribe:game', data.gameId);

    // White moves first
    if (color === 'white') {
      await makeMove(data.gameId, token);
    }
  });

  socket.on('game:move', async (data: any) => {
    const { gameId, fen, white, black, legalMoves } = data;
    console.log(`  [game:move RAW] ${gameId} keys=${Object.keys(data).join(',')} white=${white?.slice(0,10)} black=${black?.slice(0,10)} fen_turn=${fen?.split(' ')[1]} myAddr=${account.address.slice(0,10)}`);

    // Only respond to games we're actually participating in
    const myAddr = account.address.toLowerCase();
    const weAreWhite = white?.toLowerCase() === myAddr;
    const weAreBlack = black?.toLowerCase() === myAddr;
    if (!weAreWhite && !weAreBlack) {
      console.log(`  [game:move] ${gameId} — NOT participant, skipping`);
      return;
    }

    const isWhiteTurn = fen.split(' ')[1] === 'w';
    const isOurTurn = (isWhiteTurn && weAreWhite) || (!isWhiteTurn && weAreBlack);
    if (!isOurTurn) return;

    console.log(`  [game:move] ${gameId} turn=${isWhiteTurn ? 'w' : 'b'} weAre=${weAreWhite ? 'white' : 'black'} legalMoves=${legalMoves?.length ?? 'none'}`);

    // Use enriched event data if available (avoids HTTP calls + rate limits)
    if (legalMoves && legalMoves.length > 0) {
      try {
        const move = await selectMove(legalMoves, fen);
        console.log(`  Playing: ${move}`);
        const res = await fetch(`${GATEWAY}/api/game/${gameId}/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ move }),
        });
        if (!res.ok) {
          const errBody = await res.text();
          console.error(`  Move POST failed ${res.status}: ${errBody}`);
        }
      } catch (err) {
        console.error(`Move failed for ${gameId}:`, (err as Error).message);
      }
    } else {
      // Fallback: fetch legal moves via HTTP (older engine without enriched events)
      console.log(`  [game:move] ${gameId} — no enriched data, falling back to HTTP`);
      await makeMove(gameId, token);
    }
  });

  socket.on('game:ended', (data: any) => {
    startedGames.delete(data.gameId);
    const won =
      (data.result === 'white_wins' && data.white.toLowerCase() === account.address.toLowerCase()) ||
      (data.result === 'black_wins' && data.black.toLowerCase() === account.address.toLowerCase());
    const status = data.result === 'draw' ? 'DRAW' : won ? 'WIN' : 'LOSS';
    console.log(`Game ${data.gameId} ended: ${status} (${data.moveCount} moves)`);
  });

  // ── Tournament result notifications ───────────────────────────────────────

  socket.on('tournament:won', async (data: any) => {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`  *** TOURNAMENT WIN! ***`);
    console.log(`  Tournament #${data.tournamentId}: Placed #${data.placement}`);
    console.log(`  Prize: ${data.prizeAmount} USDC`);
    console.log(`  USDC balance: ${data.newUsdcBalance}`);
    console.log(`  ${data.message}`);
    console.log(`${'='.repeat(50)}\n`);
  });

  socket.on('tournament:completed', (data: any) => {
    console.log(`\nTournament #${data.tournamentId} completed!`);
    for (const w of data.winners) {
      console.log(`  #${w.placement}: ${w.wallet.slice(0, 10)}... (${w.prizeAmount} USDC)`);
    }
  });

  // ── Balance check helper ──────────────────────────────────────────────────

  async function checkBalance(): Promise<{ mon: string; usdc: string }> {
    const res = await fetch(`${GATEWAY}/api/agents/balance`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Balance check failed: ${res.status}`);
    return res.json();
  }

  // Log initial balance
  try {
    const bal = await checkBalance();
    console.log(`Wallet balance: ${bal.mon} MON, ${bal.usdc} USDC`);
  } catch { /* gateway may not be ready */ }

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
