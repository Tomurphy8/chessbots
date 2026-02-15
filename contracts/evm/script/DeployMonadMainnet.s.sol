// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ChessBotsTournament.sol";
import "../src/ChessToken.sol";
import "../src/ChessStaking.sol";
import "../src/ChessBettingPool.sol";

/// @title DeployMonadMainnet - Production deployment on Monad mainnet
/// @notice Deploys ChessBotsTournament + ChessToken + ChessStaking + ChessBettingPool
/// @dev Uses native Circle USDC on Monad (chain ID 143)
contract DeployMonadMainnet is Script {
    // Native Circle USDC on Monad mainnet
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;

    // Safe multisig treasury (same address across all networks)
    address constant TREASURY = 0xE307A2BbC6c8d5990E7F4a9Aa8dCe6ED25D5BaD3;

    // Nad.fun DEX router (Capricorn V3) — for buyback-and-burn after token graduation
    address constant DEX_ROUTER = 0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // 1. Deploy tournament contract with protocol config
        //    10% protocol fee, 90% buyback / 10% treasury split
        ChessBotsTournament tournament = new ChessBotsTournament(
            USDC,       // Native Circle USDC
            TREASURY,   // Safe multisig
            1000,       // protocolFeeBps (10%)
            9000,       // buybackShareBps (90%)
            1000        // treasuryShareBps (10%)
        );
        console.log("ChessBotsTournament deployed at:", address(tournament));

        // 2. Deploy $CHESS token (1B supply to deployer)
        ChessToken chess = new ChessToken(deployer);
        console.log("ChessToken deployed at:", address(chess));

        // 3. Deploy staking contract
        ChessStaking staking = new ChessStaking(address(chess));
        console.log("ChessStaking deployed at:", address(staking));

        // 4. Deploy betting pool (3% vig)
        ChessBettingPool bettingPool = new ChessBettingPool(
            USDC,
            address(tournament),
            TREASURY,
            300 // 3% vig
        );
        console.log("ChessBettingPool deployed at:", address(bettingPool));

        // 5. Configure tokenomics
        tournament.setChessToken(address(chess));
        tournament.setStakingContract(address(staking));
        tournament.setDexRouter(DEX_ROUTER);
        console.log("Tokenomics configured: CHESS + staking + DEX router");

        vm.stopBroadcast();

        console.log("---");
        console.log("MONAD MAINNET DEPLOYMENT COMPLETE");
        console.log("  Chain ID:     143");
        console.log("  USDC (native):", USDC);
        console.log("  Tournament:  ", address(tournament));
        console.log("  ChessToken:  ", address(chess));
        console.log("  ChessStaking:", address(staking));
        console.log("  BettingPool: ", address(bettingPool));
        console.log("  Treasury:    ", TREASURY);
        console.log("  DEX Router:  ", DEX_ROUTER);
        console.log("  Deployer:    ", deployer);
        console.log("");
        console.log("NEXT STEPS:");
        console.log("  1. Launch $CHESS on nad.fun (bonding curve)");
        console.log("  2. After graduation, verify DEX router is correct");
        console.log("  3. Update frontend .env with new contract addresses");
        console.log("  4. Update agent-gateway + orchestrator .env");
    }
}
