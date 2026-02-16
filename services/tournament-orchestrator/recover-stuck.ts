/**
 * Recovery Script for Stuck Tournaments
 * Pushes tournaments stuck in RoundActive through to completion with all-draw results.
 *
 * Usage: npx tsx services/tournament-orchestrator/recover-stuck.ts
 *
 * Prerequisites:
 *   - PRIVATE_KEY set in services/tournament-orchestrator/.env (deployer/authority wallet)
 */

import {
  createPublicClient, createWalletClient, http, defineChain, keccak256, toHex,
  type Address, type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import 'dotenv/config';

// ── Config ─────────────────────────────────────────────────────────────────────

const MONAD_RPC = process.env.MONAD_RPC || 'https://rpc.monad.xyz/';
const CONTRACT = (process.env.MONAD_CONTRACT || '0xCB030eE8Ee385f91F4372585Fe1fa3147FA192B8') as Address;
const DEPLOYER_KEY = process.env.PRIVATE_KEY || '';

// Tournament IDs to recover
const STUCK_IDS = [3, 4];

if (!DEPLOYER_KEY) {
  console.error('FATAL: Set PRIVATE_KEY in .env or environment');
  process.exit(1);
}

const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [MONAD_RPC] } },
  blockExplorers: { default: { name: 'MonadScan', url: 'https://monadscan.com' } },
});

// Minimal ABI — same entries as client.ts
const ABI = [
  { inputs: [{ name: 'tournamentId', type: 'uint256' }], name: 'getTournament', outputs: [{ components: [{ name: 'id', type: 'uint256' }, { name: 'authority', type: 'address' }, { name: 'tier', type: 'uint8' }, { name: 'entryFee', type: 'uint256' }, { name: 'status', type: 'uint8' }, { name: 'maxPlayers', type: 'uint8' }, { name: 'minPlayers', type: 'uint8' }, { name: 'registeredCount', type: 'uint8' }, { name: 'currentRound', type: 'uint8' }, { name: 'totalRounds', type: 'uint8' }, { name: 'startTime', type: 'int64' }, { name: 'registrationDeadline', type: 'int64' }, { name: 'baseTimeSeconds', type: 'uint32' }, { name: 'incrementSeconds', type: 'uint32' }, { name: 'winners', type: 'address[3]' }, { name: 'resultsUri', type: 'string' }, { name: 'prizeDistributed', type: 'bool' }, { name: 'exists', type: 'bool' }], name: '', type: 'tuple' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'tournamentId', type: 'uint256' }, { name: 'round', type: 'uint8' }, { name: 'gameInputs', type: 'tuple[]', components: [{ name: 'gameIndex', type: 'uint8' }, { name: 'white', type: 'address' }, { name: 'black', type: 'address' }] }], name: 'batchCreateAndStartGames', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'tournamentId', type: 'uint256' }, { name: 'round', type: 'uint8' }, { name: 'results', type: 'tuple[]', components: [{ name: 'gameIndex', type: 'uint8' }, { name: 'result', type: 'uint8' }, { name: 'pgnHash', type: 'bytes32' }, { name: 'resultHash', type: 'bytes32' }, { name: 'moveCount', type: 'uint16' }] }, { name: 'standings', type: 'tuple[]', components: [{ name: 'agent', type: 'address' }, { name: 'score', type: 'uint16' }, { name: 'buchholz', type: 'uint16' }, { name: 'gamesPlayed', type: 'uint8' }, { name: 'gamesWon', type: 'uint8' }, { name: 'gamesDrawn', type: 'uint8' }, { name: 'gamesLost', type: 'uint8' }] }, { name: 'advance', type: 'bool' }], name: 'executeRound', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'tournamentId', type: 'uint256' }, { name: 'winners', type: 'address[3]' }, { name: 'resultsUri', type: 'string' }], name: 'finalizeTournament', outputs: [], stateMutability: 'nonpayable', type: 'function' },
] as const;

const AGENT_JOINED_EVENT = {
  type: 'event' as const,
  name: 'AgentJoined',
  inputs: [
    { name: 'tournamentId', type: 'uint256', indexed: true },
    { name: 'agent', type: 'address', indexed: true },
    { name: 'registeredCount', type: 'uint8', indexed: false },
  ],
};

// ── Clients ────────────────────────────────────────────────────────────────────

const deployerAccount = privateKeyToAccount(DEPLOYER_KEY as `0x${string}`);

const publicClient = createPublicClient({
  chain: monad,
  transport: http(MONAD_RPC),
});

const walletClient = createWalletClient({
  account: deployerAccount,
  chain: monad,
  transport: http(MONAD_RPC),
});

