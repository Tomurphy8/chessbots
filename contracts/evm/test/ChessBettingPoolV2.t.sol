// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChessBotsTournamentV3.sol";
import "../src/ChessBettingPoolV2.sol";
import "../src/libraries/TournamentLibV3.sol";

contract MockUSDCBetV2 {
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

contract ChessBettingPoolV2Test is Test {
    ChessBotsTournamentV3 public tournament;
    ChessBettingPoolV2 public betting;
    MockUSDCBetV2 public usdc;

    address authority = address(1);
    address treasury = address(2);

    address bettor1 = address(30);
    address bettor2 = address(31);
    address bettor3 = address(32);
    address marketCreator = address(40);

    address agent1 = address(10);
    address agent2 = address(11);
    address agent3 = address(12);
    address agent4 = address(13);

    function setUp() public {
        usdc = new MockUSDCBetV2();

        // Deploy tournament (V3)
        vm.prank(authority);
        tournament = new ChessBotsTournamentV3(address(usdc), treasury, 1000, 9000, 1000);

        // Deploy V2 betting pool (3% vig)
        vm.prank(authority);
        betting = new ChessBettingPoolV2(address(usdc), address(tournament), treasury, 300);

        // Fund everyone
        address[4] memory agents = [agent1, agent2, agent3, agent4];
        for (uint256 i = 0; i < agents.length; i++) {
            usdc.mint(agents[i], 10000e6);
            vm.prank(agents[i]);
            usdc.approve(address(tournament), type(uint256).max);
        }

        address[4] memory bettors = [bettor1, bettor2, bettor3, marketCreator];
        for (uint256 i = 0; i < bettors.length; i++) {
            usdc.mint(bettors[i], 10000e6);
            vm.prank(bettors[i]);
            usdc.approve(address(betting), type(uint256).max);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────

    function _registerAgents() internal {
        vm.prank(agent1); tournament.registerAgent("Agent1", "", TournamentLibV3.AgentType.Custom);
        vm.prank(agent2); tournament.registerAgent("Agent2", "", TournamentLibV3.AgentType.Custom);
        vm.prank(agent3); tournament.registerAgent("Agent3", "", TournamentLibV3.AgentType.Custom);
        vm.prank(agent4); tournament.registerAgent("Agent4", "", TournamentLibV3.AgentType.Custom);
    }

    function _createAndStartTournament() internal returns (uint256 tournamentId) {
        _registerAgents();

        vm.prank(authority);
        tournament.createTournament(
            TournamentLibV3.Tier.Bronze,
            TournamentLibV3.Format.Swiss,
            32, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );

        vm.prank(agent1); tournament.registerForTournament(0);
        vm.prank(agent2); tournament.registerForTournament(0);
        vm.prank(agent3); tournament.registerForTournament(0);
        vm.prank(agent4); tournament.registerForTournament(0);

        vm.prank(authority);
        tournament.startTournament(0);

        return 0;
    }

    function _createRound1Games(uint256 tid) internal {
        vm.startPrank(authority);
        ChessBotsTournamentV3.GameInput[] memory games = new ChessBotsTournamentV3.GameInput[](2);
        games[0] = ChessBotsTournamentV3.GameInput({ gameIndex: 0, white: agent1, black: agent2 });
        games[1] = ChessBotsTournamentV3.GameInput({ gameIndex: 1, white: agent3, black: agent4 });
        tournament.batchCreateAndStartGames(tid, 1, games);
        vm.stopPrank();
    }

    function _completeRound1(uint256 tid) internal {
        vm.startPrank(authority);
        ChessBotsTournamentV3.GameResultInput[] memory results = new ChessBotsTournamentV3.GameResultInput[](2);
        results[0] = ChessBotsTournamentV3.GameResultInput({ gameIndex: 0, result: TournamentLibV3.GameResult.WhiteWins, pgnHash: keccak256("r1g0"), resultHash: bytes32(0), moveCount: 30 });
        results[1] = ChessBotsTournamentV3.GameResultInput({ gameIndex: 1, result: TournamentLibV3.GameResult.Draw, pgnHash: keccak256("r1g1"), resultHash: bytes32(0), moveCount: 45 });

        ChessBotsTournamentV3.StandingsInput[] memory standings = new ChessBotsTournamentV3.StandingsInput[](4);
        standings[0] = ChessBotsTournamentV3.StandingsInput({ agent: agent1, score: 2, buchholz: 0, gamesPlayed: 1, gamesWon: 1, gamesDrawn: 0, gamesLost: 0 });
        standings[1] = ChessBotsTournamentV3.StandingsInput({ agent: agent2, score: 0, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 0, gamesLost: 1 });
        standings[2] = ChessBotsTournamentV3.StandingsInput({ agent: agent3, score: 1, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 1, gamesLost: 0 });
        standings[3] = ChessBotsTournamentV3.StandingsInput({ agent: agent4, score: 1, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 1, gamesLost: 0 });

        tournament.executeRound(tid, 1, results, standings, true);
        vm.stopPrank();
    }

    function _completeRound2(uint256 tid) internal {
        vm.startPrank(authority);
        ChessBotsTournamentV3.GameInput[] memory games = new ChessBotsTournamentV3.GameInput[](2);
        games[0] = ChessBotsTournamentV3.GameInput({ gameIndex: 0, white: agent1, black: agent3 });
        games[1] = ChessBotsTournamentV3.GameInput({ gameIndex: 1, white: agent4, black: agent2 });
        tournament.batchCreateAndStartGames(tid, 2, games);

        ChessBotsTournamentV3.GameResultInput[] memory results = new ChessBotsTournamentV3.GameResultInput[](2);
        results[0] = ChessBotsTournamentV3.GameResultInput({ gameIndex: 0, result: TournamentLibV3.GameResult.WhiteWins, pgnHash: keccak256("r2g0"), resultHash: bytes32(0), moveCount: 25 });
        results[1] = ChessBotsTournamentV3.GameResultInput({ gameIndex: 1, result: TournamentLibV3.GameResult.BlackWins, pgnHash: keccak256("r2g1"), resultHash: bytes32(0), moveCount: 35 });

        ChessBotsTournamentV3.StandingsInput[] memory standings = new ChessBotsTournamentV3.StandingsInput[](4);
        standings[0] = ChessBotsTournamentV3.StandingsInput({ agent: agent1, score: 4, buchholz: 1, gamesPlayed: 2, gamesWon: 2, gamesDrawn: 0, gamesLost: 0 });
        standings[1] = ChessBotsTournamentV3.StandingsInput({ agent: agent2, score: 2, buchholz: 1, gamesPlayed: 2, gamesWon: 1, gamesDrawn: 0, gamesLost: 1 });
        standings[2] = ChessBotsTournamentV3.StandingsInput({ agent: agent3, score: 1, buchholz: 4, gamesPlayed: 2, gamesWon: 0, gamesDrawn: 1, gamesLost: 1 });
        standings[3] = ChessBotsTournamentV3.StandingsInput({ agent: agent4, score: 1, buchholz: 0, gamesPlayed: 2, gamesWon: 0, gamesDrawn: 1, gamesLost: 1 });

        tournament.executeRound(tid, 2, results, standings, false);
        vm.stopPrank();
    }

    function _finalizeTournament(uint256 tid) internal {
        vm.prank(authority);
        tournament.finalizeTournament(tid, [agent1, agent2, agent3], "ipfs://results");
    }

    function _fullTournament() internal returns (uint256 tid) {
        tid = _createAndStartTournament();
        _createRound1Games(tid);
        _completeRound1(tid);
        _completeRound2(tid);
        _finalizeTournament(tid);
    }

    // ════════════════════════════════════════════════════════════════════
    //                    GAME OUTCOME MARKET TESTS
    // ════════════════════════════════════════════════════════════════════

    function test_gameOutcome_createMarket() public {
        _createAndStartTournament();
        _createRound1Games(0);

        vm.prank(marketCreator);
        uint256 marketId = betting.createGameOutcomeMarket(0, 1, 0);
        assertEq(marketId, 0);

        ChessBettingPoolV2.Market memory m = betting.getMarket(0);
        assertTrue(m.exists);
        assertTrue(m.status == ChessBettingPoolV2.MarketStatus.Open);
        assertTrue(m.marketType == ChessBettingPoolV2.MarketType.GameOutcome);
        assertEq(m.numOutcomes, 3);
        assertEq(m.creator, marketCreator);
    }

    function test_gameOutcome_permissionlessCreation() public {
        _createAndStartTournament();
        _createRound1Games(0);

        // Anyone can create (not just authority)
        vm.prank(bettor1);
        uint256 marketId = betting.createGameOutcomeMarket(0, 1, 0);
        assertEq(marketId, 0);
    }

    function test_gameOutcome_bondDeducted() public {
        _createAndStartTournament();
        _createRound1Games(0);

        uint256 before = usdc.balanceOf(marketCreator);
        vm.prank(marketCreator);
        betting.createGameOutcomeMarket(0, 1, 0);
        assertEq(before - usdc.balanceOf(marketCreator), 5e6); // 5 USDC bond
    }

    function test_gameOutcome_noDuplicateMarket() public {
        _createAndStartTournament();
        _createRound1Games(0);

        vm.prank(marketCreator);
        betting.createGameOutcomeMarket(0, 1, 0);

        vm.prank(bettor1);
        vm.expectRevert("Market already exists");
        betting.createGameOutcomeMarket(0, 1, 0);
    }

    function test_gameOutcome_placeBetAndResolve() public {
        _createAndStartTournament();
        _createRound1Games(0);

        // Create market
        vm.prank(marketCreator);
        betting.createGameOutcomeMarket(0, 1, 0);

        // Place bets: bettor1 on WhiteWins (100), bettor2 on BlackWins (50)
        vm.prank(bettor1); betting.placeBet(0, 0, 100e6); // WhiteWins
        vm.prank(bettor2); betting.placeBet(0, 1, 50e6);  // BlackWins

        // Complete game: White wins (agent1 vs agent2, round 1, game 0 → set in _completeRound1)
        _completeRound1(0);

        // Anyone can resolve
        vm.prank(bettor3);
        betting.resolveMarket(0);

        ChessBettingPoolV2.Market memory m = betting.getMarket(0);
        assertTrue(m.status == ChessBettingPoolV2.MarketStatus.Resolved);
        assertEq(m.winningOutcome, 0); // WhiteWins
    }

    function test_gameOutcome_claimWinnings() public {
        _createAndStartTournament();
        _createRound1Games(0);

        vm.prank(marketCreator);
        betting.createGameOutcomeMarket(0, 1, 0);

        vm.prank(bettor1); betting.placeBet(0, 0, 100e6); // WhiteWins
        vm.prank(bettor2); betting.placeBet(0, 1, 50e6);  // BlackWins

        _completeRound1(0);
        betting.resolveMarket(0);

        // bettor1 wins: 100 + (50 - 3% of 50) * 100/100 = 100 + 48.5 = 148.5
        uint256 before = usdc.balanceOf(bettor1);
        vm.prank(bettor1);
        betting.claimWinnings(0);
        assertEq(usdc.balanceOf(bettor1) - before, 148500000);
    }

    function test_gameOutcome_loserCannotClaim() public {
        _createAndStartTournament();
        _createRound1Games(0);

        vm.prank(marketCreator);
        betting.createGameOutcomeMarket(0, 1, 0);

        vm.prank(bettor1); betting.placeBet(0, 0, 100e6);
        vm.prank(bettor2); betting.placeBet(0, 1, 50e6);

        _completeRound1(0);
        betting.resolveMarket(0);

        vm.prank(bettor2);
        vm.expectRevert("Not a winning bet");
        betting.claimWinnings(0);
    }

    function test_gameOutcome_vigToTreasury() public {
        _createAndStartTournament();
        _createRound1Games(0);

        vm.prank(marketCreator);
        betting.createGameOutcomeMarket(0, 1, 0);

        vm.prank(bettor1); betting.placeBet(0, 0, 100e6);
        vm.prank(bettor2); betting.placeBet(0, 1, 200e6);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        _completeRound1(0);
        betting.resolveMarket(0);

        // Losing pool = 200, vig = 3% of 200 = 6
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, 6e6);
    }

    function test_gameOutcome_bondReturnAfterResolve() public {
        _createAndStartTournament();
        _createRound1Games(0);

        vm.prank(marketCreator);
        betting.createGameOutcomeMarket(0, 1, 0);

        vm.prank(bettor1); betting.placeBet(0, 0, 10e6);
        _completeRound1(0);
        betting.resolveMarket(0);

        uint256 before = usdc.balanceOf(marketCreator);
        vm.prank(marketCreator);
        betting.claimCreatorBond(0);
        assertEq(usdc.balanceOf(marketCreator) - before, 5e6);
    }

    function test_gameOutcome_cannotClaimBondWhileOpen() public {
        _createAndStartTournament();
        _createRound1Games(0);

        vm.prank(marketCreator);
        betting.createGameOutcomeMarket(0, 1, 0);

        vm.prank(marketCreator);
        vm.expectRevert("Market still open");
        betting.claimCreatorBond(0);
    }

    function test_gameOutcome_drawResult() public {
        _createAndStartTournament();
        _createRound1Games(0);

        // Create market for game index 1 (agent3 vs agent4 — draws in _completeRound1)
        vm.prank(marketCreator);
        betting.createGameOutcomeMarket(0, 1, 1);

        vm.prank(bettor1); betting.placeBet(0, 2, 100e6); // Draw
        vm.prank(bettor2); betting.placeBet(0, 0, 50e6);  // WhiteWins

        _completeRound1(0);
        betting.resolveMarket(0);

        ChessBettingPoolV2.Market memory m = betting.getMarket(0);
        assertEq(m.winningOutcome, 2); // Draw

        vm.prank(bettor1);
        betting.claimWinnings(0);
    }

    // ════════════════════════════════════════════════════════════════════
    //                    TOURNAMENT WINNER MARKET TESTS
    // ════════════════════════════════════════════════════════════════════

    function test_tournamentWinner_createMarket() public {
        _createAndStartTournament();

        address[] memory agents = new address[](4);
        agents[0] = agent1;
        agents[1] = agent2;
        agents[2] = agent3;
        agents[3] = agent4;

        vm.prank(marketCreator);
        uint256 marketId = betting.createTournamentWinnerMarket(0, agents);
        assertEq(marketId, 0);

        ChessBettingPoolV2.Market memory m = betting.getMarket(0);
        assertEq(m.numOutcomes, 4);
        assertTrue(m.marketType == ChessBettingPoolV2.MarketType.TournamentWinner);

        address[] memory snapped = betting.getMarketAgents(0);
        assertEq(snapped.length, 4);
        assertEq(snapped[0], agent1);
        assertEq(snapped[3], agent4);
    }

    function test_tournamentWinner_unregisteredAgentReverts() public {
        _createAndStartTournament();

        address[] memory agents = new address[](2);
        agents[0] = agent1;
        agents[1] = address(99); // not registered

        vm.prank(marketCreator);
        vm.expectRevert("Agent not registered");
        betting.createTournamentWinnerMarket(0, agents);
    }

    function test_tournamentWinner_duplicateAgentReverts() public {
        _createAndStartTournament();

        address[] memory agents = new address[](2);
        agents[0] = agent1;
        agents[1] = agent1;

        vm.prank(marketCreator);
        vm.expectRevert("Duplicate agent");
        betting.createTournamentWinnerMarket(0, agents);
    }

    function test_tournamentWinner_betAndResolve() public {
        _createAndStartTournament();

        address[] memory agents = new address[](4);
        agents[0] = agent1;
        agents[1] = agent2;
        agents[2] = agent3;
        agents[3] = agent4;

        vm.prank(marketCreator);
        betting.createTournamentWinnerMarket(0, agents);

        // bettor1 bets on agent1 (outcome 0), bettor2 bets on agent3 (outcome 2)
        vm.prank(bettor1); betting.placeBet(0, 0, 100e6); // agent1
        vm.prank(bettor2); betting.placeBet(0, 2, 50e6);  // agent3

        // Complete tournament — agent1 wins
        _createRound1Games(0);
        _completeRound1(0);
        _completeRound2(0);
        _finalizeTournament(0);

        // Resolve
        betting.resolveMarket(0);

        ChessBettingPoolV2.Market memory m = betting.getMarket(0);
        assertTrue(m.status == ChessBettingPoolV2.MarketStatus.Resolved);
        assertEq(m.winningOutcome, 0); // agent1

        // bettor1 claims
        vm.prank(bettor1);
        betting.claimWinnings(0);
    }

    function test_tournamentWinner_voidsIfWinnerNotInSnapshot() public {
        _createAndStartTournament();

        // Only snapshot agent3 and agent4 (not agent1 who will win)
        address[] memory agents = new address[](2);
        agents[0] = agent3;
        agents[1] = agent4;

        vm.prank(marketCreator);
        betting.createTournamentWinnerMarket(0, agents);

        vm.prank(bettor1); betting.placeBet(0, 0, 10e6);

        _createRound1Games(0);
        _completeRound1(0);
        _completeRound2(0);
        _finalizeTournament(0);

        betting.resolveMarket(0);

        ChessBettingPoolV2.Market memory m = betting.getMarket(0);
        assertTrue(m.status == ChessBettingPoolV2.MarketStatus.Voided);

        // Bettor can claim refund
        vm.prank(bettor1);
        betting.claimRefund(0);
    }

    // ════════════════════════════════════════════════════════════════════
    //                    TOURNAMENT TOP 3 MARKET TESTS
    // ════════════════════════════════════════════════════════════════════

    function test_top3_agentInTop3() public {
        _createAndStartTournament();

        // Market: will agent1 finish top 3?
        vm.prank(marketCreator);
        betting.createTournamentTop3Market(0, agent1);

        vm.prank(bettor1); betting.placeBet(0, 0, 100e6); // Yes
        vm.prank(bettor2); betting.placeBet(0, 1, 50e6);  // No

        _createRound1Games(0);
        _completeRound1(0);
        _completeRound2(0);
        _finalizeTournament(0); // winners: [agent1, agent2, agent3]

        betting.resolveMarket(0);

        ChessBettingPoolV2.Market memory m = betting.getMarket(0);
        assertEq(m.winningOutcome, 0); // Yes — agent1 is winner
    }

    function test_top3_agentNotInTop3() public {
        _createAndStartTournament();

        // Market: will agent4 finish top 3?
        vm.prank(marketCreator);
        betting.createTournamentTop3Market(0, agent4);

        vm.prank(bettor1); betting.placeBet(0, 0, 50e6);  // Yes
        vm.prank(bettor2); betting.placeBet(0, 1, 100e6); // No

        _createRound1Games(0);
        _completeRound1(0);
        _completeRound2(0);
        _finalizeTournament(0); // winners: [agent1, agent2, agent3] — agent4 NOT in top 3

        betting.resolveMarket(0);

        ChessBettingPoolV2.Market memory m = betting.getMarket(0);
        assertEq(m.winningOutcome, 1); // No

        // bettor2 claims
        vm.prank(bettor2);
        betting.claimWinnings(0);
    }

    // ════════════════════════════════════════════════════════════════════
    //                    HEAD TO HEAD MARKET TESTS
    // ════════════════════════════════════════════════════════════════════

    function test_headToHead_agentAWins() public {
        _createAndStartTournament();

        vm.prank(marketCreator);
        betting.createHeadToHeadMarket(0, agent1, agent2);

        vm.prank(bettor1); betting.placeBet(0, 0, 100e6); // agent1
        vm.prank(bettor2); betting.placeBet(0, 1, 50e6);  // agent2

        _createRound1Games(0);
        _completeRound1(0);
        _completeRound2(0);
        _finalizeTournament(0);

        // agent1 score=4, agent2 score=2 → agent1 wins
        betting.resolveMarket(0);

        ChessBettingPoolV2.Market memory m = betting.getMarket(0);
        assertEq(m.winningOutcome, 0); // AgentA (agent1) wins
    }

    function test_headToHead_canonicalOrdering() public {
        _createAndStartTournament();

        // Creating with (agent2, agent1) should use same key as (agent1, agent2)
        vm.prank(marketCreator);
        betting.createHeadToHeadMarket(0, agent2, agent1);

        vm.prank(bettor1);
        vm.expectRevert("Market already exists");
        betting.createHeadToHeadMarket(0, agent1, agent2);
    }

    function test_headToHead_sameAgentReverts() public {
        _createAndStartTournament();

        vm.prank(marketCreator);
        vm.expectRevert("Same agent");
        betting.createHeadToHeadMarket(0, agent1, agent1);
    }

    // ════════════════════════════════════════════════════════════════════
    //                    OVER/UNDER MARKET TESTS
    // ════════════════════════════════════════════════════════════════════

    function test_overUnder_over() public {
        _createAndStartTournament();
        _createRound1Games(0);

        // Over/under 25 moves on game (0, 1, 0)
        vm.prank(marketCreator);
        betting.createOverUnderMarket(0, 1, 0, 25);

        vm.prank(bettor1); betting.placeBet(0, 0, 100e6); // Over
        vm.prank(bettor2); betting.placeBet(0, 1, 50e6);  // Under

        // Game 0 ends with 30 moves (set in _completeRound1)
        _completeRound1(0);
        betting.resolveMarket(0);

        ChessBettingPoolV2.Market memory m = betting.getMarket(0);
        assertEq(m.winningOutcome, 0); // Over (30 > 25)
    }

    function test_overUnder_under() public {
        _createAndStartTournament();
        _createRound1Games(0);

        // Over/under 40 moves on game (0, 1, 0)
        vm.prank(marketCreator);
        betting.createOverUnderMarket(0, 1, 0, 40);

        vm.prank(bettor1); betting.placeBet(0, 0, 50e6);  // Over
        vm.prank(bettor2); betting.placeBet(0, 1, 100e6); // Under

        _completeRound1(0); // game 0 has 30 moves
        betting.resolveMarket(0);

        ChessBettingPoolV2.Market memory m = betting.getMarket(0);
        assertEq(m.winningOutcome, 1); // Under (30 <= 40)
    }

    function test_overUnder_exact() public {
        _createAndStartTournament();
        _createRound1Games(0);

        // Over/under exactly 30 moves (game has 30 moves)
        vm.prank(marketCreator);
        betting.createOverUnderMarket(0, 1, 0, 30);

        vm.prank(bettor1); betting.placeBet(0, 0, 50e6);  // Over
        vm.prank(bettor2); betting.placeBet(0, 1, 100e6); // Under

        _completeRound1(0);
        betting.resolveMarket(0);

        ChessBettingPoolV2.Market memory m = betting.getMarket(0);
        assertEq(m.winningOutcome, 1); // Under (30 is NOT strictly > 30)
    }

    function test_overUnder_differentThresholdAllowed() public {
        _createAndStartTournament();
        _createRound1Games(0);

        vm.prank(marketCreator);
        betting.createOverUnderMarket(0, 1, 0, 25);

        // Different threshold = different market
        vm.prank(bettor1);
        betting.createOverUnderMarket(0, 1, 0, 35);

        assertEq(betting.nextMarketId(), 2);
    }

    // ════════════════════════════════════════════════════════════════════
    //                    VOIDING / CANCELLATION TESTS
    // ════════════════════════════════════════════════════════════════════

    function test_void_noWinningBets() public {
        _createAndStartTournament();
        _createRound1Games(0);

        vm.prank(marketCreator);
        betting.createGameOutcomeMarket(0, 1, 0);

        // Everyone bets on BlackWins, but White wins
        vm.prank(bettor1); betting.placeBet(0, 1, 100e6); // BlackWins
        vm.prank(bettor2); betting.placeBet(0, 2, 50e6);  // Draw

        _completeRound1(0); // game 0: WhiteWins
        betting.resolveMarket(0);

        ChessBettingPoolV2.Market memory m = betting.getMarket(0);
        assertTrue(m.status == ChessBettingPoolV2.MarketStatus.Voided);

        // Both bettors get refunds
        uint256 before1 = usdc.balanceOf(bettor1);
        vm.prank(bettor1);
        betting.claimRefund(0);
        assertEq(usdc.balanceOf(bettor1) - before1, 100e6);
    }

    function test_void_tournamentCancelled() public {
        // Create tournament but DON'T start it — cancel during registration
        _registerAgents();

        vm.prank(authority);
        tournament.createTournament(
            TournamentLibV3.Tier.Bronze,
            TournamentLibV3.Format.Swiss,
            32, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );

        vm.prank(agent1); tournament.registerForTournament(0);
        vm.prank(agent2); tournament.registerForTournament(0);

        // Create a tournament winner market while still in registration
        address[] memory agents = new address[](2);
        agents[0] = agent1;
        agents[1] = agent2;

        vm.prank(marketCreator);
        betting.createTournamentWinnerMarket(0, agents);

        vm.prank(bettor1); betting.placeBet(0, 0, 10e6);

        // Cancel tournament during registration
        vm.prank(authority);
        tournament.cancelTournament(0);

        // resolveMarket detects cancellation and voids
        betting.resolveMarket(0);

        ChessBettingPoolV2.Market memory m = betting.getMarket(0);
        assertTrue(m.status == ChessBettingPoolV2.MarketStatus.Voided);

        // Bettor gets refund
        vm.prank(bettor1);
        betting.claimRefund(0);
    }

    function test_void_authorityCanForceVoid() public {
        _createAndStartTournament();
        _createRound1Games(0);

        vm.prank(marketCreator);
        betting.createGameOutcomeMarket(0, 1, 0);

        vm.prank(bettor1); betting.placeBet(0, 0, 10e6);

        vm.prank(authority);
        betting.voidMarket(0);

        ChessBettingPoolV2.Market memory m = betting.getMarket(0);
        assertTrue(m.status == ChessBettingPoolV2.MarketStatus.Voided);
    }

    function test_void_bondReturnedAfterVoid() public {
        _createAndStartTournament();
        _createRound1Games(0);

        vm.prank(marketCreator);
        betting.createGameOutcomeMarket(0, 1, 0);

        vm.prank(authority);
        betting.voidMarket(0);

        uint256 before = usdc.balanceOf(marketCreator);
        vm.prank(marketCreator);
        betting.claimCreatorBond(0);
        assertEq(usdc.balanceOf(marketCreator) - before, 5e6);
    }

    // ════════════════════════════════════════════════════════════════════
    //                    BETTING GUARDS
    // ════════════════════════════════════════════════════════════════════

    function test_cannotBetOnClosedMarket() public {
        _createAndStartTournament();
        _createRound1Games(0);

        vm.prank(marketCreator);
        betting.createGameOutcomeMarket(0, 1, 0);

        vm.prank(bettor1); betting.placeBet(0, 0, 10e6);

        _completeRound1(0);
        betting.resolveMarket(0);

        vm.prank(bettor2);
        vm.expectRevert("Market not open");
        betting.placeBet(0, 1, 10e6);
    }

    function test_cannotDoubleBet() public {
        _createAndStartTournament();
        _createRound1Games(0);

        vm.prank(marketCreator);
        betting.createGameOutcomeMarket(0, 1, 0);

        vm.prank(bettor1); betting.placeBet(0, 0, 10e6);

        vm.prank(bettor1);
        vm.expectRevert("Already bet on this market");
        betting.placeBet(0, 1, 10e6);
    }

    function test_belowMinBet() public {
        _createAndStartTournament();
        _createRound1Games(0);

        vm.prank(marketCreator);
        betting.createGameOutcomeMarket(0, 1, 0);

        vm.prank(bettor1);
        vm.expectRevert("Below minimum bet");
        betting.placeBet(0, 0, 500000); // 0.5 USDC
    }

    function test_invalidOutcome() public {
        _createAndStartTournament();
        _createRound1Games(0);

        vm.prank(marketCreator);
        betting.createGameOutcomeMarket(0, 1, 0);

        vm.prank(bettor1);
        vm.expectRevert("Invalid outcome");
        betting.placeBet(0, 5, 10e6); // GameOutcome only has 3 outcomes (0,1,2)
    }

    function test_cannotResolveOpenMarketEarly() public {
        _createAndStartTournament();
        _createRound1Games(0);

        vm.prank(marketCreator);
        betting.createGameOutcomeMarket(0, 1, 0);

        vm.expectRevert("Game not completed");
        betting.resolveMarket(0);
    }

    // ════════════════════════════════════════════════════════════════════
    //                    PAUSE TESTS
    // ════════════════════════════════════════════════════════════════════

    function test_pausePreventsBets() public {
        _createAndStartTournament();
        _createRound1Games(0);

        vm.prank(marketCreator);
        betting.createGameOutcomeMarket(0, 1, 0);

        vm.prank(authority);
        betting.setPaused(true);

        vm.prank(bettor1);
        vm.expectRevert("Contract paused");
        betting.placeBet(0, 0, 10e6);
    }

    function test_pausePreventsMarketCreation() public {
        _createAndStartTournament();
        _createRound1Games(0);

        vm.prank(authority);
        betting.setPaused(true);

        vm.prank(marketCreator);
        vm.expectRevert("Contract paused");
        betting.createGameOutcomeMarket(0, 1, 0);
    }

    // ════════════════════════════════════════════════════════════════════
    //                    ADMIN TESTS
    // ════════════════════════════════════════════════════════════════════

    function test_setVigBps() public {
        vm.prank(authority);
        betting.setVigBps(500);
        assertEq(betting.vigBps(), 500);
    }

    function test_cannotSetVigTooHigh() public {
        vm.prank(authority);
        vm.expectRevert("Vig too high");
        betting.setVigBps(1001);
    }

    function test_onlyAuthorityCanSetVig() public {
        vm.prank(bettor1);
        vm.expectRevert("Not authority");
        betting.setVigBps(500);
    }

    function test_setMinBetAmount() public {
        vm.prank(authority);
        betting.setMinBetAmount(5e6);
        assertEq(betting.minBetAmount(), 5e6);
    }

    // ════════════════════════════════════════════════════════════════════
    //                    VIEW FUNCTION TESTS
    // ════════════════════════════════════════════════════════════════════

    function test_getMarketOutcomeTotals() public {
        _createAndStartTournament();
        _createRound1Games(0);

        vm.prank(marketCreator);
        betting.createGameOutcomeMarket(0, 1, 0);

        vm.prank(bettor1); betting.placeBet(0, 0, 100e6);
        vm.prank(bettor2); betting.placeBet(0, 1, 50e6);
        vm.prank(bettor3); betting.placeBet(0, 2, 30e6);

        uint256[] memory totals = betting.getMarketOutcomeTotals(0);
        assertEq(totals.length, 3);
        assertEq(totals[0], 100e6);
        assertEq(totals[1], 50e6);
        assertEq(totals[2], 30e6);
    }

    function test_getBet() public {
        _createAndStartTournament();
        _createRound1Games(0);

        vm.prank(marketCreator);
        betting.createGameOutcomeMarket(0, 1, 0);

        vm.prank(bettor1); betting.placeBet(0, 0, 100e6);

        (uint8 outcome, uint256 amount, bool claimed) = betting.getBet(0, bettor1);
        assertEq(outcome, 0);
        assertEq(amount, 100e6);
        assertFalse(claimed);
    }

    // ════════════════════════════════════════════════════════════════════
    //                    MULTI-MARKET TEST
    // ════════════════════════════════════════════════════════════════════

    function test_multipleMarketTypes() public {
        _createAndStartTournament();
        _createRound1Games(0);

        // Create multiple market types simultaneously
        vm.startPrank(marketCreator);
        uint256 gameMarket = betting.createGameOutcomeMarket(0, 1, 0);
        uint256 overUnderMarket = betting.createOverUnderMarket(0, 1, 0, 25);

        address[] memory agents = new address[](4);
        agents[0] = agent1;
        agents[1] = agent2;
        agents[2] = agent3;
        agents[3] = agent4;
        uint256 winnerMarket = betting.createTournamentWinnerMarket(0, agents);
        uint256 top3Market = betting.createTournamentTop3Market(0, agent1);
        uint256 h2hMarket = betting.createHeadToHeadMarket(0, agent1, agent2);
        vm.stopPrank();

        assertEq(gameMarket, 0);
        assertEq(overUnderMarket, 1);
        assertEq(winnerMarket, 2);
        assertEq(top3Market, 3);
        assertEq(h2hMarket, 4);

        // All 5 market types created successfully
        assertEq(betting.nextMarketId(), 5);
    }
}
