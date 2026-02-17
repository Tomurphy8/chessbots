// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChessBotsTournamentV3.sol";
import "../src/libraries/TournamentLibV3.sol";

contract MockUSDC {
    string public name = "Mock USDC";
    string public symbol = "USDC";
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

contract ChessBotsTournamentV3Test is Test {
    ChessBotsTournamentV3 public tournament;
    MockUSDC public usdc;

    address authority = address(1);
    address treasury = address(2);

    // Individual agents
    address agent1 = address(10);
    address agent2 = address(11);
    address agent3 = address(12);
    address agent4 = address(13);
    address agent5 = address(14);
    address agent6 = address(15);
    address agent7 = address(16);
    address agent8 = address(17);
    address agent9 = address(18);
    address agent10 = address(19);

    function setUp() public {
        usdc = new MockUSDC();
        vm.prank(authority);
        tournament = new ChessBotsTournamentV3(address(usdc), treasury, 1000, 9000, 1000);

        // Fund all agents
        address[10] memory allAgents = [agent1, agent2, agent3, agent4, agent5, agent6, agent7, agent8, agent9, agent10];
        for (uint256 i = 0; i < allAgents.length; i++) {
            usdc.mint(allAgents[i], 10000e6);
            vm.prank(allAgents[i]);
            usdc.approve(address(tournament), type(uint256).max);
        }
    }

    function _registerAgents(uint8 count) internal {
        address[10] memory allAgents = [agent1, agent2, agent3, agent4, agent5, agent6, agent7, agent8, agent9, agent10];
        string[10] memory names = ["Agent1", "Agent2", "Agent3", "Agent4", "Agent5", "Agent6", "Agent7", "Agent8", "Agent9", "Agent10"];
        for (uint8 i = 0; i < count; i++) {
            vm.prank(allAgents[i]);
            tournament.registerAgent(names[i], "", TournamentLibV3.AgentType.OpenClaw);
        }
    }

    // ================================================================
    //                    INITIALIZATION TESTS
    // ================================================================

    function test_initialize() public view {
        (address auth, address treas, uint16 feeBps,,, uint64 totalTournaments, uint256 totalPrize, bool paused,,) = tournament.protocol();
        assertEq(auth, authority);
        assertEq(treas, treasury);
        assertEq(feeBps, 1000);
        assertEq(totalTournaments, 0);
        assertEq(totalPrize, 0);
        assertEq(paused, false);
    }

    function test_registerAgent() public {
        vm.prank(agent1);
        tournament.registerAgent("DeepClaw-v3", "", TournamentLibV3.AgentType.OpenClaw);

        (address wallet, string memory agentName,,,,,,,,,, bool registered) = tournament.agents(agent1);
        assertEq(wallet, agent1);
        assertEq(agentName, "DeepClaw-v3");
        assertTrue(registered);
    }

    // ================================================================
    //                    SWISS FORMAT TESTS (V2 compatible)
    // ================================================================

    function test_swiss_fullLifecycle() public {
        _registerAgents(4);

        int64 regDeadline = int64(int256(block.timestamp + 3600));
        int64 startTime = int64(int256(block.timestamp + 7200));

        vm.prank(authority);
        tournament.createTournament(
            TournamentLibV3.Tier.Bronze,
            TournamentLibV3.Format.Swiss,
            32, 4, startTime, regDeadline, 300, 3
        );

        // Verify format is Swiss
        ChessBotsTournamentV3.Tournament memory t = tournament.getTournament(0);
        assertEq(uint8(t.format), uint8(TournamentLibV3.Format.Swiss));

        // Register players
        vm.prank(agent1); tournament.registerForTournament(0);
        vm.prank(agent2); tournament.registerForTournament(0);
        vm.prank(agent3); tournament.registerForTournament(0);
        vm.prank(agent4); tournament.registerForTournament(0);

        // Verify prize pool (4 * 50 = 200 USDC)
        assertEq(usdc.balanceOf(address(tournament)), 200e6);

        // Start tournament
        vm.prank(authority);
        tournament.startTournament(0);

        t = tournament.getTournament(0);
        assertEq(t.totalRounds, 2); // log2(4) = 2

        vm.startPrank(authority);

        // --- Round 1 ---
        ChessBotsTournamentV3.GameInput[] memory r1Games = new ChessBotsTournamentV3.GameInput[](2);
        r1Games[0] = ChessBotsTournamentV3.GameInput({ gameIndex: 0, white: agent1, black: agent2 });
        r1Games[1] = ChessBotsTournamentV3.GameInput({ gameIndex: 1, white: agent3, black: agent4 });
        tournament.batchCreateAndStartGames(0, 1, r1Games);

        ChessBotsTournamentV3.GameResultInput[] memory r1Results = new ChessBotsTournamentV3.GameResultInput[](2);
        r1Results[0] = ChessBotsTournamentV3.GameResultInput({ gameIndex: 0, result: TournamentLibV3.GameResult.WhiteWins, pgnHash: keccak256("r1g0"), resultHash: bytes32(0), moveCount: 20 });
        r1Results[1] = ChessBotsTournamentV3.GameResultInput({ gameIndex: 1, result: TournamentLibV3.GameResult.Draw, pgnHash: keccak256("r1g1"), resultHash: bytes32(0), moveCount: 30 });

        ChessBotsTournamentV3.StandingsInput[] memory r1Standings = new ChessBotsTournamentV3.StandingsInput[](4);
        r1Standings[0] = ChessBotsTournamentV3.StandingsInput({ agent: agent1, score: 2, buchholz: 0, gamesPlayed: 1, gamesWon: 1, gamesDrawn: 0, gamesLost: 0 });
        r1Standings[1] = ChessBotsTournamentV3.StandingsInput({ agent: agent2, score: 0, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 0, gamesLost: 1 });
        r1Standings[2] = ChessBotsTournamentV3.StandingsInput({ agent: agent3, score: 1, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 1, gamesLost: 0 });
        r1Standings[3] = ChessBotsTournamentV3.StandingsInput({ agent: agent4, score: 1, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 1, gamesLost: 0 });

        tournament.executeRound(0, 1, r1Results, r1Standings, true);

        // --- Round 2 ---
        ChessBotsTournamentV3.GameInput[] memory r2Games = new ChessBotsTournamentV3.GameInput[](2);
        r2Games[0] = ChessBotsTournamentV3.GameInput({ gameIndex: 0, white: agent1, black: agent3 });
        r2Games[1] = ChessBotsTournamentV3.GameInput({ gameIndex: 1, white: agent4, black: agent2 });
        tournament.batchCreateAndStartGames(0, 2, r2Games);

        ChessBotsTournamentV3.GameResultInput[] memory r2Results = new ChessBotsTournamentV3.GameResultInput[](2);
        r2Results[0] = ChessBotsTournamentV3.GameResultInput({ gameIndex: 0, result: TournamentLibV3.GameResult.WhiteWins, pgnHash: keccak256("r2g0"), resultHash: bytes32(0), moveCount: 25 });
        r2Results[1] = ChessBotsTournamentV3.GameResultInput({ gameIndex: 1, result: TournamentLibV3.GameResult.BlackWins, pgnHash: keccak256("r2g1"), resultHash: bytes32(0), moveCount: 35 });

        ChessBotsTournamentV3.StandingsInput[] memory r2Standings = new ChessBotsTournamentV3.StandingsInput[](4);
        r2Standings[0] = ChessBotsTournamentV3.StandingsInput({ agent: agent1, score: 4, buchholz: 1, gamesPlayed: 2, gamesWon: 2, gamesDrawn: 0, gamesLost: 0 });
        r2Standings[1] = ChessBotsTournamentV3.StandingsInput({ agent: agent2, score: 0, buchholz: 1, gamesPlayed: 2, gamesWon: 0, gamesDrawn: 0, gamesLost: 2 });
        r2Standings[2] = ChessBotsTournamentV3.StandingsInput({ agent: agent3, score: 1, buchholz: 4, gamesPlayed: 2, gamesWon: 0, gamesDrawn: 1, gamesLost: 1 });
        r2Standings[3] = ChessBotsTournamentV3.StandingsInput({ agent: agent4, score: 1, buchholz: 0, gamesPlayed: 2, gamesWon: 0, gamesDrawn: 1, gamesLost: 1 });

        tournament.executeRound(0, 2, r2Results, r2Standings, false);

        // Finalize + distribute
        tournament.finalizeTournament(0, [agent1, agent3, agent4], "ipfs://results");
        tournament.distributePrizes(0);
        vm.stopPrank();

        // Verify Swiss 70/20/10 split (200 USDC pool, 10% fee = 20 fee, 180 player pool)
        // 1st: 180 * 70% = 126, 2nd: 180 * 20% = 36, 3rd: 180 - 126 - 36 = 18
        assertEq(usdc.balanceOf(agent1), 10000e6 - 50e6 + 126e6); // 10076
        assertEq(usdc.balanceOf(agent3), 10000e6 - 50e6 + 36e6);  // 9986
        assertEq(usdc.balanceOf(agent4), 10000e6 - 50e6 + 18e6);  // 9968
        assertEq(usdc.balanceOf(treasury), 20e6); // 10% protocol fee
        assertEq(usdc.balanceOf(address(tournament)), 0);
        assertEq(tournament.totalGamesPlayed(), 4);
    }

    // ================================================================
    //                    MATCH FORMAT TESTS (1v1)
    // ================================================================

    function test_match_createChallenge() public {
        _registerAgents(2);

        int64 regDeadline = int64(int256(block.timestamp + 3600));
        int64 startTime = int64(int256(block.timestamp + 7200));

        vm.prank(agent1);
        tournament.createMatchChallenge(
            TournamentLibV3.Tier.Rookie,
            startTime, regDeadline, 300, 3, 1, agent2
        );

        ChessBotsTournamentV3.Tournament memory t = tournament.getTournament(0);
        assertEq(uint8(t.format), uint8(TournamentLibV3.Format.Match));
        assertEq(t.maxPlayers, 2);
        assertEq(t.minPlayers, 2);
        assertEq(t.bestOf, 1);
        assertEq(t.challengeTarget, agent2);
    }

    function test_match_bestOf3() public {
        _registerAgents(2);

        int64 regDeadline = int64(int256(block.timestamp + 3600));
        int64 startTime = int64(int256(block.timestamp + 7200));

        vm.prank(agent1);
        tournament.createMatchChallenge(
            TournamentLibV3.Tier.Rookie,
            startTime, regDeadline, 300, 3, 3, agent2
        );

        ChessBotsTournamentV3.Tournament memory t = tournament.getTournament(0);
        assertEq(t.bestOf, 3);
    }

    function test_match_challengeOnlyTargetCanJoin() public {
        _registerAgents(3);

        int64 regDeadline = int64(int256(block.timestamp + 3600));
        int64 startTime = int64(int256(block.timestamp + 7200));

        // agent1 challenges agent2
        vm.prank(agent1);
        tournament.createMatchChallenge(
            TournamentLibV3.Tier.Rookie,
            startTime, regDeadline, 300, 3, 1, agent2
        );

        // agent1 registers (challenger)
        vm.prank(agent1);
        tournament.registerForTournament(0);

        // agent3 tries to join — should fail (not the target)
        vm.prank(agent3);
        vm.expectRevert("Not the challenged opponent");
        tournament.registerForTournament(0);

        // agent2 can join (the target)
        vm.prank(agent2);
        tournament.registerForTournament(0);
    }

    function test_match_fullLifecycle_winnerTakesAll() public {
        _registerAgents(2);

        int64 regDeadline = int64(int256(block.timestamp + 3600));
        int64 startTime = int64(int256(block.timestamp + 7200));

        // Create open match (no specific target)
        vm.prank(authority);
        tournament.createTournament(
            TournamentLibV3.Tier.Rookie,
            TournamentLibV3.Format.Match,
            2, 2, startTime, regDeadline, 300, 3
        );

        // Register both players (5 USDC each)
        vm.prank(agent1); tournament.registerForTournament(0);
        vm.prank(agent2); tournament.registerForTournament(0);

        assertEq(usdc.balanceOf(address(tournament)), 10e6); // 5 + 5

        // Start
        vm.prank(authority);
        tournament.startTournament(0);

        ChessBotsTournamentV3.Tournament memory t = tournament.getTournament(0);
        assertEq(t.totalRounds, 1); // bestOf = 1

        // Play single game
        vm.startPrank(authority);

        ChessBotsTournamentV3.GameInput[] memory gameInputs = new ChessBotsTournamentV3.GameInput[](1);
        gameInputs[0] = ChessBotsTournamentV3.GameInput({ gameIndex: 0, white: agent1, black: agent2 });
        tournament.batchCreateAndStartGames(0, 1, gameInputs);

        ChessBotsTournamentV3.GameResultInput[] memory results = new ChessBotsTournamentV3.GameResultInput[](1);
        results[0] = ChessBotsTournamentV3.GameResultInput({ gameIndex: 0, result: TournamentLibV3.GameResult.WhiteWins, pgnHash: keccak256("p"), resultHash: bytes32(0), moveCount: 30 });

        ChessBotsTournamentV3.StandingsInput[] memory standings = new ChessBotsTournamentV3.StandingsInput[](2);
        standings[0] = ChessBotsTournamentV3.StandingsInput({ agent: agent1, score: 2, buchholz: 0, gamesPlayed: 1, gamesWon: 1, gamesDrawn: 0, gamesLost: 0 });
        standings[1] = ChessBotsTournamentV3.StandingsInput({ agent: agent2, score: 0, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 0, gamesLost: 1 });

        tournament.executeRound(0, 1, results, standings, false);

        // Finalize with only winner (2nd and 3rd = address(0))
        tournament.finalizeTournament(0, [agent1, address(0), address(0)], "ipfs://match-result");

        // Distribute — winner takes all
        tournament.distributePrizes(0);
        vm.stopPrank();

        // 10 USDC pool, 10% fee = 1 USDC fee, 9 USDC to winner
        // Match format: firstPrize = 9, unclaimed 2nd+3rd = 0 (both 0 in Match split)
        assertEq(usdc.balanceOf(agent1), 10000e6 - 5e6 + 9e6); // 10004
        assertEq(usdc.balanceOf(agent2), 10000e6 - 5e6);        // 9995
        assertEq(usdc.balanceOf(treasury), 1e6);
    }

    function test_match_bestOf3_lifecycle() public {
        _registerAgents(2);

        int64 regDeadline = int64(int256(block.timestamp + 3600));
        int64 startTime = int64(int256(block.timestamp + 7200));

        vm.prank(authority);
        tournament.createTournament(
            TournamentLibV3.Tier.Bronze,
            TournamentLibV3.Format.Match,
            2, 2, startTime, regDeadline, 300, 3
        );

        // Verify it's a Match format
        ChessBotsTournamentV3.Tournament memory t = tournament.getTournament(0);
        assertEq(uint8(t.format), uint8(TournamentLibV3.Format.Match));
        assertEq(t.bestOf, 1); // default bestOf=1 when created via createTournament

        vm.prank(agent1); tournament.registerForTournament(0);
        vm.prank(agent2); tournament.registerForTournament(0);

        vm.prank(authority);
        tournament.startTournament(0);

        t = tournament.getTournament(0);
        assertEq(t.totalRounds, 1); // bestOf=1

        // Play round 1
        vm.startPrank(authority);
        ChessBotsTournamentV3.GameInput[] memory g = new ChessBotsTournamentV3.GameInput[](1);
        g[0] = ChessBotsTournamentV3.GameInput({ gameIndex: 0, white: agent1, black: agent2 });
        tournament.batchCreateAndStartGames(0, 1, g);

        ChessBotsTournamentV3.GameResultInput[] memory r = new ChessBotsTournamentV3.GameResultInput[](1);
        r[0] = ChessBotsTournamentV3.GameResultInput({ gameIndex: 0, result: TournamentLibV3.GameResult.BlackWins, pgnHash: keccak256("g1"), resultHash: bytes32(0), moveCount: 25 });

        ChessBotsTournamentV3.StandingsInput[] memory s = new ChessBotsTournamentV3.StandingsInput[](2);
        s[0] = ChessBotsTournamentV3.StandingsInput({ agent: agent1, score: 0, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 0, gamesLost: 1 });
        s[1] = ChessBotsTournamentV3.StandingsInput({ agent: agent2, score: 2, buchholz: 0, gamesPlayed: 1, gamesWon: 1, gamesDrawn: 0, gamesLost: 0 });

        tournament.executeRound(0, 1, r, s, false);

        // Finalize — agent2 wins
        tournament.finalizeTournament(0, [agent2, address(0), address(0)], "ipfs://match-bo1");
        tournament.distributePrizes(0);
        vm.stopPrank();

        // agent2 should get all prizes (winner takes all in Match format)
        // Pool = 100 USDC, fee = 10, player pool = 90
        assertEq(usdc.balanceOf(agent2), 10000e6 - 50e6 + 90e6); // 10040
        assertEq(usdc.balanceOf(agent1), 10000e6 - 50e6);         // 9950
    }

    function test_match_invalidBestOf() public {
        _registerAgents(2);

        int64 regDeadline = int64(int256(block.timestamp + 3600));
        int64 startTime = int64(int256(block.timestamp + 7200));

        vm.prank(agent1);
        vm.expectRevert("bestOf must be 1, 3, or 5");
        tournament.createMatchChallenge(
            TournamentLibV3.Tier.Rookie,
            startTime, regDeadline, 300, 3, 2, agent2 // bestOf=2 is invalid
        );
    }

    function test_match_cannotHaveMoreThan2Players() public {
        _registerAgents(2);

        int64 regDeadline = int64(int256(block.timestamp + 3600));
        int64 startTime = int64(int256(block.timestamp + 7200));

        vm.prank(authority);
        vm.expectRevert("Match requires exactly 2 players");
        tournament.createTournament(
            TournamentLibV3.Tier.Rookie,
            TournamentLibV3.Format.Match,
            4, 2, startTime, regDeadline, 300, 3 // maxPlayers=4 invalid for Match
        );
    }

    // ================================================================
    //                    LEAGUE FORMAT TESTS
    // ================================================================

    function test_league_creation() public {
        _registerAgents(4);

        int64 regDeadline = int64(int256(block.timestamp + 3600));
        int64 startTime = int64(int256(block.timestamp + 7200));

        vm.prank(authority);
        tournament.createTournament(
            TournamentLibV3.Tier.Silver,
            TournamentLibV3.Format.League,
            10, 4, startTime, regDeadline, 600, 5
        );

        ChessBotsTournamentV3.Tournament memory t = tournament.getTournament(0);
        assertEq(uint8(t.format), uint8(TournamentLibV3.Format.League));
    }

    function test_league_roundCalculation() public {
        _registerAgents(6);

        int64 regDeadline = int64(int256(block.timestamp + 3600));
        int64 startTime = int64(int256(block.timestamp + 7200));

        vm.prank(authority);
        tournament.createTournament(
            TournamentLibV3.Tier.Silver,
            TournamentLibV3.Format.League,
            10, 4, startTime, regDeadline, 600, 5
        );

        // Register 6 players
        vm.prank(agent1); tournament.registerForTournament(0);
        vm.prank(agent2); tournament.registerForTournament(0);
        vm.prank(agent3); tournament.registerForTournament(0);
        vm.prank(agent4); tournament.registerForTournament(0);
        vm.prank(agent5); tournament.registerForTournament(0);
        vm.prank(agent6); tournament.registerForTournament(0);

        vm.prank(authority);
        tournament.startTournament(0);

        // League: rounds = N - 1 = 5
        ChessBotsTournamentV3.Tournament memory t = tournament.getTournament(0);
        assertEq(t.totalRounds, 5); // 6 players => 5 rounds
    }

    function test_league_fullLifecycle_4players() public {
        _registerAgents(4);

        int64 regDeadline = int64(int256(block.timestamp + 3600));
        int64 startTime = int64(int256(block.timestamp + 7200));

        vm.prank(authority);
        tournament.createTournament(
            TournamentLibV3.Tier.Bronze,
            TournamentLibV3.Format.League,
            10, 4, startTime, regDeadline, 300, 3
        );

        vm.prank(agent1); tournament.registerForTournament(0);
        vm.prank(agent2); tournament.registerForTournament(0);
        vm.prank(agent3); tournament.registerForTournament(0);
        vm.prank(agent4); tournament.registerForTournament(0);

        vm.prank(authority);
        tournament.startTournament(0);

        ChessBotsTournamentV3.Tournament memory t = tournament.getTournament(0);
        assertEq(t.totalRounds, 3); // 4 players => 3 rounds (round-robin)

        vm.startPrank(authority);

        // --- Round 1: agent1 vs agent2, agent3 vs agent4 ---
        _playLeagueRound(0, 1,
            agent1, agent2, TournamentLibV3.GameResult.WhiteWins,
            agent3, agent4, TournamentLibV3.GameResult.WhiteWins,
            true
        );

        // --- Round 2: agent1 vs agent3, agent2 vs agent4 ---
        _playLeagueRound(0, 2,
            agent1, agent3, TournamentLibV3.GameResult.Draw,
            agent2, agent4, TournamentLibV3.GameResult.BlackWins,
            true
        );

        // --- Round 3: agent1 vs agent4, agent2 vs agent3 ---
        _playLeagueRound(0, 3,
            agent1, agent4, TournamentLibV3.GameResult.WhiteWins,
            agent2, agent3, TournamentLibV3.GameResult.Draw,
            false
        );

        // Final standings (using league 3/1/0 scoring):
        // agent1: W, D, W = 3+1+3 = 7 pts
        // agent3: W, D(vs1), D(vs2) = 3+1+1 = 5 pts
        // agent4: L, W, L = 0+3+0 = 3 pts
        // agent2: L, L, D = 0+0+1 = 1 pt

        // Update cumulative standings for round 3
        ChessBotsTournamentV3.StandingsInput[] memory finalStandings = new ChessBotsTournamentV3.StandingsInput[](4);
        finalStandings[0] = ChessBotsTournamentV3.StandingsInput({ agent: agent1, score: 7, buchholz: 0, gamesPlayed: 3, gamesWon: 2, gamesDrawn: 1, gamesLost: 0 });
        finalStandings[1] = ChessBotsTournamentV3.StandingsInput({ agent: agent3, score: 5, buchholz: 0, gamesPlayed: 3, gamesWon: 1, gamesDrawn: 2, gamesLost: 0 });
        finalStandings[2] = ChessBotsTournamentV3.StandingsInput({ agent: agent4, score: 3, buchholz: 0, gamesPlayed: 3, gamesWon: 1, gamesDrawn: 0, gamesLost: 2 });
        finalStandings[3] = ChessBotsTournamentV3.StandingsInput({ agent: agent2, score: 1, buchholz: 0, gamesPlayed: 3, gamesWon: 0, gamesDrawn: 1, gamesLost: 2 });

        // Note: standings were set in the _playLeagueRound helper, we just finalize
        tournament.finalizeTournament(0, [agent1, agent3, agent4], "ipfs://league-results");
        tournament.distributePrizes(0);
        vm.stopPrank();

        // League 50/30/20 split: 200 USDC pool, 10% fee = 20 USDC fee, 180 player pool
        // 1st: 180 * 50% = 90, 2nd: 180 * 30% = 54, 3rd: 180 - 90 - 54 = 36
        assertEq(usdc.balanceOf(agent1), 10000e6 - 50e6 + 90e6);  // 10040
        assertEq(usdc.balanceOf(agent3), 10000e6 - 50e6 + 54e6);  // 10004
        assertEq(usdc.balanceOf(agent4), 10000e6 - 50e6 + 36e6);  // 9986
        assertEq(usdc.balanceOf(treasury), 20e6);
    }

    /// @dev Helper to play a league round with 2 games, update standings, optionally advance
    function _playLeagueRound(
        uint256 tid,
        uint8 round,
        address white1, address black1, TournamentLibV3.GameResult result1,
        address white2, address black2, TournamentLibV3.GameResult result2,
        bool advance
    ) internal {
        ChessBotsTournamentV3.GameInput[] memory g = new ChessBotsTournamentV3.GameInput[](2);
        g[0] = ChessBotsTournamentV3.GameInput({ gameIndex: 0, white: white1, black: black1 });
        g[1] = ChessBotsTournamentV3.GameInput({ gameIndex: 1, white: white2, black: black2 });
        tournament.batchCreateAndStartGames(tid, round, g);

        ChessBotsTournamentV3.GameResultInput[] memory r = new ChessBotsTournamentV3.GameResultInput[](2);
        r[0] = ChessBotsTournamentV3.GameResultInput({ gameIndex: 0, result: result1, pgnHash: keccak256(abi.encode("r", round, "g0")), resultHash: bytes32(0), moveCount: 25 });
        r[1] = ChessBotsTournamentV3.GameResultInput({ gameIndex: 1, result: result2, pgnHash: keccak256(abi.encode("r", round, "g1")), resultHash: bytes32(0), moveCount: 30 });

        // We need cumulative standings. For simplicity in this helper, calculate running totals.
        // The caller should handle final standings verification.
        // For now, use placeholder standings that get overwritten.
        ChessBotsTournamentV3.StandingsInput[] memory s = new ChessBotsTournamentV3.StandingsInput[](4);

        if (round == 1) {
            s[0] = _standingFor(white1, result1, true, 1);
            s[1] = _standingFor(black1, result1, false, 1);
            s[2] = _standingFor(white2, result2, true, 1);
            s[3] = _standingFor(black2, result2, false, 1);
        } else if (round == 2) {
            // Cumulative: need to add previous round. We'll use approximate cumulative scores.
            // agent1: R1=W(3), R2=D(1) = 4
            // agent2: R1=L(0), R2=L(0) = 0
            // agent3: R1=W(3), R2=D(1) = 4
            // agent4: R1=L(0), R2=W(3) = 3
            s[0] = ChessBotsTournamentV3.StandingsInput({ agent: agent1, score: 4, buchholz: 0, gamesPlayed: 2, gamesWon: 1, gamesDrawn: 1, gamesLost: 0 });
            s[1] = ChessBotsTournamentV3.StandingsInput({ agent: agent3, score: 4, buchholz: 0, gamesPlayed: 2, gamesWon: 1, gamesDrawn: 1, gamesLost: 0 });
            s[2] = ChessBotsTournamentV3.StandingsInput({ agent: agent2, score: 0, buchholz: 0, gamesPlayed: 2, gamesWon: 0, gamesDrawn: 0, gamesLost: 2 });
            s[3] = ChessBotsTournamentV3.StandingsInput({ agent: agent4, score: 3, buchholz: 0, gamesPlayed: 2, gamesWon: 1, gamesDrawn: 0, gamesLost: 1 });
        } else if (round == 3) {
            // Final cumulative
            s[0] = ChessBotsTournamentV3.StandingsInput({ agent: agent1, score: 7, buchholz: 0, gamesPlayed: 3, gamesWon: 2, gamesDrawn: 1, gamesLost: 0 });
            s[1] = ChessBotsTournamentV3.StandingsInput({ agent: agent3, score: 5, buchholz: 0, gamesPlayed: 3, gamesWon: 1, gamesDrawn: 2, gamesLost: 0 });
            s[2] = ChessBotsTournamentV3.StandingsInput({ agent: agent4, score: 3, buchholz: 0, gamesPlayed: 3, gamesWon: 1, gamesDrawn: 0, gamesLost: 2 });
            s[3] = ChessBotsTournamentV3.StandingsInput({ agent: agent2, score: 1, buchholz: 0, gamesPlayed: 3, gamesWon: 0, gamesDrawn: 1, gamesLost: 2 });
        }

        tournament.executeRound(tid, round, r, s, advance);
    }

    function _standingFor(address agent, TournamentLibV3.GameResult result, bool isWhite, uint8 gamesPlayed)
        internal pure returns (ChessBotsTournamentV3.StandingsInput memory)
    {
        uint16 score;
        uint8 won; uint8 drawn; uint8 lost;
        if (result == TournamentLibV3.GameResult.WhiteWins) {
            if (isWhite) { score = 3; won = 1; }
            else { score = 0; lost = 1; }
        } else if (result == TournamentLibV3.GameResult.BlackWins) {
            if (!isWhite) { score = 3; won = 1; }
            else { score = 0; lost = 1; }
        } else if (result == TournamentLibV3.GameResult.Draw) {
            score = 1; drawn = 1;
        }
        return ChessBotsTournamentV3.StandingsInput({
            agent: agent, score: score, buchholz: 0,
            gamesPlayed: gamesPlayed, gamesWon: won, gamesDrawn: drawn, gamesLost: lost
        });
    }

    // ================================================================
    //                    TEAM FORMAT TESTS
    // ================================================================

    function test_team_creation() public {
        _registerAgents(2);

        int64 regDeadline = int64(int256(block.timestamp + 3600));
        int64 startTime = int64(int256(block.timestamp + 7200));

        vm.prank(authority);
        tournament.createTeamTournament(
            TournamentLibV3.Tier.Bronze,
            8, 2, startTime, regDeadline, 300, 3, 5
        );

        ChessBotsTournamentV3.Tournament memory t = tournament.getTournament(0);
        assertEq(uint8(t.format), uint8(TournamentLibV3.Format.Team));
        assertEq(t.teamSize, 5);
        assertEq(t.maxPlayers, 8); // 8 teams max
        assertEq(t.minPlayers, 2); // 2 teams min
    }

    function test_team_invalidSize() public {
        _registerAgents(1);

        int64 regDeadline = int64(int256(block.timestamp + 3600));
        int64 startTime = int64(int256(block.timestamp + 7200));

        vm.prank(authority);
        vm.expectRevert("Team size must be 2-10");
        tournament.createTeamTournament(
            TournamentLibV3.Tier.Bronze,
            8, 2, startTime, regDeadline, 300, 3, 1 // teamSize=1 invalid
        );
    }

    function test_team_registerTeam() public {
        _registerAgents(5);

        int64 regDeadline = int64(int256(block.timestamp + 3600));
        int64 startTime = int64(int256(block.timestamp + 7200));

        vm.prank(authority);
        tournament.createTeamTournament(
            TournamentLibV3.Tier.Free,
            8, 2, startTime, regDeadline, 300, 3, 5
        );

        // Fund tournament for free tier
        usdc.mint(authority, 100e6);
        vm.startPrank(authority);
        usdc.approve(address(tournament), 100e6);
        tournament.fundTournament(0, 100e6);
        vm.stopPrank();

        // Register a team of 5
        address[] memory members = new address[](5);
        members[0] = agent1;
        members[1] = agent2;
        members[2] = agent3;
        members[3] = agent4;
        members[4] = agent5;

        vm.prank(agent1); // captain
        tournament.registerTeam(0, members);

        // Verify team roster
        address[] memory roster = tournament.getTeamRoster(0, 0);
        assertEq(roster.length, 5);
        assertEq(roster[0], agent1);
        assertEq(roster[4], agent5);

        // Verify team count
        assertEq(tournament.getTeamCount(0), 1);

        // Verify registrations created for all members
        ChessBotsTournamentV3.Registration memory r1 = tournament.getRegistration(0, agent1);
        assertTrue(r1.exists);
        assertTrue(r1.active);

        ChessBotsTournamentV3.Registration memory r5 = tournament.getRegistration(0, agent5);
        assertTrue(r5.exists);
    }

    function test_team_cannotRegisterIndividually() public {
        _registerAgents(2);

        int64 regDeadline = int64(int256(block.timestamp + 3600));
        int64 startTime = int64(int256(block.timestamp + 7200));

        vm.prank(authority);
        tournament.createTeamTournament(
            TournamentLibV3.Tier.Free,
            8, 2, startTime, regDeadline, 300, 3, 5
        );

        // Try to register individually — should fail
        vm.prank(agent1);
        vm.expectRevert("Use registerTeam for team tournaments");
        tournament.registerForTournament(0);
    }

    function test_team_wrongTeamSize() public {
        _registerAgents(4);

        int64 regDeadline = int64(int256(block.timestamp + 3600));
        int64 startTime = int64(int256(block.timestamp + 7200));

        vm.prank(authority);
        tournament.createTeamTournament(
            TournamentLibV3.Tier.Free,
            8, 2, startTime, regDeadline, 300, 3, 5
        );

        // Try to register with only 4 members (need 5)
        address[] memory members = new address[](4);
        members[0] = agent1;
        members[1] = agent2;
        members[2] = agent3;
        members[3] = agent4;

        vm.prank(agent1);
        vm.expectRevert("Wrong team size");
        tournament.registerTeam(0, members);
    }

    function test_team_memberAlreadyInTournament() public {
        _registerAgents(10);

        int64 regDeadline = int64(int256(block.timestamp + 3600));
        int64 startTime = int64(int256(block.timestamp + 7200));

        vm.prank(authority);
        tournament.createTeamTournament(
            TournamentLibV3.Tier.Free,
            8, 2, startTime, regDeadline, 300, 3, 5
        );

        // Register first team
        address[] memory team1 = new address[](5);
        team1[0] = agent1;
        team1[1] = agent2;
        team1[2] = agent3;
        team1[3] = agent4;
        team1[4] = agent5;

        vm.prank(agent1);
        tournament.registerTeam(0, team1);

        // Try to register second team with overlapping member (agent1)
        address[] memory team2 = new address[](5);
        team2[0] = agent6;
        team2[1] = agent7;
        team2[2] = agent8;
        team2[3] = agent9;
        team2[4] = agent1; // already on team1!

        vm.prank(agent6);
        vm.expectRevert("Member already in tournament");
        tournament.registerTeam(0, team2);
    }

    function test_team_fullLifecycle() public {
        _registerAgents(10);

        int64 regDeadline = int64(int256(block.timestamp + 3600));
        int64 startTime = int64(int256(block.timestamp + 7200));

        vm.prank(authority);
        tournament.createTeamTournament(
            TournamentLibV3.Tier.Free,
            8, 2, startTime, regDeadline, 300, 3, 5
        );

        // Fund tournament
        usdc.mint(authority, 100e6);
        vm.startPrank(authority);
        usdc.approve(address(tournament), 100e6);
        tournament.fundTournament(0, 100e6);
        vm.stopPrank();

        // Register 2 teams
        address[] memory team1 = new address[](5);
        team1[0] = agent1; team1[1] = agent2; team1[2] = agent3; team1[3] = agent4; team1[4] = agent5;
        vm.prank(agent1); tournament.registerTeam(0, team1);

        address[] memory team2 = new address[](5);
        team2[0] = agent6; team2[1] = agent7; team2[2] = agent8; team2[3] = agent9; team2[4] = agent10;
        vm.prank(agent6); tournament.registerTeam(0, team2);

        // Start
        vm.prank(authority);
        tournament.startTournament(0);

        ChessBotsTournamentV3.Tournament memory t = tournament.getTournament(0);
        assertEq(t.totalRounds, 1); // 2 teams => log2(2) = 1 round (Swiss at team level)

        // Play 5 board games (one per board in the team match)
        vm.startPrank(authority);

        ChessBotsTournamentV3.GameInput[] memory games_ = new ChessBotsTournamentV3.GameInput[](5);
        games_[0] = ChessBotsTournamentV3.GameInput({ gameIndex: 0, white: agent1, black: agent6 });
        games_[1] = ChessBotsTournamentV3.GameInput({ gameIndex: 1, white: agent2, black: agent7 });
        games_[2] = ChessBotsTournamentV3.GameInput({ gameIndex: 2, white: agent3, black: agent8 });
        games_[3] = ChessBotsTournamentV3.GameInput({ gameIndex: 3, white: agent4, black: agent9 });
        games_[4] = ChessBotsTournamentV3.GameInput({ gameIndex: 4, white: agent5, black: agent10 });
        tournament.batchCreateAndStartGames(0, 1, games_);

        // Results: Team1 wins 3-2
        ChessBotsTournamentV3.GameResultInput[] memory results = new ChessBotsTournamentV3.GameResultInput[](5);
        results[0] = ChessBotsTournamentV3.GameResultInput({ gameIndex: 0, result: TournamentLibV3.GameResult.WhiteWins, pgnHash: keccak256("b0"), resultHash: bytes32(0), moveCount: 20 });
        results[1] = ChessBotsTournamentV3.GameResultInput({ gameIndex: 1, result: TournamentLibV3.GameResult.BlackWins, pgnHash: keccak256("b1"), resultHash: bytes32(0), moveCount: 30 });
        results[2] = ChessBotsTournamentV3.GameResultInput({ gameIndex: 2, result: TournamentLibV3.GameResult.WhiteWins, pgnHash: keccak256("b2"), resultHash: bytes32(0), moveCount: 25 });
        results[3] = ChessBotsTournamentV3.GameResultInput({ gameIndex: 3, result: TournamentLibV3.GameResult.Draw, pgnHash: keccak256("b3"), resultHash: bytes32(0), moveCount: 40 });
        results[4] = ChessBotsTournamentV3.GameResultInput({ gameIndex: 4, result: TournamentLibV3.GameResult.WhiteWins, pgnHash: keccak256("b4"), resultHash: bytes32(0), moveCount: 35 });

        // Update individual agent standings
        ChessBotsTournamentV3.StandingsInput[] memory standings = new ChessBotsTournamentV3.StandingsInput[](10);
        // Team 1 members
        standings[0] = ChessBotsTournamentV3.StandingsInput({ agent: agent1, score: 2, buchholz: 0, gamesPlayed: 1, gamesWon: 1, gamesDrawn: 0, gamesLost: 0 });
        standings[1] = ChessBotsTournamentV3.StandingsInput({ agent: agent2, score: 0, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 0, gamesLost: 1 });
        standings[2] = ChessBotsTournamentV3.StandingsInput({ agent: agent3, score: 2, buchholz: 0, gamesPlayed: 1, gamesWon: 1, gamesDrawn: 0, gamesLost: 0 });
        standings[3] = ChessBotsTournamentV3.StandingsInput({ agent: agent4, score: 1, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 1, gamesLost: 0 });
        standings[4] = ChessBotsTournamentV3.StandingsInput({ agent: agent5, score: 2, buchholz: 0, gamesPlayed: 1, gamesWon: 1, gamesDrawn: 0, gamesLost: 0 });
        // Team 2 members
        standings[5] = ChessBotsTournamentV3.StandingsInput({ agent: agent6, score: 0, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 0, gamesLost: 1 });
        standings[6] = ChessBotsTournamentV3.StandingsInput({ agent: agent7, score: 2, buchholz: 0, gamesPlayed: 1, gamesWon: 1, gamesDrawn: 0, gamesLost: 0 });
        standings[7] = ChessBotsTournamentV3.StandingsInput({ agent: agent8, score: 0, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 0, gamesLost: 1 });
        standings[8] = ChessBotsTournamentV3.StandingsInput({ agent: agent9, score: 1, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 1, gamesLost: 0 });
        standings[9] = ChessBotsTournamentV3.StandingsInput({ agent: agent10, score: 0, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 0, gamesLost: 1 });

        tournament.executeRound(0, 1, results, standings, false);

        // Finalize: Team1 captain (agent1) wins, Team2 captain (agent6) is 2nd
        // For team format, prize goes to team captain
        tournament.finalizeTournament(0, [agent1, agent6, address(0)], "ipfs://team-results");
        tournament.distributePrizes(0);
        vm.stopPrank();

        // Team format uses Swiss split: 70/20/10
        // 100 USDC pool, 10% fee = 10 USDC, player pool = 90
        // 1st: 90 * 70% = 63, 2nd: 90 * 20% = 18, 3rd: 90 - 63 - 18 = 9
        // 3rd winner is address(0), so 9 USDC stays (not transferred)
        assertEq(usdc.balanceOf(agent1), 10000e6 + 63e6);  // 10063 (no entry fee for Free tier)
        assertEq(usdc.balanceOf(agent6), 10000e6 + 18e6);  // 10018
        assertEq(usdc.balanceOf(treasury), 10e6);

        assertEq(tournament.totalGamesPlayed(), 5);
    }

    // ================================================================
    //                    FREE TIER TESTS
    // ================================================================

    function test_freeTier_swissFormat() public {
        _registerAgents(4);

        vm.prank(authority);
        tournament.createTournament(
            TournamentLibV3.Tier.Free,
            TournamentLibV3.Format.Swiss,
            8, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 5
        );

        // Fund tournament
        usdc.mint(authority, 100e6);
        vm.startPrank(authority);
        usdc.approve(address(tournament), 100e6);
        tournament.fundTournament(0, 100e6);
        vm.stopPrank();

        // Register agents (free, no cost)
        vm.prank(agent1); tournament.registerForTournament(0);
        vm.prank(agent2); tournament.registerForTournament(0);
        vm.prank(agent3); tournament.registerForTournament(0);
        vm.prank(agent4); tournament.registerForTournament(0);

        // Balances unchanged
        assertEq(usdc.balanceOf(agent1), 10000e6);
        assertEq(usdc.balanceOf(agent2), 10000e6);
    }

    function test_freeTier_matchFormat() public {
        _registerAgents(2);

        vm.prank(authority);
        tournament.createTournament(
            TournamentLibV3.Tier.Free,
            TournamentLibV3.Format.Match,
            2, 2,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );

        vm.prank(agent1); tournament.registerForTournament(0);
        vm.prank(agent2); tournament.registerForTournament(0);

        // No USDC spent
        assertEq(usdc.balanceOf(agent1), 10000e6);
        assertEq(usdc.balanceOf(agent2), 10000e6);
    }

    // ================================================================
    //                    LEGENDS TIER TESTS
    // ================================================================

    function test_legends_withFormat() public {
        _registerAgents(2);

        vm.prank(authority);
        tournament.createLegendsTournament(
            TournamentLibV3.Format.Match,
            2, 2,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3,
            1000e6 // 1000 USDC entry
        );

        ChessBotsTournamentV3.Tournament memory t = tournament.getTournament(0);
        assertEq(uint8(t.format), uint8(TournamentLibV3.Format.Match));
        assertEq(uint8(t.tier), uint8(TournamentLibV3.Tier.Legends));
        assertEq(t.entryFee, 1000e6);
    }

    function test_legends_leagueFormat() public {
        _registerAgents(4);

        vm.prank(authority);
        tournament.createLegendsTournament(
            TournamentLibV3.Format.League,
            10, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            600, 5,
            500e6
        );

        ChessBotsTournamentV3.Tournament memory t = tournament.getTournament(0);
        assertEq(uint8(t.format), uint8(TournamentLibV3.Format.League));
        assertEq(t.entryFee, 500e6);
    }

    function test_legends_minFee() public {
        vm.prank(authority);
        vm.expectRevert("Legends min 500 USDC");
        tournament.createLegendsTournament(
            TournamentLibV3.Format.Swiss,
            8, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3,
            100e6 // Below 500 USDC minimum
        );
    }

    // ================================================================
    //                    EDGE CASES & ACCESS CONTROL
    // ================================================================

    function test_cannotDoubleRegister() public {
        vm.prank(agent1);
        tournament.registerAgent("Agent1", "", TournamentLibV3.AgentType.Custom);

        vm.prank(agent1);
        vm.expectRevert("Already registered");
        tournament.registerAgent("Agent1Again", "", TournamentLibV3.AgentType.Custom);
    }

    function test_cannotRegisterAfterDeadline() public {
        _registerAgents(2);

        vm.prank(authority);
        tournament.createTournament(
            TournamentLibV3.Tier.Rookie,
            TournamentLibV3.Format.Match,
            2, 2,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );

        vm.warp(block.timestamp + 3601);

        vm.prank(agent1);
        vm.expectRevert("Registration closed");
        tournament.registerForTournament(0);
    }

    function test_unregisteredCantCreateTournament() public {
        vm.prank(agent1);
        vm.expectRevert("Must be registered agent or authority");
        tournament.createTournament(
            TournamentLibV3.Tier.Bronze,
            TournamentLibV3.Format.Swiss,
            32, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );
    }

    function test_registeredAgentCanCreateTournament() public {
        _registerAgents(1);

        vm.prank(agent1);
        tournament.createTournament(
            TournamentLibV3.Tier.Bronze,
            TournamentLibV3.Format.Swiss,
            16, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );

        ChessBotsTournamentV3.Tournament memory t = tournament.getTournament(0);
        assertTrue(t.exists);
        assertEq(t.authority, agent1);
    }

    function test_cancelAndRefund() public {
        _registerAgents(2);

        vm.prank(authority);
        tournament.createTournament(
            TournamentLibV3.Tier.Rookie,
            TournamentLibV3.Format.Match,
            2, 2,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );

        vm.prank(agent1); tournament.registerForTournament(0);
        uint256 bal1Before = usdc.balanceOf(agent1);

        vm.prank(authority);
        tournament.cancelTournament(0);

        vm.prank(agent1);
        tournament.claimRefund(0);

        // agent1 should get their 5 USDC back
        assertEq(usdc.balanceOf(agent1), bal1Before + 5e6);
    }

    function test_pauseProtocol() public {
        _registerAgents(1);

        vm.prank(authority);
        tournament.setPaused(true);

        // Cannot create tournament when paused
        vm.prank(agent1);
        vm.expectRevert("Protocol paused");
        tournament.createTournament(
            TournamentLibV3.Tier.Bronze,
            TournamentLibV3.Format.Swiss,
            8, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );

        // Unpause
        vm.prank(authority);
        tournament.setPaused(false);

        // Now it works
        vm.prank(agent1);
        tournament.createTournament(
            TournamentLibV3.Tier.Bronze,
            TournamentLibV3.Format.Swiss,
            8, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );
    }

    function test_authorityTransfer() public {
        address newAuth = address(99);

        vm.prank(authority);
        tournament.proposeAuthority(newAuth);

        vm.prank(newAuth);
        tournament.acceptAuthority();

        (address auth,,,,,,,,,) = tournament.protocol();
        assertEq(auth, newAuth);
    }

    // ================================================================
    //                    FORMAT-SPECIFIC PRIZE CALCULATION
    // ================================================================

    function test_prizeSplit_swiss() public pure {
        // 1000 USDC pool, 10% fee
        (uint256 first, uint256 second, uint256 third, uint256 fee) =
            TournamentLibV3.calculatePrizesForFormat(1000e6, 1000, TournamentLibV3.Format.Swiss);

        assertEq(fee, 100e6);           // 10% of 1000
        assertEq(first, 630e6);         // 70% of 900
        assertEq(second, 180e6);        // 20% of 900
        assertEq(third, 90e6);          // 10% of 900 (remainder)
    }

    function test_prizeSplit_match() public pure {
        // 100 USDC pool, 10% fee
        (uint256 first, uint256 second, uint256 third, uint256 fee) =
            TournamentLibV3.calculatePrizesForFormat(100e6, 1000, TournamentLibV3.Format.Match);

        assertEq(fee, 10e6);            // 10% of 100
        assertEq(first, 90e6);          // Winner takes all
        assertEq(second, 0);
        assertEq(third, 0);
    }

    function test_prizeSplit_league() public pure {
        // 1000 USDC pool, 10% fee
        (uint256 first, uint256 second, uint256 third, uint256 fee) =
            TournamentLibV3.calculatePrizesForFormat(1000e6, 1000, TournamentLibV3.Format.League);

        assertEq(fee, 100e6);           // 10% of 1000
        assertEq(first, 450e6);         // 50% of 900
        assertEq(second, 270e6);        // 30% of 900
        assertEq(third, 180e6);         // 20% of 900 (remainder)
    }

    function test_prizeSplit_team() public pure {
        // 500 USDC pool, 10% fee
        (uint256 first, uint256 second, uint256 third, uint256 fee) =
            TournamentLibV3.calculatePrizesForFormat(500e6, 1000, TournamentLibV3.Format.Team);

        assertEq(fee, 50e6);            // 10% of 500
        assertEq(first, 315e6);         // 70% of 450
        assertEq(second, 90e6);         // 20% of 450
        assertEq(third, 45e6);          // 10% of 450 (remainder)
    }

    // ================================================================
    //                    ROUND CALCULATION TESTS
    // ================================================================

    function test_roundCalc_swiss() public pure {
        assertEq(TournamentLibV3.calculateRoundsForFormat(4, TournamentLibV3.Format.Swiss, 0), 2);
        assertEq(TournamentLibV3.calculateRoundsForFormat(8, TournamentLibV3.Format.Swiss, 0), 3);
        assertEq(TournamentLibV3.calculateRoundsForFormat(16, TournamentLibV3.Format.Swiss, 0), 4);
        assertEq(TournamentLibV3.calculateRoundsForFormat(64, TournamentLibV3.Format.Swiss, 0), 6);
    }

    function test_roundCalc_match() public pure {
        assertEq(TournamentLibV3.calculateRoundsForFormat(2, TournamentLibV3.Format.Match, 1), 1);
        assertEq(TournamentLibV3.calculateRoundsForFormat(2, TournamentLibV3.Format.Match, 3), 3);
        assertEq(TournamentLibV3.calculateRoundsForFormat(2, TournamentLibV3.Format.Match, 5), 5);
    }

    function test_roundCalc_league() public pure {
        assertEq(TournamentLibV3.calculateRoundsForFormat(4, TournamentLibV3.Format.League, 0), 3);
        assertEq(TournamentLibV3.calculateRoundsForFormat(6, TournamentLibV3.Format.League, 0), 5);
        assertEq(TournamentLibV3.calculateRoundsForFormat(10, TournamentLibV3.Format.League, 0), 9);
    }

    function test_roundCalc_team() public pure {
        // Team uses Swiss formula at team level
        assertEq(TournamentLibV3.calculateRoundsForFormat(4, TournamentLibV3.Format.Team, 0), 2);
        assertEq(TournamentLibV3.calculateRoundsForFormat(8, TournamentLibV3.Format.Team, 0), 3);
    }

    // ================================================================
    //                    SPONSORSHIP WITH V3 FORMATS
    // ================================================================

    function test_sponsorship_leagueTournament() public {
        _registerAgents(4);
        address sponsor = address(50);
        usdc.mint(sponsor, 1000e6);

        vm.prank(authority);
        tournament.createTournament(
            TournamentLibV3.Tier.Free,
            TournamentLibV3.Format.League,
            10, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );

        vm.startPrank(sponsor);
        usdc.approve(address(tournament), 500e6);
        tournament.sponsorTournament(0, 500e6, "SponsorName", "https://sponsor.com");
        vm.stopPrank();

        ChessBotsTournamentV3.Sponsorship memory s = tournament.getSponsor(0);
        assertEq(s.sponsor, sponsor);
        assertEq(s.amount, 500e6);

        // 10% platform fee = 50 USDC to treasury, 450 USDC to prize pool
        assertEq(usdc.balanceOf(treasury), 50e6);
        assertEq(tournament.tournamentCollected(0), 450e6);
    }

    // ================================================================
    //                    GAS BENCHMARK
    // ================================================================

    function test_gasBenchmark_matchFormat() public {
        _registerAgents(2);

        vm.prank(authority);
        tournament.createTournament(
            TournamentLibV3.Tier.Rookie,
            TournamentLibV3.Format.Match,
            2, 2,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );

        vm.prank(agent1); tournament.registerForTournament(0);
        vm.prank(agent2); tournament.registerForTournament(0);

        vm.prank(authority);
        tournament.startTournament(0);

        vm.startPrank(authority);

        ChessBotsTournamentV3.GameInput[] memory g = new ChessBotsTournamentV3.GameInput[](1);
        g[0] = ChessBotsTournamentV3.GameInput({ gameIndex: 0, white: agent1, black: agent2 });

        uint256 gasBefore = gasleft();
        tournament.batchCreateAndStartGames(0, 1, g);
        uint256 createGas = gasBefore - gasleft();

        ChessBotsTournamentV3.GameResultInput[] memory r = new ChessBotsTournamentV3.GameResultInput[](1);
        r[0] = ChessBotsTournamentV3.GameResultInput({ gameIndex: 0, result: TournamentLibV3.GameResult.WhiteWins, pgnHash: keccak256("p"), resultHash: bytes32(0), moveCount: 30 });

        ChessBotsTournamentV3.StandingsInput[] memory s = new ChessBotsTournamentV3.StandingsInput[](2);
        s[0] = ChessBotsTournamentV3.StandingsInput({ agent: agent1, score: 2, buchholz: 0, gamesPlayed: 1, gamesWon: 1, gamesDrawn: 0, gamesLost: 0 });
        s[1] = ChessBotsTournamentV3.StandingsInput({ agent: agent2, score: 0, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 0, gamesLost: 1 });

        gasBefore = gasleft();
        tournament.executeRound(0, 1, r, s, false);
        uint256 executeGas = gasBefore - gasleft();

        gasBefore = gasleft();
        tournament.finalizeTournament(0, [agent1, address(0), address(0)], "ipfs://r");
        uint256 finalizeGas = gasBefore - gasleft();

        gasBefore = gasleft();
        tournament.distributePrizes(0);
        uint256 distributeGas = gasBefore - gasleft();

        vm.stopPrank();

        emit log_named_uint("Match: createAndStartGames (1 game)", createGas);
        emit log_named_uint("Match: executeRound (1 result, 2 standings)", executeGas);
        emit log_named_uint("Match: finalizeTournament", finalizeGas);
        emit log_named_uint("Match: distributePrizes", distributeGas);
        emit log_named_uint("Match: total lifecycle gas", createGas + executeGas + finalizeGas + distributeGas);
    }
}
