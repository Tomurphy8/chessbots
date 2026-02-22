// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ChessBotsTournamentV4.sol";
import "../src/ChessRevenueRouter.sol";
import "../src/ChessELO.sol";
import "../src/ChessSeason.sol";
import "../src/ChessSeasonRewards.sol";
import "../src/ChessSatellite.sol";
import "../src/ChessBounty.sol";
import "../src/ChessStakingV2.sol";
import "../src/ChessForwarder.sol";

/// @title DeployAllV4 - Deploy all V4 economics contracts on Monad mainnet
/// @notice Deploys 9 contracts: V4 Tournament, RevenueRouter, ELO, Season, SeasonRewards,
///         Satellite, Bounty, StakingV2, Forwarder — then wires them together.
/// @dev V3 stays live at 0x0e2663b0DCD9b7408d51C6972f679B81a5A7477e
contract DeployAllV4 is Script {
    // ─── Existing Deployed Addresses ────────────────────────────────────────────
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address constant TREASURY = 0xE307A2BbC6c8d5990E7F4a9Aa8dCe6ED25D5BaD3;
    address constant CHESS_TOKEN = 0x223A470B7Ffe0A43613D6ab8105097BFB33f7777;
    address constant DEX_ROUTER = 0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137;
    address constant STAKING_V1 = 0xf242D07Ba9Aed9997c893B515678bc468D86E32C;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deployer:", deployer);
        console.log("Chain ID: 143 (Monad mainnet)");
        console.log("---");

        vm.startBroadcast(deployerKey);

        // ─── Tier 1: No constructor dependencies ────────────────────────────────

        ChessELO elo = new ChessELO();
        console.log("1. ChessELO deployed at:          ", address(elo));

        ChessSeason season = new ChessSeason();
        console.log("2. ChessSeason deployed at:        ", address(season));

        ChessSatellite satellite = new ChessSatellite();
        console.log("3. ChessSatellite deployed at:     ", address(satellite));

        ChessForwarder forwarder = new ChessForwarder();
        console.log("4. ChessForwarder deployed at:     ", address(forwarder));

        // ─── Tier 2: Depend on existing tokens ──────────────────────────────────

        ChessSeasonRewards seasonRewards = new ChessSeasonRewards(CHESS_TOKEN);
        console.log("5. ChessSeasonRewards deployed at: ", address(seasonRewards));

        ChessBounty bounty = new ChessBounty(USDC);
        console.log("6. ChessBounty deployed at:        ", address(bounty));

        ChessStakingV2 stakingV2 = new ChessStakingV2(CHESS_TOKEN, USDC);
        console.log("7. ChessStakingV2 deployed at:     ", address(stakingV2));

        // ─── Tier 3: Core contracts ─────────────────────────────────────────────

        ChessRevenueRouter revenueRouter = new ChessRevenueRouter(USDC, TREASURY, deployer);
        console.log("8. ChessRevenueRouter deployed at: ", address(revenueRouter));

        ChessBotsTournamentV4 v4 = new ChessBotsTournamentV4(USDC, TREASURY);
        console.log("9. ChessBotsTournamentV4 at:       ", address(v4));

        // ─── Post-Deploy Wiring ─────────────────────────────────────────────────

        // Configure V4 Tournament
        v4.setChessToken(CHESS_TOKEN);
        v4.setDexRouter(DEX_ROUTER);
        v4.setStakingContract(STAKING_V1);
        v4.setRevenueRouter(address(revenueRouter));
        console.log("V4 configured: CHESS, DEX, Staking, RevenueRouter");

        // Configure Revenue Router
        revenueRouter.setChessToken(CHESS_TOKEN);
        revenueRouter.setDexRouter(DEX_ROUTER);
        revenueRouter.setSeasonRewards(address(seasonRewards));
        console.log("RevenueRouter configured: CHESS, DEX, SeasonRewards");

        // Configure Forwarder to allow V4 as target
        forwarder.setAllowedTarget(address(v4), true);
        console.log("Forwarder: V4 whitelisted as target");

        vm.stopBroadcast();

        // ─── Summary ────────────────────────────────────────────────────────────
        console.log("");
        console.log("========================================");
        console.log("  V4 ECONOMICS - FULL DEPLOYMENT DONE");
        console.log("========================================");
        console.log("");
        console.log("NEW CONTRACTS:");
        console.log("  ChessELO:            ", address(elo));
        console.log("  ChessSeason:         ", address(season));
        console.log("  ChessSatellite:      ", address(satellite));
        console.log("  ChessForwarder:      ", address(forwarder));
        console.log("  ChessSeasonRewards:  ", address(seasonRewards));
        console.log("  ChessBounty:         ", address(bounty));
        console.log("  ChessStakingV2:      ", address(stakingV2));
        console.log("  ChessRevenueRouter:  ", address(revenueRouter));
        console.log("  ChessBotsTournamentV4:", address(v4));
        console.log("");
        console.log("EXISTING (unchanged):");
        console.log("  V3 Tournament:  0x0e2663b0DCD9b7408d51C6972f679B81a5A7477e");
        console.log("  USDC:           ", USDC);
        console.log("  CHESS Token:    ", CHESS_TOKEN);
        console.log("  Staking V1:     ", STAKING_V1);
        console.log("  BettingPool:    0x2b7d1D75AF4fA998bF4C93E84710623BCACC8dA9");
        console.log("  DEX Router:     ", DEX_ROUTER);
        console.log("  Treasury:       ", TREASURY);
        console.log("");
        console.log("MANUAL STEPS AFTER DEPLOY:");
        console.log("  1. ELO:       setAuthorizedUpdater(orchestrator, true)");
        console.log("  2. Season:    setAuthorizedRecorder(orchestrator, true)");
        console.log("  3. Satellite: setAuthorizedManager(orchestrator, true)");
        console.log("  4. Bounty:    setAuthorizedManager(orchestrator, true)");
        console.log("  5. Update frontend .env with all 9 addresses");
        console.log("  6. Update agent-gateway + orchestrator .env");
        console.log("  7. Verify contracts on monadscan.com");
    }
}
