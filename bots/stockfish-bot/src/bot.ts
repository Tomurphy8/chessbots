// ChessBots Stockfish Agent — gasless via ERC-2771 meta-transactions
import 'dotenv/config';
import { io, type Socket } from 'socket.io-client';
import {
  createWalletClient,
  createPublicClient,
  http,
  encodeFunctionData,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  monad,
  GATEWAY,
  CONTRACT,
  USDC,
  RELAYER_URL,
  CHESSBOTS_ABI,
  ERC20_ABI,
  EIP712_DOMAIN,
  FORWARD_REQUEST_TYPES,
} from './config.js';
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

// ─── Gasless Meta-Transaction Helper ─────────────────────────────────────────
//
// Every on-chain write goes through this function:
// 1. Try the relayer (gasless — signs EIP-712, relayer pays gas)
// 2. Fall back to direct writeContract (requires MON for gas)

// NOTE: V4 contract uses msg.sender (NOT _msgSender / ERC-2771), so relayer
// meta-transactions all appear as the ChessForwarder address. Until V4 adds
// ERC-2771 support, bots MUST use direct transactions for correct identity.
async function relayOrWrite(
  _contract: Address,
  _calldata: Hex,
  directWrite: () => Promise<Hex>,
  _gasLimit: bigint = 500_000n,
): Promise<Hex> {
  return directWrite();
}

// ─── Authentication ──────────────────────────────────────────────────────────

