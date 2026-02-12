// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChessBotsTournament.sol";
import "../src/libraries/TournamentLib.sol";

contract MockUSDCSponsor {
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

contract SponsorshipTest is Test {
    ChessBotsTournament public tournament;
    MockUSDCSponsor public usdc;

    address authority = address(1);
    address treasury = address(2);
    address sponsor = address(20);
    address agent1 = address(10);
    address agent2 = address(11);
    address agent3 = address(12);
    address agent4 = address(13);

    function setUp() public {
        usdc = new MockUSDCSponsor();
        vm.prank(authority);
        tournament = new ChessBotsTournament(address(usdc), treasury, 1000, 9000, 1000);

        // Fund everyone
        usdc.mint(sponsor, 50000e6);
        usdc.mint(agent1, 1000e6);
        usdc.mint(agent2, 1000e6);
        usdc.mint(agent3, 1000e6);
        usdc.mint(agent4, 1000e6);

        // Approve
        vm.prank(sponsor); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(agent1); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(agent2); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(agent3); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(agent4); usdc.approve(address(tournament), type(uint256).max);
    }

    function _createBronzeTournament() internal returns (uint256) {
        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Bronze, 32, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );
        return 0;
    }

    // ── Basic Sponsorship ──────────────────────────────────────────────

    function test_sponsorTournament() public {
        _createBronzeTournament();

        uint256 sponsorBefore = usdc.balanceOf(sponsor);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 contractBefore = usdc.balanceOf(address(tournament));

        vm.prank(sponsor);
        tournament.sponsorTournament(0, 1000e6, "Acme Corp", "https://acme.com/logo.png");

        // Platform fee = 10% = 100 USDC to treasury
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, 100e6);

        // 90% = 900 USDC to contract (prize pool)
        assertEq(usdc.balanceOf(address(tournament)) - contractBefore, 900e6);

        // Sponsor paid 1000 USDC total
        assertEq(sponsorBefore - usdc.balanceOf(sponsor), 1000e6);
    }

    function test_sponsorMetadata() public {
        _createBronzeTournament();

        vm.prank(sponsor);
        tournament.sponsorTournament(0, 500e6, "ChessAI Labs", "https://chessai.labs/banner");

        ChessBotsTournament.Sponsorship memory sp = tournament.getSponsor(0);
        assertEq(sp.sponsor, sponsor);
        assertEq(sp.name, "ChessAI Labs");
        assertEq(sp.uri, "https://chessai.labs/banner");
        assertEq(sp.amount, 500e6);
    }

    function test_anyoneCanSponsor() public {
        _createBronzeTournament();

        // A random address (agent1) can sponsor
        vm.prank(agent1);
        tournament.sponsorTournament(0, 100e6, "Random Sponsor", "");

        ChessBotsTournament.Sponsorship memory sp = tournament.getSponsor(0);
        assertEq(sp.sponsor, agent1);
    }

    // ── Cannot Sponsor Invalid Tournaments ─────────────────────────────

    function test_cannotSponsorCancelledTournament() public {
        _createBronzeTournament();

        vm.prank(authority);
        tournament.cancelTournament(0);

        vm.prank(sponsor);
        vm.expectRevert("Tournament cancelled");
        tournament.sponsorTournament(0, 500e6, "Sponsor", "");
    }

    function test_cannotDoubleSponsor() public {
        _createBronzeTournament();

        vm.prank(sponsor);
        tournament.sponsorTournament(0, 500e6, "First Sponsor", "");

        vm.prank(sponsor);
        vm.expectRevert("Already sponsored");
        tournament.sponsorTournament(0, 200e6, "Second Sponsor", "");
    }

    function test_cannotSponsorZero() public {
        _createBronzeTournament();

        vm.prank(sponsor);
        vm.expectRevert("Zero amount");
        tournament.sponsorTournament(0, 0, "Sponsor", "");
    }

    // ── Platform Fee Math ──────────────────────────────────────────────

    function test_platformFeeExact10Percent() public {
        _createBronzeTournament();

        uint256 amounts_to_test = 777e6;
        uint256 expectedFee = (amounts_to_test * 1000) / 10000; // 10% = 77.7 USDC
        uint256 expectedPrize = amounts_to_test - expectedFee;

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 contractBefore = usdc.balanceOf(address(tournament));

        vm.prank(sponsor);
        tournament.sponsorTournament(0, amounts_to_test, "Sponsor", "");

        assertEq(usdc.balanceOf(treasury) - treasuryBefore, expectedFee);
        assertEq(usdc.balanceOf(address(tournament)) - contractBefore, expectedPrize);
    }

    // ── Full Lifecycle: Sponsor + Play + Distribute ────────────────────

    function test_sponsoredTournamentDistribution() public {
        _createBronzeTournament();

        // Register agents
        vm.prank(agent1); tournament.registerAgent("A1", "", TournamentLib.AgentType.Custom);
        vm.prank(agent2); tournament.registerAgent("A2", "", TournamentLib.AgentType.Custom);
        vm.prank(agent3); tournament.registerAgent("A3", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4); tournament.registerAgent("A4", "", TournamentLib.AgentType.Custom);

        // Register for tournament (4 × 50 = 200 USDC)
        vm.prank(agent1); tournament.registerForTournament(0);
        vm.prank(agent2); tournament.registerForTournament(0);
        vm.prank(agent3); tournament.registerForTournament(0);
        vm.prank(agent4); tournament.registerForTournament(0);

        // Sponsor adds 1000 USDC (900 to pool, 100 to treasury)
        vm.prank(sponsor);
        tournament.sponsorTournament(0, 1000e6, "Acme", "");

        // Total pool = 200 + 900 = 1100 USDC in contract
        assertEq(usdc.balanceOf(address(tournament)), 1100e6);

        // Play tournament
        vm.startPrank(authority);
        tournament.startTournament(0);

        // Round 1
        tournament.createGame(0, 1, 0, agent1, agent2);
        tournament.createGame(0, 1, 1, agent3, agent4);
        tournament.startGame(0, 1, 0);
        tournament.submitGameResult(0, 1, 0, TournamentLib.GameResult.WhiteWins, keccak256("r1g0"), bytes32(0), 20);
        tournament.startGame(0, 1, 1);
        tournament.submitGameResult(0, 1, 1, TournamentLib.GameResult.Draw, keccak256("r1g1"), bytes32(0), 30);

        tournament.updateStandings(0, agent1, 2, 0, 1, 1, 0, 0);
        tournament.updateStandings(0, agent2, 0, 0, 1, 0, 0, 1);
        tournament.updateStandings(0, agent3, 1, 0, 1, 0, 1, 0);
        tournament.updateStandings(0, agent4, 1, 0, 1, 0, 1, 0);

        tournament.advanceRound(0);

        // Round 2
        tournament.createGame(0, 2, 0, agent1, agent3);
        tournament.createGame(0, 2, 1, agent4, agent2);
        tournament.startGame(0, 2, 0);
        tournament.submitGameResult(0, 2, 0, TournamentLib.GameResult.WhiteWins, keccak256("r2g0"), bytes32(0), 25);
        tournament.startGame(0, 2, 1);
        tournament.submitGameResult(0, 2, 1, TournamentLib.GameResult.BlackWins, keccak256("r2g1"), bytes32(0), 35);

        tournament.updateStandings(0, agent1, 4, 1, 2, 2, 0, 0);
        tournament.updateStandings(0, agent2, 2, 1, 2, 1, 0, 1);
        tournament.updateStandings(0, agent3, 1, 4, 2, 0, 1, 1);
        tournament.updateStandings(0, agent4, 1, 0, 2, 0, 1, 1);

        tournament.finalizeTournament(0, [agent1, agent2, agent3], "ipfs://results");
        tournament.distributePrizes(0);
        vm.stopPrank();

        // Prizes come from 1100 USDC pool (200 entry + 900 sponsor)
        // Player prizes = 90% of 1100 = 990 USDC
        // Protocol fee = 10% of 1100 = 110 USDC
        // 1st = 70% of 990 = 693, 2nd = 20% of 990 = 198, 3rd = 10% of 990 = 99
        // Agent1 started with 950 (paid 50 entry) + 693 prize = 1643
        assertEq(usdc.balanceOf(agent1), 1643e6);
    }
}
