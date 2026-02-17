// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ChessBotsTournamentV3.sol";

/// @title DeployTournamentV3 - Multi-format tournament deployment
/// @notice Deploys ChessBotsTournamentV3 with Swiss, Match, Team, and League support
/// @dev V2 stays live for existing tournaments. V3 is a new contract deployed alongside.
///      ChessToken, ChessStaking, and BettingPool are NOT redeployed.
contract DeployTournamentV3 is Script {
    // Native Circle USDC on Monad
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;

    // Safe multisig treasury
    address constant TREASURY = 0xE307A2BbC6c8d5990E7F4a9Aa8dCe6ED25D5BaD3;

    // Nad.fun DEX router (Capricorn V3) — for buyback-and-burn
    address constant DEX_ROUTER = 0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137;

    // Existing contracts (unchanged)
    address constant CHESS_TOKEN = 0xC138bA72CE0234448FCCab4B2208a1681c5BA1fa;
    address constant CHESS_STAKING = 0xf242D07Ba9Aed9997c893B515678bc468D86E32C;

    // V2 contract (stays live)
    address constant V2_TOURNAMENT = 0xCB030eE8Ee385f91F4372585Fe1fa3147FA192B8;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // 1. Deploy V3 tournament contract
        //    Same protocol config as V2: 10% fee, 90% buyback / 10% treasury
        ChessBotsTournamentV3 tournamentV3 = new ChessBotsTournamentV3(
            USDC,
            TREASURY,
            1000,   // protocolFeeBps (10%)
            9000,   // buybackShareBps (90%)
            1000    // treasuryShareBps (10%)
        );
        console.log("ChessBotsTournamentV3 deployed at:", address(tournamentV3));

        // 2. Configure tokenomics (point to existing token + staking + DEX)
        tournamentV3.setChessToken(CHESS_TOKEN);
        tournamentV3.setStakingContract(CHESS_STAKING);
        tournamentV3.setDexRouter(DEX_ROUTER);
        console.log("Tokenomics configured: CHESS + staking + DEX router");

        vm.stopBroadcast();

        console.log("---");
        console.log("TOURNAMENT V3 DEPLOYMENT COMPLETE");
        console.log("  Chain ID:            143");
        console.log("  NEW V3 Tournament:  ", address(tournamentV3));
        console.log("  OLD V2 Tournament:  ", V2_TOURNAMENT);
        console.log("  USDC (unchanged):   ", USDC);
        console.log("  ChessToken:         ", CHESS_TOKEN);
        console.log("  ChessStaking:       ", CHESS_STAKING);
        console.log("  Treasury:           ", TREASURY);
        console.log("  Deployer:           ", deployer);
        console.log("");
        console.log("V3 NEW FEATURES:");
        console.log("  - Format field: Swiss (0), Match (1), Team (2), League (3)");
        console.log("  - 1v1 Match: createMatchChallenge(), bestOf 1/3/5, winner-takes-all");
        console.log("  - Team Tournaments: createTeamTournament(), registerTeam(), team rosters");
        console.log("  - League: round-robin (N-1 rounds), 50/30/20 prize split");
        console.log("  - MIN_PLAYERS lowered from 4 to 2 for 1v1 support");
        console.log("");
        console.log("NEXT STEPS:");
        console.log("  1. Update MONAD_V3_CONTRACT address in all config files");
        console.log("  2. Add V3 contract address to Railway env vars");
        console.log("  3. Add V3 contract address to Vercel env vars (NEXT_PUBLIC_V3_CONTRACT)");
        console.log("  4. Update orchestrator to use V3 for new tournaments");
        console.log("  5. V2 continues to serve existing tournaments - no migration needed");
    }
}
