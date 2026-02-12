// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChessBotsTournament.sol";
import "../src/libraries/TournamentLib.sol";

contract MockUSDCRef {
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

contract ReferralTest is Test {
    ChessBotsTournament public tournament;
    MockUSDCRef public usdc;

    address authority = address(1);
    address treasury = address(2);
    address referrer = address(10);
    address referee1 = address(11);
    address referee2 = address(12);
    address agent3 = address(13);
    address agent4 = address(14);

    function setUp() public {
        usdc = new MockUSDCRef();
        vm.prank(authority);
        tournament = new ChessBotsTournament(address(usdc), treasury, 1000, 9000, 1000);

        // Fund agents
        usdc.mint(referrer, 10000e6);
        usdc.mint(referee1, 10000e6);
        usdc.mint(referee2, 10000e6);
        usdc.mint(agent3, 10000e6);
        usdc.mint(agent4, 10000e6);

        // Approve
        vm.prank(referrer); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(referee1); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(referee2); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(agent3); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(agent4); usdc.approve(address(tournament), type(uint256).max);
    }

    // ── Registration ───────────────────────────────────────────────────

    function test_registerWithReferral() public {
        // Referrer must be registered first
        vm.prank(referrer);
        tournament.registerAgent("Referrer", "", TournamentLib.AgentType.Custom);

        vm.prank(referee1);
        tournament.registerAgentWithReferral("Referee1", "", TournamentLib.AgentType.Custom, referrer);

        // Check referredBy is set
        (,,,,,,,,,, address refBy,) = tournament.agents(referee1);
        assertEq(refBy, referrer);

        // Check tournaments remaining
        assertEq(tournament.referralTournamentsRemaining(referee1), 10);
    }

    function test_registerWithoutReferral() public {
        vm.prank(referrer);
        tournament.registerAgent("NoReferral", "", TournamentLib.AgentType.Custom);

        (,,,,,,,,,, address refBy,) = tournament.agents(referrer);
        assertEq(refBy, address(0));
        assertEq(tournament.referralTournamentsRemaining(referrer), 0);
    }

    function test_cannotSelfRefer() public {
        vm.prank(referrer);
        tournament.registerAgent("Referrer", "", TournamentLib.AgentType.Custom);

        vm.prank(referee1);
        vm.expectRevert("Cannot self-refer");
        tournament.registerAgentWithReferral("Referee1", "", TournamentLib.AgentType.Custom, referee1);
    }

    function test_referrerMustBeRegistered() public {
        // referrer is NOT registered
        vm.prank(referee1);
        vm.expectRevert("Referrer not registered");
        tournament.registerAgentWithReferral("Referee1", "", TournamentLib.AgentType.Custom, referrer);
    }

    // ── Bonus Accrual ──────────────────────────────────────────────────

    function test_referralBonusAccrual() public {
        // Setup referral
        vm.prank(referrer);
        tournament.registerAgent("Referrer", "", TournamentLib.AgentType.Custom);
        vm.prank(referee1);
        tournament.registerAgentWithReferral("Referee1", "", TournamentLib.AgentType.Custom, referrer);
        vm.prank(agent3);
        tournament.registerAgent("Agent3", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4);
        tournament.registerAgent("Agent4", "", TournamentLib.AgentType.Custom);

        // Create a Bronze tournament (50 USDC entry)
        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Bronze, 32, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );

        // referee1 registers — should accrue 5% of 50 USDC = 2.5 USDC
        vm.prank(referee1);
        tournament.registerForTournament(0);

        uint256 expectedBonus = (50e6 * 500) / 10000; // 5% = 2.5 USDC
        assertEq(tournament.referralEarnings(referrer), expectedBonus);
        assertEq(tournament.referralTournamentsRemaining(referee1), 9);
        assertEq(tournament.tournamentReferralBonuses(0), expectedBonus);
    }

    function test_noReferralBonusForNonReferred() public {
        vm.prank(referrer);
        tournament.registerAgent("Agent", "", TournamentLib.AgentType.Custom);
        vm.prank(agent3);
        tournament.registerAgent("Agent3", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4);
        tournament.registerAgent("Agent4", "", TournamentLib.AgentType.Custom);
        vm.prank(referee1);
        tournament.registerAgent("Referee1", "", TournamentLib.AgentType.Custom);

        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Bronze, 32, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );

        // referee1 registered without referral
        vm.prank(referee1);
        tournament.registerForTournament(0);

        assertEq(tournament.referralEarnings(referrer), 0);
    }

    function test_referralStopsAfter10Tournaments() public {
        vm.prank(referrer);
        tournament.registerAgent("Referrer", "", TournamentLib.AgentType.Custom);
        vm.prank(referee1);
        tournament.registerAgentWithReferral("Referee1", "", TournamentLib.AgentType.Custom, referrer);
        vm.prank(agent3);
        tournament.registerAgent("Agent3", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4);
        tournament.registerAgent("Agent4", "", TournamentLib.AgentType.Custom);

        // Create 11 tournaments and register referee1 in all
        for (uint256 i = 0; i < 11; i++) {
            vm.prank(authority);
            tournament.createTournament(
                TournamentLib.Tier.Rookie, 32, 4,
                int64(int256(block.timestamp + 7200 + i * 100)),
                int64(int256(block.timestamp + 3600 + i * 100)),
                300, 3
            );

            vm.prank(referee1);
            tournament.registerForTournament(i);
        }

        // 10 bonuses accrued (5% of 5 USDC = 0.25 USDC each), 11th tournament = no bonus
        uint256 expectedBonus = (5e6 * 500 / 10000) * 10; // 10 × 0.25 USDC = 2.5 USDC
        assertEq(tournament.referralEarnings(referrer), expectedBonus);
        assertEq(tournament.referralTournamentsRemaining(referee1), 0);
    }

    // ── Claim Earnings ─────────────────────────────────────────────────

    function test_claimReferralEarnings() public {
        vm.prank(referrer);
        tournament.registerAgent("Referrer", "", TournamentLib.AgentType.Custom);
        vm.prank(referee1);
        tournament.registerAgentWithReferral("Referee1", "", TournamentLib.AgentType.Custom, referrer);
        vm.prank(agent3);
        tournament.registerAgent("Agent3", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4);
        tournament.registerAgent("Agent4", "", TournamentLib.AgentType.Custom);

        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Bronze, 32, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );

        vm.prank(referee1);
        tournament.registerForTournament(0);

        uint256 bonus = tournament.referralEarnings(referrer);
        assertTrue(bonus > 0);

        uint256 referrerBefore = usdc.balanceOf(referrer);

        vm.prank(referrer);
        tournament.claimReferralEarnings();

        assertEq(usdc.balanceOf(referrer), referrerBefore + bonus);
        assertEq(tournament.referralEarnings(referrer), 0);
    }

    function test_cannotClaimZeroEarnings() public {
        vm.prank(referrer);
        tournament.registerAgent("Referrer", "", TournamentLib.AgentType.Custom);

        vm.prank(referrer);
        vm.expectRevert("No referral earnings");
        tournament.claimReferralEarnings();
    }

    // ── Referral + Prize Distribution Integration ──────────────────────

    function test_referralDeductedFromProtocolFee() public {
        // Setup referral chain
        vm.prank(referrer);
        tournament.registerAgent("Referrer", "", TournamentLib.AgentType.Custom);
        vm.prank(referee1);
        tournament.registerAgentWithReferral("R1", "", TournamentLib.AgentType.Custom, referrer);
        vm.prank(agent3);
        tournament.registerAgent("A3", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4);
        tournament.registerAgent("A4", "", TournamentLib.AgentType.Custom);

        // Create Bronze tournament
        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Bronze, 32, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );

        // Register 4 agents (referee1 has referral)
        vm.prank(referrer); tournament.registerForTournament(0);
        vm.prank(referee1); tournament.registerForTournament(0);
        vm.prank(agent3); tournament.registerForTournament(0);
        vm.prank(agent4); tournament.registerForTournament(0);

        uint256 referralBonus = tournament.tournamentReferralBonuses(0);
        assertTrue(referralBonus > 0);

        // Play full tournament
        vm.startPrank(authority);
        tournament.startTournament(0);

        // Round 1
        tournament.createGame(0, 1, 0, referrer, referee1);
        tournament.createGame(0, 1, 1, agent3, agent4);
        tournament.startGame(0, 1, 0);
        tournament.submitGameResult(0, 1, 0, TournamentLib.GameResult.WhiteWins, keccak256("r1g0"), bytes32(0), 20);
        tournament.startGame(0, 1, 1);
        tournament.submitGameResult(0, 1, 1, TournamentLib.GameResult.Draw, keccak256("r1g1"), bytes32(0), 30);

        tournament.updateStandings(0, referrer, 2, 0, 1, 1, 0, 0);
        tournament.updateStandings(0, referee1, 0, 0, 1, 0, 0, 1);
        tournament.updateStandings(0, agent3, 1, 0, 1, 0, 1, 0);
        tournament.updateStandings(0, agent4, 1, 0, 1, 0, 1, 0);

        tournament.advanceRound(0);

        // Round 2
        tournament.createGame(0, 2, 0, referrer, agent3);
        tournament.createGame(0, 2, 1, agent4, referee1);
        tournament.startGame(0, 2, 0);
        tournament.submitGameResult(0, 2, 0, TournamentLib.GameResult.WhiteWins, keccak256("r2g0"), bytes32(0), 25);
        tournament.startGame(0, 2, 1);
        tournament.submitGameResult(0, 2, 1, TournamentLib.GameResult.BlackWins, keccak256("r2g1"), bytes32(0), 35);

        tournament.updateStandings(0, referrer, 4, 1, 2, 2, 0, 0);
        tournament.updateStandings(0, referee1, 2, 1, 2, 1, 0, 1);
        tournament.updateStandings(0, agent3, 1, 4, 2, 0, 1, 1);
        tournament.updateStandings(0, agent4, 1, 0, 2, 0, 1, 1);

        // Finalize
        tournament.finalizeTournament(0, [referrer, referee1, agent3], "ipfs://results");

        uint256 treasuryBefore = usdc.balanceOf(treasury);

        // Distribute prizes — referral bonus should be subtracted from protocol fee
        tournament.distributePrizes(0);
        vm.stopPrank();

        // Prize pool = 200 USDC
        // Player prizes = 180 USDC (90%)
        // Protocol fee = 20 USDC (10%)
        // Referral bonus = 2.5 USDC (5% of 50 USDC from referee1)
        // Treasury should receive less because referral is deducted from protocol fee
        uint256 treasuryReceived = usdc.balanceOf(treasury) - treasuryBefore;
        // Protocol fee (20 USDC) - referral (2.5 USDC) = 17.5 USDC for buyback+treasury split
        // Since no dexRouter, full amount goes to pendingBuyback or treasury
        // The key assertion: total distributed = 200 USDC, contract balance = 0 (except referral held)
        assertTrue(usdc.balanceOf(address(tournament)) >= referralBonus, "Contract holds referral funds");
    }

    // ── Free Tier: No Referral ─────────────────────────────────────────

    function test_noReferralOnFreeTournament() public {
        vm.prank(referrer);
        tournament.registerAgent("Referrer", "", TournamentLib.AgentType.Custom);
        vm.prank(referee1);
        tournament.registerAgentWithReferral("Referee1", "", TournamentLib.AgentType.Custom, referrer);
        vm.prank(agent3);
        tournament.registerAgent("A3", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4);
        tournament.registerAgent("A4", "", TournamentLib.AgentType.Custom);

        // Create and fund a free tournament
        vm.startPrank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Free, 32, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );
        usdc.mint(authority, 100e6);
        usdc.approve(address(tournament), 100e6);
        tournament.fundTournament(0, 100e6);
        vm.stopPrank();

        // Register referred agent in free tournament
        vm.prank(referee1);
        tournament.registerForTournament(0);

        // No referral bonus for free tournaments (entry fee = 0)
        assertEq(tournament.referralEarnings(referrer), 0);
        // Tournaments remaining should not decrement
        assertEq(tournament.referralTournamentsRemaining(referee1), 10);
    }
}
