// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChessBounty.sol";

contract MockUSDCBounty {
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

contract ChessBountyTest is Test {
    ChessBounty public bounty;
    MockUSDCBounty public usdc;

    address authority = address(1);
    address orchestrator = address(2);
    address agent1 = address(10);
    address agent2 = address(11);
    address agent3 = address(12);
    address agent4 = address(13);

    function setUp() public {
        usdc = new MockUSDCBounty();
        vm.prank(authority);
        bounty = new ChessBounty(address(usdc));

        vm.prank(authority);
        bounty.setAuthorizedManager(orchestrator, true);
    }

    function _initBountyTournament(uint256 tournamentId, uint256 totalPool, uint8 playerCount) internal {
        address[] memory players = new address[](playerCount);
        address[4] memory allAgents = [agent1, agent2, agent3, agent4];
        for (uint8 i = 0; i < playerCount; i++) {
            players[i] = allAgents[i];
        }

        // Fund the bounty contract with USDC (simulating entry fee collection)
        usdc.mint(address(bounty), totalPool);

        vm.prank(orchestrator);
        bounty.initializeBounties(tournamentId, totalPool, players);
    }

    // ================================================================
    //                  INITIALIZATION TESTS
    // ================================================================

    function test_initializeBounties() public {
        _initBountyTournament(1, 400e6, 4);

        ChessBounty.BountyTournament memory bt = bounty.getBountyTournament(1);
        assertEq(bt.totalPool, 400e6);
        assertEq(bt.bountyPool, 200e6);     // 50%
        assertEq(bt.centralPool, 200e6);    // 50%
        assertEq(bt.playerCount, 4);
        assertTrue(bt.initialized);

        // Each player gets 200e6 / 4 = 50e6 bounty
        assertEq(bounty.getAgentBounty(1, agent1), 50e6);
        assertEq(bounty.getAgentBounty(1, agent2), 50e6);
        assertEq(bounty.getAgentBounty(1, agent3), 50e6);
        assertEq(bounty.getAgentBounty(1, agent4), 50e6);
    }

    function test_cannotInitializeTwice() public {
        _initBountyTournament(1, 400e6, 4);

        address[] memory players = new address[](2);
        players[0] = agent1;
        players[1] = agent2;

        vm.prank(orchestrator);
        vm.expectRevert("Already initialized");
        bounty.initializeBounties(1, 400e6, players);
    }

    // ================================================================
    //                  BOUNTY TRANSFER TESTS
    // ================================================================

    function test_bountyTransferOnWin() public {
        _initBountyTournament(1, 400e6, 4);

        // agent1 beats agent2 — gets agent2's 50 USDC bounty
        vm.prank(orchestrator);
        bounty.transferBounty(1, agent1, agent2);

        assertEq(bounty.getAgentBounty(1, agent1), 100e6); // 50 + 50
        assertEq(bounty.getAgentBounty(1, agent2), 0);
    }

    function test_cumulativeBounties() public {
        _initBountyTournament(1, 400e6, 4);

        // agent1 beats agent2 → agent1 has 100
        vm.prank(orchestrator);
        bounty.transferBounty(1, agent1, agent2);

        // agent1 beats agent3 → agent1 has 150
        vm.prank(orchestrator);
        bounty.transferBounty(1, agent1, agent3);

        assertEq(bounty.getAgentBounty(1, agent1), 150e6);
        assertEq(bounty.getAgentBounty(1, agent2), 0);
        assertEq(bounty.getAgentBounty(1, agent3), 0);
    }

    function test_drawNoBountyTransfer() public {
        _initBountyTournament(1, 400e6, 4);

        // Draws don't transfer bounties — no call to transferBounty
        // After no transfer, bounties remain unchanged
        assertEq(bounty.getAgentBounty(1, agent1), 50e6);
        assertEq(bounty.getAgentBounty(1, agent2), 50e6);
    }

    function test_bountySnowball() public {
        _initBountyTournament(1, 400e6, 4);

        // agent1 beats agent2 (has 100), then beats agent3 (has 150), then beats agent4 (has 200)
        vm.startPrank(orchestrator);
        bounty.transferBounty(1, agent1, agent2);
        bounty.transferBounty(1, agent1, agent3);
        bounty.transferBounty(1, agent1, agent4);
        vm.stopPrank();

        // agent1 has ALL bounties
        assertEq(bounty.getAgentBounty(1, agent1), 200e6);
    }

    // ================================================================
    //                  CLAIM TESTS
    // ================================================================

    function test_claimBounty() public {
        _initBountyTournament(1, 400e6, 4);

        vm.prank(orchestrator);
        bounty.transferBounty(1, agent1, agent2);

        vm.prank(orchestrator);
        bounty.finalizeBounties(1);

        uint256 before = usdc.balanceOf(agent1);
        vm.prank(agent1);
        bounty.claimBounty(1);

        assertEq(usdc.balanceOf(agent1) - before, 100e6);
    }

    function test_cannotClaimBeforeFinalized() public {
        _initBountyTournament(1, 400e6, 4);

        vm.prank(agent1);
        vm.expectRevert("Not finalized");
        bounty.claimBounty(1);
    }

    function test_cannotDoubleClaim() public {
        _initBountyTournament(1, 400e6, 4);

        vm.prank(orchestrator);
        bounty.finalizeBounties(1);

        vm.prank(agent1);
        bounty.claimBounty(1);

        vm.prank(agent1);
        vm.expectRevert("Already claimed");
        bounty.claimBounty(1);
    }

    function test_zeroBountyCannotClaim() public {
        _initBountyTournament(1, 400e6, 4);

        // agent2 loses all bounty
        vm.prank(orchestrator);
        bounty.transferBounty(1, agent1, agent2);

        vm.prank(orchestrator);
        bounty.finalizeBounties(1);

        vm.prank(agent2);
        vm.expectRevert("No bounty to claim");
        bounty.claimBounty(1);
    }

    // ================================================================
    //                  VIEW TESTS
    // ================================================================

    function test_getCentralPool() public {
        _initBountyTournament(1, 400e6, 4);
        assertEq(bounty.getCentralPool(1), 200e6);
    }

    // ================================================================
    //                  AUTH TESTS
    // ================================================================

    function test_onlyAuthorizedCanInit() public {
        address[] memory players = new address[](2);
        players[0] = agent1;
        players[1] = agent2;

        vm.prank(address(99));
        vm.expectRevert("Not authorized");
        bounty.initializeBounties(1, 100e6, players);
    }

    function test_onlyAuthorizedCanTransfer() public {
        _initBountyTournament(1, 400e6, 4);

        vm.prank(address(99));
        vm.expectRevert("Not authorized");
        bounty.transferBounty(1, agent1, agent2);
    }
}
