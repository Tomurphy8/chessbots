// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ChessBotsTournament.sol";
import "../src/ChessBettingPool.sol";

/// @title DeployTournamentV2 - Upgrade deployment for permissionless tournament creation
/// @notice Deploys new ChessBotsTournament (with onlyRegisteredAgentOrAuthority) + new ChessBettingPool
/// @dev ChessToken and ChessStaking are NOT redeployed — they have no tournament address dependency.
///      BettingPool MUST be redeployed because it has an immutable tournamentContract reference.
contract DeployTournamentV2 is Script {
    // Native Circle USDC on Monad mainnet
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;

    // Safe multisig treasury
    address constant TREASURY = 0xE307A2BbC6c8d5990E7F4a9Aa8dCe6ED25D5BaD3;

    // Nad.fun DEX router (Capricorn V3) — for buyback-and-burn
    address constant DEX_ROUTER = 0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137;

    // Existing contracts that are NOT redeployed
    address constant CHESS_TOKEN = 0xC138bA72CE0234448FCCab4B2208a1681c5BA1fa;
    address constant CHESS_STAKING = 0xf242D07Ba9Aed9997c893B515678bc468D86E32C;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // 1. Deploy new tournament contract (permissionless creation)
        //    Same protocol config: 10% fee, 90% buyback / 10% treasury
        ChessBotsTournament tournament = new ChessBotsTournament(
            USDC,
            TREASURY,
            1000,   // protocolFeeBps (10%)
            9000,   // buybackShareBps (90%)
            1000    // treasuryShareBps (10%)
        );
        console.log("ChessBotsTournament V2 deployed at:", address(tournament));

        // 2. Deploy new betting pool (immutable tournament address)
        ChessBettingPool bettingPool = new ChessBettingPool(
            USDC,
            address(tournament),
            TREASURY,
            300 // 3% vig
        );
        console.log("ChessBettingPool V2 deployed at:", address(bettingPool));

        // 3. Configure tokenomics on new tournament (point to existing token + staking)
        tournament.setChessToken(CHESS_TOKEN);
        tournament.setStakingContract(CHESS_STAKING);
        tournament.setDexRouter(DEX_ROUTER);
        console.log("Tokenomics configured: CHESS + staking + DEX router");

        vm.stopBroadcast();

        console.log("---");
        console.log("TOURNAMENT V2 DEPLOYMENT COMPLETE");
        console.log("  Chain ID:        143");
        console.log("  NEW Tournament: ", address(tournament));
        console.log("  NEW BettingPool:", address(bettingPool));
        console.log("  USDC (unchanged):", USDC);
        console.log("  ChessToken (unchanged):", CHESS_TOKEN);
        console.log("  ChessStaking (unchanged):", CHESS_STAKING);
        console.log("  Treasury:        ", TREASURY);
        console.log("  Deployer:        ", deployer);
        console.log("");
        console.log("WHAT CHANGED:");
        console.log("  - createTournament() now allows registered agents (not just authority)");
        console.log("  - createLegendsTournament() now allows registered agents (not just authority)");
        console.log("");
        console.log("NEXT STEPS:");
        console.log("  1. Update MONAD_CONTRACT + DEPLOY_BLOCK in all config files");
        console.log("  2. Update Railway env vars (agent-gateway + tournament-orchestrator)");
        console.log("  3. Update Vercel env vars (NEXT_PUBLIC_CONTRACT_ADDRESS)");
        console.log("  4. Update BettingPool address in frontend chains.ts");
    }
}
