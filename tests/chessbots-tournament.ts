import * as anchor from '@coral-xyz/anchor';
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from '@solana/spl-token';
import { assert } from 'chai';

describe('chessbots-tournament', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idl = require('../target/idl/chessbots_tournament.json');
  const programId = new PublicKey(idl.address);
  const program = new anchor.Program(idl, provider);

  const authority = provider.wallet as anchor.Wallet;
  const treasuryKeypair = Keypair.generate();

  let usdcMint: PublicKey;
  let treasuryTokenAccount: PublicKey;

  const agent1 = Keypair.generate();
  const agent2 = Keypair.generate();
  const agent3 = Keypair.generate();
  const agent4 = Keypair.generate();

  let agent1TokenAccount: PublicKey;
  let agent2TokenAccount: PublicKey;
  let agent3TokenAccount: PublicKey;
  let agent4TokenAccount: PublicKey;

  let protocolPda: PublicKey;
  let tournamentPda: PublicKey;
  let prizeVaultPda: PublicKey;

  // Tournament ID is auto-incrementing from protocol.total_tournaments.
  // First tournament created will have id=0.
  const tournamentIdBytes = new anchor.BN(0).toArrayLike(Buffer, 'le', 8);

  before(async () => {
    const airdropAmount = 2 * anchor.web3.LAMPORTS_PER_SOL;
    for (const kp of [agent1, agent2, agent3, agent4, treasuryKeypair]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, airdropAmount);
      await provider.connection.confirmTransaction(sig);
    }

    usdcMint = await createMint(
      provider.connection, authority.payer, authority.publicKey, null, 6,
    );

    treasuryTokenAccount = await createAccount(
      provider.connection, authority.payer, usdcMint, treasuryKeypair.publicKey,
    );
    agent1TokenAccount = await createAccount(
      provider.connection, authority.payer, usdcMint, agent1.publicKey,
    );
    agent2TokenAccount = await createAccount(
      provider.connection, authority.payer, usdcMint, agent2.publicKey,
    );
    agent3TokenAccount = await createAccount(
      provider.connection, authority.payer, usdcMint, agent3.publicKey,
    );
    agent4TokenAccount = await createAccount(
      provider.connection, authority.payer, usdcMint, agent4.publicKey,
    );

    const mintAmount = 1000_000_000;
    for (const acct of [agent1TokenAccount, agent2TokenAccount, agent3TokenAccount, agent4TokenAccount]) {
      await mintTo(provider.connection, authority.payer, usdcMint, acct, authority.publicKey, mintAmount);
    }

    [protocolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('protocol')], programId,
    );
    [tournamentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('tournament'), tournamentIdBytes], programId,
    );
    [prizeVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('prize_vault'), tournamentIdBytes], programId,
    );
  });

  it('initializes the protocol', async () => {
    await program.methods
      .initializeProtocol({
        treasury: treasuryKeypair.publicKey,
        protocolFeeBps: 1000,
        buybackShareBps: 9000,
        treasuryShareBps: 1000,
      })
      .accounts({
        protocol: protocolPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const state = await (program.account as any).protocolState.fetch(protocolPda);
    assert.equal(state.authority.toBase58(), authority.publicKey.toBase58());
    assert.equal(state.protocolFeeBps, 1000);
    assert.equal(state.paused, false);
  });

  it('registers agents', async () => {
    const agents = [
      { kp: agent1, name: 'DeepClaw-v3', type: { openClaw: {} } },
      { kp: agent2, name: 'SolanaBot-Alpha', type: { solanaAgentKit: {} } },
      { kp: agent3, name: 'ChessAgent-Pro', type: { custom: {} } },
      { kp: agent4, name: 'NeuralKnight', type: { openClaw: {} } },
    ];

    for (const agent of agents) {
      const [agentPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('agent'), agent.kp.publicKey.toBuffer()], programId,
      );

      await program.methods
        .registerAgent(agent.name, '', agent.type)
        .accounts({
          protocol: protocolPda,
          agentProfile: agentPda,
          wallet: agent.kp.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([agent.kp])
        .rpc();

      const profile = await (program.account as any).agentProfile.fetch(agentPda);
      assert.equal(profile.name, agent.name);
      assert.equal(profile.eloRating, 1200);
    }
  });

  it('creates a bronze tournament', async () => {
    const now = Math.floor(Date.now() / 1000);

    await program.methods
      .createTournament({
        tier: { bronze: {} },
        maxPlayers: 32,
        minPlayers: 4,
        startTime: new anchor.BN(now + 7200),
        registrationDeadline: new anchor.BN(now + 3600),
        timeControl: { baseTimeSeconds: 300, incrementSeconds: 3 },
      })
      .accounts({
        protocol: protocolPda,
        tournament: tournamentPda,
        prizeVault: prizeVaultPda,
        usdcMint: usdcMint,
        authority: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const tournament = await (program.account as any).tournament.fetch(tournamentPda);
    assert.equal(tournament.id.toNumber(), 0);
    assert.equal(tournament.maxPlayers, 32);
    assert.equal(tournament.registeredCount, 0);
  });

  it('registers 4 agents for the tournament', async () => {
    const agentData = [
      { kp: agent1, tokenAccount: agent1TokenAccount },
      { kp: agent2, tokenAccount: agent2TokenAccount },
      { kp: agent3, tokenAccount: agent3TokenAccount },
      { kp: agent4, tokenAccount: agent4TokenAccount },
    ];

    for (const { kp, tokenAccount } of agentData) {
      const [agentPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('agent'), kp.publicKey.toBuffer()], programId,
      );
      const [registrationPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('registration'), tournamentIdBytes, kp.publicKey.toBuffer()], programId,
      );

      await program.methods
        .registerForTournament()
        .accounts({
          protocol: protocolPda,
          tournament: tournamentPda,
          registration: registrationPda,
          agentProfile: agentPda,
          agentUsdc: tokenAccount,
          prizeVault: prizeVaultPda,
          agent: kp.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([kp])
        .rpc();
    }

    const tournament = await (program.account as any).tournament.fetch(tournamentPda);
    assert.equal(tournament.registeredCount, 4);

    const vaultInfo = await getAccount(provider.connection, prizeVaultPda);
    assert.equal(Number(vaultInfo.amount), 200_000_000);
  });

  it('starts the tournament', async () => {
    await program.methods
      .startTournament()
      .accounts({
        protocol: protocolPda,
        tournament: tournamentPda,
        authority: authority.publicKey,
      })
      .rpc();

    const tournament = await (program.account as any).tournament.fetch(tournamentPda);
    assert.property(tournament.status, 'roundActive');
    assert.equal(tournament.currentRound, 1);
    assert.ok(tournament.totalRounds > 0);
    console.log(`Tournament started: ${tournament.totalRounds} rounds for 4 players`);
  });

  it('creates games for round 1', async () => {
    const [game0Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('game'), tournamentIdBytes, Buffer.from([1]), Buffer.from([0])], programId,
    );

    await program.methods
      .createGame(1, 0)
      .accounts({
        protocol: protocolPda,
        tournament: tournamentPda,
        game: game0Pda,
        white: agent1.publicKey,
        black: agent2.publicKey,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const game = await (program.account as any).game.fetch(game0Pda);
    assert.equal(game.white.toBase58(), agent1.publicKey.toBase58());
    assert.equal(game.black.toBase58(), agent2.publicKey.toBase58());

    const [game1Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('game'), tournamentIdBytes, Buffer.from([1]), Buffer.from([1])], programId,
    );

    await program.methods
      .createGame(1, 1)
      .accounts({
        protocol: protocolPda,
        tournament: tournamentPda,
        game: game1Pda,
        white: agent3.publicKey,
        black: agent4.publicKey,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  it('starts and submits game results', async () => {
    const [game0Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('game'), tournamentIdBytes, Buffer.from([1]), Buffer.from([0])], programId,
    );
    const [game1Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('game'), tournamentIdBytes, Buffer.from([1]), Buffer.from([1])], programId,
    );

    await program.methods.startGame().accounts({
      protocol: protocolPda, tournament: tournamentPda, game: game0Pda, authority: authority.publicKey,
    }).rpc();

    await program.methods
      .submitGameResult({ whiteWins: {} }, 'https://arweave.net/abc123', Array(32).fill(0), 20)
      .accounts({
        protocol: protocolPda, tournament: tournamentPda, game: game0Pda, arbiter: authority.publicKey,
      })
      .rpc();

    const game0 = await (program.account as any).game.fetch(game0Pda);
    assert.property(game0.status, 'completed');

    await program.methods.startGame().accounts({
      protocol: protocolPda, tournament: tournamentPda, game: game1Pda, authority: authority.publicKey,
    }).rpc();

    await program.methods
      .submitGameResult({ draw: {} }, 'https://arweave.net/def456', Array(32).fill(0), 30)
      .accounts({
        protocol: protocolPda, tournament: tournamentPda, game: game1Pda, arbiter: authority.publicKey,
      })
      .rpc();
  });

  it('updates player standings and advances rounds', async () => {
    // Update all 4 players (triggers RoundComplete)
    const updates = [
      { kp: agent1, score: 2, buchholz: 0, played: 1, won: 1, drawn: 0, lost: 0 },
      { kp: agent2, score: 0, buchholz: 0, played: 1, won: 0, drawn: 0, lost: 1 },
      { kp: agent3, score: 1, buchholz: 0, played: 1, won: 0, drawn: 1, lost: 0 },
      { kp: agent4, score: 1, buchholz: 0, played: 1, won: 0, drawn: 1, lost: 0 },
    ];

    for (const u of updates) {
      const [regPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('registration'), tournamentIdBytes, u.kp.publicKey.toBuffer()], programId,
      );
      await program.methods
        .updateStandings(u.score, u.buchholz, u.played, u.won, u.drawn, u.lost)
        .accounts({
          protocol: protocolPda, tournament: tournamentPda, registration: regPda, authority: authority.publicKey,
        })
        .rpc();
    }

    let tournament = await (program.account as any).tournament.fetch(tournamentPda);
    console.log(`After round 1 - Status: ${JSON.stringify(tournament.status)}, Round: ${tournament.currentRound}/${tournament.totalRounds}`);

    // For 4 players, totalRounds = ceil(log2(4)) = 2
    // We need to play round 2 to reach currentRound == totalRounds
    if (tournament.currentRound < tournament.totalRounds) {
      // Advance round
      await program.methods.advanceRound().accounts({
        protocol: protocolPda, tournament: tournamentPda, authority: authority.publicKey,
      }).rpc();

      tournament = await (program.account as any).tournament.fetch(tournamentPda);
      console.log(`After advance - Status: ${JSON.stringify(tournament.status)}, Round: ${tournament.currentRound}/${tournament.totalRounds}`);

      // Create and play round 2 games
      const [g2_0] = PublicKey.findProgramAddressSync(
        [Buffer.from('game'), tournamentIdBytes, Buffer.from([2]), Buffer.from([0])], programId,
      );
      const [g2_1] = PublicKey.findProgramAddressSync(
        [Buffer.from('game'), tournamentIdBytes, Buffer.from([2]), Buffer.from([1])], programId,
      );

      await program.methods.createGame(2, 0).accounts({
        protocol: protocolPda, tournament: tournamentPda, game: g2_0,
        white: agent1.publicKey, black: agent3.publicKey,
        authority: authority.publicKey, systemProgram: SystemProgram.programId,
      }).rpc();

      await program.methods.createGame(2, 1).accounts({
        protocol: protocolPda, tournament: tournamentPda, game: g2_1,
        white: agent4.publicKey, black: agent2.publicKey,
        authority: authority.publicKey, systemProgram: SystemProgram.programId,
      }).rpc();

      await program.methods.startGame().accounts({
        protocol: protocolPda, tournament: tournamentPda, game: g2_0, authority: authority.publicKey,
      }).rpc();
      await program.methods.submitGameResult({ whiteWins: {} }, 'https://arweave.net/r2g0', Array(32).fill(0), 25)
        .accounts({ protocol: protocolPda, tournament: tournamentPda, game: g2_0, arbiter: authority.publicKey })
        .rpc();

      await program.methods.startGame().accounts({
        protocol: protocolPda, tournament: tournamentPda, game: g2_1, authority: authority.publicKey,
      }).rpc();
      await program.methods.submitGameResult({ blackWins: {} }, 'https://arweave.net/r2g1', Array(32).fill(0), 35)
        .accounts({ protocol: protocolPda, tournament: tournamentPda, game: g2_1, arbiter: authority.publicKey })
        .rpc();

      // Update standings for round 2
      const r2Updates = [
        { kp: agent1, score: 4, buchholz: 1, played: 2, won: 2, drawn: 0, lost: 0 },
        { kp: agent2, score: 0, buchholz: 1, played: 2, won: 0, drawn: 0, lost: 2 },
        { kp: agent3, score: 1, buchholz: 4, played: 2, won: 0, drawn: 1, lost: 1 },
        { kp: agent4, score: 1, buchholz: 0, played: 2, won: 0, drawn: 1, lost: 1 },
      ];
      for (const u of r2Updates) {
        const [regPda] = PublicKey.findProgramAddressSync(
          [Buffer.from('registration'), tournamentIdBytes, u.kp.publicKey.toBuffer()], programId,
        );
        await program.methods
          .updateStandings(u.score, u.buchholz, u.played, u.won, u.drawn, u.lost)
          .accounts({
            protocol: protocolPda, tournament: tournamentPda, registration: regPda, authority: authority.publicKey,
          })
          .rpc();
      }
    }

    tournament = await (program.account as any).tournament.fetch(tournamentPda);
    console.log(`Final - Status: ${JSON.stringify(tournament.status)}, Round: ${tournament.currentRound}/${tournament.totalRounds}`);

    const [reg1] = PublicKey.findProgramAddressSync(
      [Buffer.from('registration'), tournamentIdBytes, agent1.publicKey.toBuffer()], programId,
    );
    const standing = await (program.account as any).tournamentRegistration.fetch(reg1);
    assert.equal(standing.score, 4);
    assert.equal(standing.gamesWon, 2);
  });

  it('finalizes tournament and distributes prizes', async () => {
    await program.methods
      .finalizeTournament(
        [agent1.publicKey, agent3.publicKey, agent4.publicKey],
        'https://arweave.net/results',
      )
      .accounts({
        protocol: protocolPda,
        tournament: tournamentPda,
        authority: authority.publicKey,
      })
      .rpc();

    const completed = await (program.account as any).tournament.fetch(tournamentPda);
    assert.property(completed.status, 'completed');
    assert.equal(completed.winners[0].toBase58(), agent1.publicKey.toBase58());

    await program.methods
      .distributePrizes()
      .accounts({
        protocol: protocolPda,
        tournament: tournamentPda,
        prizeVault: prizeVaultPda,
        firstPlaceUsdc: agent1TokenAccount,
        secondPlaceUsdc: agent3TokenAccount,
        thirdPlaceUsdc: agent4TokenAccount,
        treasuryUsdc: treasuryTokenAccount,
        authority: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const vault = await getAccount(provider.connection, prizeVaultPda);
    assert.equal(Number(vault.amount), 0);

    const first = await getAccount(provider.connection, agent1TokenAccount);
    const treasury = await getAccount(provider.connection, treasuryTokenAccount);

    console.log('\n=== Prize Distribution ===');
    console.log(`Total pool: 200 USDC (4 × 50 USDC)`);
    console.log(`Protocol fee: ${Number(treasury.amount) / 1_000_000} USDC (10%)`);
    console.log(`1st place (agent1): ${Number(first.amount) / 1_000_000} USDC total`);
    console.log(`Prize vault remaining: ${Number(vault.amount) / 1_000_000} USDC`);

    assert.ok(Number(first.amount) > 1_000_000_000);
    assert.equal(Number(treasury.amount), 20_000_000);
  });
});
