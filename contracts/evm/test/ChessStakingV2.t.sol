// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChessStakingV2.sol";

contract MockCHESSV2 {
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

contract MockUSDCV2 {
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

contract ChessStakingV2Test is Test {
    ChessStakingV2 public staking;
    MockCHESSV2 public chess;
    MockUSDCV2 public usdc;

    address authority = address(1);
    address manager = address(2);   // V4 tournament contract
    address backer1 = address(10);
    address backer2 = address(11);
    address agent1 = address(20);
    address agent2 = address(21);

    function setUp() public {
        chess = new MockCHESSV2();
        usdc = new MockUSDCV2();

        vm.prank(authority);
        staking = new ChessStakingV2(address(chess), address(usdc));

        vm.prank(authority);
        staking.setManager(manager);

        // Fund backers
        chess.mint(backer1, 500_000e18);
        chess.mint(backer2, 200_000e18);
        usdc.mint(backer1, 100_000e6);
        usdc.mint(backer2, 50_000e6);

        // Approve
        vm.prank(backer1);
        chess.approve(address(staking), type(uint256).max);
        vm.prank(backer1);
        usdc.approve(address(staking), type(uint256).max);
        vm.prank(backer2);
        chess.approve(address(staking), type(uint256).max);
        vm.prank(backer2);
        usdc.approve(address(staking), type(uint256).max);

        // Fund manager (V4 contract) with USDC for winnings distribution
        usdc.mint(manager, 1_000_000e6);
        vm.prank(manager);
        usdc.approve(address(staking), type(uint256).max);
    }

    // ================================================================
    //                  BACKING TESTS
    // ================================================================

    function test_backAgent() public {
        vm.prank(backer1);
        staking.backAgent(agent1, 50_000e18, 1_000e6);

        ChessStakingV2.BackerPosition memory pos = staking.getPosition(backer1, agent1);
        assertEq(pos.chessStaked, 50_000e18);
        assertEq(pos.usdcDeposited, 1_000e6);

        ChessStakingV2.AgentPool memory pool = staking.getAgentPool(agent1);
        assertEq(pool.totalChessStaked, 50_000e18);
        assertEq(pool.totalUsdcPool, 1_000e6);
        assertEq(pool.backerCount, 1);
        assertTrue(pool.exists);
    }

    function test_multipleBackers() public {
        vm.prank(backer1);
        staking.backAgent(agent1, 100_000e18, 5_000e6);

        vm.prank(backer2);
        staking.backAgent(agent1, 50_000e18, 2_000e6);

        ChessStakingV2.AgentPool memory pool = staking.getAgentPool(agent1);
        assertEq(pool.totalChessStaked, 150_000e18);
        assertEq(pool.totalUsdcPool, 7_000e6);
        assertEq(pool.backerCount, 2);
    }

    function test_cannotBackZero() public {
        vm.prank(backer1);
        vm.expectRevert("Nothing to stake");
        staking.backAgent(agent1, 0, 0);
    }

    function test_cannotBackZeroAgent() public {
        vm.prank(backer1);
        vm.expectRevert("Zero agent");
        staking.backAgent(address(0), 100e18, 0);
    }

    // ================================================================
    //                  COVERAGE TIER TESTS
    // ================================================================

    function test_coverageTier1() public view {
        assertEq(staking.getCoverageBps(10_000e18), 2500);  // 25%
    }

    function test_coverageTier2() public view {
        assertEq(staking.getCoverageBps(50_000e18), 5000);  // 50%
    }

    function test_coverageTier3() public view {
        assertEq(staking.getCoverageBps(100_000e18), 7500); // 75%
    }

    function test_coverageTier4() public view {
        assertEq(staking.getCoverageBps(250_000e18), 10000); // 100%
    }

    function test_coverageNone() public view {
        assertEq(staking.getCoverageBps(5_000e18), 0);
    }

    // ================================================================
    //                  WIN SPLIT TESTS
    // ================================================================

    function test_agentShareTier1() public view {
        assertEq(staking.getAgentShareBps(10_000e18), 7500);  // 75/25
    }

    function test_agentShareTier4() public view {
        assertEq(staking.getAgentShareBps(250_000e18), 5500); // 55/45
    }

    function test_agentShareNone() public view {
        assertEq(staking.getAgentShareBps(5_000e18), 10000);  // 100% to agent
    }

    // ================================================================
    //                  ENTRY FEE COVERAGE TESTS
    // ================================================================

    function test_coverEntryFee() public {
        // backer1 stakes 50K CHESS (tier 2 = 50% coverage) and 1000 USDC
        vm.prank(backer1);
        staking.backAgent(agent1, 50_000e18, 1_000e6);

        // Entry fee is 100 USDC, 50% covered = 50 USDC
        vm.prank(manager);
        uint256 covered = staking.coverEntryFee(agent1, 100e6);

        assertEq(covered, 50e6);

        // Backer's USDC reduced
        ChessStakingV2.BackerPosition memory pos = staking.getPosition(backer1, agent1);
        assertEq(pos.usdcDeposited, 950e6);
    }

    function test_coverEntryFee_noBackers() public {
        vm.prank(manager);
        uint256 covered = staking.coverEntryFee(agent2, 100e6);
        assertEq(covered, 0);
    }

    function test_coverEntryFee_cappedByUsdcPool() public {
        // Stake lots of CHESS (tier 4 = 100% coverage) but only 10 USDC
        vm.prank(backer1);
        staking.backAgent(agent1, 250_000e18, 10e6);

        // Entry fee is 100 USDC, coverage capped at 10 USDC (pool limit)
        vm.prank(manager);
        uint256 covered = staking.coverEntryFee(agent1, 100e6);

        assertEq(covered, 10e6);
    }

    // ================================================================
    //                  WINNINGS DISTRIBUTION TESTS
    // ================================================================

    function test_distributeWinnings_singleBacker() public {
        vm.prank(backer1);
        staking.backAgent(agent1, 50_000e18, 1_000e6);

        // Agent wins 1000 USDC — tier 2: 65% agent, 35% stakers
        vm.prank(manager);
        staking.distributeWinnings(agent1, 1, 1_000e6);

        // Agent gets 650 USDC
        assertEq(usdc.balanceOf(agent1), 650e6);

        // Backer gets 350 USDC (auto-compounded to USDC deposit)
        ChessStakingV2.BackerPosition memory pos = staking.getPosition(backer1, agent1);
        assertEq(pos.totalEarned, 350e6);
        assertEq(pos.usdcDeposited, 1_350e6); // 1000 + 350
    }

    function test_distributeWinnings_multipleBackers() public {
        // backer1 stakes 100K CHESS, backer2 stakes 50K CHESS
        // Total 150K = tier 3 (75% coverage, 60/40 split)
        vm.prank(backer1);
        staking.backAgent(agent1, 100_000e18, 5_000e6);

        vm.prank(backer2);
        staking.backAgent(agent1, 50_000e18, 2_000e6);

        // Agent wins 1000 USDC — 60% agent (600), 40% stakers (400)
        vm.prank(manager);
        staking.distributeWinnings(agent1, 1, 1_000e6);

        // Backer1 gets 2/3 of 400e6 = 266_666_666 (pro-rata by CHESS staked)
        ChessStakingV2.BackerPosition memory pos1 = staking.getPosition(backer1, agent1);
        assertEq(pos1.totalEarned, 266_666_666);

        // Backer2 gets 1/3 of 400e6 = 133_333_333
        ChessStakingV2.BackerPosition memory pos2 = staking.getPosition(backer2, agent1);
        assertEq(pos2.totalEarned, 133_333_333);

        // 266_666_666 + 133_333_333 = 399_999_999, dust = 1 goes to agent
        // Agent gets 600e6 base + 1 dust = 600_000_001
        assertEq(usdc.balanceOf(agent1), 600_000_001);
    }

    function test_distributeWinnings_noBackers() public {
        // No backers — agent gets everything
        vm.prank(manager);
        staking.distributeWinnings(agent1, 1, 1_000e6);

        assertEq(usdc.balanceOf(agent1), 1_000e6);
    }

    // ================================================================
    //                  WITHDRAWAL TESTS
    // ================================================================

    function test_withdrawBacking() public {
        vm.prank(backer1);
        staking.backAgent(agent1, 50_000e18, 1_000e6);

        // Fast forward past cooldown
        vm.warp(block.timestamp + 8 days);

        uint256 chessBefore = chess.balanceOf(backer1);
        vm.prank(backer1);
        staking.withdrawBacking(agent1, 50_000e18);

        assertEq(chess.balanceOf(backer1) - chessBefore, 50_000e18);
    }

    function test_withdrawUsdc() public {
        vm.prank(backer1);
        staking.backAgent(agent1, 50_000e18, 1_000e6);

        vm.warp(block.timestamp + 8 days);

        uint256 usdcBefore = usdc.balanceOf(backer1);
        vm.prank(backer1);
        staking.withdrawUsdc(agent1, 500e6);

        assertEq(usdc.balanceOf(backer1) - usdcBefore, 500e6);
    }

    function test_cannotWithdrawDuringCooldown() public {
        vm.prank(backer1);
        staking.backAgent(agent1, 50_000e18, 0);

        vm.prank(backer1);
        vm.expectRevert("Cooldown active");
        staking.withdrawBacking(agent1, 50_000e18);
    }

    function test_cannotWithdrawMoreThanStaked() public {
        vm.prank(backer1);
        staking.backAgent(agent1, 50_000e18, 0);

        vm.warp(block.timestamp + 8 days);

        vm.prank(backer1);
        vm.expectRevert("Insufficient stake");
        staking.withdrawBacking(agent1, 100_000e18);
    }

    // ================================================================
    //                  AUTH TESTS
    // ================================================================

    function test_onlyManagerCanCoverFee() public {
        vm.prank(address(99));
        vm.expectRevert("Not manager");
        staking.coverEntryFee(agent1, 100e6);
    }

    function test_onlyManagerCanDistribute() public {
        vm.prank(address(99));
        vm.expectRevert("Not manager");
        staking.distributeWinnings(agent1, 1, 1_000e6);
    }

    function test_authorityTransfer() public {
        address newAuth = address(55);

        vm.prank(authority);
        staking.proposeAuthority(newAuth);

        vm.prank(newAuth);
        staking.acceptAuthority();

        assertEq(staking.authority(), newAuth);
    }

    // ================================================================
    //                  VIEW TESTS
    // ================================================================

    function test_getBackers() public {
        vm.prank(backer1);
        staking.backAgent(agent1, 50_000e18, 0);

        vm.prank(backer2);
        staking.backAgent(agent1, 25_000e18, 0);

        address[] memory backers = staking.getBackers(agent1);
        assertEq(backers.length, 2);
        assertEq(backers[0], backer1);
        assertEq(backers[1], backer2);
    }
}
