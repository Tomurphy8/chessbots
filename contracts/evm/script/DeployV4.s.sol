// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ChessBotsTournamentV4.sol";
import "../src/ChessRevenueRouter.sol";

/// @title DeployV4 - Deploy V4 economics contracts on Monad mainnet
/// @notice Deploys ChessBotsTournamentV4 + ChessRevenueRouter alongside existing V3
/// @dev V3 stays live at 0x0e2663b0DCD9b7408d51C6972f679B81a5A7477e
contract DeployV4 is Script {
    // Native Circle USDC on Monad mainnet
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;

    // Safe multisig treasury
    address constant TREASURY = 0xE307A2BbC6c8d5990E7F4a9Aa8dCe6ED25D5BaD3;

    // $CHESS token on nad.fun
    address constant CHESS_TOKEN = 0x223A470B7Ffe0A43613D6ab8105097BFB33f7777;

    // Nad.fun DEX router (Capricorn V3)
    address constant DEX_ROUTER = 0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137;

    // Existing staking contract
    address constant STAKING = 0xf242D07Ba9Aed9997c893B515678bc468D86E32C;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // 1. Deploy ChessRevenueRouter
        ChessRevenueRouter revenueRouter = new ChessRevenueRouter(
            USDC,
            TREASURY,
            deployer // authority
        );
        console.log("ChessRevenueRouter deployed at:", address(revenueRouter));

        // 2. Configure revenue router
        revenueRouter.setChessToken(CHESS_TOKEN);
        revenueRouter.setDexRouter(DEX_ROUTER);
        console.log("RevenueRouter configured: CHESS + DEX router");

        // 3. Deploy ChessBotsTournamentV4
        ChessBotsTournamentV4 v4 = new ChessBotsTournamentV4(
            USDC,
            TREASURY
        );
        console.log("ChessBotsTournamentV4 deployed at:", address(v4));

        // 4. Configure V4 tokenomics
        v4.setChessToken(CHESS_TOKEN);
        v4.setDexRouter(DEX_ROUTER);
        v4.setStakingContract(STAKING);
        v4.setRevenueRouter(address(revenueRouter));
        console.log("V4 tokenomics configured");

        vm.stopBroadcast();

        console.log("---");
        console.log("V4 ECONOMICS DEPLOYMENT COMPLETE");
        console.log("  Chain ID:          143");
        console.log("  USDC (native):    ", USDC);
        console.log("  V4 Tournament:    ", address(v4));
        console.log("  RevenueRouter:    ", address(revenueRouter));
        console.log("  CHESS Token:      ", CHESS_TOKEN);
        console.log("  Staking:          ", STAKING);
        console.log("  Treasury:         ", TREASURY);
        console.log("  DEX Router:       ", DEX_ROUTER);
        console.log("  Deployer:         ", deployer);
        console.log("");
        console.log("EXISTING (unchanged):");
        console.log("  V3 Tournament:     0x0e2663b0DCD9b7408d51C6972f679B81a5A7477e");
        console.log("  BettingPool:       0x2b7d1D75AF4fA998bF4C93E84710623BCACC8dA9");
        console.log("");
        console.log("NEXT STEPS:");
        console.log("  1. Set season rewards on RevenueRouter when ChessSeasonRewards deploys");
        console.log("  2. Update frontend .env with V4 contract address");
        console.log("  3. Update agent-gateway + orchestrator .env");
        console.log("  4. Verify contracts on Monad explorer");
    }
}
