// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChessSatellite.sol";
import "../src/libraries/TournamentLibV4.sol";

contract ChessSatelliteTest is Test {
    ChessSatellite public satellite;

    address authority = address(1);
    address orchestrator = address(2);
    address agent1 = address(10);
    address agent2 = address(11);
    address agent3 = address(12);

    function setUp() public {
        vm.prank(authority);
        satellite = new ChessSatellite();

        vm.prank(authority);
        satellite.setAuthorizedManager(orchestrator, true);
    }

    function test_createSatellite() public {
        vm.prank(orchestrator);
        uint256 id = satellite.createSatellite(5, TournamentLibV4.Tier.Silver, 3);

        assertEq(id, 0);
        ChessSatellite.Satellite memory s = satellite.getSatellite(0);
        assertEq(s.targetTournamentId, 5);
        assertEq(uint8(s.targetTier), uint8(TournamentLibV4.Tier.Silver));
        assertEq(s.seatsAwarded, 3);
        assertTrue(s.exists);
    }

    function test_issueTickets() public {
        vm.prank(orchestrator);
        satellite.createSatellite(5, TournamentLibV4.Tier.Silver, 3);

        address[] memory winners = new address[](2);
        winners[0] = agent1;
        winners[1] = agent2;

        vm.prank(orchestrator);
        satellite.issueTickets(0, winners);

        assertTrue(satellite.hasValidTicket(agent1, 5));
        assertTrue(satellite.hasValidTicket(agent2, 5));
        assertFalse(satellite.hasValidTicket(agent3, 5));
    }

    function test_cannotIssueTooManyTickets() public {
        vm.prank(orchestrator);
        satellite.createSatellite(5, TournamentLibV4.Tier.Silver, 1);

        address[] memory winners = new address[](2);
        winners[0] = agent1;
        winners[1] = agent2;

        vm.prank(orchestrator);
        vm.expectRevert("Too many winners");
        satellite.issueTickets(0, winners);
    }

    function test_useTicket() public {
        vm.prank(orchestrator);
        satellite.createSatellite(5, TournamentLibV4.Tier.Silver, 2);

        address[] memory winners = new address[](1);
        winners[0] = agent1;

        vm.prank(orchestrator);
        satellite.issueTickets(0, winners);

        assertTrue(satellite.hasValidTicket(agent1, 5));

        vm.prank(orchestrator);
        satellite.useTicketForSatellite(0, agent1);

        assertFalse(satellite.hasValidTicket(agent1, 5));

        ChessSatellite.Ticket memory t = satellite.getTicket(0, agent1);
        assertTrue(t.used);
    }

    function test_ticketExpiry() public {
        vm.prank(orchestrator);
        satellite.createSatellite(5, TournamentLibV4.Tier.Silver, 1);

        address[] memory winners = new address[](1);
        winners[0] = agent1;

        vm.prank(orchestrator);
        satellite.issueTickets(0, winners);

        // Fast forward past expiry
        vm.warp(block.timestamp + 8 days);

        vm.prank(orchestrator);
        vm.expectRevert("Ticket expired");
        satellite.useTicketForSatellite(0, agent1);
    }

    function test_cannotDoubleUseTicket() public {
        vm.prank(orchestrator);
        satellite.createSatellite(5, TournamentLibV4.Tier.Silver, 1);

        address[] memory winners = new address[](1);
        winners[0] = agent1;

        vm.prank(orchestrator);
        satellite.issueTickets(0, winners);

        vm.prank(orchestrator);
        satellite.useTicketForSatellite(0, agent1);

        vm.prank(orchestrator);
        vm.expectRevert("Already used");
        satellite.useTicketForSatellite(0, agent1);
    }

    function test_onlyAuthorizedCanCreate() public {
        vm.prank(address(99));
        vm.expectRevert("Not authorized");
        satellite.createSatellite(5, TournamentLibV4.Tier.Silver, 1);
    }

    function test_multipleSatellites() public {
        vm.startPrank(orchestrator);
        satellite.createSatellite(5, TournamentLibV4.Tier.Silver, 2);
        satellite.createSatellite(10, TournamentLibV4.Tier.Masters, 1);
        vm.stopPrank();

        assertEq(satellite.totalSatellites(), 2);
    }
}
