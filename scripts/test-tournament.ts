/**
 * Test Tournament Script
 * Creates a Free tier tournament, registers 4 test agents, and triggers it.
 *
 * Usage: npx tsx scripts/test-tournament.ts
 *
 * Prerequisites:
 *   - PRIVATE_KEY set in services/tournament-orchestrator/.env
 *   - Deployer wallet has MON for gas
 *   - Tournament contract deployed at MONAD_CONTRACT
 */

import { createPublicClient, createWalletClient, http, defineChain, type Address, type Hash } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import 'dotenv/config';

// ── Config ─────────────────────────────────────────────────────────────────────

const MONAD_RPC = process.env.MONAD_RPC || 'https://testnet-rpc.monad.xyz/';
const CONTRACT = (process.env.MONAD_CONTRACT || '0x376714678A7B332E245b3780795fF6518d66A15c') as Address;
const DEPLOYER_KEY = process.env.PRIVATE_KEY || '';

if (!DEPLOYER_KEY) {
  console.error('FATAL: Set PRIVATE_KEY in .env or environment');
  process.exit(1);
}

const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [MONAD_RPC] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://testnet.monadexplorer.com' } },
});

const TOURNAMENT_ABI = [
  { inputs: [{ name: 'tier', type: 'uint8' }, { name: 'maxPlayers', type: 'uint8' }, { name: 'minPlayers', type: 'uint8' }, { name: 'startTime', type: 'int64' }, { name: 'registrationDeadline', type: 'int64' }, { name: 'baseTimeSeconds', type: 'uint32' }, { name: 'incrementSeconds', type: 'uint32' }], name: 'createTournament', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'name', type: 'string' }, { name: 'metadataUri', type: 'string' }, { name: 'agentType', type: 'uint8' }], name: 'registerAgent', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'tournamentId', type: 'uint256' }], name: 'registerForTournament', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'tournamentId', type: 'uint256' }, { name: 'amount', type: 'uint256' }], name: 'fundTournament', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'tournamentId', type: 'uint256' }], name: 'getTournament', outputs: [{ components: [{ name: 'id', type: 'uint256' }, { name: 'authority', type: 'address' }, { name: 'tier', type: 'uint8' }, { name: 'entryFee', type: 'uint256' }, { name: 'status', type: 'uint8' }, { name: 'maxPlayers', type: 'uint8' }, { name: 'minPlayers', type: 'uint8' }, { name: 'registeredCount', type: 'uint8' }, { name: 'currentRound', type: 'uint8' }, { name: 'totalRounds', type: 'uint8' }, { name: 'startTime', type: 'int64' }, { name: 'registrationDeadline', type: 'int64' }, { name: 'baseTimeSeconds', type: 'uint32' }, { name: 'incrementSeconds', type: 'uint32' }, { name: 'winners', type: 'address[3]' }, { name: 'resultsUri', type: 'string' }, { name: 'prizeDistributed', type: 'bool' }, { name: 'exists', type: 'bool' }], name: '', type: 'tuple' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'protocol', outputs: [{ name: 'authority', type: 'address' }, { name: 'treasury', type: 'address' }, { name: 'protocolFeeBps', type: 'uint16' }, { name: 'buybackShareBps', type: 'uint16' }, { name: 'treasuryShareBps', type: 'uint16' }, { name: 'totalTournaments', type: 'uint64' }, { name: 'totalPrizeDistributed', type: 'uint64' }, { name: 'paused', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'wallet', type: 'address' }], name: 'getAgent', outputs: [{ components: [{ name: 'wallet', type: 'address' }, { name: 'name', type: 'string' }, { name: 'metadataUri', type: 'string' }, { name: 'agentType', type: 'uint8' }, { name: 'eloRating', type: 'uint16' }, { name: 'gamesPlayed', type: 'uint32' }, { name: 'gamesWon', type: 'uint32' }, { name: 'gamesDrawn', type: 'uint32' }, { name: 'gamesLost', type: 'uint32' }, { name: 'totalEarnings', type: 'uint64' }, { name: 'referredBy', type: 'address' }, { name: 'registered', type: 'bool' }], name: '', type: 'tuple' }], stateMutability: 'view', type: 'function' },
] as const;

// ── Clients ────────────────────────────────────────────────────────────────────

const deployerAccount = privateKeyToAccount(DEPLOYER_KEY as `0x${string}`);

const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(MONAD_RPC),
});

const deployerWallet = createWalletClient({
  account: deployerAccount,
  chain: monadTestnet,
  transport: http(MONAD_RPC),
});

