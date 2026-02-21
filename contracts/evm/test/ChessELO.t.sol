// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChessELO.sol";
import "../src/libraries/TournamentLibV4.sol";

contract ChessELOTest is Test {
    ChessELO public eloContract;

    address authority = address(1);
    address orchestrator = address(2);
    address agent1 = address(10);
    address agent2 = address(11);
    address agent3 = address(12);
    address agent4 = address(13);

    function setUp() public {
        vm.prank(authority);
        eloContract = new ChessELO();

        // Authorize the orchestrator as updater
        vm.prank(authority);
        eloContract.setAuthorizedUpdater(orchestrator, true);

        // Initialize agents
        vm.startPrank(orchestrator);
        eloContract.initializeAgent(agent1, 1200);
        eloContract.initializeAgent(agent2, 1200);
        eloContract.initializeAgent(agent3, 1500);
        eloContract.initializeAgent(agent4, 900);
        vm.stopPrank();
    }

    // ================================================================
    //                  INITIALIZATION TESTS
    // ================================================================

    function test_initializeAgent() public view {
        assertEq(eloContract.elo(agent1), 1200);
        assertEq(eloContract.tournamentCount(agent1), 0);
        assertTrue(eloContract.initialized(agent1));
        assertEq(uint8(eloContract.bracket(agent1)), uint8(TournamentLibV4.Bracket.Unrated));
    }

    function test_cannotInitializeTwice() public {
        vm.prank(orchestrator);
        vm.expectRevert("Already initialized");
        eloContract.initializeAgent(agent1, 1200);
    }

    function test_cannotInitializeUnauthorized() public {
        vm.prank(address(99));
        vm.expectRevert("Not authorized updater");
        eloContract.initializeAgent(address(50), 1200);
    }

    // ================================================================
    //                  RATING UPDATE TESTS
    // ================================================================

    function test_updateRatings_win() public {
        address[] memory players = new address[](1);
        address[] memory opponents = new address[](1);
        uint256[] memory results = new uint256[](1);

        players[0] = agent1;
        opponents[0] = agent2;
        results[0] = 1000; // win

        vm.prank(orchestrator);
        eloContract.updateRatings(1, players, opponents, results);

        // Equal ratings, K=40 (provisional), win → +20
        assertEq(eloContract.elo(agent1), 1220);
    }

    function test_updateRatings_loss() public {
        address[] memory players = new address[](1);
        address[] memory opponents = new address[](1);
        uint256[] memory results = new uint256[](1);

        players[0] = agent1;
        opponents[0] = agent2;
        results[0] = 0; // loss

        vm.prank(orchestrator);
        eloContract.updateRatings(1, players, opponents, results);

        assertEq(eloContract.elo(agent1), 1180);
    }

    function test_updateRatings_draw() public {
        address[] memory players = new address[](1);
        address[] memory opponents = new address[](1);
        uint256[] memory results = new uint256[](1);

        players[0] = agent1;
        opponents[0] = agent2;
        results[0] = 500; // draw

        vm.prank(orchestrator);
        eloContract.updateRatings(1, players, opponents, results);

        assertEq(eloContract.elo(agent1), 1200);
    }

    function test_updateRatings_batchFromTournament() public {
        // Simulate a 4-player tournament: 2 games
        // Game 1: agent1 beats agent2
        // Game 2: agent3 beats agent4
        address[] memory players = new address[](4);
        address[] memory opponents = new address[](4);
        uint256[] memory results = new uint256[](4);

        // Both perspectives for game 1
        players[0] = agent1; opponents[0] = agent2; results[0] = 1000; // agent1 wins
        players[1] = agent2; opponents[1] = agent1; results[1] = 0;    // agent2 loses

        // Both perspectives for game 2
        players[2] = agent3; opponents[2] = agent4; results[2] = 1000; // agent3 wins
        players[3] = agent4; opponents[3] = agent3; results[3] = 0;    // agent4 loses

        vm.prank(orchestrator);
        eloContract.updateRatings(1, players, opponents, results);

        // agent1: 1200 vs 1200, win → 1220
        assertEq(eloContract.elo(agent1), 1220);
        // agent2: 1200 vs 1220 (agent1 already updated), loss → 1183
        // (sequential update — agent1's new rating is used for agent2's calculation)
        assertEq(eloContract.elo(agent2), 1183);
        // agent3: 1500 vs 900, expected win → small gain
        assertTrue(eloContract.elo(agent3) > 1500);
        assertTrue(eloContract.elo(agent3) <= 1510);
        // agent4: 900 vs 1500, expected loss → small loss
        assertTrue(eloContract.elo(agent4) < 900);
    }

    function test_updateRatings_unauthorized() public {
        address[] memory players = new address[](1);
        address[] memory opponents = new address[](1);
        uint256[] memory results = new uint256[](1);

        players[0] = agent1;
        opponents[0] = agent2;
        results[0] = 1000;

        vm.prank(address(99));
        vm.expectRevert("Not authorized updater");
        eloContract.updateRatings(1, players, opponents, results);
    }

    function test_updateRatings_invalidResult() public {
        address[] memory players = new address[](1);
        address[] memory opponents = new address[](1);
        uint256[] memory results = new uint256[](1);

        players[0] = agent1;
        opponents[0] = agent2;
        results[0] = 750; // invalid

        vm.prank(orchestrator);
        vm.expectRevert("Invalid result");
        eloContract.updateRatings(1, players, opponents, results);
    }

    // ================================================================
    //                  BRACKET TESTS
    // ================================================================

    function test_bracketStaysUnratedUnder10Tournaments() public {
        // Play 9 tournaments — should stay Unrated
        for (uint16 i = 0; i < 9; i++) {
            address[] memory participants = new address[](1);
            participants[0] = agent1;

            vm.prank(orchestrator);
            eloContract.recordTournamentCompletion(participants);
        }

        assertEq(uint8(eloContract.bracket(agent1)), uint8(TournamentLibV4.Bracket.Unrated));
        assertEq(eloContract.tournamentCount(agent1), 9);
    }

    function test_bracketClassCAfter10Tournaments() public {
        // ELO stays at 1200 (ClassC range: < 1200)
        // First lower ELO below 1200
        _simulateLoss(agent1, agent3); // lose to higher rated player

        // Complete 10 tournaments
        address[] memory participants = new address[](1);
        participants[0] = agent1;
        for (uint16 i = 0; i < 10; i++) {
            vm.prank(orchestrator);
            eloContract.recordTournamentCompletion(participants);
        }

        assertEq(eloContract.tournamentCount(agent1), 10);
        // After 10 tournaments with ELO < 1200, should be ClassC
        assertEq(uint8(eloContract.bracket(agent1)), uint8(TournamentLibV4.Bracket.ClassC));
    }

    function test_bracketClassBForHigherRating() public {
        // Boost agent1's ELO above CLASS_C_MAX (1200) + BRACKET_BUFFER (25) = 1225
        _simulateMultipleWins(agent1, agent2, 5);

        // Complete 10 tournaments
        address[] memory participants = new address[](1);
        participants[0] = agent1;
        for (uint16 i = 0; i < 10; i++) {
            vm.prank(orchestrator);
            eloContract.recordTournamentCompletion(participants);
        }

        uint16 currentElo = eloContract.elo(agent1);
        assertTrue(currentElo > 1225, "ELO should be above ClassB threshold");
        assertEq(uint8(eloContract.bracket(agent1)), uint8(TournamentLibV4.Bracket.ClassB));
    }

    // ================================================================
    //                  ELIGIBILITY TESTS
    // ================================================================

    function test_eligibility_openAcceptsAll() public view {
        assertTrue(eloContract.isEligible(agent1, TournamentLibV4.Bracket.Open));
    }

    function test_eligibility_unratedCanEnterClassC() public view {
        // agent1 is Unrated
        assertTrue(eloContract.isEligible(agent1, TournamentLibV4.Bracket.ClassC));
        assertTrue(eloContract.isEligible(agent1, TournamentLibV4.Bracket.Unrated));
    }

    function test_eligibility_unratedCannotEnterClassB() public view {
        assertFalse(eloContract.isEligible(agent1, TournamentLibV4.Bracket.ClassB));
    }

    // ================================================================
    //                  VIEW FUNCTION TESTS
    // ================================================================

    function test_getProfile() public view {
        (uint16 rating, TournamentLibV4.Bracket agentBracket, uint16 tournaments, bool isInit) =
            eloContract.getProfile(agent1);

        assertEq(rating, 1200);
        assertEq(uint8(agentBracket), uint8(TournamentLibV4.Bracket.Unrated));
        assertEq(tournaments, 0);
        assertTrue(isInit);
    }

    function test_getELO() public view {
        assertEq(eloContract.getELO(agent1), 1200);
        assertEq(eloContract.getELO(agent3), 1500);
    }

    // ================================================================
    //                  AUTHORITY TESTS
    // ================================================================

    function test_authorityTransfer() public {
        address newAuth = address(55);

        vm.prank(authority);
        eloContract.proposeAuthority(newAuth);

        vm.prank(newAuth);
        eloContract.acceptAuthority();

        assertEq(eloContract.authority(), newAuth);
    }

    function test_setUpdater() public {
        address newUpdater = address(77);

        vm.prank(authority);
        eloContract.setAuthorizedUpdater(newUpdater, true);

        assertTrue(eloContract.authorizedUpdaters(newUpdater));

        vm.prank(authority);
        eloContract.setAuthorizedUpdater(newUpdater, false);

        assertFalse(eloContract.authorizedUpdaters(newUpdater));
    }

    // ================================================================
    //                        HELPERS
    // ================================================================

    function _simulateLoss(address player, address opponent) internal {
        address[] memory players = new address[](1);
        address[] memory opponents = new address[](1);
        uint256[] memory results = new uint256[](1);

        players[0] = player;
        opponents[0] = opponent;
        results[0] = 0; // loss

        vm.prank(orchestrator);
        eloContract.updateRatings(0, players, opponents, results);
    }

    function _simulateMultipleWins(address player, address opponent, uint8 count) internal {
        for (uint8 i = 0; i < count; i++) {
            address[] memory players = new address[](1);
            address[] memory opponents = new address[](1);
            uint256[] memory results = new uint256[](1);

            players[0] = player;
            opponents[0] = opponent;
            results[0] = 1000; // win

            vm.prank(orchestrator);
            eloContract.updateRatings(i, players, opponents, results);
        }
    }
}
