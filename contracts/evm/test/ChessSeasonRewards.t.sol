// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChessSeasonRewards.sol";

contract MockCHESS {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient");
        require(allowance[from][msg.sender] >= amount, "Not allowed");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract ChessSeasonRewardsTest is Test {
    ChessSeasonRewards public rewards;
    MockCHESS public chess;

    address authority = address(1);
    address depositor = address(2);
    address winner1 = address(10);
    address winner2 = address(11);
    address winner3 = address(12);

    function setUp() public {
        chess = new MockCHESS();
        vm.prank(authority);
        rewards = new ChessSeasonRewards(address(chess));

        // Fund depositor
        chess.mint(depositor, 1_000_000e18);
        vm.prank(depositor);
        chess.approve(address(rewards), type(uint256).max);
    }

    function test_deposit() public {
        vm.prank(depositor);
        rewards.deposit(100_000e18);

        assertEq(rewards.balance(), 100_000e18);
    }

    function test_depositZeroReverts() public {
        vm.prank(depositor);
        vm.expectRevert("Zero amount");
        rewards.deposit(0);
    }

    function test_distributeRewards() public {
        vm.prank(depositor);
        rewards.deposit(100_000e18);

        address[] memory recipients = new address[](3);
        uint256[] memory amounts = new uint256[](3);

        recipients[0] = winner1; amounts[0] = 50_000e18;
        recipients[1] = winner2; amounts[1] = 30_000e18;
        recipients[2] = winner3; amounts[2] = 20_000e18;

        vm.prank(authority);
        rewards.distributeRewards(0, recipients, amounts);

        assertEq(chess.balanceOf(winner1), 50_000e18);
        assertEq(chess.balanceOf(winner2), 30_000e18);
        assertEq(chess.balanceOf(winner3), 20_000e18);
        assertEq(rewards.totalDistributed(), 100_000e18);
        assertEq(rewards.seasonDistributed(0), 100_000e18);
    }

    function test_cannotDistributeMoreThanBalance() public {
        vm.prank(depositor);
        rewards.deposit(50e18);

        address[] memory recipients = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        recipients[0] = winner1;
        amounts[0] = 100e18;

        vm.prank(authority);
        vm.expectRevert("Insufficient balance");
        rewards.distributeRewards(0, recipients, amounts);
    }

    function test_onlyAuthorityCanDistribute() public {
        vm.prank(depositor);
        rewards.deposit(100e18);

        address[] memory recipients = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        recipients[0] = winner1;
        amounts[0] = 50e18;

        vm.prank(address(99));
        vm.expectRevert("Unauthorized");
        rewards.distributeRewards(0, recipients, amounts);
    }

    function test_authorityTransfer() public {
        address newAuth = address(55);

        vm.prank(authority);
        rewards.proposeAuthority(newAuth);

        vm.prank(newAuth);
        rewards.acceptAuthority();

        assertEq(rewards.authority(), newAuth);
    }
}
