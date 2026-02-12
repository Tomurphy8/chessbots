// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MockUSDC.sol";
import "../src/ChessBotsTournament.sol";

/// @title DeployBase - Self-contained Base Sepolia deployment
/// @notice Deploys MockUSDC + ChessBotsTournament + initializes protocol
contract DeployBase is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // 1. Deploy mock USDC
        MockUSDC usdc = new MockUSDC();
        console.log("MockUSDC deployed at:", address(usdc));

        // 2. Deploy tournament contract with protocol config in constructor
        //    SC-C1: 10% fee, 90% buyback / 10% treasury split
        ChessBotsTournament tournament = new ChessBotsTournament(
            address(usdc),
            deployer,       // treasury
            1000,           // protocolFeeBps (10%)
            9000,           // buybackShareBps (90%)
            1000            // treasuryShareBps (10%)
        );
        console.log("ChessBotsTournament deployed at:", address(tournament));
        console.log("Protocol initialized in constructor. Treasury:", deployer);

        // 4. Mint test USDC to deployer (100,000 USDC)
        usdc.mint(deployer, 100_000 * 1e6);
        console.log("Minted 100,000 USDC to deployer");

        vm.stopBroadcast();

        console.log("---");
        console.log("BASE SEPOLIA DEPLOYMENT COMPLETE");
        console.log("  MockUSDC:", address(usdc));
        console.log("  Tournament:", address(tournament));
        console.log("  Deployer/Treasury:", deployer);
    }
}
