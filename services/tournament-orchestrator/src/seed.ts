/**
 * Seed script: Populates the on-chain contract with test agents and tournaments.
 *
 * Creates:
 * - 8 test agents (mix of agent types)
 * - 1 completed Swiss tournament (4 players, 3 rounds)
 * - 1 completed 1v1 Match (best-of-3)
 * - 1 completed League (4 players, round-robin)
 * - 1 Swiss tournament in registration (upcoming)
 * - 1 League tournament in registration (upcoming)
 *
 * Each completed tournament has simulated game results so the leaderboard
 * and tournament history pages show real data.
 *
 * Usage: npx tsx src/seed.ts
 */
import 'dotenv/config';
import {
  createPublicClient, createWalletClient, http, defineChain, keccak256, toHex,
  type Address, type Hash,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { getChainConfig, isDeployed } from './chains/index.js';
import { MonadClient } from './chains/client.js';

// ── Config ──────────────────────────────────────────────────────────────────

const AGENT_NAMES = [
  'AlphaKnight', 'BishopBot', 'CastleAI', 'DragonPawn',
  'EchoRook', 'FrostQueen', 'GambitPro', 'HyperEngine',
];

const AGENT_TYPES = [0, 0, 1, 1, 2, 2, 0, 2]; // OpenClaw, OpenClaw, SolanaAgentKit, ...

// Deterministic seed keys — derived from keccak256 of index for reproducibility
function derivePrivateKey(index: number): `0x${string}` {
  const hash = keccak256(toHex(`chessbots-seed-agent-${index}`));
  return hash as `0x${string}`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz/'] } },
});

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function waitForDeadline(deadlineUnix: number) {
  const remaining = deadlineUnix - Math.floor(Date.now() / 1000);
  if (remaining > 0) {
    console.log(`  Waiting ${remaining}s for registration deadline to pass...`);
    await sleep((remaining + 2) * 1000); // +2s buffer
  }
}

