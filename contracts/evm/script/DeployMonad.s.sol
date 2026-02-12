// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MockUSDC.sol";
import "../src/ChessBotsTournament.sol";
import "../src/ChessToken.sol";
import "../src/ChessStaking.sol";
import "../src/ChessBettingPool.sol";

/// @title DeployMonad - Self-contained testnet deployment
/// @notice Deploys MockUSDC + ChessBotsTournament + ChessToken + ChessStaking
/// @dev SC-C1: Constructor now takes all protocol params (no separate initialize)
contract DeployMonad is Script {
    // Safe multisig treasury (same address on Monad testnet, mainnet, Base, Ethereum)
    address constant TREASURY = 0xE307A2BbC6c8d5990E7F4a9Aa8dCe6ED25D5BaD3;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // 1. Deploy mock USDC
        MockUSDC usdc = new MockUSDC();
        console.log("MockUSDC deployed at:", address(usdc));

        // 2. Deploy tournament contract with protocol config in constructor
        //    10% protocol fee, 90% buyback / 10% treasury split
        ChessBotsTournament tournament = new ChessBotsTournament(
            address(usdc),  // _usdc
            TREASURY,       // _treasury (Safe multisig)
            1000,           // _protocolFeeBps (10%)
            9000,           // _buybackShareBps (90%)
            1000            // _treasuryShareBps (10%)
        );
        console.log("ChessBotsTournament deployed at:", address(tournament));
        console.log("Protocol initialized in constructor. Treasury:", TREASURY);

        // 4. Deploy $CHESS token (1B supply to deployer)
        ChessToken chess = new ChessToken(deployer);
        console.log("ChessToken deployed at:", address(chess));

        // 5. Deploy staking contract
        ChessStaking staking = new ChessStaking(address(chess));
        console.log("ChessStaking deployed at:", address(staking));

        // 6. Deploy betting pool (3% vig)
        ChessBettingPool bettingPool = new ChessBettingPool(
            address(usdc),
            address(tournament),
            TREASURY,
            300 // 3% vig
        );
        console.log("ChessBettingPool deployed at:", address(bettingPool));

        // 7. Configure tokenomics on tournament contract
        tournament.setChessToken(address(chess));
        tournament.setStakingContract(address(staking));
        console.log("Tokenomics configured on tournament contract");

        // 8. Note: setDexRouter left for manual config after pool creation
        //    tournament.setDexRouter(UNISWAP_V3_ROUTER);

        // 9. Mint test USDC to deployer (100,000 USDC)
        usdc.mint(deployer, 100_000 * 1e6);
        console.log("Minted 100,000 USDC to deployer");

        vm.stopBroadcast();

        console.log("---");
        console.log("MONAD DEPLOYMENT COMPLETE");
        console.log("  MockUSDC:", address(usdc));
        console.log("  Tournament:", address(tournament));
        console.log("  ChessToken:", address(chess));
        console.log("  ChessStaking:", address(staking));
        console.log("  BettingPool:", address(bettingPool));
        console.log("  Deployer:", deployer);
        console.log("  Treasury (Safe):", TREASURY);
        console.log("");
        console.log("NEXT STEPS:");
        console.log("  1. Create CHESS/USDC pool on Uniswap V3");
        console.log("  2. Call tournament.setDexRouter(ROUTER_ADDRESS)");
        console.log("  3. Add initial liquidity to the pool");
    }
}