async function confirmTx(hash: Hash, label: string) {
  console.log(`  [tx] ${label}: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status === 'reverted') {
    throw new Error(`Transaction reverted: ${label}`);
  }
  console.log(`  [tx] ${label}: confirmed (block ${receipt.blockNumber})`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════');
  console.log('  ChessBots Test Tournament');
  console.log('═══════════════════════════════════════════\n');
  console.log(`Deployer: ${deployerAccount.address}`);
  console.log(`Contract: ${CONTRACT}`);
  console.log(`RPC: ${MONAD_RPC}\n`);

  // Check protocol state
  const protocol = await publicClient.readContract({
    address: CONTRACT,
    abi: TOURNAMENT_ABI,
    functionName: 'protocol',
  });
  const totalTournaments = Number(protocol[5]);
  console.log(`Total tournaments so far: ${totalTournaments}`);
  // Tournament IDs are 0-indexed: next ID = current count (before increment)
  const newTournamentId = totalTournaments;

  // ── Step 1: Generate 4 test wallets ───────────────────────────────────────
  console.log('\n── Step 1: Generate test wallets ──');
  const testWallets: { key: `0x${string}`; address: Address }[] = [];
  for (let i = 0; i < 4; i++) {
    const key = generatePrivateKey();
    const account = privateKeyToAccount(key);
    testWallets.push({ key, address: account.address });
    console.log(`  Agent ${i + 1}: ${account.address}`);
  }

  // ── Step 2: Fund test wallets with MON for gas ──────────────────────────
  console.log('\n── Step 2: Fund test wallets with MON ──');
  const gasAmount = BigInt('100000000000000000'); // 0.1 MON each
  for (const wallet of testWallets) {
    const hash = await deployerWallet.sendTransaction({
      to: wallet.address,
      value: gasAmount,
    });
    await confirmTx(hash, `Fund ${wallet.address.slice(0, 10)}...`);
  }

  // ── Step 3: Create Free tier tournament ────────────────────────────────
  console.log('\n── Step 3: Create Free tier tournament ──');
  const now = Math.floor(Date.now() / 1000);
  const registrationDeadline = BigInt(now + 30); // 30 seconds from now (tight for testing)
  const startTime = BigInt(now + 60); // 1 minute from now

  const createHash = await deployerWallet.writeContract({
    address: CONTRACT,
    abi: TOURNAMENT_ABI,
    functionName: 'createTournament',
    args: [
      5,    // tier: Free (5)
      8,    // maxPlayers
      4,    // minPlayers
      startTime,
      registrationDeadline,
      300,  // baseTimeSeconds (5 min)
      3,    // incrementSeconds
    ],
  });
  await confirmTx(createHash, `createTournament(${newTournamentId})`);

  // Verify tournament
  const tournament = await publicClient.readContract({
    address: CONTRACT,
    abi: TOURNAMENT_ABI,
    functionName: 'getTournament',
    args: [BigInt(newTournamentId)],
  });
  console.log(`  Tournament #${newTournamentId} created!`);
  console.log(`  Tier: Free, Status: ${tournament.status}, MaxPlayers: ${tournament.maxPlayers}`);
  console.log(`  Registration deadline: ${new Date(Number(registrationDeadline) * 1000).toISOString()}`);

  // ── Step 4: Register agents ─────────────────────────────────────────────
  console.log('\n── Step 4: Register agents ──');
  const agentNames = ['AlphaKnight', 'DeepRook', 'QuantumBishop', 'NeuroPawn'];
  for (let i = 0; i < testWallets.length; i++) {
    const wallet = testWallets[i];
    const agentWallet = createWalletClient({
      account: privateKeyToAccount(wallet.key),
      chain: monadTestnet,
      transport: http(MONAD_RPC),
    });

    // Check if already registered
    try {
      const existing = await publicClient.readContract({
        address: CONTRACT,
        abi: TOURNAMENT_ABI,
        functionName: 'getAgent',
        args: [wallet.address],
      });
      if (existing.registered) {
        console.log(`  ${agentNames[i]}: already registered, skipping.`);
        continue;
      }
    } catch { /* not registered */ }

    const hash = await agentWallet.writeContract({
      address: CONTRACT,
      abi: TOURNAMENT_ABI,
      functionName: 'registerAgent',
      args: [agentNames[i], `https://chessbots.io/agents/${wallet.address}`, 2], // Custom type
    });
    await confirmTx(hash, `registerAgent(${agentNames[i]})`);
  }

  // ── Step 5: Register for tournament ──────────────────────────────────────
  console.log('\n── Step 5: Register for tournament ──');
  for (let i = 0; i < testWallets.length; i++) {
    const wallet = testWallets[i];
    const agentWallet = createWalletClient({
      account: privateKeyToAccount(wallet.key),
      chain: monadTestnet,
      transport: http(MONAD_RPC),
    });

    const hash = await agentWallet.writeContract({
      address: CONTRACT,
      abi: TOURNAMENT_ABI,
      functionName: 'registerForTournament',
      args: [BigInt(newTournamentId)],
    });
    await confirmTx(hash, `registerForTournament(${agentNames[i]})`);
  }

  // Verify registration count
  const updatedTournament = await publicClient.readContract({
    address: CONTRACT,
    abi: TOURNAMENT_ABI,
    functionName: 'getTournament',
    args: [BigInt(newTournamentId)],
  });
  console.log(`\n  Registered: ${updatedTournament.registeredCount}/${updatedTournament.maxPlayers}`);

  // ── Step 6: Wait for orchestrator ────────────────────────────────────────
  const deadlineMs = Number(registrationDeadline) * 1000;
  const waitMs = deadlineMs - Date.now() + 5000; // Wait until deadline + 5s
  if (waitMs > 0) {
    console.log(`\n── Step 6: Waiting ${Math.ceil(waitMs / 1000)}s for registration deadline... ──`);
    console.log('  The orchestrator (in watch mode) will pick up the tournament automatically.');
    console.log(`  Monitor logs: railway logs --service tournament-orchestrator`);
    console.log(`  View on-chain: ${monadTestnet.blockExplorers.default.url}/address/${CONTRACT}`);
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('  Setup Complete!');
  console.log('═══════════════════════════════════════════');
  console.log(`\n  Tournament ID: ${newTournamentId}`);
  console.log(`  Players: ${testWallets.map(w => w.address.slice(0, 10) + '...').join(', ')}`);
  console.log(`  Deadline: ${new Date(deadlineMs).toISOString()}`);
  console.log(`\n  Watch the orchestrator: railway logs --service tournament-orchestrator -f`);
  console.log(`  View game page: https://chessbots.io/tournaments/${newTournamentId}`);
  console.log('');
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