async function confirmTx(hash: Hash, label: string) {
  console.log(`    [tx] ${label}: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status === 'reverted') {
    throw new Error(`Transaction reverted: ${label}`);
  }
  console.log(`    [tx] ${label}: confirmed (block ${receipt.blockNumber})`);
}

// ── Wallet Discovery ───────────────────────────────────────────────────────────

async function getRegisteredWallets(tournamentId: number, expectedCount: number): Promise<Address[]> {
  const CHUNK_SIZE = 99n;
  const PARALLEL_BATCH = 5;
  const latestBlock = await publicClient.getBlockNumber();
  const wallets: Address[] = [];

  const scanRanges = [
    { from: latestBlock > 10_000n ? latestBlock - 10_000n : 0n, to: latestBlock },
    { from: latestBlock > 50_000n ? latestBlock - 50_000n : 0n, to: latestBlock > 10_000n ? latestBlock - 10_000n : 0n },
    { from: latestBlock > 200_000n ? latestBlock - 200_000n : 0n, to: latestBlock > 50_000n ? latestBlock - 50_000n : 0n },
  ];

  for (const range of scanRanges) {
    if (range.from >= range.to) continue;

    const chunks: Array<{ from: bigint; to: bigint }> = [];
    for (let from = range.from; from <= range.to; from += CHUNK_SIZE + 1n) {
      const to = from + CHUNK_SIZE > range.to ? range.to : from + CHUNK_SIZE;
      chunks.push({ from, to });
    }

    for (let i = 0; i < chunks.length; i += PARALLEL_BATCH) {
      const batch = chunks.slice(i, i + PARALLEL_BATCH);
      const results = await Promise.allSettled(
        batch.map(chunk =>
          publicClient.getLogs({
            address: CONTRACT,
            event: AGENT_JOINED_EVENT,
            args: { tournamentId: BigInt(tournamentId) },
            fromBlock: chunk.from,
            toBlock: chunk.to,
          })
        )
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          for (const logEntry of result.value) {
            const args = logEntry.args as Record<string, unknown>;
            if (args.agent) wallets.push(args.agent as Address);
          }
        }
      }
    }

    if (wallets.length >= expectedCount) break;
  }

  console.log(`  Found ${wallets.length} registered wallets`);
  return wallets;
}

// ── Recovery Logic ─────────────────────────────────────────────────────────────

async function recoverTournament(tournamentId: number) {
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  Recovering Tournament #${tournamentId}`);
  console.log(`${'═'.repeat(50)}`);

  // 1. Read on-chain state
  const t = await publicClient.readContract({
    address: CONTRACT,
    abi: ABI,
    functionName: 'getTournament',
    args: [BigInt(tournamentId)],
  });

  console.log(`  Status: ${t.status} (need 2=RoundActive)`);
  console.log(`  Round: ${t.currentRound} / ${t.totalRounds}`);
  console.log(`  Players: ${t.registeredCount}`);

  if (t.status !== 2) {
    console.log(`  Skipping — not in RoundActive state`);
    return;
  }

  // 2. Get registered wallets
  console.log(`\n  Discovering registered wallets...`);
  const wallets = await getRegisteredWallets(tournamentId, t.registeredCount);
  if (wallets.length < t.registeredCount) {
    console.error(`  ERROR: Found ${wallets.length} wallets, expected ${t.registeredCount}`);
    return;
  }

  // 3. Process remaining rounds
  for (let round = t.currentRound; round <= t.totalRounds; round++) {
    console.log(`\n  ── Round ${round} / ${t.totalRounds} ──`);

    // Generate sequential pairings
    const gameInputs: Array<{ gameIndex: number; white: Address; black: Address }> = [];
    for (let i = 0; i < wallets.length - 1; i += 2) {
      gameInputs.push({
        gameIndex: Math.floor(i / 2),
        white: wallets[i],
        black: wallets[i + 1],
      });
    }
    console.log(`  Created ${gameInputs.length} pairings`);

    // 3a. Create games on-chain
    console.log(`  Creating games on-chain...`);
    const createHash = await walletClient.writeContract({
      address: CONTRACT,
      abi: ABI,
      functionName: 'batchCreateAndStartGames',
      args: [BigInt(tournamentId), round, gameInputs],
    });
    await confirmTx(createHash, `batchCreateAndStartGames(round ${round})`);

    // 3b. Submit all-draw results
    const results = gameInputs.map((g, i) => ({
      gameIndex: g.gameIndex,
      result: 3, // Draw
      pgnHash: keccak256(toHex(`t${tournamentId}-r${round}-g${i}:recovery:draw`)),
      resultHash: keccak256(toHex(`t${tournamentId}-r${round}-g${i}:result:draw`)),
      moveCount: 0,
    }));

    // Cumulative standings: 1 point per draw per round
    const standings = wallets.map(w => ({
      agent: w,
      score: round, // 1 point per draw, cumulative
      buchholz: 0,
      gamesPlayed: round,
      gamesWon: 0,
      gamesDrawn: round,
      gamesLost: 0,
    }));

    const advance = round < t.totalRounds;
    console.log(`  Submitting results (advance=${advance})...`);
    const execHash = await walletClient.writeContract({
      address: CONTRACT,
      abi: ABI,
      functionName: 'executeRound',
      args: [BigInt(tournamentId), round, results, standings, advance],
    });
    await confirmTx(execHash, `executeRound(round ${round})`);
  }

  // 4. Finalize
  console.log(`\n  Finalizing tournament...`);
  const winners: [Address, Address, Address] = [wallets[0], wallets[1], wallets[2]];
  const finalizeHash = await walletClient.writeContract({
    address: CONTRACT,
    abi: ABI,
    functionName: 'finalizeTournament',
    args: [BigInt(tournamentId), winners, `chessbots://tournament/${tournamentId}/recovery`],
  });
  await confirmTx(finalizeHash, `finalizeTournament`);

  console.log(`\n  Tournament #${tournamentId} recovered successfully!`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  ChessBots Tournament Recovery');
  console.log('═══════════════════════════════════════════════');
  console.log(`Deployer: ${deployerAccount.address}`);
  console.log(`Contract: ${CONTRACT}`);
  console.log(`Recovering: ${STUCK_IDS.join(', ')}\n`);

  for (const id of STUCK_IDS) {
    await recoverTournament(id);
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Recovery Complete');
  console.log('═══════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('\nERROR:', err.message);
  process.exit(1);
});