async function waitForTx(publicClient: any, hash: Hash, label: string) {
  console.log(`  [tx] ${label}: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status === 'reverted') throw new Error(`Reverted: ${label}`);
  console.log(`  [tx] ${label}: confirmed (block ${receipt.blockNumber})`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!isDeployed()) {
    console.error('Contract not deployed or PRIVATE_KEY not set');
    process.exit(1);
  }

  const chainConfig = getChainConfig();
  const chain = new MonadClient(chainConfig);

  const rpcUrl = chainConfig.rpcUrl;
  const contractAddress = chainConfig.contractAddress as Address;

  const chainDef = { ...monad, rpcUrls: { default: { http: [rpcUrl] } } };
  const publicClient = createPublicClient({ chain: chainDef, transport: http(rpcUrl) });

  const authorityAccount = privateKeyToAccount(chainConfig.privateKey as `0x${string}`);
  const authorityWallet = createWalletClient({
    account: authorityAccount,
    chain: chainDef,
    transport: http(rpcUrl),
  });

  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  ChessBots Seed Script`);
  console.log(`  Authority: ${authorityAccount.address}`);
  console.log(`  Contract:  ${contractAddress}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  // ── Step 1: Check existing state ──────────────────────────────────────────

  const protocol = await chain.getProtocolState();
  const existingTournaments = Number(protocol[5]);
  console.log(`Existing tournaments: ${existingTournaments}`);

  // Clean up any half-finished tournaments from previous seed runs
  // Use known seed agent addresses for finalization
  const seedAgentAddresses = Array.from({ length: 8 }, (_, i) => {
    const pk = derivePrivateKey(i);
    return privateKeyToAccount(pk).address;
  });

  for (let i = 0; i < existingTournaments; i++) {
    try {
      const t = await chain.getTournament(BigInt(i));
      // Status 3 = RoundComplete — if it's the last round, finalize it
      if (t.status === 3 && t.currentRound === t.totalRounds) {
        console.log(`  Finalizing stale tournament #${i} (RoundComplete, last round)...`);
        const winners: [Address, Address, Address] = [
          seedAgentAddresses[0], seedAgentAddresses[1], seedAgentAddresses[2],
        ];
        await chain.finalizeTournament(BigInt(i), winners, 'ipfs://seed-cleanup');
        console.log(`  Tournament #${i} finalized (cleanup)`);
      }
    } catch (e: any) {
      console.log(`  Skipping tournament #${i} cleanup: ${e.message?.slice(0, 80)}`);
    }
  }

  // Check if authority is already registered as agent
  const authorityAgent = await chain.getAgent(authorityAccount.address);
  if (!authorityAgent.registered) {
    console.log('\n── Registering authority as agent ──');
    await chain.registerAgent('Authority', 'ipfs://authority', 0);
    console.log('  Authority registered as agent');
  } else {
    console.log(`Authority already registered as agent: ${authorityAgent.name}`);
  }

  // ── Step 2: Create ephemeral agent wallets ────────────────────────────────

  console.log('\n── Creating ephemeral agent wallets ──');

  interface AgentWallet {
    privateKey: `0x${string}`;
    address: Address;
    name: string;
    agentType: number;
    walletClient: any;
  }

  const agents: AgentWallet[] = [];

  for (let i = 0; i < AGENT_NAMES.length; i++) {
    const pk = derivePrivateKey(i);
    const account = privateKeyToAccount(pk);
    const wc = createWalletClient({
      account,
      chain: chainDef,
      transport: http(rpcUrl),
    });
    agents.push({
      privateKey: pk,
      address: account.address,
      name: AGENT_NAMES[i],
      agentType: AGENT_TYPES[i],
      walletClient: wc,
    });
    console.log(`  Agent ${i}: ${AGENT_NAMES[i]} → ${account.address}`);
  }

  // ── Step 3: Fund agent wallets with MON for gas ───────────────────────────

  console.log('\n── Funding agent wallets with MON ──');
  const FUND_AMOUNT = 100000000000000000n; // 0.1 MON

  for (const agent of agents) {
    const balance = await publicClient.getBalance({ address: agent.address });
    if (balance < FUND_AMOUNT / 2n) {
      const hash = await authorityWallet.sendTransaction({
        to: agent.address,
        value: FUND_AMOUNT,
      });
      await waitForTx(publicClient, hash, `fund ${agent.name}`);
    } else {
      console.log(`  ${agent.name} already funded (${balance} wei)`);
    }
  }

  // ── Step 4: Register agents ───────────────────────────────────────────────

  console.log('\n── Registering agents ──');

  // We need a minimal ABI just for registerAgent + registerForTournament
  const REGISTER_ABI = [
    {
      inputs: [
        { name: 'name', type: 'string' },
        { name: 'metadataUri', type: 'string' },
        { name: 'agentType', type: 'uint8' },
      ],
      name: 'registerAgent',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function',
    },
    {
      inputs: [{ name: 'tournamentId', type: 'uint256' }],
      name: 'registerForTournament',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function',
    },
  ] as const;

  for (const agent of agents) {
    const agentData = await chain.getAgent(agent.address);
    if (agentData.registered) {
      console.log(`  ${agent.name} already registered`);
      continue;
    }
    const hash = await agent.walletClient.writeContract({
      address: contractAddress,
      abi: REGISTER_ABI,
      functionName: 'registerAgent',
      args: [agent.name, `ipfs://${agent.name.toLowerCase()}`, agent.agentType],
    });
    await waitForTx(publicClient, hash, `register ${agent.name}`);
  }

  // Also register authority for tournaments if needed
  // (Authority is already registered from Step 1)

  // ── Step 5: Create and run completed Swiss tournament ─────────────────────

  console.log('\n══ Creating Completed Swiss Tournament ══');

  // Future deadlines for registration — startTournament has no deadline check
  // so we can start immediately after registering all players.
  // Contract requires: deadline > now AND deadline < startTime
  const now = Math.floor(Date.now() / 1000);
  const futureDeadline = BigInt(now + 3600); // 1 hour
  const futureStart = BigInt(now + 3601);    // deadline < startTime required

  // Create Swiss tournament: tier=free(5), format=swiss(0), max=4, min=4
  await chain.createTournament(5, 0, 4, 4, futureStart, futureDeadline, 300, 3);
  const p1 = await chain.getProtocolState();
  const swissId = BigInt(Number(p1[5]) - 1);
  console.log(`  Created Swiss tournament #${swissId}`);

  // Register first 4 agents
  const swissAgents = agents.slice(0, 4);
  for (const agent of swissAgents) {
    const hash = await agent.walletClient.writeContract({
      address: contractAddress,
      abi: REGISTER_ABI,
      functionName: 'registerForTournament',
      args: [swissId],
    });
    await waitForTx(publicClient, hash, `${agent.name} joins Swiss #${swissId}`);
  }

  // Start tournament (no deadline check — only needs enough players registered)
  await chain.startTournament(swissId);

  // Read back totalRounds from contract (calculated dynamically on start)
  const swissTournament = await chain.getTournament(swissId);
  const swissRounds = swissTournament.totalRounds;
  console.log(`  Swiss tournament #${swissId} started (${swissRounds} rounds)`);

  // Run rounds with simulated results
  await runSimulatedRounds(chain, swissId, swissAgents.map(a => a.address), swissRounds);

  // Finalize
  const swissWinners: [Address, Address, Address] = [
    swissAgents[0].address, swissAgents[1].address, swissAgents[2].address,
  ];
  await chain.finalizeTournament(swissId, swissWinners, 'ipfs://swiss-results');
  console.log(`  Swiss tournament #${swissId} finalized! Winner: ${swissAgents[0].name}`);

  // ── Step 6: Create and run completed Match (1v1) ──────────────────────────

  console.log('\n══ Creating Completed 1v1 Match ══');

  const matchNow = Math.floor(Date.now() / 1000);
  const matchDeadline = BigInt(matchNow + 3600);
  const matchStart = BigInt(matchNow + 3601);

  // Match challenge: tier=free(5), bestOf=3
  await chain.createMatchChallenge(
    5, matchStart, matchDeadline, 300, 3, 3,
    '0x0000000000000000000000000000000000000000' as Address,
  );
  const p2 = await chain.getProtocolState();
  const matchId = BigInt(Number(p2[5]) - 1);
  console.log(`  Created Match #${matchId}`);

  // Register 2 agents for match
  const matchAgents = agents.slice(4, 6);
  for (const agent of matchAgents) {
    const hash = await agent.walletClient.writeContract({
      address: contractAddress,
      abi: REGISTER_ABI,
      functionName: 'registerForTournament',
      args: [matchId],
    });
    await waitForTx(publicClient, hash, `${agent.name} joins Match #${matchId}`);
  }

  // Start (no deadline check required)
  await chain.startTournament(matchId);

  const matchTournament = await chain.getTournament(matchId);
  const matchRounds = matchTournament.totalRounds;
  console.log(`  Match #${matchId} started (best-of ${matchRounds})`);

  // Run ALL rounds — contract requires all rounds played before finalization
  // (no on-chain early clinch — orchestrator handles clinch logic, contract doesn't)
  await runSimulatedMatchRounds(chain, matchId, matchAgents.map(a => a.address), matchRounds);

  // Finalize — only 1 winner for match, others are zero address
  const ZERO = '0x0000000000000000000000000000000000000000' as Address;
  await chain.finalizeTournament(matchId, [matchAgents[0].address, ZERO, ZERO], 'ipfs://match-results');
  console.log(`  Match #${matchId} finalized! Winner: ${matchAgents[0].name}`);

  // ── Step 7: Create and run completed League ───────────────────────────────

  console.log('\n══ Creating Completed League Tournament ══');

  const leagueNow = Math.floor(Date.now() / 1000);
  const leagueDeadline = BigInt(leagueNow + 3600);
  const leagueStart = BigInt(leagueNow + 3601);

  // League: tier=free(5), format=league(3), max=4, min=4
  await chain.createTournament(5, 3, 4, 4, leagueStart, leagueDeadline, 300, 3);
  const p3 = await chain.getProtocolState();
  const leagueId = BigInt(Number(p3[5]) - 1);
  console.log(`  Created League #${leagueId}`);

  // Register agents 4-7 for league
  const leagueAgents = agents.slice(4, 8);
  for (const agent of leagueAgents) {
    const hash = await agent.walletClient.writeContract({
      address: contractAddress,
      abi: REGISTER_ABI,
      functionName: 'registerForTournament',
      args: [leagueId],
    });
    await waitForTx(publicClient, hash, `${agent.name} joins League #${leagueId}`);
  }

  await chain.startTournament(leagueId);

  const leagueTournament = await chain.getTournament(leagueId);
  const leagueRounds = leagueTournament.totalRounds;
  console.log(`  League #${leagueId} started (${leagueRounds} rounds)`);

  // Run all rounds (round-robin: N-1 rounds for N players)
  await runSimulatedRounds(chain, leagueId, leagueAgents.map(a => a.address), leagueRounds);

  await chain.finalizeTournament(leagueId, [
    leagueAgents[0].address, leagueAgents[1].address, leagueAgents[2].address,
  ], 'ipfs://league-results');
  console.log(`  League #${leagueId} finalized! Winner: ${leagueAgents[0].name}`);

  // ── Step 8: Create upcoming tournaments (in registration) ─────────────────

  console.log('\n══ Creating Upcoming Tournaments ══');

  const upcomingNow = Math.floor(Date.now() / 1000);
  const upcomingDeadline = BigInt(upcomingNow + 7200); // 2 hours from now
  const upcomingStart = BigInt(upcomingNow + 7201);

  // Upcoming Swiss — tier=free(5), format=swiss(0)
  await chain.createTournament(5, 0, 8, 4, upcomingStart, upcomingDeadline, 600, 5);
  const p4 = await chain.getProtocolState();
  const upcomingSwissId = Number(p4[5]) - 1;
  console.log(`  Created upcoming Swiss #${upcomingSwissId} (registration open)`);

  // Register a few agents to show partial registration
  for (const agent of agents.slice(0, 3)) {
    const hash = await agent.walletClient.writeContract({
      address: contractAddress,
      abi: REGISTER_ABI,
      functionName: 'registerForTournament',
      args: [BigInt(upcomingSwissId)],
    });
    await waitForTx(publicClient, hash, `${agent.name} joins upcoming Swiss`);
  }

  // Upcoming League — tier=free(5), format=league(3)
  await chain.createTournament(5, 3, 6, 4, upcomingStart, upcomingDeadline, 600, 5);
  const p5 = await chain.getProtocolState();
  const upcomingLeagueId = Number(p5[5]) - 1;
  console.log(`  Created upcoming League #${upcomingLeagueId} (registration open)`);

  // Register a couple agents
  for (const agent of agents.slice(2, 5)) {
    const hash = await agent.walletClient.writeContract({
      address: contractAddress,
      abi: REGISTER_ABI,
      functionName: 'registerForTournament',
      args: [BigInt(upcomingLeagueId)],
    });
    await waitForTx(publicClient, hash, `${agent.name} joins upcoming League`);
  }

  // Upcoming 1v1 Match — tier=free(5), best-of-5
  await chain.createMatchChallenge(
    5, upcomingStart, upcomingDeadline, 300, 3, 5,
    '0x0000000000000000000000000000000000000000' as Address,
  );
  const p6 = await chain.getProtocolState();
  const upcomingMatchId = Number(p6[5]) - 1;
  console.log(`  Created upcoming Match #${upcomingMatchId} (registration open)`);

  // ── Done! ──────────────────────────────────────────────────────────────────

  const finalProtocol = await chain.getProtocolState();
  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  Seed complete!`);
  console.log(`  Total tournaments: ${Number(finalProtocol[5])}`);
  console.log(`  Total agents: ${agents.length} + authority`);
  console.log(`  Completed: Swiss #${swissId}, Match #${matchId}, League #${leagueId}`);
  console.log(`  Upcoming: Swiss #${upcomingSwissId}, League #${upcomingLeagueId}, Match #${upcomingMatchId}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);
}

// ── Simulated Round Execution ───────────────────────────────────────────────

/**
 * Run N rounds for a multi-player tournament (Swiss/League) with simulated results.
 * Generates deterministic white-favoring results for variety.
 */
async function runSimulatedRounds(
  chain: MonadClient,
  tournamentId: bigint,
  players: Address[],
  totalRounds: number,
) {
  // Track cumulative standings
  const stats = new Map<string, {
    score: number; gamesPlayed: number; gamesWon: number;
    gamesDrawn: number; gamesLost: number;
  }>();
  for (const p of players) {
    stats.set(p, { score: 0, gamesPlayed: 0, gamesWon: 0, gamesDrawn: 0, gamesLost: 0 });
  }

  for (let round = 1; round <= totalRounds; round++) {
    console.log(`  Running round ${round}/${totalRounds}...`);

    // Generate pairings: simple sequential pairing
    const pairings: Array<{ white: Address; black: Address; gameIndex: number }> = [];
    const available = [...players];
    let gameIdx = 0;

    // Rotate players for different matchups each round
    const rotated = [available[0], ...available.slice(1)];
    // Rotate the non-first players
    for (let r = 1; r < round; r++) {
      const last = rotated.pop()!;
      rotated.splice(1, 0, last);
    }

    for (let i = 0; i < Math.floor(rotated.length / 2); i++) {
      pairings.push({
        white: rotated[i] as Address,
        black: rotated[rotated.length - 1 - i] as Address,
        gameIndex: gameIdx++,
      });
    }

    // Create games on-chain
    await chain.batchCreateAndStartGames(tournamentId, round, pairings);

    // Simulate results — alternate between white wins, black wins, draw
    const results: Array<{
      gameIndex: number; result: number;
      pgnHash: `0x${string}`; resultHash: `0x${string}`; moveCount: number;
    }> = [];

    for (const p of pairings) {
      // Deterministic result based on round + gameIndex
      const seed = round * 100 + p.gameIndex;
      let result: number;
      if (seed % 3 === 0) {
        result = 1; // White wins
        const ws = stats.get(p.white)!;
        ws.gamesWon++;
        ws.score += 3;
        const bs = stats.get(p.black)!;
        bs.gamesLost++;
      } else if (seed % 3 === 1) {
        result = 2; // Black wins
        const bs = stats.get(p.black)!;
        bs.gamesWon++;
        bs.score += 3;
        const ws = stats.get(p.white)!;
        ws.gamesLost++;
      } else {
        result = 3; // Draw
        const ws = stats.get(p.white)!;
        ws.gamesDrawn++;
        ws.score += 1;
        const bs = stats.get(p.black)!;
        bs.gamesDrawn++;
        bs.score += 1;
      }

      stats.get(p.white)!.gamesPlayed++;
      stats.get(p.black)!.gamesPlayed++;

      const gameId = `t${tournamentId}-r${round}-g${p.gameIndex}`;
      results.push({
        gameIndex: p.gameIndex,
        result,
        pgnHash: keccak256(toHex(gameId)) as `0x${string}`,
        resultHash: keccak256(toHex(`${gameId}:result`)) as `0x${string}`,
        moveCount: 30 + (seed % 20),
      });
    }

    // Submit round results
    const standings = players.map(p => {
      const s = stats.get(p)!;
      return {
        wallet: p,
        score: s.score,
        buchholz: 0,
        gamesPlayed: s.gamesPlayed,
        gamesWon: s.gamesWon,
        gamesDrawn: s.gamesDrawn,
        gamesLost: s.gamesLost,
        opponents: [] as string[],
        colors: [] as ('white' | 'black')[],
      };
    });

    const advance = round < totalRounds;
    await chain.executeRound(tournamentId, round, results, standings, advance);
    console.log(`    Round ${round} submitted on-chain`);
  }
}

/**
 * Run rounds for a 1v1 match format with simulated results.
 */
async function runSimulatedMatchRounds(
  chain: MonadClient,
  tournamentId: bigint,
  players: Address[],
  totalRounds: number,
) {
  const stats = new Map<string, {
    score: number; gamesPlayed: number; gamesWon: number;
    gamesDrawn: number; gamesLost: number;
  }>();
  for (const p of players) {
    stats.set(p, { score: 0, gamesPlayed: 0, gamesWon: 0, gamesDrawn: 0, gamesLost: 0 });
  }

  for (let round = 1; round <= totalRounds; round++) {
    console.log(`  Running match round ${round}/${totalRounds}...`);

    // 1v1: single game per round, alternating colors
    const white = round % 2 === 1 ? players[0] : players[1];
    const black = round % 2 === 1 ? players[1] : players[0];

    const pairings = [{ white: white as Address, black: black as Address, gameIndex: 0 }];
    await chain.batchCreateAndStartGames(tournamentId, round, pairings);

    // Player 0 always wins for a clean 2-0 clinch
    const winnerIsWhite = white === players[0];
    const result = winnerIsWhite ? 1 : 2; // 1=WhiteWins, 2=BlackWins

    const ws0 = stats.get(players[0])!;
    ws0.gamesWon++;
    ws0.gamesPlayed++;
    ws0.score += 3;
    const ws1 = stats.get(players[1])!;
    ws1.gamesLost++;
    ws1.gamesPlayed++;

    const gameId = `t${tournamentId}-r${round}-g0`;
    const results = [{
      gameIndex: 0,
      result,
      pgnHash: keccak256(toHex(gameId)) as `0x${string}`,
      resultHash: keccak256(toHex(`${gameId}:result`)) as `0x${string}`,
      moveCount: 42,
    }];

    const standings = players.map(p => {
      const s = stats.get(p)!;
      return {
        wallet: p,
        score: s.score,
        buchholz: 0,
        gamesPlayed: s.gamesPlayed,
        gamesWon: s.gamesWon,
        gamesDrawn: s.gamesDrawn,
        gamesLost: s.gamesLost,
        opponents: [] as string[],
        colors: [] as ('white' | 'black')[],
      };
    });

    const advance = round < totalRounds;
    await chain.executeRound(tournamentId, round, results, standings, advance);
    console.log(`    Match round ${round} submitted on-chain`);
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('Seed failed:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
