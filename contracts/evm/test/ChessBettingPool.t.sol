// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChessBotsTournament.sol";
import "../src/ChessBettingPool.sol";
import "../src/libraries/TournamentLib.sol";

contract MockUSDCBet {
    string public name = "Mock USDC";
    uint8 public decimals = 6;
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

contract ChessBettingPoolTest is Test {
    ChessBotsTournament public tournament;
    ChessBettingPool public betting;
    MockUSDCBet public usdc;

    address authority = address(1);
    address treasury = address(2);
    address bettor1 = address(30);
    address bettor2 = address(31);
    address bettor3 = address(32);
    address agent1 = address(10);
    address agent2 = address(11);
    address agent3 = address(12);
    address agent4 = address(13);

    function setUp() public {
        usdc = new MockUSDCBet();

        // Deploy tournament
        vm.prank(authority);
        tournament = new ChessBotsTournament(address(usdc), treasury, 1000, 9000, 1000);

        // Deploy betting pool (3% vig)
        vm.prank(authority);
        betting = new ChessBettingPool(address(usdc), address(tournament), treasury, 300);

        // Fund agents and bettors
        usdc.mint(agent1, 1000e6);
        usdc.mint(agent2, 1000e6);
        usdc.mint(agent3, 1000e6);
        usdc.mint(agent4, 1000e6);
        usdc.mint(bettor1, 10000e6);
        usdc.mint(bettor2, 10000e6);
        usdc.mint(bettor3, 10000e6);

        // Approve tournament
        vm.prank(agent1); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(agent2); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(agent3); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(agent4); usdc.approve(address(tournament), type(uint256).max);

        // Approve betting pool
        vm.prank(bettor1); usdc.approve(address(betting), type(uint256).max);
        vm.prank(bettor2); usdc.approve(address(betting), type(uint256).max);
        vm.prank(bettor3); usdc.approve(address(betting), type(uint256).max);
    }

    function _setupTournamentWithGame() internal {
        // Register agents
        vm.prank(agent1); tournament.registerAgent("A1", "", TournamentLib.AgentType.Custom);
        vm.prank(agent2); tournament.registerAgent("A2", "", TournamentLib.AgentType.Custom);
        vm.prank(agent3); tournament.registerAgent("A3", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4); tournament.registerAgent("A4", "", TournamentLib.AgentType.Custom);

        // Create and register for tournament
        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Bronze, 32, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );

        vm.prank(agent1); tournament.registerForTournament(0);
        vm.prank(agent2); tournament.registerForTournament(0);
        vm.prank(agent3); tournament.registerForTournament(0);
        vm.prank(agent4); tournament.registerForTournament(0);

        // Start tournament and create game
        vm.startPrank(authority);
        tournament.startTournament(0);
        tournament.createGame(0, 1, 0, agent1, agent2);
        tournament.createGame(0, 1, 1, agent3, agent4);
        vm.stopPrank();
    }

    // ── Pool Creation ──────────────────────────────────────────────────

    function test_createBetPool() public {
        _setupTournamentWithGame();

        vm.prank(authority);
        uint256 poolId = betting.createBetPool(0, 1, 0);

        assertEq(poolId, 0);

        (uint256 tid, uint8 round, uint8 gi, ChessBettingPool.PoolStatus status,,,,,,bool exists) = betting.betPools(0);
        assertEq(tid, 0);
        assertEq(round, 1);
        assertEq(gi, 0);
        assertTrue(status == ChessBettingPool.PoolStatus.Open);
        assertTrue(exists);
    }

    function test_onlyAuthorityCanCreatePool() public {
        _setupTournamentWithGame();

        vm.prank(bettor1);
        vm.expectRevert("Not authority");
        betting.createBetPool(0, 1, 0);
    }

    // ── Placing Bets ───────────────────────────────────────────────────

    function test_placeBet() public {
        _setupTournamentWithGame();

        vm.prank(authority);
        betting.createBetPool(0, 1, 0);

        uint256 betAmount = 10e6; // 10 USDC
        vm.prank(bettor1);
        betting.placeBet(0, ChessBettingPool.Prediction.WhiteWins, betAmount);

        (ChessBettingPool.Prediction pred, uint256 amt, bool claimed) = betting.getBet(0, bettor1);
        assertEq(uint8(pred), uint8(ChessBettingPool.Prediction.WhiteWins));
        assertEq(amt, betAmount);
        assertFalse(claimed);
    }

    function test_multipleBettors() public {
        _setupTournamentWithGame();

        vm.prank(authority);
        betting.createBetPool(0, 1, 0);

        vm.prank(bettor1); betting.placeBet(0, ChessBettingPool.Prediction.WhiteWins, 100e6);
        vm.prank(bettor2); betting.placeBet(0, ChessBettingPool.Prediction.BlackWins, 50e6);
        vm.prank(bettor3); betting.placeBet(0, ChessBettingPool.Prediction.Draw, 30e6);

        (uint256 ww, uint256 bw, uint256 d) = betting.getPoolBreakdown(0);
        assertEq(ww, 100e6);
        assertEq(bw, 50e6);
        assertEq(d, 30e6);
        assertEq(betting.getPoolTotal(0), 180e6);
    }

    function test_cannotDoubleBet() public {
        _setupTournamentWithGame();

        vm.prank(authority);
        betting.createBetPool(0, 1, 0);

        vm.prank(bettor1); betting.placeBet(0, ChessBettingPool.Prediction.WhiteWins, 10e6);

        vm.prank(bettor1);
        vm.expectRevert("Already bet on this pool");
        betting.placeBet(0, ChessBettingPool.Prediction.BlackWins, 10e6);
    }

    function test_belowMinBet() public {
        _setupTournamentWithGame();

        vm.prank(authority);
        betting.createBetPool(0, 1, 0);

        vm.prank(bettor1);
        vm.expectRevert("Below minimum bet");
        betting.placeBet(0, ChessBettingPool.Prediction.WhiteWins, 500000); // 0.5 USDC, below 1 USDC min
    }

    // ── Settlement ─────────────────────────────────────────────────────

    function test_settleBets() public {
        _setupTournamentWithGame();

        vm.prank(authority);
        betting.createBetPool(0, 1, 0);

        // Place bets
        vm.prank(bettor1); betting.placeBet(0, ChessBettingPool.Prediction.WhiteWins, 100e6);
        vm.prank(bettor2); betting.placeBet(0, ChessBettingPool.Prediction.BlackWins, 50e6);

        // Complete the game in tournament
        vm.startPrank(authority);
        tournament.startGame(0, 1, 0);
        tournament.submitGameResult(0, 1, 0, TournamentLib.GameResult.WhiteWins, keccak256("game"), bytes32(0), 30);

        // Settle
        betting.settleBets(0);
        vm.stopPrank();

        (,,, ChessBettingPool.PoolStatus status, ChessBettingPool.Prediction winPred,,,,,) = betting.betPools(0);
        assertTrue(status == ChessBettingPool.PoolStatus.Settled);
        assertTrue(winPred == ChessBettingPool.Prediction.WhiteWins);
    }

    function test_cannotSettleBeforeGameCompletes() public {
        _setupTournamentWithGame();

        vm.prank(authority);
        betting.createBetPool(0, 1, 0);

        vm.prank(bettor1); betting.placeBet(0, ChessBettingPool.Prediction.WhiteWins, 10e6);

        vm.prank(authority);
        vm.expectRevert("Game not completed");
        betting.settleBets(0);
    }

    function test_onlyAuthorityCanSettle() public {
        _setupTournamentWithGame();

        vm.prank(authority);
        betting.createBetPool(0, 1, 0);

        vm.prank(bettor1);
        vm.expectRevert("Not authority");
        betting.settleBets(0);
    }

    // ── Claim Winnings ─────────────────────────────────────────────────

    function test_claimWinnings() public {
        _setupTournamentWithGame();

        vm.prank(authority);
        betting.createBetPool(0, 1, 0);

        // bettor1 bets 100 USDC on WhiteWins
        // bettor2 bets 50 USDC on BlackWins
        vm.prank(bettor1); betting.placeBet(0, ChessBettingPool.Prediction.WhiteWins, 100e6);
        vm.prank(bettor2); betting.placeBet(0, ChessBettingPool.Prediction.BlackWins, 50e6);

        // White wins
        vm.startPrank(authority);
        tournament.startGame(0, 1, 0);
        tournament.submitGameResult(0, 1, 0, TournamentLib.GameResult.WhiteWins, keccak256("game"), bytes32(0), 30);
        betting.settleBets(0);
        vm.stopPrank();

        // Calculate expected payout
        // Total pool = 150 USDC
        // Winning pool (WhiteWins) = 100 USDC
        // Losing pool = 50 USDC
        // Vig = 3% of 50 = 1.5 USDC
        // Distributable = 50 - 1.5 = 48.5 USDC
        // bettor1 payout = 100 + (48.5 * 100 / 100) = 148.5 USDC
        uint256 expectedPayout = 100e6 + (48500000 * 100e6 / 100e6); // 148.5 USDC = 148500000
        uint256 bettor1Before = usdc.balanceOf(bettor1);

        vm.prank(bettor1);
        betting.claimWinnings(0);

        assertEq(usdc.balanceOf(bettor1) - bettor1Before, expectedPayout);
    }

    function test_loserCannotClaim() public {
        _setupTournamentWithGame();

        vm.prank(authority);
        betting.createBetPool(0, 1, 0);

        vm.prank(bettor1); betting.placeBet(0, ChessBettingPool.Prediction.WhiteWins, 100e6);
        vm.prank(bettor2); betting.placeBet(0, ChessBettingPool.Prediction.BlackWins, 50e6);

        vm.startPrank(authority);
        tournament.startGame(0, 1, 0);
        tournament.submitGameResult(0, 1, 0, TournamentLib.GameResult.WhiteWins, keccak256("game"), bytes32(0), 30);
        betting.settleBets(0);
        vm.stopPrank();

        vm.prank(bettor2);
        vm.expectRevert("Not a winning bet");
        betting.claimWinnings(0);
    }

    function test_cannotDoubleClaim() public {
        _setupTournamentWithGame();

        vm.prank(authority);
        betting.createBetPool(0, 1, 0);

        vm.prank(bettor1); betting.placeBet(0, ChessBettingPool.Prediction.WhiteWins, 100e6);
        vm.prank(bettor2); betting.placeBet(0, ChessBettingPool.Prediction.BlackWins, 50e6);

        vm.startPrank(authority);
        tournament.startGame(0, 1, 0);
        tournament.submitGameResult(0, 1, 0, TournamentLib.GameResult.WhiteWins, keccak256("game"), bytes32(0), 30);
        betting.settleBets(0);
        vm.stopPrank();

        vm.prank(bettor1);
        betting.claimWinnings(0);

        vm.prank(bettor1);
        vm.expectRevert("Already claimed");
        betting.claimWinnings(0);
    }

    // ── Draw Result ────────────────────────────────────────────────────

    function test_drawResult() public {
        _setupTournamentWithGame();

        vm.prank(authority);
        betting.createBetPool(0, 1, 0);

        vm.prank(bettor1); betting.placeBet(0, ChessBettingPool.Prediction.Draw, 100e6);
        vm.prank(bettor2); betting.placeBet(0, ChessBettingPool.Prediction.WhiteWins, 50e6);

        vm.startPrank(authority);
        tournament.startGame(0, 1, 0);
        tournament.submitGameResult(0, 1, 0, TournamentLib.GameResult.Draw, keccak256("draw"), bytes32(0), 40);
        betting.settleBets(0);
        vm.stopPrank();

        (,,, ChessBettingPool.PoolStatus status, ChessBettingPool.Prediction winPred,,,,,) = betting.betPools(0);
        assertTrue(winPred == ChessBettingPool.Prediction.Draw);

        // bettor1 (Draw) should be able to claim
        vm.prank(bettor1);
        betting.claimWinnings(0);

        // bettor2 (WhiteWins) cannot
        vm.prank(bettor2);
        vm.expectRevert("Not a winning bet");
        betting.claimWinnings(0);
    }

    // ── Vig To Treasury ────────────────────────────────────────────────

    function test_vigToTreasury() public {
        _setupTournamentWithGame();

        vm.prank(authority);
        betting.createBetPool(0, 1, 0);

        vm.prank(bettor1); betting.placeBet(0, ChessBettingPool.Prediction.WhiteWins, 100e6);
        vm.prank(bettor2); betting.placeBet(0, ChessBettingPool.Prediction.BlackWins, 200e6);

        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.startPrank(authority);
        tournament.startGame(0, 1, 0);
        tournament.submitGameResult(0, 1, 0, TournamentLib.GameResult.WhiteWins, keccak256("game"), bytes32(0), 30);
        betting.settleBets(0);
        vm.stopPrank();

        // Losing pool = 200 USDC (BlackWins bets)
        // Vig = 3% of 200 = 6 USDC
        uint256 vigExpected = (200e6 * 300) / 10000;
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, vigExpected);
    }

    // ── Cancel and Refund ──────────────────────────────────────────────

    function test_cancelAndRefund() public {
        _setupTournamentWithGame();

        vm.prank(authority);
        betting.createBetPool(0, 1, 0);

        vm.prank(bettor1); betting.placeBet(0, ChessBettingPool.Prediction.WhiteWins, 100e6);

        uint256 bettor1Before = usdc.balanceOf(bettor1);

        vm.prank(authority);
        betting.cancelBetPool(0);

        vm.prank(bettor1);
        betting.claimRefund(0);

        assertEq(usdc.balanceOf(bettor1), bettor1Before + 100e6);
    }

    function test_cannotRefundSettledPool() public {
        _setupTournamentWithGame();

        vm.prank(authority);
        betting.createBetPool(0, 1, 0);

        vm.prank(bettor1); betting.placeBet(0, ChessBettingPool.Prediction.WhiteWins, 10e6);

        vm.startPrank(authority);
        tournament.startGame(0, 1, 0);
        tournament.submitGameResult(0, 1, 0, TournamentLib.GameResult.WhiteWins, keccak256("game"), bytes32(0), 30);
        betting.settleBets(0);
        vm.stopPrank();

        vm.prank(bettor1);
        vm.expectRevert("Pool not cancelled");
        betting.claimRefund(0);
    }

    // ── Pause ──────────────────────────────────────────────────────────

    function test_pausePreventsBets() public {
        _setupTournamentWithGame();

        vm.prank(authority);
        betting.createBetPool(0, 1, 0);

        vm.prank(authority);
        betting.setPaused(true);

        vm.prank(bettor1);
        vm.expectRevert("Contract paused");
        betting.placeBet(0, ChessBettingPool.Prediction.WhiteWins, 10e6);
    }

    // ── Admin ──────────────────────────────────────────────────────────

    function test_setVigBps() public {
        vm.prank(authority);
        betting.setVigBps(500); // 5%

        assertEq(betting.vigBps(), 500);
    }

    function test_cannotSetVigTooHigh() public {
        vm.prank(authority);
        vm.expectRevert("Vig too high");
        betting.setVigBps(1001); // > 10%
    }

    function test_setMinBetAmount() public {
        vm.prank(authority);
        betting.setMinBetAmount(5e6); // 5 USDC

        assertEq(betting.minBetAmount(), 5e6);
    }
}