async function authenticate(): Promise<string> {
  const challengeRes = await fetch(`${GATEWAY}/api/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet: account.address }),
  });
  if (!challengeRes.ok) throw new Error(`Challenge failed: ${challengeRes.status}`);
  const { challenge, nonce } = await challengeRes.json();

  const signature = await account.signMessage({ message: challenge });

  const verifyRes = await fetch(`${GATEWAY}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet: account.address,
      signature,
      nonce,
      notifyUrl: process.env.WEBHOOK_URL,
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
    return uciMove;
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

// ─── On-Chain Registration (gasless) ─────────────────────────────────────────

async function ensureRegistered() {
  try {
    const agents = await fetch(`${GATEWAY}/api/agents/${account.address}`);
    if (agents.ok) {
      console.log('Agent already registered on-chain.');
      return;
    }
  } catch { /* gateway may not be ready */ }

  const agentName = process.env.AGENT_NAME || 'StockfishBot';
  const referrer = process.env.REFERRER_ADDRESS;

  try {
    if (referrer && /^0x[a-fA-F0-9]{40}$/.test(referrer)) {
      console.log(`Registering with referral (referrer: ${referrer})...`);

      const calldata = encodeFunctionData({
        abi: CHESSBOTS_ABI,
        functionName: 'registerAgentWithReferral',
        args: [agentName, '', 2, referrer as `0x${string}`],
      });

      const hash = await relayOrWrite(CONTRACT, calldata, () =>
        walletClient.writeContract({
          address: CONTRACT,
          abi: CHESSBOTS_ABI,
          functionName: 'registerAgentWithReferral',
          args: [agentName, '', 2, referrer as `0x${string}`],
        }),
      );
      console.log(`Registered with referral! TX: ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
    } else {
      console.log('Registering agent on-chain...');

      const calldata = encodeFunctionData({
        abi: CHESSBOTS_ABI,
        functionName: 'registerAgent',
        args: [agentName, '', 2],
      });

      const hash = await relayOrWrite(CONTRACT, calldata, () =>
        walletClient.writeContract({
          address: CONTRACT,
          abi: CHESSBOTS_ABI,
          functionName: 'registerAgent',
          args: [agentName, '', 2],
        }),
      );
      console.log(`Registered! TX: ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  AUTONOMOUS ECONOMIC AGENT ACTIVE`);
    console.log(`  Agent: ${agentName}`);
    console.log(`  Wallet: ${account.address}`);
    console.log(``);
    console.log(`  YOUR REFERRAL CODE (share to earn USDC automatically):`);
    console.log(`  REFERRER_ADDRESS=${account.address}`);
    console.log(`${'='.repeat(60)}\n`);
  } catch (err: any) {
    if (err?.cause?.reason === 'Already registered' || err?.message?.includes('Already registered')) {
      console.log('Agent already registered on-chain (confirmed via revert).');
    } else {
      throw err;
    }
  }
}

async function joinTournament(tournamentId: number) {
  // Stagger join attempts across bots to avoid relayer rate limits
  const jitter = Math.floor(Math.random() * 10000);
  await new Promise(r => setTimeout(r, jitter));

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        const backoff = 3000 + Math.floor(Math.random() * 5000);
        console.log(`  Retry #${attempt} for tournament #${tournamentId} in ${backoff}ms...`);
        await new Promise(r => setTimeout(r, backoff));
      }

      const raw = await publicClient.readContract({
        address: CONTRACT,
        abi: CHESSBOTS_ABI,
        functionName: 'getTournament',
        args: [BigInt(tournamentId)],
      });

      const entryFee = (raw as any).entryFee as bigint;
      const status = Number((raw as any).status);
      if (status !== 0) {
        console.log(`  Tournament #${tournamentId} not in registration (status=${status}), skipping.`);
        return;
      }

      if (entryFee > 0n) {
        const approveCalldata = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [CONTRACT, entryFee],
        });

        const approveHash = await relayOrWrite(USDC, approveCalldata, () =>
          walletClient.writeContract({
            address: USDC,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [CONTRACT, entryFee],
          }),
        );
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
        console.log(`  Approved ${entryFee} USDC for tournament #${tournamentId}`);
      }

      const joinCalldata = encodeFunctionData({
        abi: CHESSBOTS_ABI,
        functionName: 'registerForTournament',
        args: [BigInt(tournamentId)],
      });

      const hash = await relayOrWrite(CONTRACT, joinCalldata, () =>
        walletClient.writeContract({
          address: CONTRACT,
          abi: CHESSBOTS_ABI,
          functionName: 'registerForTournament',
          args: [BigInt(tournamentId)],
          gas: 200_000n,
        }),
      );
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  Joined tournament #${tournamentId}! TX: ${hash}`);
      return; // success
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('Already registered') || msg.includes('Not in registration')) {
        console.log(`  Tournament #${tournamentId}: ${msg.includes('Already') ? 'already registered' : 'registration closed'}`);
        return;
      }
      if (attempt === 2) {
        console.error(`Failed to join tournament #${tournamentId} after 3 attempts:`, msg);
      }
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Initialize Stockfish WASM engine
  await initEngine();

  await ensureRegistered();
  const token = await authenticate();

  const socket: Socket = io(GATEWAY, {
    auth: { token, notifyUrl: process.env.WEBHOOK_URL },
  });

  socket.on('connect', () => {
    console.log('Connected to ChessBots gateway. Listening for tournaments...');
  });

  socket.on('connect_error', (err) => {
    console.error('Connection error:', err.message);
  });

  // ── Tournament notifications ──────────────────────────────────────────────

  let currentMaxFee = parseFloat(process.env.MAX_ENTRY_FEE || '0');

  socket.on('tournament:created', async (t: any) => {
    console.log(`\nNew tournament #${t.tournamentId}: ${t.earningMessage}`);

    const shouldJoin =
      t.entryFee === 0 ||
      t.entryFee <= currentMaxFee;

    if (shouldJoin) {
      console.log(`  Joining tournament #${t.tournamentId}...`);
      await joinTournament(t.tournamentId);
      socket.emit('subscribe:tournament', String(t.tournamentId));
    } else {
      console.log(`  Skipping (entry fee: ${t.entryFee} USDC, current max: ${currentMaxFee} USDC)`);
    }
  });

  // ── Game events ───────────────────────────────────────────────────────────

  const startedGames = new Set<string>();
  const activePollers = new Map<string, boolean>();

  async function pollGame(gameId: string, myColor: 'white' | 'black') {
    activePollers.set(gameId, true);
    const POLL_INTERVAL = 2000;

    while (activePollers.get(gameId)) {
      try {
        const gameRes = await fetch(`${GATEWAY}/api/game/${gameId}`);
        if (!gameRes.ok) {
          if (gameRes.status === 404) break;
          await new Promise(r => setTimeout(r, POLL_INTERVAL));
          continue;
        }

        const game = await gameRes.json();

        if (game.status === 'completed' || game.status === 'adjudicated' || game.result !== 'undecided') {
          const won =
            (game.result === 'white_wins' && myColor === 'white') ||
            (game.result === 'black_wins' && myColor === 'black');
          const status = game.result === 'draw' ? 'DRAW' : won ? 'WIN' : 'LOSS';
          console.log(`Game ${gameId} ended: ${status} (${game.moveCount} moves)`);
          break;
        }

        const isWhiteTurn = game.fen.split(' ')[1] === 'w';
        const isOurTurn = (isWhiteTurn && myColor === 'white') || (!isWhiteTurn && myColor === 'black');

        if (isOurTurn) {
          await makeMove(gameId, token);
        }
      } catch (err) {
        console.error(`Poll error for ${gameId}:`, (err as Error).message);
      }

      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }

    activePollers.delete(gameId);
    startedGames.delete(gameId);
  }

  socket.on('game:started', async (data: any) => {
    const myAddr = account.address.toLowerCase();
    const isParticipant = data.white?.toLowerCase() === myAddr || data.black?.toLowerCase() === myAddr;
    if (!isParticipant) return;

    if (startedGames.has(data.gameId)) return;
    startedGames.add(data.gameId);

    const color = data.white.toLowerCase() === myAddr ? 'white' : 'black';
    console.log(`\nGame started: ${data.gameId} — playing as ${color}`);
    socket.emit('subscribe:game', data.gameId);

    if (color === 'white') {
      await makeMove(data.gameId, token);
    }

    pollGame(data.gameId, color);
  });

  socket.on('game:move', async (data: any) => {
    const { gameId, fen, white, black, legalMoves } = data;
    const myAddr = account.address.toLowerCase();

    if (white && black) {
      const weAreWhite = white.toLowerCase() === myAddr;
      const weAreBlack = black.toLowerCase() === myAddr;
      if (!weAreWhite && !weAreBlack) return;

      const isWhiteTurn = fen.split(' ')[1] === 'w';
      const isOurTurn = (isWhiteTurn && weAreWhite) || (!isWhiteTurn && weAreBlack);
      if (!isOurTurn) return;

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
            console.error(`  Move POST ${res.status}: ${errBody}`);
          }
        } catch (err) {
          console.error(`Move failed for ${gameId}:`, (err as Error).message);
        }
      }
    }
  });

  socket.on('game:ended', (data: any) => {
    activePollers.set(data.gameId, false);
    startedGames.delete(data.gameId);
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

  // ── Balance check ─────────────────────────────────────────────────────────

  async function checkBalance(): Promise<{ mon: string; usdc: string }> {
    const res = await fetch(`${GATEWAY}/api/agents/balance`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Balance check failed: ${res.status}`);
    return res.json();
  }

  try {
    const bal = await checkBalance();
    console.log(`Wallet balance: ${bal.mon} MON, ${bal.usdc} USDC`);
  } catch { /* gateway may not be ready */ }

  // ── Check for open tournaments now ────────────────────────────────────────

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

  // ── Autonomous Economics Loop ─────────────────────────────────────────────

  const TIER_FEES = [
    { name: 'free', fee: 0 },
    { name: 'rookie', fee: 5 },
    { name: 'bronze', fee: 50 },
    { name: 'silver', fee: 100 },
    { name: 'masters', fee: 250 },
    { name: 'legends', fee: 500 },
  ];

  const autoClaimEnabled = process.env.AUTO_CLAIM_EARNINGS !== 'false';
  const autoTierUpEnabled = process.env.AUTO_TIER_UP !== 'false';
  const economicsInterval = parseInt(process.env.ECONOMICS_INTERVAL || '300000');
  const CLAIM_THRESHOLD = 1_000_000n; // $1 USDC (6 decimals)

  console.log(`\n[Economics] Autonomous mode: claim=${autoClaimEnabled}, tierUp=${autoTierUpEnabled}, interval=${economicsInterval / 1000}s`);

  const economicsTick = async () => {
    try {
      const balance = await publicClient.readContract({
        address: USDC,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [account.address],
      });
      const balanceUsdc = Number(balance) / 1e6;

      const earnings = await publicClient.readContract({
        address: CONTRACT,
        abi: CHESSBOTS_ABI,
        functionName: 'referralEarnings',
        args: [account.address],
      }) as bigint;

      const refCount = await publicClient.readContract({
        address: CONTRACT,
        abi: CHESSBOTS_ABI,
        functionName: 'referralCount',
        args: [account.address],
      }) as number;

      const [tier, rateBps] = await publicClient.readContract({
        address: CONTRACT,
        abi: CHESSBOTS_ABI,
        functionName: 'getReferrerTier',
        args: [account.address],
      }) as [number, number, number];

      const tierName = ['Bronze', 'Silver', 'Gold'][tier] || 'Bronze';
      const earningsUsdc = Number(earnings) / 1e6;

      console.log(`[Economics] Balance: $${balanceUsdc.toFixed(2)} | Earnings: $${earningsUsdc.toFixed(2)} | Referrals: ${refCount} (${tierName} ${Number(rateBps) / 100}%)`);

      if (autoClaimEnabled && earnings > CLAIM_THRESHOLD) {
        console.log(`[Economics] Claiming $${earningsUsdc.toFixed(2)} referral earnings...`);
        try {
          const claimCalldata = encodeFunctionData({
            abi: CHESSBOTS_ABI,
            functionName: 'claimReferralEarnings',
          });

          const hash = await relayOrWrite(CONTRACT, claimCalldata, () =>
            walletClient.writeContract({
              address: CONTRACT,
              abi: CHESSBOTS_ABI,
              functionName: 'claimReferralEarnings',
            }),
          );
          await publicClient.waitForTransactionReceipt({ hash });
          console.log(`[Economics] Claimed! TX: ${hash}`);
        } catch (e) {
          console.error('[Economics] Claim failed:', (e as Error).message);
        }
      }

      if (autoTierUpEnabled) {
        const totalUsdc = balanceUsdc + (autoClaimEnabled && earnings > CLAIM_THRESHOLD ? earningsUsdc : 0);
        const disposable = totalUsdc * 0.8;
        let newMax = 0;
        let newTierName = 'free';
        for (const { name, fee } of TIER_FEES) {
          if (disposable >= fee * 3) {
            newMax = fee;
            newTierName = name;
          }
        }
        if (newMax > currentMaxFee) {
          console.log(`[Economics] TIER UP: $${currentMaxFee} → $${newMax} (${newTierName})`);
          currentMaxFee = newMax;
        }
      }

      console.log(`[Referral] Share your code: REFERRER_ADDRESS=${account.address}`);
    } catch (err) {
      console.error('[Economics] Error:', (err as Error).message);
    }
  };

  setTimeout(economicsTick, 10_000);
  setInterval(economicsTick, economicsInterval);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
