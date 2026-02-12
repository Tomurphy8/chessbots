// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChessBotsTournament.sol";
import "../src/ChessToken.sol";
import "../src/ChessStaking.sol";
import "../src/libraries/TournamentLib.sol";

contract DiscountUSDC {
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

contract FeeDiscountTest is Test {
    ChessBotsTournament public tournament;
    DiscountUSDC public usdc;
    ChessToken public chess;
    ChessStaking public staking;

    address authority = address(1);
    address treasury = address(2);
    address agent1 = address(10); // Will stake 100K CHESS (8% discount)
    address agent2 = address(11); // Will stake 10K CHESS (2% discount)
    address agent3 = address(12); // No stake (0% discount)
    address agent4 = address(13); // No stake (0% discount)

    function setUp() public {
        usdc = new DiscountUSDC();
        chess = new ChessToken(address(this));
        staking = new ChessStaking(address(chess));

        // SC-C1: Constructor now takes all protocol params
        vm.prank(authority);
        tournament = new ChessBotsTournament(address(usdc), treasury, 1000, 9000, 1000);

        // Configure staking
        vm.prank(authority);
        tournament.setStakingContract(address(staking));

        // Distribute CHESS tokens and set up staking
        chess.transfer(agent1, 100_000e18);
        chess.transfer(agent2, 10_000e18);

        vm.prank(agent1);
        chess.approve(address(staking), type(uint256).max);
        vm.prank(agent1);
        staking.stake(100_000e18); // 8% discount

        vm.prank(agent2);
        chess.approve(address(staking), type(uint256).max);
        vm.prank(agent2);
        staking.stake(10_000e18); // 2% discount

        // Fund agents with USDC
        usdc.mint(agent1, 10_000e6);
        usdc.mint(agent2, 10_000e6);
        usdc.mint(agent3, 10_000e6);
        usdc.mint(agent4, 10_000e6);

        vm.prank(agent1); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(agent2); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(agent3); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(agent4); usdc.approve(address(tournament), type(uint256).max);

        // Register agents
        vm.prank(agent1); tournament.registerAgent("Staker100K", "", TournamentLib.AgentType.Custom);
        vm.prank(agent2); tournament.registerAgent("Staker10K", "", TournamentLib.AgentType.Custom);
        vm.prank(agent3); tournament.registerAgent("NoStake1", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4); tournament.registerAgent("NoStake2", "", TournamentLib.AgentType.Custom);
    }

    function test_registrationWithDiscount_8percent() public {
        // Create Bronze tournament (50 USDC entry)
        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Bronze, 32, 4,
            int64(int256(block.timestamp + 200)),
            int64(int256(block.timestamp + 100)),
            60, 0
        );

        uint256 balBefore = usdc.balanceOf(agent1);

        vm.prank(agent1);
        tournament.registerForTournament(0);

        uint256 balAfter = usdc.balanceOf(agent1);
        // 50 USDC - 8% = 46 USDC
        uint256 paid = balBefore - balAfter;
        assertEq(paid, 46e6);
    }

    function test_registrationWithDiscount_2percent() public {
        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Bronze, 32, 4,
            int64(int256(block.timestamp + 200)),
            int64(int256(block.timestamp + 100)),
            60, 0
        );

        uint256 balBefore = usdc.balanceOf(agent2);

        vm.prank(agent2);
        tournament.registerForTournament(0);

        uint256 paid = balBefore - usdc.balanceOf(agent2);
        // 50 USDC - 2% = 49 USDC
        assertEq(paid, 49e6);
    }

    function test_registrationWithoutStaking_fullFee() public {
        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Bronze, 32, 4,
            int64(int256(block.timestamp + 200)),
            int64(int256(block.timestamp + 100)),
            60, 0
        );

        uint256 balBefore = usdc.balanceOf(agent3);

        vm.prank(agent3);
        tournament.registerForTournament(0);

        uint256 paid = balBefore - usdc.balanceOf(agent3);
        assertEq(paid, 50e6); // Full fee
    }

    function test_tournamentCollected_tracksActualAmounts() public {
        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Bronze, 32, 4,
            int64(int256(block.timestamp + 200)),
            int64(int256(block.timestamp + 100)),
            60, 0
        );

        vm.prank(agent1); tournament.registerForTournament(0); // 46 USDC
        vm.prank(agent2); tournament.registerForTournament(0); // 49 USDC
        vm.prank(agent3); tournament.registerForTournament(0); // 50 USDC
        vm.prank(agent4); tournament.registerForTournament(0); // 50 USDC

        // Total collected = 46 + 49 + 50 + 50 = 195 USDC
        assertEq(tournament.tournamentCollected(0), 195e6);
    }

    function test_prizesFromActualCollected() public {
        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Bronze, 32, 4,
            int64(int256(block.timestamp + 200)),
            int64(int256(block.timestamp + 100)),
            60, 0
        );

        vm.prank(agent1); tournament.registerForTournament(0); // 46 USDC
        vm.prank(agent2); tournament.registerForTournament(0); // 49 USDC
        vm.prank(agent3); tournament.registerForTournament(0); // 50 USDC
        vm.prank(agent4); tournament.registerForTournament(0); // 50 USDC

        // Total = 195 USDC
        vm.prank(authority); tournament.startTournament(0);

        // Fast tournament
        ChessBotsTournament.GameInput[] memory g = new ChessBotsTournament.GameInput[](2);
        g[0] = ChessBotsTournament.GameInput(0, agent1, agent2);
        g[1] = ChessBotsTournament.GameInput(1, agent3, agent4);
        vm.prank(authority); tournament.batchCreateAndStartGames(0, 1, g);

        ChessBotsTournament.GameResultInput[] memory r = new ChessBotsTournament.GameResultInput[](2);
        r[0] = ChessBotsTournament.GameResultInput(0, TournamentLib.GameResult.WhiteWins, keccak256("p1"), keccak256("r1"), 30);
        r[1] = ChessBotsTournament.GameResultInput(1, TournamentLib.GameResult.WhiteWins, keccak256("p2"), keccak256("r2"), 25);

        ChessBotsTournament.StandingsInput[] memory s = new ChessBotsTournament.StandingsInput[](4);
        s[0] = ChessBotsTournament.StandingsInput(agent1, 4, 2, 2, 2, 0, 0);
        s[1] = ChessBotsTournament.StandingsInput(agent2, 2, 0, 2, 1, 0, 1);
        s[2] = ChessBotsTournament.StandingsInput(agent3, 2, 4, 2, 1, 0, 1);
        s[3] = ChessBotsTournament.StandingsInput(agent4, 0, 0, 2, 0, 0, 2);

        vm.prank(authority); tournament.executeRound(0, 1, r, s, true);

        ChessBotsTournament.GameInput[] memory g2 = new ChessBotsTournament.GameInput[](2);
        g2[0] = ChessBotsTournament.GameInput(0, agent1, agent3);
        g2[1] = ChessBotsTournament.GameInput(1, agent2, agent4);
        vm.prank(authority); tournament.batchCreateAndStartGames(0, 2, g2);

        ChessBotsTournament.GameResultInput[] memory r2 = new ChessBotsTournament.GameResultInput[](2);
        r2[0] = ChessBotsTournament.GameResultInput(0, TournamentLib.GameResult.WhiteWins, keccak256("p3"), keccak256("r3"), 40);
        r2[1] = ChessBotsTournament.GameResultInput(1, TournamentLib.GameResult.WhiteWins, keccak256("p4"), keccak256("r4"), 35);

        ChessBotsTournament.StandingsInput[] memory s2 = new ChessBotsTournament.StandingsInput[](4);
        s2[0] = ChessBotsTournament.StandingsInput(agent1, 4, 2, 2, 2, 0, 0);
        s2[1] = ChessBotsTournament.StandingsInput(agent2, 2, 0, 2, 1, 0, 1);
        s2[2] = ChessBotsTournament.StandingsInput(agent3, 2, 4, 2, 1, 0, 1);
        s2[3] = ChessBotsTournament.StandingsInput(agent4, 0, 0, 2, 0, 0, 2);

        vm.prank(authority); tournament.executeRound(0, 2, r2, s2, false);

        vm.prank(authority); tournament.finalizeTournament(0, [agent1, agent3, agent2], "ipfs://results");

        // Store balances before distribution
        uint256 w1Before = usdc.balanceOf(agent1);
        uint256 w2Before = usdc.balanceOf(agent3);
        uint256 w3Before = usdc.balanceOf(agent2);

        vm.prank(authority); tournament.distributePrizes(0);

        // totalPool = 195 USDC (from tournamentCollected)
        // protocolFee = 195 * 1000 / 10000 = 19.5 → 19 USDC (integer math)
        // playerPool = 195 - 19 = 176 USDC
        // 1st = 176 * 7000 / 10000 = 123.2 → 123 USDC
        uint256 protocolFee = (195e6 * 1000) / 10000;
        uint256 playerPool = 195e6 - protocolFee;
        uint256 firstPrize = (playerPool * 7000) / 10000;

        assertEq(usdc.balanceOf(agent1) - w1Before, firstPrize);
    }

    function test_noStakingContract_noDiscount() public {
        // Deploy fresh tournament without staking configured
        DiscountUSDC freshUsdc = new DiscountUSDC();
        vm.prank(authority);
        ChessBotsTournament fresh = new ChessBotsTournament(address(freshUsdc), treasury, 1000, 9000, 1000);
        // Note: no setStakingContract called

        freshUsdc.mint(agent1, 10_000e6);
        vm.prank(agent1); freshUsdc.approve(address(fresh), type(uint256).max);
        vm.prank(agent1); fresh.registerAgent("TestAgent", "", TournamentLib.AgentType.Custom);

        vm.prank(authority);
        fresh.createTournament(
            TournamentLib.Tier.Bronze, 32, 4,
            int64(int256(block.timestamp + 200)),
            int64(int256(block.timestamp + 100)),
            60, 0
        );

        uint256 balBefore = freshUsdc.balanceOf(agent1);
        vm.prank(agent1); fresh.registerForTournament(0);
        uint256 paid = balBefore - freshUsdc.balanceOf(agent1);

        // Full fee — no discount even though agent1 has CHESS staked elsewhere
        assertEq(paid, 50e6);
    }
}
