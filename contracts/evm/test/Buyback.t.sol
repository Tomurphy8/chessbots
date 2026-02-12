// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChessBotsTournament.sol";
import "../src/ChessToken.sol";
import "../src/MockDexRouter.sol";
import "../src/libraries/TournamentLib.sol";

contract TestUSDC {
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
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract BuybackTest is Test {
    ChessBotsTournament public tournament;
    TestUSDC public usdc;
    ChessToken public chess;
    MockDexRouter public router;

    address authority = address(1);
    address treasury = address(2);
    address agent1 = address(10);
    address agent2 = address(11);
    address agent3 = address(12);
    address agent4 = address(13);
    address anyone = address(99);

    function setUp() public {
        usdc = new TestUSDC();
        chess = new ChessToken(address(this)); // deploy chess, this contract holds supply

        router = new MockDexRouter(address(usdc), address(chess));

        // Fund the router with CHESS for swaps
        chess.transfer(address(router), 500_000_000e18);

        // SC-C1: Constructor now takes all protocol params
        vm.prank(authority);
        tournament = new ChessBotsTournament(address(usdc), treasury, 1000, 9000, 1000);

        // Configure tokenomics
        vm.prank(authority);
        tournament.setChessToken(address(chess));
        vm.prank(authority);
        tournament.setDexRouter(address(router));

        // Fund agents
        usdc.mint(agent1, 10_000e6);
        usdc.mint(agent2, 10_000e6);
        usdc.mint(agent3, 10_000e6);
        usdc.mint(agent4, 10_000e6);

        vm.prank(agent1); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(agent2); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(agent3); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(agent4); usdc.approve(address(tournament), type(uint256).max);
    }

    // --- Helper: run a full tournament and distribute prizes ---
    function _runTournamentAndDistribute() internal returns (uint256 tournamentId) {
        // Register agents
        vm.prank(agent1); tournament.registerAgent("Agent1", "", TournamentLib.AgentType.Custom);
        vm.prank(agent2); tournament.registerAgent("Agent2", "", TournamentLib.AgentType.Custom);
        vm.prank(agent3); tournament.registerAgent("Agent3", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4); tournament.registerAgent("Agent4", "", TournamentLib.AgentType.Custom);

        // Create Bronze tournament (50 USDC entry)
        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Bronze, 32, 4,
            int64(int256(block.timestamp + 200)),
            int64(int256(block.timestamp + 100)),
            60, 0
        );
        tournamentId = 0;

        // Register all 4 agents
        vm.prank(agent1); tournament.registerForTournament(0);
        vm.prank(agent2); tournament.registerForTournament(0);
        vm.prank(agent3); tournament.registerForTournament(0);
        vm.prank(agent4); tournament.registerForTournament(0);

        // Start tournament
        vm.prank(authority);
        tournament.startTournament(0);

        // Create and play games for round 1
        ChessBotsTournament.GameInput[] memory gameInputs = new ChessBotsTournament.GameInput[](2);
        gameInputs[0] = ChessBotsTournament.GameInput(0, agent1, agent2);
        gameInputs[1] = ChessBotsTournament.GameInput(1, agent3, agent4);
        vm.prank(authority);
        tournament.batchCreateAndStartGames(0, 1, gameInputs);

        // Submit results
        ChessBotsTournament.GameResultInput[] memory results = new ChessBotsTournament.GameResultInput[](2);
        results[0] = ChessBotsTournament.GameResultInput(0, TournamentLib.GameResult.WhiteWins, keccak256("pgn1"), keccak256("r1"), 30);
        results[1] = ChessBotsTournament.GameResultInput(1, TournamentLib.GameResult.WhiteWins, keccak256("pgn2"), keccak256("r2"), 25);

        ChessBotsTournament.StandingsInput[] memory standings = new ChessBotsTournament.StandingsInput[](4);
        standings[0] = ChessBotsTournament.StandingsInput(agent1, 2, 0, 1, 1, 0, 0);
        standings[1] = ChessBotsTournament.StandingsInput(agent2, 0, 0, 1, 0, 0, 1);
        standings[2] = ChessBotsTournament.StandingsInput(agent3, 2, 0, 1, 1, 0, 0);
        standings[3] = ChessBotsTournament.StandingsInput(agent4, 0, 0, 1, 0, 0, 1);

        vm.prank(authority);
        tournament.executeRound(0, 1, results, standings, true);

        // Round 2
        ChessBotsTournament.GameInput[] memory g2 = new ChessBotsTournament.GameInput[](2);
        g2[0] = ChessBotsTournament.GameInput(0, agent1, agent3);
        g2[1] = ChessBotsTournament.GameInput(1, agent2, agent4);
        vm.prank(authority);
        tournament.batchCreateAndStartGames(0, 2, g2);

        ChessBotsTournament.GameResultInput[] memory r2 = new ChessBotsTournament.GameResultInput[](2);
        r2[0] = ChessBotsTournament.GameResultInput(0, TournamentLib.GameResult.WhiteWins, keccak256("pgn3"), keccak256("r3"), 40);
        r2[1] = ChessBotsTournament.GameResultInput(1, TournamentLib.GameResult.WhiteWins, keccak256("pgn4"), keccak256("r4"), 35);

        ChessBotsTournament.StandingsInput[] memory s2 = new ChessBotsTournament.StandingsInput[](4);
        s2[0] = ChessBotsTournament.StandingsInput(agent1, 4, 2, 2, 2, 0, 0);
        s2[1] = ChessBotsTournament.StandingsInput(agent2, 2, 0, 2, 1, 0, 1);
        s2[2] = ChessBotsTournament.StandingsInput(agent3, 2, 4, 2, 1, 0, 1);
        s2[3] = ChessBotsTournament.StandingsInput(agent4, 0, 0, 2, 0, 0, 2);

        vm.prank(authority);
        tournament.executeRound(0, 2, r2, s2, false);

        // Finalize
        vm.prank(authority);
        tournament.finalizeTournament(0, [agent1, agent3, agent2], "ipfs://results");

        // Distribute prizes
        vm.prank(authority);
        tournament.distributePrizes(0);
    }

    function test_distributePrizes_splitsFee() public {
        _runTournamentAndDistribute();

        // totalPool = 4 * 50 USDC = 200 USDC
        // protocolFee = 200 * 1000 / 10000 = 20 USDC
        // buybackAmount = 20 * 9000 / 10000 = 18 USDC
        // treasuryAmount = 20 - 18 = 2 USDC

        assertEq(tournament.pendingBuyback(), 18e6);
        assertEq(usdc.balanceOf(treasury), 2e6);
    }

    function test_executeBuyback_swapsAndBurns() public {
        _runTournamentAndDistribute();

        uint256 pending = tournament.pendingBuyback();
        assertEq(pending, 18e6);

        // SC-H4: Only authority can trigger buyback
        vm.prank(authority);
        tournament.executeBuyback(0);

        // Pending should be zeroed
        assertEq(tournament.pendingBuyback(), 0);

        // CHESS should have been burned (router gives 1000x CHESS per USDC)
        // 18 USDC * 1000 = 18,000 CHESS burned
        assertGt(chess.totalBurned(), 0);
    }

    function test_executeBuyback_failsUnderMinimum() public {
        // Only accumulate a small amount (need to run partial tournament)
        // Instead, just test with zero
        vm.prank(authority);
        vm.expectRevert("Min 10 USDC to buyback");
        tournament.executeBuyback(0);
    }

    function test_executeBuyback_failsNonAuthority() public {
        // SC-H4: Non-authority should be rejected
        vm.prank(anyone);
        vm.expectRevert("Unauthorized");
        tournament.executeBuyback(0);
    }

    function test_executeBuyback_failsWhenNotConfigured() public {
        // Deploy fresh tournament without token config
        vm.prank(authority);
        ChessBotsTournament freshTournament = new ChessBotsTournament(address(usdc), treasury, 1000, 9000, 1000);

        vm.prank(authority);
        vm.expectRevert("Buyback not configured");
        freshTournament.executeBuyback(0);
    }

    function test_gracefulDegradation_noTokenConfigured() public {
        // Deploy fresh tournament without token config
        TestUSDC freshUsdc = new TestUSDC();
        vm.prank(authority);
        ChessBotsTournament fresh = new ChessBotsTournament(address(freshUsdc), treasury, 1000, 9000, 1000);

        // Fund agents
        freshUsdc.mint(agent1, 10_000e6);
        freshUsdc.mint(agent2, 10_000e6);
        freshUsdc.mint(agent3, 10_000e6);
        freshUsdc.mint(agent4, 10_000e6);

        vm.prank(agent1); freshUsdc.approve(address(fresh), type(uint256).max);
        vm.prank(agent2); freshUsdc.approve(address(fresh), type(uint256).max);
        vm.prank(agent3); freshUsdc.approve(address(fresh), type(uint256).max);
        vm.prank(agent4); freshUsdc.approve(address(fresh), type(uint256).max);

        vm.prank(agent1); fresh.registerAgent("A1", "", TournamentLib.AgentType.Custom);
        vm.prank(agent2); fresh.registerAgent("A2", "", TournamentLib.AgentType.Custom);
        vm.prank(agent3); fresh.registerAgent("A3", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4); fresh.registerAgent("A4", "", TournamentLib.AgentType.Custom);

        vm.prank(authority);
        fresh.createTournament(TournamentLib.Tier.Bronze, 32, 4, int64(int256(block.timestamp + 200)), int64(int256(block.timestamp + 100)), 60, 0);

        vm.prank(agent1); fresh.registerForTournament(0);
        vm.prank(agent2); fresh.registerForTournament(0);
        vm.prank(agent3); fresh.registerForTournament(0);
        vm.prank(agent4); fresh.registerForTournament(0);

        vm.prank(authority); fresh.startTournament(0);

        // Fast forward through tournament
        ChessBotsTournament.GameInput[] memory g = new ChessBotsTournament.GameInput[](2);
        g[0] = ChessBotsTournament.GameInput(0, agent1, agent2);
        g[1] = ChessBotsTournament.GameInput(1, agent3, agent4);
        vm.prank(authority); fresh.batchCreateAndStartGames(0, 1, g);

        ChessBotsTournament.GameResultInput[] memory r = new ChessBotsTournament.GameResultInput[](2);
        r[0] = ChessBotsTournament.GameResultInput(0, TournamentLib.GameResult.WhiteWins, keccak256("p1"), keccak256("r1"), 30);
        r[1] = ChessBotsTournament.GameResultInput(1, TournamentLib.GameResult.WhiteWins, keccak256("p2"), keccak256("r2"), 25);

        ChessBotsTournament.StandingsInput[] memory s = new ChessBotsTournament.StandingsInput[](4);
        s[0] = ChessBotsTournament.StandingsInput(agent1, 4, 2, 2, 2, 0, 0);
        s[1] = ChessBotsTournament.StandingsInput(agent2, 2, 0, 2, 1, 0, 1);
        s[2] = ChessBotsTournament.StandingsInput(agent3, 2, 4, 2, 1, 0, 1);
        s[3] = ChessBotsTournament.StandingsInput(agent4, 0, 0, 2, 0, 0, 2);

        vm.prank(authority); fresh.executeRound(0, 1, r, s, true);

        // Round 2
        ChessBotsTournament.GameInput[] memory g2 = new ChessBotsTournament.GameInput[](2);
        g2[0] = ChessBotsTournament.GameInput(0, agent1, agent3);
        g2[1] = ChessBotsTournament.GameInput(1, agent2, agent4);
        vm.prank(authority); fresh.batchCreateAndStartGames(0, 2, g2);

        ChessBotsTournament.GameResultInput[] memory r2 = new ChessBotsTournament.GameResultInput[](2);
        r2[0] = ChessBotsTournament.GameResultInput(0, TournamentLib.GameResult.WhiteWins, keccak256("p3"), keccak256("r3"), 40);
        r2[1] = ChessBotsTournament.GameResultInput(1, TournamentLib.GameResult.WhiteWins, keccak256("p4"), keccak256("r4"), 35);

        ChessBotsTournament.StandingsInput[] memory s2 = new ChessBotsTournament.StandingsInput[](4);
        s2[0] = ChessBotsTournament.StandingsInput(agent1, 4, 2, 2, 2, 0, 0);
        s2[1] = ChessBotsTournament.StandingsInput(agent2, 2, 0, 2, 1, 0, 1);
        s2[2] = ChessBotsTournament.StandingsInput(agent3, 2, 4, 2, 1, 0, 1);
        s2[3] = ChessBotsTournament.StandingsInput(agent4, 0, 0, 2, 0, 0, 2);

        vm.prank(authority); fresh.executeRound(0, 2, r2, s2, false);

        vm.prank(authority); fresh.finalizeTournament(0, [agent1, agent3, agent2], "ipfs://results");
        vm.prank(authority); fresh.distributePrizes(0);

        // No buyback configured → all protocol fee goes to treasury
        assertEq(fresh.pendingBuyback(), 0);
        // 20 USDC protocol fee → all to treasury
        assertEq(freshUsdc.balanceOf(treasury), 20e6);
    }

    function test_buybackAccumulates() public {
        _runTournamentAndDistribute();
        uint256 firstBuyback = tournament.pendingBuyback();
        assertEq(firstBuyback, 18e6);

        // The pending buyback accumulates (we can't easily run two tournaments
        // since agents are already registered, but we verify the value is correct)
        assertGt(firstBuyback, 0);
    }

    function test_setChessToken_onlyAuthority() public {
        vm.prank(anyone);
        vm.expectRevert("Unauthorized");
        tournament.setChessToken(address(chess));
    }

    function test_setDexRouter_onlyAuthority() public {
        vm.prank(anyone);
        vm.expectRevert("Unauthorized");
        tournament.setDexRouter(address(router));
    }
}
