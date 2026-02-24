// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ChessBettingPoolV3.sol";

contract DeployBettingV3 is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        ChessBettingPoolV3 pool = new ChessBettingPoolV3(
            0x754704Bc059F8C67012fEd69BC8A327a5aafb603, // USDC
            0xa6B8eA116E16321B98fa9aCCfb63Cf0933c7e787, // V4 Tournament Contract
            0xE307A2BbC6c8d5990E7F4a9Aa8dCe6ED25D5BaD3, // Treasury
            300                                           // 3% vig
        );

        console.log("ChessBettingPoolV3 deployed at:", address(pool));

        vm.stopBroadcast();
    }
}
