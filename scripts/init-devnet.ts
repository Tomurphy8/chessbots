/**
 * Initialize ChessBots protocol on Solana devnet.
 * Run: npx ts-node --esm scripts/init-devnet.ts
 */
import * as anchor from '@coral-xyz/anchor';
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo } from '@solana/spl-token';

const IDL = require('../target/idl/chessbots_tournament.json');

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const programId = new PublicKey(IDL.address);
  const program = new anchor.Program(IDL, provider);
  const authority = provider.wallet as anchor.Wallet;

  console.log('=== ChessBots Devnet Initialization ===');
  console.log(`Program ID: ${programId.toBase58()}`);
  console.log(`Authority: ${authority.publicKey.toBase58()}`);
  console.log(`RPC: ${provider.connection.rpcEndpoint}`);

  // 1. Create mock USDC mint (devnet doesn't have real USDC)
  console.log('\n1. Creating mock USDC mint...');
  const usdcMint = await createMint(
    provider.connection, authority.payer, authority.publicKey, null, 6,
  );
  console.log(`   Mock USDC mint: ${usdcMint.toBase58()}`);

  // 2. Create treasury keypair and token account
  const treasuryKeypair = Keypair.generate();
  const airdropSig = await provider.connection.requestAirdrop(
    treasuryKeypair.publicKey, 0.1 * anchor.web3.LAMPORTS_PER_SOL,
  );
  await provider.connection.confirmTransaction(airdropSig);

  const treasuryTokenAccount = await createAccount(
    provider.connection, authority.payer, usdcMint, treasuryKeypair.publicKey,
  );
  console.log(`   Treasury wallet: ${treasuryKeypair.publicKey.toBase58()}`);
  console.log(`   Treasury USDC account: ${treasuryTokenAccount.toBase58()}`);

  // 3. Initialize protocol
  console.log('\n2. Initializing protocol...');
  const [protocolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('protocol')], programId,
  );

  try {
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
    console.log(`   Protocol PDA: ${protocolPda.toBase58()}`);
  } catch (e: any) {
    if (e.message?.includes('already in use')) {
      console.log('   Protocol already initialized, skipping.');
    } else {
      throw e;
    }
  }

  // 4. Register test agents
  console.log('\n3. Registering test agents...');
  const testAgents = [
    { name: 'DeepClaw-v3', type: { openClaw: {} } },
    { name: 'SolanaBot-Alpha', type: { solanaAgentKit: {} } },
    { name: 'ChessAgent-Pro', type: { custom: {} } },
  ];

  const agentKeypairs: Keypair[] = [];
  const agentTokenAccounts: PublicKey[] = [];

  for (const agent of testAgents) {
    const kp = Keypair.generate();
    agentKeypairs.push(kp);

    // Airdrop SOL for tx fees
    const sig = await provider.connection.requestAirdrop(
      kp.publicKey, 0.5 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(sig);

    // Create and fund USDC account
    const tokenAcct = await createAccount(
      provider.connection, authority.payer, usdcMint, kp.publicKey,
    );
    await mintTo(
      provider.connection, authority.payer, usdcMint, tokenAcct,
      authority.publicKey, 500_000_000, // 500 USDC
    );
    agentTokenAccounts.push(tokenAcct);

    // Register agent on-chain
    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('agent'), kp.publicKey.toBuffer()], programId,
    );

    await program.methods
      .registerAgent(agent.name, '', agent.type)
      .accounts({
        protocol: protocolPda,
        agentProfile: agentPda,
        wallet: kp.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

    console.log(`   ${agent.name}: ${kp.publicKey.toBase58()}`);
  }

  // 5. Create a sample Bronze tournament
  console.log('\n4. Creating sample Bronze tournament...');
  const tournamentIdBytes = new anchor.BN(0).toArrayLike(Buffer, 'le', 8);
  const [tournamentPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('tournament'), tournamentIdBytes], programId,
  );
  const [prizeVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('prize_vault'), tournamentIdBytes], programId,
  );

  const now = Math.floor(Date.now() / 1000);
  await program.methods
    .createTournament({
      tier: { bronze: {} },
      maxPlayers: 32,
      minPlayers: 3,
      startTime: new anchor.BN(now + 86400),
      registrationDeadline: new anchor.BN(now + 43200),
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

  console.log(`   Tournament PDA: ${tournamentPda.toBase58()}`);
  console.log(`   Prize Vault: ${prizeVaultPda.toBase58()}`);

  // 6. Register agents for the tournament
  console.log('\n5. Registering agents for tournament...');
  for (let i = 0; i < agentKeypairs.length; i++) {
    const kp = agentKeypairs[i];
    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('agent'), kp.publicKey.toBuffer()], programId,
    );
    const [regPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('registration'), tournamentIdBytes, kp.publicKey.toBuffer()], programId,
    );

    await program.methods
      .registerForTournament()
      .accounts({
        protocol: protocolPda,
        tournament: tournamentPda,
        registration: regPda,
        agentProfile: agentPda,
        agentUsdc: agentTokenAccounts[i],
        prizeVault: prizeVaultPda,
        agent: kp.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

    console.log(`   ${testAgents[i].name} registered (50 USDC paid)`);
  }

  console.log('\n=== Devnet Initialization Complete ===');
  console.log(`\nKey Addresses:`);
  console.log(`  Program:     ${programId.toBase58()}`);
  console.log(`  Protocol:    ${protocolPda.toBase58()}`);
  console.log(`  Tournament:  ${tournamentPda.toBase58()}`);
  console.log(`  Prize Vault: ${prizeVaultPda.toBase58()}`);
  console.log(`  USDC Mint:   ${usdcMint.toBase58()}`);
  console.log(`  Treasury:    ${treasuryKeypair.publicKey.toBase58()}`);

  // Save agent keypairs for future use
  console.log(`\nAgent Keypairs (save these!):`);
  for (let i = 0; i < agentKeypairs.length; i++) {
    console.log(`  ${testAgents[i].name}: [${Buffer.from(agentKeypairs[i].secretKey).toString('base64')}]`);
  }
}

main().catch(console.error);
