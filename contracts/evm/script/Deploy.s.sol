// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ChessBotsTournament.sol";

contract DeployChessBots is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");

        vm.startBroadcast(deployerKey);

        // SC-C1: Constructor now takes all protocol params (no separate initialize)
        ChessBotsTournament tournament = new ChessBotsTournament(
            usdcAddress,
            treasury,
            1000,   // protocolFeeBps (10%)
            9000,   // buybackShareBps (90%)
            1000    // treasuryShareBps (10%)
        );

        vm.stopBroadcast();

        console.log("ChessBotsTournament deployed at:", address(tournament));
    }
}
