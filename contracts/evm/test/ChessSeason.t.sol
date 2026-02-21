// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChessSeason.sol";
import "../src/libraries/TournamentLibV4.sol";

contract ChessSeasonTest is Test {
    ChessSeason public season;

    address authority = address(1);
    address orchestrator = address(2);
    address agent1 = address(10);
    address agent2 = address(11);
    address agent3 = address(12);
    address agent4 = address(13);

    function setUp() public {
        vm.prank(authority);
        season = new ChessSeason();

        vm.prank(authority);
        season.setAuthorizedRecorder(orchestrator, true);
    }

    // ================================================================
    //                  SEASON LIFECYCLE TESTS
    // ================================================================

    function test_startSeason() public {
        vm.prank(authority);
        season.startSeason(0); // default 4 weeks

        (uint256 id, uint256 startTime, uint256 endTime, bool active) = season.getCurrentSeason();
        assertEq(id, 0);
        assertEq(startTime, block.timestamp);
        assertEq(endTime, block.timestamp + 4 weeks);
        assertTrue(active);
    }

    function test_startSeasonCustomDuration() public {
        vm.prank(authority);
        season.startSeason(2 weeks);

        (, , uint256 endTime, ) = season.getCurrentSeason();
        assertEq(endTime, block.timestamp + 2 weeks);
    }

    function test_cannotStartWhileActive() public {
        vm.prank(authority);
        season.startSeason(4 weeks);

        vm.prank(authority);
        vm.expectRevert("Current season still active");
        season.startSeason(4 weeks);
    }

    function test_canStartAfterExpiry() public {
        vm.prank(authority);
        season.startSeason(1 hours);

        // Fast forward past expiry
        vm.warp(block.timestamp + 2 hours);

        vm.prank(authority);
        season.startSeason(0);

        assertEq(season.totalSeasons(), 2);
        assertEq(season.currentSeasonId(), 1);
    }

    function test_endSeasonEarly() public {
        vm.prank(authority);
        season.startSeason(4 weeks);

        vm.prank(authority);
        season.endSeason();

        (, , uint256 endTime, bool active) = season.getCurrentSeason();
        assertEq(endTime, block.timestamp);
        assertFalse(active);
    }

    // ================================================================
    //                  POINT AWARD TESTS
    // ================================================================

    function test_recordTournamentResult() public {
        vm.prank(authority);
        season.startSeason(0);

        address[] memory agents = new address[](4);
        agents[0] = agent1; // 1st
        agents[1] = agent2; // 2nd
        agents[2] = agent3; // 3rd
        agents[3] = agent4; // 4th

        vm.prank(orchestrator);
        season.recordTournamentResult(0, 1, agents, TournamentLibV4.Tier.Bronze);

        // Bronze points: 1st=50, 2nd=35, 3rd=25, 4th-8th=15
        assertEq(season.getSeasonPoints(0, agent1), 50);
        assertEq(season.getSeasonPoints(0, agent2), 35);
        assertEq(season.getSeasonPoints(0, agent3), 25);
        assertEq(season.getSeasonPoints(0, agent4), 15);
    }

    function test_pointsAccumulateAcrossTournaments() public {
        vm.prank(authority);
        season.startSeason(0);

        // Tournament 1: agent1 wins
        address[] memory agents1 = new address[](2);
        agents1[0] = agent1;
        agents1[1] = agent2;

        vm.prank(orchestrator);
        season.recordTournamentResult(0, 1, agents1, TournamentLibV4.Tier.Bronze);

        // Tournament 2: agent1 wins again
        address[] memory agents2 = new address[](2);
        agents2[0] = agent1;
        agents2[1] = agent3;

        vm.prank(orchestrator);
        season.recordTournamentResult(0, 2, agents2, TournamentLibV4.Tier.Bronze);

        assertEq(season.getSeasonPoints(0, agent1), 100); // 50 + 50
        assertEq(season.getTournamentCount(0, agent1), 2);
    }

    function test_cannotRecordTwice() public {
        vm.prank(authority);
        season.startSeason(0);

        address[] memory agents = new address[](1);
        agents[0] = agent1;

        vm.prank(orchestrator);
        season.recordTournamentResult(0, 1, agents, TournamentLibV4.Tier.Bronze);

        vm.prank(orchestrator);
        vm.expectRevert("Already recorded");
        season.recordTournamentResult(0, 1, agents, TournamentLibV4.Tier.Bronze);
    }

    // ================================================================
    //                  TIER POINT TABLES
    // ================================================================

    function test_freePoints() public {
        vm.prank(authority);
        season.startSeason(0);

        address[] memory agents = new address[](4);
        agents[0] = agent1; agents[1] = agent2;
        agents[2] = agent3; agents[3] = agent4;

        vm.prank(orchestrator);
        season.recordTournamentResult(0, 1, agents, TournamentLibV4.Tier.Free);

        assertEq(season.getSeasonPoints(0, agent1), 10);
        assertEq(season.getSeasonPoints(0, agent2), 7);
        assertEq(season.getSeasonPoints(0, agent3), 5);
        assertEq(season.getSeasonPoints(0, agent4), 3);
    }

    function test_legendsPoints() public {
        vm.prank(authority);
        season.startSeason(0);

        address[] memory agents = new address[](3);
        agents[0] = agent1; agents[1] = agent2; agents[2] = agent3;

        vm.prank(orchestrator);
        season.recordTournamentResult(0, 1, agents, TournamentLibV4.Tier.Legends);

        assertEq(season.getSeasonPoints(0, agent1), 400);
        assertEq(season.getSeasonPoints(0, agent2), 280);
        assertEq(season.getSeasonPoints(0, agent3), 200);
    }

    // ================================================================
    //                  CONSISTENCY BONUS
    // ================================================================

    function test_consistencyBonus_noBonus() public {
        vm.prank(authority);
        season.startSeason(0);

        // Play 5 tournaments
        for (uint256 i = 0; i < 5; i++) {
            address[] memory agents = new address[](1);
            agents[0] = agent1;
            vm.prank(orchestrator);
            season.recordTournamentResult(0, i, agents, TournamentLibV4.Tier.Bronze);
        }

        // 5 tournaments × 50 points = 250 base, no bonus
        uint256 withBonus = season.getSeasonPointsWithBonus(0, agent1);
        assertEq(withBonus, 250); // 1.0x
    }

    function test_consistencyBonus_125x() public {
        vm.prank(authority);
        season.startSeason(0);

        // Play 10 tournaments
        for (uint256 i = 0; i < 10; i++) {
            address[] memory agents = new address[](1);
            agents[0] = agent1;
            vm.prank(orchestrator);
            season.recordTournamentResult(0, i, agents, TournamentLibV4.Tier.Bronze);
        }

        // 10 tournaments × 50 = 500 base, 1.25x = 625
        uint256 withBonus = season.getSeasonPointsWithBonus(0, agent1);
        assertEq(withBonus, 625);
    }

    function test_consistencyBonus_150x() public {
        vm.prank(authority);
        season.startSeason(0);

        // Play 20 tournaments
        for (uint256 i = 0; i < 20; i++) {
            address[] memory agents = new address[](1);
            agents[0] = agent1;
            vm.prank(orchestrator);
            season.recordTournamentResult(0, i, agents, TournamentLibV4.Tier.Bronze);
        }

        // 20 tournaments × 50 = 1000 base, 1.5x = 1500
        uint256 withBonus = season.getSeasonPointsWithBonus(0, agent1);
        assertEq(withBonus, 1500);
    }

    // ================================================================
    //                  AUTH TESTS
    // ================================================================

    function test_onlyAuthorizedCanRecord() public {
        vm.prank(authority);
        season.startSeason(0);

        address[] memory agents = new address[](1);
        agents[0] = agent1;

        vm.prank(address(99));
        vm.expectRevert("Not authorized");
        season.recordTournamentResult(0, 1, agents, TournamentLibV4.Tier.Bronze);
    }

    function test_consistencyMultiplierView() public view {
        assertEq(season.getConsistencyMultiplier(5), 10000);
        assertEq(season.getConsistencyMultiplier(10), 12500);
        assertEq(season.getConsistencyMultiplier(20), 15000);
    }
}
