// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChessBotsTournament.sol";
import "../src/interfaces/IChessBotsTournament.sol";
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

        // Fund agents generously for multi-tournament tests
        usdc.mint(referrer, 100000e6);
        usdc.mint(referee1, 100000e6);
        usdc.mint(referee2, 100000e6);
        usdc.mint(agent3, 100000e6);
        usdc.mint(agent4, 100000e6);

        // Approve
        vm.prank(referrer); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(referee1); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(referee2); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(agent3); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(agent4); usdc.approve(address(tournament), type(uint256).max);
    }

    // ── Helper: create a Rookie tournament ─────────────────────────────
    function _createRookieTournament(uint256 index) internal {
        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Rookie, 32, 4,
            int64(int256(block.timestamp + 7200 + index * 100)),
            int64(int256(block.timestamp + 3600 + index * 100)),
            300, 3
        );
    }

    // ── Helper: register N agents referred by referrer ──────────────────
    function _registerReferredAgents(uint256 count) internal {
        for (uint256 i = 0; i < count; i++) {
            address a = address(uint160(100 + i));
            usdc.mint(a, 100000e6);
            vm.prank(a);
            usdc.approve(address(tournament), type(uint256).max);
            vm.prank(a);
            tournament.registerAgentWithReferral(
                string(abi.encodePacked("Agent", vm.toString(i))),
                "",
                TournamentLib.AgentType.Custom,
                referrer
            );
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── Registration Tests ────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    function test_registerWithReferral() public {
        vm.prank(referrer);
        tournament.registerAgent("Referrer", "", TournamentLib.AgentType.Custom);

        vm.prank(referee1);
        tournament.registerAgentWithReferral("Referee1", "", TournamentLib.AgentType.Custom, referrer);

        // Check referredBy is set
        (,,,,,,,,,, address refBy,) = tournament.agents(referee1);
        assertEq(refBy, referrer);

        // Check tournaments remaining (V2: 25 instead of 10)
        assertEq(tournament.referralTournamentsRemaining(referee1), 25);
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
        vm.prank(referee1);
        vm.expectRevert("Referrer not registered");
        tournament.registerAgentWithReferral("Referee1", "", TournamentLib.AgentType.Custom, referrer);
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── Referral Count Tests ─────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    function test_referralCount_incrementsOnRegistration() public {
        vm.prank(referrer);
        tournament.registerAgent("Referrer", "", TournamentLib.AgentType.Custom);

        assertEq(tournament.referralCount(referrer), 0);

        vm.prank(referee1);
        tournament.registerAgentWithReferral("R1", "", TournamentLib.AgentType.Custom, referrer);
        assertEq(tournament.referralCount(referrer), 1);

        vm.prank(referee2);
        tournament.registerAgentWithReferral("R2", "", TournamentLib.AgentType.Custom, referrer);
        assertEq(tournament.referralCount(referrer), 2);
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── Bonus Accrual Tests ──────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    function test_referralBonusAccrual_bronzeTier() public {
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

        // referee1 registers — pays 1% less (referee discount), then 5% bonus at Bronze tier
        vm.prank(referee1);
        tournament.registerForTournament(0);

        // actualFee after 1% referee discount: 50e6 - (50e6 * 100 / 10000) = 50e6 - 0.5e6 = 49.5e6
        uint256 actualFee = 50e6 - (50e6 * 100) / 10000; // 49.5 USDC
        uint256 expectedBonus = (actualFee * 500) / 10000; // 5% of 49.5 = 2.475 USDC
        assertEq(tournament.referralEarnings(referrer), expectedBonus);
        assertEq(tournament.referralTournamentsRemaining(referee1), 24); // 25 - 1
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

        vm.prank(referee1);
        tournament.registerForTournament(0);

        assertEq(tournament.referralEarnings(referrer), 0);
    }

    function test_referralFullRateCapsAt25Tournaments() public {
        vm.prank(referrer);
        tournament.registerAgent("Referrer", "", TournamentLib.AgentType.Custom);
        vm.prank(referee1);
        tournament.registerAgentWithReferral("Referee1", "", TournamentLib.AgentType.Custom, referrer);
        vm.prank(agent3);
        tournament.registerAgent("Agent3", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4);
        tournament.registerAgent("Agent4", "", TournamentLib.AgentType.Custom);

        // Create 26 tournaments and register referee1 in all
        for (uint256 i = 0; i < 26; i++) {
            _createRookieTournament(i);
            vm.prank(referee1);
            tournament.registerForTournament(i);
        }

        // Rookie = 5 USDC, referee discount = 1% → actualFee = 4.95 USDC
        uint256 actualFee = 5e6 - (5e6 * 100) / 10000; // 4.95 USDC
        // 25 tournaments at Bronze tier (5%) + 1 at long-tail (2%)
        uint256 fullRateBonus = (actualFee * 500 / 10000) * 25; // 25 × 0.2475 USDC
        uint256 longTailBonus = (actualFee * 200 / 10000) * 1;  // 1 × 0.099 USDC
        uint256 expectedTotal = fullRateBonus + longTailBonus;
        assertEq(tournament.referralEarnings(referrer), expectedTotal);
        assertEq(tournament.referralTournamentsRemaining(referee1), 0);
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── Long-tail Tests ──────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    function test_longTail_2percentAfterCap() public {
        vm.prank(referrer);
        tournament.registerAgent("Referrer", "", TournamentLib.AgentType.Custom);
        vm.prank(referee1);
        tournament.registerAgentWithReferral("Referee1", "", TournamentLib.AgentType.Custom, referrer);
        vm.prank(agent3);
        tournament.registerAgent("Agent3", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4);
        tournament.registerAgent("Agent4", "", TournamentLib.AgentType.Custom);

        // Exhaust full-rate period: 25 tournaments
        for (uint256 i = 0; i < 25; i++) {
            _createRookieTournament(i);
            vm.prank(referee1);
            tournament.registerForTournament(i);
        }

        uint256 earningsAfterFullRate = tournament.referralEarnings(referrer);
        assertEq(tournament.referralTournamentsRemaining(referee1), 0);

        // Tournament 26 should accrue at 2% long-tail rate
        _createRookieTournament(25);
        vm.prank(referee1);
        tournament.registerForTournament(25);

        uint256 actualFee = 5e6 - (5e6 * 100) / 10000; // 4.95 USDC (with referee discount)
        uint256 longTailBonus = (actualFee * 200) / 10000; // 2% = 0.099 USDC
        assertEq(tournament.referralEarnings(referrer), earningsAfterFullRate + longTailBonus);
    }

    function test_longTail_continuesForever() public {
        vm.prank(referrer);
        tournament.registerAgent("Referrer", "", TournamentLib.AgentType.Custom);
        vm.prank(referee1);
        tournament.registerAgentWithReferral("Referee1", "", TournamentLib.AgentType.Custom, referrer);
        vm.prank(agent3);
        tournament.registerAgent("Agent3", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4);
        tournament.registerAgent("Agent4", "", TournamentLib.AgentType.Custom);

        // Exhaust full-rate: 25 tournaments
        for (uint256 i = 0; i < 25; i++) {
            _createRookieTournament(i);
            vm.prank(referee1);
            tournament.registerForTournament(i);
        }

        uint256 earningsAfterFullRate = tournament.referralEarnings(referrer);

        // Play 25 more (tournaments 25-49) — all at 2% long-tail
        for (uint256 i = 25; i < 50; i++) {
            _createRookieTournament(i);
            vm.prank(referee1);
            tournament.registerForTournament(i);
        }

        uint256 actualFee = 5e6 - (5e6 * 100) / 10000;
        uint256 longTailPer = (actualFee * 200) / 10000; // 2%
        uint256 expectedLongTail = longTailPer * 25; // 25 long-tail tournaments
        assertEq(tournament.referralEarnings(referrer), earningsAfterFullRate + expectedLongTail);
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── Referee Discount Tests ──────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    function test_refereeDiscount_reducesActualFee() public {
        vm.prank(referrer);
        tournament.registerAgent("Referrer", "", TournamentLib.AgentType.Custom);
        vm.prank(referee1);
        tournament.registerAgentWithReferral("Referee1", "", TournamentLib.AgentType.Custom, referrer);
        vm.prank(agent3);
        tournament.registerAgent("Agent3", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4);
        tournament.registerAgent("Agent4", "", TournamentLib.AgentType.Custom);

        // Create Bronze tournament (50 USDC)
        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Bronze, 32, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );

        uint256 referee1Before = usdc.balanceOf(referee1);

        vm.prank(referee1);
        tournament.registerForTournament(0);

        // Referee pays 1% less: 50 USDC - 0.5 USDC = 49.5 USDC
        uint256 expectedPayment = 50e6 - (50e6 * 100) / 10000; // 49.5 USDC
        assertEq(referee1Before - usdc.balanceOf(referee1), expectedPayment);
        assertEq(tournament.playerPayment(0, referee1), expectedPayment);
    }

    function test_refereeDiscount_notApplied_withoutReferrer() public {
        vm.prank(agent3);
        tournament.registerAgent("Agent3", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4);
        tournament.registerAgent("Agent4", "", TournamentLib.AgentType.Custom);
        vm.prank(referee1);
        tournament.registerAgent("Referee1NoRef", "", TournamentLib.AgentType.Custom);
        vm.prank(referrer);
        tournament.registerAgent("Referrer", "", TournamentLib.AgentType.Custom);

        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Bronze, 32, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );

        uint256 agent3Before = usdc.balanceOf(agent3);

        vm.prank(agent3);
        tournament.registerForTournament(0);

        // Non-referred agent pays full 50 USDC
        assertEq(agent3Before - usdc.balanceOf(agent3), 50e6);
        assertEq(tournament.playerPayment(0, agent3), 50e6);
    }

    function test_refereeDiscount_appliesEveryTournament() public {
        vm.prank(referrer);
        tournament.registerAgent("Referrer", "", TournamentLib.AgentType.Custom);
        vm.prank(referee1);
        tournament.registerAgentWithReferral("Referee1", "", TournamentLib.AgentType.Custom, referrer);
        vm.prank(agent3);
        tournament.registerAgent("Agent3", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4);
        tournament.registerAgent("Agent4", "", TournamentLib.AgentType.Custom);

        // Create 30 tournaments (beyond the 25 full-rate cap)
        for (uint256 i = 0; i < 30; i++) {
            _createRookieTournament(i);
        }

        uint256 totalPaid = 0;
        uint256 expectedFee = 5e6 - (5e6 * 100) / 10000; // 4.95 USDC per tournament

        for (uint256 i = 0; i < 30; i++) {
            uint256 before = usdc.balanceOf(referee1);
            vm.prank(referee1);
            tournament.registerForTournament(i);
            uint256 paid = before - usdc.balanceOf(referee1);
            assertEq(paid, expectedFee, "Referee discount should apply to every tournament");
            totalPaid += paid;
        }

        // Total paid should be 30 × 4.95 USDC
        assertEq(totalPaid, expectedFee * 30);
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── Tier Tests ──────────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    function test_tierBronze_defaultRate() public {
        vm.prank(referrer);
        tournament.registerAgent("Referrer", "", TournamentLib.AgentType.Custom);

        // 0 referrals = Bronze tier
        (uint8 tier, uint16 rateBps, uint16 count) = tournament.getReferrerTier(referrer);
        assertEq(tier, 0);
        assertEq(rateBps, 500); // 5%
        assertEq(count, 0);

        // Refer 5 agents — still Bronze
        _registerReferredAgents(5);
        (tier, rateBps, count) = tournament.getReferrerTier(referrer);
        assertEq(tier, 0);
        assertEq(rateBps, 500);
        assertEq(count, 5);
    }

    function test_tierSilver_after10Referrals() public {
        vm.prank(referrer);
        tournament.registerAgent("Referrer", "", TournamentLib.AgentType.Custom);

        // Refer 10 agents → Silver
        _registerReferredAgents(10);

        (uint8 tier, uint16 rateBps, uint16 count) = tournament.getReferrerTier(referrer);
        assertEq(tier, 1);
        assertEq(rateBps, 700); // 7%
        assertEq(count, 10);
    }

    function test_tierGold_after25Referrals() public {
        vm.prank(referrer);
        tournament.registerAgent("Referrer", "", TournamentLib.AgentType.Custom);

        // Refer 25 agents → Gold
        _registerReferredAgents(25);

        (uint8 tier, uint16 rateBps, uint16 count) = tournament.getReferrerTier(referrer);
        assertEq(tier, 2);
        assertEq(rateBps, 1000); // 10%
        assertEq(count, 25);
    }

    function test_tierUpgrade_emitsEvent() public {
        vm.prank(referrer);
        tournament.registerAgent("Referrer", "", TournamentLib.AgentType.Custom);

        // Register 9 agents (no event yet)
        _registerReferredAgents(9);

        // 10th agent → Silver tier event
        address tenthAgent = address(uint160(200));
        usdc.mint(tenthAgent, 100000e6);
        vm.prank(tenthAgent);
        usdc.approve(address(tournament), type(uint256).max);

        vm.expectEmit(true, false, false, true);
        emit IChessBotsTournament.ReferralTierChanged(referrer, 1, 700);
        vm.prank(tenthAgent);
        tournament.registerAgentWithReferral("Tenth", "", TournamentLib.AgentType.Custom, referrer);

        // Register agents 11-24 (no event)
        for (uint256 i = 0; i < 14; i++) {
            address a = address(uint160(300 + i));
            usdc.mint(a, 100000e6);
            vm.prank(a);
            usdc.approve(address(tournament), type(uint256).max);
            vm.prank(a);
            tournament.registerAgentWithReferral(
                string(abi.encodePacked("Fill", vm.toString(i))),
                "",
                TournamentLib.AgentType.Custom,
                referrer
            );
        }

        // 25th agent → Gold tier event
        address twentyFifth = address(uint160(500));
        usdc.mint(twentyFifth, 100000e6);
        vm.prank(twentyFifth);
        usdc.approve(address(tournament), type(uint256).max);

        vm.expectEmit(true, false, false, true);
        emit IChessBotsTournament.ReferralTierChanged(referrer, 2, 1000);
        vm.prank(twentyFifth);
        tournament.registerAgentWithReferral("TwentyFifth", "", TournamentLib.AgentType.Custom, referrer);
    }

    function test_silverTier_7percentBonus() public {
        vm.prank(referrer);
        tournament.registerAgent("Referrer", "", TournamentLib.AgentType.Custom);

        // Refer 10 agents to reach Silver tier
        _registerReferredAgents(10);

        // Now referee1 registers with this referrer
        vm.prank(referee1);
        tournament.registerAgentWithReferral("Referee1", "", TournamentLib.AgentType.Custom, referrer);

        // Create Bronze tournament
        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Bronze, 32, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );

        uint256 earningsBefore = tournament.referralEarnings(referrer);

        vm.prank(referee1);
        tournament.registerForTournament(0);

        // actualFee = 50 USDC - 1% referee discount = 49.5 USDC
        // Silver tier bonus = 7% of 49.5 = 3.465 USDC
        uint256 actualFee = 50e6 - (50e6 * 100) / 10000;
        uint256 expectedBonus = (actualFee * 700) / 10000;
        assertEq(tournament.referralEarnings(referrer) - earningsBefore, expectedBonus);
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── Claim Earnings Tests ─────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

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

    // ══════════════════════════════════════════════════════════════════════
    // ── Prize Distribution Integration ──────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    function test_referralDeductedFromProtocolFee() public {
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

        // Contract should hold referral funds
        assertTrue(usdc.balanceOf(address(tournament)) >= referralBonus, "Contract holds referral funds");
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── Protocol Fee Solvency Test ──────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    function test_protocolFeeSolvency_maxTier() public {
        // Scenario: Gold tier referrer (10%) with all 16 referred players in a tournament.
        // Protocol fee is 10%. With referee discounts (1%) reducing the pool,
        // the referral bonuses should still fit within protocol fee.

        vm.prank(referrer);
        tournament.registerAgent("GoldReferrer", "", TournamentLib.AgentType.Custom);

        // Register 25 agents to reach Gold tier
        _registerReferredAgents(25);

        (uint8 tier,,) = tournament.getReferrerTier(referrer);
        assertEq(tier, 2, "Should be Gold tier");

        // Create a Rookie tournament with 4 players (all referred by same Gold referrer)
        // Use 4 of the referred agents
        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Rookie, 32, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );

        // Register 4 referred agents
        for (uint256 i = 0; i < 4; i++) {
            address a = address(uint160(100 + i));
            vm.prank(a);
            tournament.registerForTournament(0);
        }

        // Verify: referral bonuses should not exceed protocol fee
        uint256 totalPool = tournament.tournamentCollected(0);
        uint256 referralTotal = tournament.tournamentReferralBonuses(0);

        // Protocol fee = 10% of pool
        uint256 protocolFee = (totalPool * 1000) / 10000;

        // Referral bonuses should be <= protocol fee
        assertTrue(referralTotal <= protocolFee, "Referral total must not exceed protocol fee");

        // Verify exact math:
        // Each player pays: 5 USDC - 1% = 4.95 USDC
        // Pool = 4 × 4.95 = 19.8 USDC
        // Protocol fee = 10% of 19.8 = 1.98 USDC
        // Each referral bonus = 10% of 4.95 = 0.495 USDC
        // Total referral = 4 × 0.495 = 1.98 USDC
        // Referral == protocolFee (edge case but valid, protocol gets 0)
        assertEq(referralTotal, protocolFee, "At max tier with all referred players, referral equals protocol fee");
    }

    // ══════════════════════════════════════════════════════════════════════
    // ── Free Tier: No Referral ───────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

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
        assertEq(tournament.referralTournamentsRemaining(referee1), 25);
    }
}
