// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChessToken.sol";
import "../src/ChessStaking.sol";

contract ChessStakingTest is Test {
    ChessToken public token;
    ChessStaking public staking;

    address deployer = address(1);
    address alice = address(10);
    address bob = address(11);

    function setUp() public {
        token = new ChessToken(deployer);
        staking = new ChessStaking(address(token));

        // Give alice and bob tokens (enough for tier 8 testing)
        vm.prank(deployer);
        token.transfer(alice, 6_000_000e18);
        vm.prank(deployer);
        token.transfer(bob, 6_000_000e18);

        // Approve staking contract
        vm.prank(alice);
        token.approve(address(staking), type(uint256).max);
        vm.prank(bob);
        token.approve(address(staking), type(uint256).max);
    }

    function test_stakeAndBalance() public {
        vm.prank(alice);
        staking.stake(10_000e18);

        assertEq(staking.stakedBalance(alice), 10_000e18);
        assertEq(staking.totalStaked(), 10_000e18);
        assertEq(token.balanceOf(alice), 5_990_000e18);
    }

    function test_unstake() public {
        vm.prank(alice);
        staking.stake(50_000e18);

        // M-7: Must wait for lockup period (7 days)
        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(alice);
        staking.unstake(20_000e18);

        assertEq(staking.stakedBalance(alice), 30_000e18);
        assertEq(staking.totalStaked(), 30_000e18);
        assertEq(token.balanceOf(alice), 5_970_000e18);
    }

    function test_cannotUnstakeMoreThanStaked() public {
        vm.prank(alice);
        staking.stake(10_000e18);

        vm.prank(alice);
        vm.expectRevert("Insufficient staked balance");
        staking.unstake(20_000e18);
    }

    function test_cannotStakeZero() public {
        vm.prank(alice);
        vm.expectRevert("Cannot stake zero");
        staking.stake(0);
    }

    function test_cannotUnstakeZero() public {
        vm.prank(alice);
        vm.expectRevert("Cannot unstake zero");
        staking.unstake(0);
    }

    function test_discountTier0_noStake() public view {
        assertEq(staking.getDiscount(alice), 0);
    }

    function test_discountTier0_belowThreshold() public {
        vm.prank(alice);
        staking.stake(9_999e18);
        assertEq(staking.getDiscount(alice), 0);
    }

    function test_discountTier1_10K() public {
        vm.prank(alice);
        staking.stake(10_000e18);
        assertEq(staking.getDiscount(alice), 200); // 2%
    }

    function test_discountTier2_50K() public {
        vm.prank(alice);
        staking.stake(50_000e18);
        assertEq(staking.getDiscount(alice), 500); // 5%
    }

    function test_discountTier3_100K() public {
        vm.prank(alice);
        staking.stake(100_000e18);
        assertEq(staking.getDiscount(alice), 800); // 8%
    }

    function test_discountTier4_250K() public {
        vm.prank(alice);
        staking.stake(250_000e18);
        assertEq(staking.getDiscount(alice), 1200); // 12%
    }

    function test_discountTier5_500K() public {
        vm.prank(alice);
        staking.stake(500_000e18);
        assertEq(staking.getDiscount(alice), 1500); // 15%
    }

    function test_discountTier6_1M() public {
        vm.prank(alice);
        staking.stake(1_000_000e18);
        assertEq(staking.getDiscount(alice), 1800); // 18%
    }

    function test_discountTier7_2_5M() public {
        vm.prank(alice);
        staking.stake(2_500_000e18);
        assertEq(staking.getDiscount(alice), 2100); // 21%
    }

    function test_discountTier8_5M() public {
        vm.prank(alice);
        staking.stake(5_000_000e18);
        assertEq(staking.getDiscount(alice), 2500); // 25%
    }

    function test_discountTier8_aboveMax() public {
        vm.prank(alice);
        staking.stake(6_000_000e18);
        assertEq(staking.getDiscount(alice), 2500); // Still 25% max
    }

    function test_discountDropsAfterUnstake() public {
        vm.prank(alice);
        staking.stake(100_000e18);
        assertEq(staking.getDiscount(alice), 800);

        // M-7: Must wait for lockup period (7 days)
        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(alice);
        staking.unstake(60_000e18);
        // Now at 40K → tier 1 (200 bps)
        assertEq(staking.getDiscount(alice), 200);
    }

    function test_lockupPreventsEarlyUnstake() public {
        vm.prank(alice);
        staking.stake(10_000e18);

        // Try to unstake immediately — should fail
        vm.prank(alice);
        vm.expectRevert("Lockup period active");
        staking.unstake(10_000e18);

        // Warp 6 days — still locked
        vm.warp(block.timestamp + 6 days);
        vm.prank(alice);
        vm.expectRevert("Lockup period active");
        staking.unstake(10_000e18);

        // Warp past 7 days — should succeed
        vm.warp(block.timestamp + 2 days);
        vm.prank(alice);
        staking.unstake(10_000e18);
        assertEq(staking.stakedBalance(alice), 0);
    }

    function test_multipleStakers() public {
        vm.prank(alice);
        staking.stake(50_000e18);
        vm.prank(bob);
        staking.stake(100_000e18);

        assertEq(staking.totalStaked(), 150_000e18);
        assertEq(staking.getDiscount(alice), 500);
        assertEq(staking.getDiscount(bob), 800);
    }
}
