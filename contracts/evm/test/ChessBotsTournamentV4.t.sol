// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChessBotsTournamentV4.sol";
import "../src/ChessRevenueRouter.sol";
import "../src/libraries/TournamentLibV4.sol";
import "../src/libraries/PayoutCalculator.sol";

contract MockUSDCV4 {
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

contract ChessBotsTournamentV4Test is Test {
    ChessBotsTournamentV4 public v4;
    MockUSDCV4 public usdc;

    address authority = address(1);
    address treasury = address(2);

    address agent1 = address(10);
    address agent2 = address(11);
    address agent3 = address(12);
    address agent4 = address(13);
    address agent5 = address(14);
    address agent6 = address(15);
    address agent7 = address(16);
    address agent8 = address(17);

    function setUp() public {
        usdc = new MockUSDCV4();
        vm.prank(authority);
        v4 = new ChessBotsTournamentV4(address(usdc), treasury);

        // Fund and approve all agents
        address[8] memory allAgents = [agent1, agent2, agent3, agent4, agent5, agent6, agent7, agent8];
        for (uint256 i = 0; i < allAgents.length; i++) {
            usdc.mint(allAgents[i], 100000e6);
            vm.prank(allAgents[i]);
            usdc.approve(address(v4), type(uint256).max);
        }
    }

    function _registerAgents(uint8 count) internal {
        address[8] memory allAgents = [agent1, agent2, agent3, agent4, agent5, agent6, agent7, agent8];
        string[8] memory names = ["Agent1", "Agent2", "Agent3", "Agent4", "Agent5", "Agent6", "Agent7", "Agent8"];
        for (uint8 i = 0; i < count; i++) {
            vm.prank(allAgents[i]);
            v4.registerAgent(names[i], "", TournamentLibV4.AgentType.OpenClaw);
        }
    }

    function _createBronzeTournament(uint8 maxPlayers, uint8 minPlayers) internal returns (uint256) {
        vm.prank(authority);
        v4.createTournament(
            TournamentLibV4.Tier.Bronze,
            TournamentLibV4.Format.Swiss,
            TournamentLibV4.Bracket.Open,
            maxPlayers,
            minPlayers,
            int64(int256(block.timestamp + 1 hours)),
            int64(int256(block.timestamp + 50 minutes)),
            600,
            5
        );
        (,, uint64 totalTournaments,,,,) = v4.protocol();
        return totalTournaments - 1;
    }

    function _registerForTournament(uint256 tournamentId, address agent) internal {
        vm.prank(agent);
        v4.registerForTournament(tournamentId);
    }

    // Full tournament lifecycle: create → register → start → play all rounds → finalize
    function _runFullTournament(uint8 playerCount) internal returns (uint256 tournamentId) {
        _registerAgents(playerCount);
        tournamentId = _createBronzeTournament(playerCount, playerCount);

        address[8] memory allAgents = [agent1, agent2, agent3, agent4, agent5, agent6, agent7, agent8];
        for (uint8 i = 0; i < playerCount; i++) {
            _registerForTournament(tournamentId, allAgents[i]);
        }

        vm.prank(authority);
        v4.startTournament(tournamentId);

        // Get total rounds
        ChessBotsTournamentV4.Tournament memory t = v4.getTournament(tournamentId);
        uint8 totalRounds = t.totalRounds;

        // Play through ALL rounds
        for (uint8 round = 1; round <= totalRounds; round++) {
            uint8 gamesThisRound = playerCount / 2;

            // Create and start games
            ChessBotsTournamentV4.GameInput[] memory gameInputs = new ChessBotsTournamentV4.GameInput[](gamesThisRound);
            for (uint8 i = 0; i < gamesThisRound; i++) {
                gameInputs[i] = ChessBotsTournamentV4.GameInput({
                    gameIndex: i,
                    white: allAgents[i * 2],
                    black: allAgents[i * 2 + 1]
                });
            }

            vm.prank(authority);
            v4.batchCreateAndStartGames(tournamentId, round, gameInputs);

            // Submit results — white always wins
            ChessBotsTournamentV4.GameResultInput[] memory results = new ChessBotsTournamentV4.GameResultInput[](gamesThisRound);
            for (uint8 i = 0; i < gamesThisRound; i++) {
                results[i] = ChessBotsTournamentV4.GameResultInput({
                    gameIndex: i,
                    result: TournamentLibV4.GameResult.WhiteWins,
                    pgnHash: keccak256(abi.encode("pgn", round, i)),
                    resultHash: keccak256(abi.encode("result", round, i)),
                    moveCount: 30
                });
            }

            // Cumulative standings
            ChessBotsTournamentV4.StandingsInput[] memory standings = new ChessBotsTournamentV4.StandingsInput[](playerCount);
            for (uint8 i = 0; i < playerCount; i++) {
                bool isWhite = (i % 2 == 0);
                standings[i] = ChessBotsTournamentV4.StandingsInput({
                    agent: allAgents[i],
                    score: isWhite ? uint16(round * 2) : 0,
                    buchholz: 0,
                    gamesPlayed: round,
                    gamesWon: isWhite ? round : 0,
                    gamesDrawn: 0,
                    gamesLost: isWhite ? 0 : round
                });
            }

            // Advance if not last round
            bool advance = round < totalRounds;
            vm.prank(authority);
            v4.executeRound(tournamentId, round, results, standings, advance);
        }

        // Finalize with ranked list: whites first (winners), then blacks
        address[] memory ranked = new address[](playerCount);
        uint8 idx = 0;
        for (uint8 i = 0; i < playerCount; i += 2) {
            ranked[idx++] = allAgents[i];
        }
        for (uint8 i = 1; i < playerCount; i += 2) {
            ranked[idx++] = allAgents[i];
        }

        vm.prank(authority);
        v4.finalizeTournament(tournamentId, ranked, "ipfs://results");
    }

    // ================================================================
    //                    INITIALIZATION TESTS
    // ================================================================

    function test_v4_initialize() public view {
        (address auth, address treas,,, bool paused,,) = v4.protocol();
        assertEq(auth, authority);
        assertEq(treas, treasury);
        assertEq(paused, false);
    }

    function test_v4_registerAgent() public {
        vm.prank(agent1);
        v4.registerAgent("TestBot", "ipfs://meta", TournamentLibV4.AgentType.OpenClaw);

        ChessBotsTournamentV4.AgentProfile memory a = v4.getAgent(agent1);
        assertEq(a.wallet, agent1);
        assertEq(a.name, "TestBot");
        assertEq(a.eloRating, 1200);
        assertTrue(a.registered);
    }

    // ================================================================
    //                   PROGRESSIVE RAKE TESTS
    // ================================================================

    function test_v4_progressiveRake() public view {
        assertEq(v4.getEffectiveRake(TournamentLibV4.Tier.Free), 0);
        assertEq(v4.getEffectiveRake(TournamentLibV4.Tier.Rookie), 1000);
        assertEq(v4.getEffectiveRake(TournamentLibV4.Tier.Bronze), 800);
        assertEq(v4.getEffectiveRake(TournamentLibV4.Tier.Silver), 600);
        assertEq(v4.getEffectiveRake(TournamentLibV4.Tier.Masters), 500);
        assertEq(v4.getEffectiveRake(TournamentLibV4.Tier.Legends), 400);
    }

    function test_v4_rakeOverride() public {
        vm.prank(authority);
        v4.setRakeOverride(TournamentLibV4.Tier.Bronze, 500);
        assertEq(v4.getEffectiveRake(TournamentLibV4.Tier.Bronze), 500);
    }

    function test_v4_rakeOverrideTooHigh() public {
        vm.prank(authority);
        vm.expectRevert("Rake too high");
        v4.setRakeOverride(TournamentLibV4.Tier.Bronze, 2001);
    }

    // ================================================================
    //                   TOURNAMENT CREATION TESTS
    // ================================================================

    function test_v4_createTournament() public {
        _registerAgents(1);

        vm.prank(authority);
        v4.createTournament(
            TournamentLibV4.Tier.Bronze,
            TournamentLibV4.Format.Swiss,
            TournamentLibV4.Bracket.Open,
            8,
            4,
            int64(int256(block.timestamp + 1 hours)),
            int64(int256(block.timestamp + 50 minutes)),
            600,
            5
        );

        ChessBotsTournamentV4.Tournament memory t = v4.getTournament(0);
        assertEq(t.entryFee, 50e6);
        assertTrue(t.exists);
        assertEq(uint8(t.bracket), uint8(TournamentLibV4.Bracket.Open));
        assertEq(uint8(t.tournamentType), uint8(TournamentLibV4.TournamentType.Standard));
    }

    function test_v4_createFreeTournament() public {
        _registerAgents(1);

        vm.prank(authority);
        v4.createTournament(
            TournamentLibV4.Tier.Free,
            TournamentLibV4.Format.Swiss,
            TournamentLibV4.Bracket.Open,
            8,
            4,
            int64(int256(block.timestamp + 1 hours)),
            int64(int256(block.timestamp + 50 minutes)),
            600,
            5
        );

        ChessBotsTournamentV4.Tournament memory t = v4.getTournament(0);
        assertEq(t.entryFee, 0);
    }

    // ================================================================
    //               DYNAMIC PAYOUT DISTRIBUTION TESTS
    // ================================================================

    function test_v4_dynamicPayouts_4players() public {
        uint256 tournamentId = _runFullTournament(4);

        // Check tournament is completed
        ChessBotsTournamentV4.Tournament memory t = v4.getTournament(tournamentId);
        assertEq(uint8(t.status), uint8(TournamentLibV4.TournamentStatus.Completed));

        // Record balances before distribution
        uint256 a1Before = usdc.balanceOf(agent1);
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        // Distribute prizes
        vm.prank(authority);
        v4.distributePrizes(tournamentId);

        // 4 players × 50 USDC = 200 USDC pool
        // 8% rake (Bronze) = 16 USDC protocol fee
        // Player pool = 184 USDC
        // 4 players → 8-player table (3 paid): 55%/30%/15%

        uint256 playerPool = 200e6 - (200e6 * 800 / 10000); // 184 USDC
        uint256 protocolFee = 200e6 - playerPool;

        // Verify first place got roughly 55% of player pool
        uint256 a1After = usdc.balanceOf(agent1);
        uint256 firstPrize = a1After - a1Before;
        assertEq(firstPrize, (playerPool * 5500) / 10000);

        // Verify prizes distributed flag
        t = v4.getTournament(tournamentId);
        assertTrue(t.prizeDistributed);

        // Protocol fee sent to treasury (no revenue router configured)
        uint256 treasuryAfter = usdc.balanceOf(treasury);
        assertEq(treasuryAfter - treasuryBefore, protocolFee);
    }

    function test_v4_dynamicPayouts_8players() public {
        uint256 tournamentId = _runFullTournament(8);

        uint256[8] memory beforeBals;
        address[8] memory allAgents = [agent1, agent2, agent3, agent4, agent5, agent6, agent7, agent8];
        for (uint256 i = 0; i < 8; i++) {
            beforeBals[i] = usdc.balanceOf(allAgents[i]);
        }

        vm.prank(authority);
        v4.distributePrizes(tournamentId);

        // 8 × 50 = 400 USDC, 8% rake = 32, player pool = 368
        uint256 playerPool = 400e6 - (400e6 * 800 / 10000);

        // 8-player table: 3 paid (55/30/15)
        address[] memory ranked = v4.getRankedPlayers(tournamentId);
        assertEq(ranked.length, 8);

        // First place
        uint256 firstPrize = usdc.balanceOf(ranked[0]) - _getBeforeBal(ranked[0], beforeBals, allAgents);
        assertEq(firstPrize, (playerPool * 5500) / 10000);
    }

    function test_v4_cannotDistributeTwice() public {
        uint256 tournamentId = _runFullTournament(4);

        vm.prank(authority);
        v4.distributePrizes(tournamentId);

        vm.prank(authority);
        vm.expectRevert("Already distributed");
        v4.distributePrizes(tournamentId);
    }

    // ================================================================
    //                    FINALIZATION TESTS
    // ================================================================

    function test_v4_finalizeSetsRankedPlayers() public {
        uint256 tournamentId = _runFullTournament(4);

        address[] memory ranked = v4.getRankedPlayers(tournamentId);
        assertEq(ranked.length, 4);
        assertEq(ranked[0], agent1); // 1st place
        assertEq(ranked[1], agent3); // 2nd place (white in game 2)
    }

    function test_v4_finalizeSetsRank() public {
        uint256 tournamentId = _runFullTournament(4);

        ChessBotsTournamentV4.Registration memory r1 = v4.getRegistration(tournamentId, agent1);
        assertEq(r1.finalRank, 1);

        // Ranked order: [agent1, agent3, agent2, agent4] — whites first then blacks
        ChessBotsTournamentV4.Registration memory r2 = v4.getRegistration(tournamentId, agent2);
        assertEq(r2.finalRank, 3);

        ChessBotsTournamentV4.Registration memory r4 = v4.getRegistration(tournamentId, agent4);
        assertEq(r4.finalRank, 4);
    }

    // ================================================================
    //                     HEARTBEAT TESTS
    // ================================================================

    function test_v4_heartbeat() public {
        _registerAgents(1);

        vm.prank(agent1);
        v4.heartbeat();

        assertEq(v4.lastHeartbeat(agent1), block.timestamp);
    }

    function test_v4_heartbeatOnlyRegistered() public {
        vm.prank(agent1);
        vm.expectRevert("Agent not registered");
        v4.heartbeat();
    }

    function test_v4_setHeartbeatWindow() public {
        vm.prank(authority);
        v4.setHeartbeatWindow(1 hours);
        assertEq(v4.heartbeatWindow(), 1 hours);
    }

    function test_v4_heartbeatWindowTooSmall() public {
        vm.prank(authority);
        vm.expectRevert("Invalid window");
        v4.setHeartbeatWindow(10 minutes);
    }

    // ================================================================
    //                     PAYOUT PREVIEW TESTS
    // ================================================================

    function test_v4_payoutPreview() public view {
        uint16[] memory preview = v4.getPayoutPreview(8);
        assertEq(preview.length, 3);
        assertEq(preview[0], 5500);

        preview = v4.getPayoutPreview(16);
        assertEq(preview.length, 5);

        preview = v4.getPayoutPreview(32);
        assertEq(preview.length, 8);

        preview = v4.getPayoutPreview(64);
        assertEq(preview.length, 12);
    }

    // ================================================================
    //                    BRACKET TESTS
    // ================================================================

    function test_v4_bracketOpenAcceptsAll() public {
        _registerAgents(4);
        uint256 tournamentId = _createBronzeTournament(4, 2);

        // Open bracket should accept anyone
        _registerForTournament(tournamentId, agent1);
        _registerForTournament(tournamentId, agent2);
    }

    function test_v4_cancelAndRefund() public {
        _registerAgents(4);
        uint256 tournamentId = _createBronzeTournament(8, 4);

        _registerForTournament(tournamentId, agent1);
        uint256 balBefore = usdc.balanceOf(agent1);

        vm.prank(authority);
        v4.cancelTournament(tournamentId);

        vm.prank(agent1);
        v4.claimRefund(tournamentId);

        assertEq(usdc.balanceOf(agent1), balBefore + 50e6);
    }

    // ================================================================
    //                  REVENUE ROUTER INTEGRATION
    // ================================================================

    function test_v4_revenueRoutedToRouter() public {
        ChessRevenueRouter router = new ChessRevenueRouter(address(usdc), treasury, authority);

        vm.prank(authority);
        v4.setRevenueRouter(address(router));

        uint256 tournamentId = _runFullTournament(4);

        vm.prank(authority);
        v4.distributePrizes(tournamentId);

        // Protocol fee should be in the revenue router now
        uint256 expectedFee = (200e6 * 800) / 10000; // 16 USDC
        assertEq(router.pendingRevenue(), expectedFee);
    }

    // ================================================================
    //                        HELPERS
    // ================================================================

    function _getBeforeBal(
        address agent,
        uint256[8] memory beforeBals,
        address[8] memory allAgents
    ) internal pure returns (uint256) {
        for (uint256 i = 0; i < 8; i++) {
            if (allAgents[i] == agent) return beforeBals[i];
        }
        return 0;
    }
}
