// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChessToken.sol";

contract ChessTokenTest is Test {
    ChessToken public token;
    address deployer = address(1);
    address alice = address(10);
    address bob = address(11);

    function setUp() public {
        token = new ChessToken(deployer);
    }

    function test_initialSupply() public view {
        assertEq(token.totalSupply(), 1_000_000_000e18);
        assertEq(token.balanceOf(deployer), 1_000_000_000e18);
        assertEq(token.totalBurned(), 0);
    }

    function test_transfer() public {
        vm.prank(deployer);
        token.transfer(alice, 1000e18);
        assertEq(token.balanceOf(alice), 1000e18);
        assertEq(token.balanceOf(deployer), 1_000_000_000e18 - 1000e18);
    }

    function test_approve_and_transferFrom() public {
        vm.prank(deployer);
        token.approve(alice, 500e18);
        assertEq(token.allowance(deployer, alice), 500e18);

        vm.prank(alice);
        token.transferFrom(deployer, bob, 500e18);
        assertEq(token.balanceOf(bob), 500e18);
        assertEq(token.allowance(deployer, alice), 0);
    }

    function test_burn() public {
        vm.prank(deployer);
        token.burn(100e18);

        assertEq(token.totalSupply(), 1_000_000_000e18 - 100e18);
        assertEq(token.balanceOf(deployer), 1_000_000_000e18 - 100e18);
        assertEq(token.totalBurned(), 100e18);
    }

    function test_burnFrom() public {
        vm.prank(deployer);
        token.approve(alice, 200e18);

        vm.prank(alice);
        token.burnFrom(deployer, 200e18);

        assertEq(token.totalSupply(), 1_000_000_000e18 - 200e18);
        assertEq(token.totalBurned(), 200e18);
        assertEq(token.allowance(deployer, alice), 0);
    }

    function test_cannotBurnMoreThanBalance() public {
        vm.prank(deployer);
        token.transfer(alice, 100e18);

        vm.prank(alice);
        vm.expectRevert("Insufficient balance");
        token.burn(200e18);
    }

    function test_cannotTransferMoreThanBalance() public {
        vm.prank(alice);
        vm.expectRevert("Insufficient balance");
        token.transfer(bob, 1);
    }

    function test_cannotTransferToZero() public {
        vm.prank(deployer);
        vm.expectRevert("Transfer to zero");
        token.transfer(address(0), 100e18);
    }

    function test_maxApproval_noDecrease() public {
        vm.prank(deployer);
        token.approve(alice, type(uint256).max);

        vm.prank(alice);
        token.transferFrom(deployer, bob, 100e18);

        // Max approval should not decrease
        assertEq(token.allowance(deployer, alice), type(uint256).max);
    }
}
