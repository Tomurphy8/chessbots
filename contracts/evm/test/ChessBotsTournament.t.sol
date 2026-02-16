// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChessBotsTournament.sol";
import "../src/libraries/TournamentLib.sol";

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

contract ChessBotsTournamentTest is Test {
    ChessBotsTournament public tournament;
    MockUSDC public usdc;

    address authority = address(1);
    address treasury = address(2);
    address agent1 = address(10);
    address agent2 = address(11);
    address agent3 = address(12);
    address agent4 = address(13);

    function setUp() public {
        usdc = new MockUSDC();
        // SC-C1: Constructor now takes all protocol params (deployed from authority)
        vm.prank(authority);
        tournament = new ChessBotsTournament(address(usdc), treasury, 1000, 9000, 1000);

        // Fund agents with 1000 USDC each
        usdc.mint(agent1, 1000e6);
        usdc.mint(agent2, 1000e6);
        usdc.mint(agent3, 1000e6);
        usdc.mint(agent4, 1000e6);

        // Agents approve tournament contract
        vm.prank(agent1); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(agent2); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(agent3); usdc.approve(address(tournament), type(uint256).max);
        vm.prank(agent4); usdc.approve(address(tournament), type(uint256).max);
    }

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
        tournament.registerAgent("DeepClaw-v3", "", TournamentLib.AgentType.OpenClaw);

        (address wallet, string memory agentName,,,,,,,,,, bool registered) = tournament.agents(agent1);
        assertEq(wallet, agent1);
        assertEq(agentName, "DeepClaw-v3");
        assertTrue(registered);
    }

    function test_fullTournamentLifecycle() public {
        // Register agents
        vm.prank(agent1); tournament.registerAgent("DeepClaw-v3", "", TournamentLib.AgentType.OpenClaw);
        vm.prank(agent2); tournament.registerAgent("SolanaBot", "", TournamentLib.AgentType.SolanaAgentKit);
        vm.prank(agent3); tournament.registerAgent("ChessAgent", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4); tournament.registerAgent("NeuralKnight", "", TournamentLib.AgentType.OpenClaw);

        // Create tournament
        int64 regDeadline = int64(int256(block.timestamp + 3600));
        int64 startTime = int64(int256(block.timestamp + 7200));

        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Bronze, 32, 4,
            startTime, regDeadline,
            300, 3
        );

        // Register for tournament (each pays 50 USDC)
        vm.prank(agent1); tournament.registerForTournament(0);
        vm.prank(agent2); tournament.registerForTournament(0);
        vm.prank(agent3); tournament.registerForTournament(0);
        vm.prank(agent4); tournament.registerForTournament(0);

        // Verify prize pool (200 USDC in contract)
        assertEq(usdc.balanceOf(address(tournament)), 200e6);

        // Start tournament
        vm.prank(authority);
        tournament.startTournament(0);

        // Create round 1 games
        vm.startPrank(authority);
        tournament.createGame(0, 1, 0, agent1, agent2);
        tournament.createGame(0, 1, 1, agent3, agent4);

        // Start and submit round 1 results (pgnHash instead of pgnUri)
        tournament.startGame(0, 1, 0);
        tournament.submitGameResult(0, 1, 0, TournamentLib.GameResult.WhiteWins, keccak256("ipfs://r1g0"), bytes32(0), 20);

        tournament.startGame(0, 1, 1);
        tournament.submitGameResult(0, 1, 1, TournamentLib.GameResult.Draw, keccak256("ipfs://r1g1"), bytes32(0), 30);

        // Update standings (triggers RoundComplete)
        tournament.updateStandings(0, agent1, 2, 0, 1, 1, 0, 0);
        tournament.updateStandings(0, agent2, 0, 0, 1, 0, 0, 1);
        tournament.updateStandings(0, agent3, 1, 0, 1, 0, 1, 0);
        tournament.updateStandings(0, agent4, 1, 0, 1, 0, 1, 0);

        // Advance to round 2
        tournament.advanceRound(0);

        // Create and play round 2
        tournament.createGame(0, 2, 0, agent1, agent3);
        tournament.createGame(0, 2, 1, agent4, agent2);

        tournament.startGame(0, 2, 0);
        tournament.submitGameResult(0, 2, 0, TournamentLib.GameResult.WhiteWins, keccak256("ipfs://r2g0"), bytes32(0), 25);

        tournament.startGame(0, 2, 1);
        tournament.submitGameResult(0, 2, 1, TournamentLib.GameResult.BlackWins, keccak256("ipfs://r2g1"), bytes32(0), 35);

        // Update round 2 standings
        tournament.updateStandings(0, agent1, 4, 1, 2, 2, 0, 0);
        tournament.updateStandings(0, agent2, 0, 1, 2, 0, 0, 2);
        tournament.updateStandings(0, agent3, 1, 4, 2, 0, 1, 1);
        tournament.updateStandings(0, agent4, 1, 0, 2, 0, 1, 1);

        // Finalize
        tournament.finalizeTournament(0, [agent1, agent3, agent4], "ipfs://results");

        // Distribute prizes
        tournament.distributePrizes(0);
        vm.stopPrank();

        // Verify balances
        assertEq(usdc.balanceOf(agent1), 1076e6);
        assertEq(usdc.balanceOf(agent3), 986e6);
        assertEq(usdc.balanceOf(agent4), 968e6);
        assertEq(usdc.balanceOf(treasury), 20e6);
        assertEq(usdc.balanceOf(address(tournament)), 0);

        // Verify game counter
        assertEq(tournament.totalGamesPlayed(), 4);
    }

    function test_cannotDoubleRegister() public {
        vm.prank(agent1);
        tournament.registerAgent("Agent1", "", TournamentLib.AgentType.Custom);

        vm.prank(agent1);
        vm.expectRevert("Already registered");
        tournament.registerAgent("Agent1Again", "", TournamentLib.AgentType.Custom);
    }

    function test_cannotRegisterAfterDeadline() public {
        vm.prank(agent1);
        tournament.registerAgent("Agent1", "", TournamentLib.AgentType.Custom);

        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Bronze, 32, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );

        // Warp past deadline
        vm.warp(block.timestamp + 3601);

        vm.prank(agent1);
        vm.expectRevert("Registration closed");
        tournament.registerForTournament(0);
    }

    function test_unregisteredCantCreateTournament() public {
        // Unregistered agent cannot create tournaments
        vm.prank(agent1);
        vm.expectRevert("Must be registered agent or authority");
        tournament.createTournament(
            TournamentLib.Tier.Bronze, 32, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );
    }

    function test_registeredAgentCanCreateTournament() public {
        // Register agent1
        vm.prank(agent1);
        tournament.registerAgent("Agent1", "", TournamentLib.AgentType.OpenClaw);

        // Agent1 creates a tournament
        vm.prank(agent1);
        tournament.createTournament(
            TournamentLib.Tier.Bronze, 16, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );

        // Verify tournament exists
        ChessBotsTournament.Tournament memory t = tournament.getTournament(0);
        assertTrue(t.exists);
        assertEq(uint8(t.tier), uint8(TournamentLib.Tier.Bronze));
        assertEq(t.maxPlayers, 16);
    }

    function test_authorityCanStillCreateTournament() public {
        // Authority (not registered as agent) can still create
        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Silver, 8, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            600, 5
        );

        ChessBotsTournament.Tournament memory t = tournament.getTournament(0);
        assertTrue(t.exists);
        assertEq(t.authority, authority);
    }

    function test_registeredAgentCanCreateLegendsTournament() public {
        // Register and fund agent1
        vm.prank(agent1);
        tournament.registerAgent("Agent1", "", TournamentLib.AgentType.OpenClaw);
        usdc.mint(agent1, 10000e6);

        // Agent1 creates a Legends tournament
        vm.prank(agent1);
        tournament.createLegendsTournament(
            16, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3,
            1000e6
        );

        ChessBotsTournament.Tournament memory t = tournament.getTournament(0);
        assertTrue(t.exists);
        assertEq(uint8(t.tier), uint8(TournamentLib.Tier.Legends));
        assertEq(t.entryFee, 1000e6);
    }

    function test_registeredAgentCreatesOwnAuthority() public {
        // Register agent1
        vm.prank(agent1);
        tournament.registerAgent("Agent1", "", TournamentLib.AgentType.OpenClaw);

        // Agent1 creates a tournament
        vm.prank(agent1);
        tournament.createTournament(
            TournamentLib.Tier.Free, 8, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            300, 3
        );

        // Verify agent1 is the tournament authority
        ChessBotsTournament.Tournament memory t = tournament.getTournament(0);
        assertEq(t.authority, agent1);
    }

    // --- Legends Tier Tests ---

    function test_legendsTournamentCustomFee() public {
        // Register agents
        vm.prank(agent1); tournament.registerAgent("Agent1", "", TournamentLib.AgentType.OpenClaw);
        vm.prank(agent2); tournament.registerAgent("Agent2", "", TournamentLib.AgentType.Custom);
        vm.prank(agent3); tournament.registerAgent("Agent3", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4); tournament.registerAgent("Agent4", "", TournamentLib.AgentType.Custom);

        // Fund agents with more USDC for high-stakes
        usdc.mint(agent1, 10000e6);
        usdc.mint(agent2, 10000e6);
        usdc.mint(agent3, 10000e6);
        usdc.mint(agent4, 10000e6);

        // Create Legends tournament with 1000 USDC entry
        vm.prank(authority);
        tournament.createLegendsTournament(
            16, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            30, 0,
            1000e6  // 1000 USDC custom entry
        );

        // Verify the tournament has correct entry fee
        ChessBotsTournament.Tournament memory t = tournament.getTournament(0);
        assertEq(t.entryFee, 1000e6);
        assertEq(uint8(t.tier), uint8(TournamentLib.Tier.Legends));

        // Register — each pays 1000 USDC
        vm.prank(agent1); tournament.registerForTournament(0);
        vm.prank(agent2); tournament.registerForTournament(0);
        vm.prank(agent3); tournament.registerForTournament(0);
        vm.prank(agent4); tournament.registerForTournament(0);

        // Prize pool should be 4000 USDC
        assertEq(usdc.balanceOf(address(tournament)), 4000e6);
    }

    function test_legendsMinimumFee() public {
        // Should revert if entry fee < 500 USDC
        vm.prank(authority);
        vm.expectRevert("Legends min 500 USDC");
        tournament.createLegendsTournament(
            16, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            30, 0,
            100e6  // Only 100 USDC — below 500 minimum
        );
    }

    function test_legendsHighStakes() public {
        // Test with very high stakes — 10,000 USDC entry
        vm.prank(authority);
        tournament.createLegendsTournament(
            8, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            30, 0,
            10_000e6  // 10,000 USDC per player
        );

        ChessBotsTournament.Tournament memory t = tournament.getTournament(0);
        assertEq(t.entryFee, 10_000e6);
        assertEq(uint8(t.tier), uint8(TournamentLib.Tier.Legends));
    }

    // --- Batch Function Tests ---

    function _setupTournamentWithPlayers() internal returns (uint256) {
        vm.prank(agent1); tournament.registerAgent("Agent1", "", TournamentLib.AgentType.OpenClaw);
        vm.prank(agent2); tournament.registerAgent("Agent2", "", TournamentLib.AgentType.SolanaAgentKit);
        vm.prank(agent3); tournament.registerAgent("Agent3", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4); tournament.registerAgent("Agent4", "", TournamentLib.AgentType.OpenClaw);

        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Bronze, 32, 4,
            int64(int256(block.timestamp + 7200)),
            int64(int256(block.timestamp + 3600)),
            30, 0  // 30s bullet, no increment
        );

        vm.prank(agent1); tournament.registerForTournament(0);
        vm.prank(agent2); tournament.registerForTournament(0);
        vm.prank(agent3); tournament.registerForTournament(0);
        vm.prank(agent4); tournament.registerForTournament(0);

        vm.prank(authority);
        tournament.startTournament(0);

        return 0;
    }

    function test_batchCreateAndStartGames() public {
        uint256 tid = _setupTournamentWithPlayers();

        ChessBotsTournament.GameInput[] memory gameInputs = new ChessBotsTournament.GameInput[](2);
        gameInputs[0] = ChessBotsTournament.GameInput({ gameIndex: 0, white: agent1, black: agent2 });
        gameInputs[1] = ChessBotsTournament.GameInput({ gameIndex: 1, white: agent3, black: agent4 });

        vm.prank(authority);
        tournament.batchCreateAndStartGames(tid, 1, gameInputs);

        ChessBotsTournament.Game memory g0 = tournament.getGame(tid, 1, 0);
        assertEq(g0.white, agent1);
        assertEq(g0.black, agent2);
        assertTrue(g0.exists);
        assertEq(uint8(g0.status), uint8(TournamentLib.GameStatus.InProgress));

        ChessBotsTournament.Game memory g1 = tournament.getGame(tid, 1, 1);
        assertEq(g1.white, agent3);
        assertEq(g1.black, agent4);
        assertTrue(g1.exists);
        assertEq(uint8(g1.status), uint8(TournamentLib.GameStatus.InProgress));
    }

    function test_batchSubmitResults() public {
        uint256 tid = _setupTournamentWithPlayers();

        ChessBotsTournament.GameInput[] memory gameInputs = new ChessBotsTournament.GameInput[](2);
        gameInputs[0] = ChessBotsTournament.GameInput({ gameIndex: 0, white: agent1, black: agent2 });
        gameInputs[1] = ChessBotsTournament.GameInput({ gameIndex: 1, white: agent3, black: agent4 });

        vm.startPrank(authority);
        tournament.batchCreateAndStartGames(tid, 1, gameInputs);

        ChessBotsTournament.GameResultInput[] memory results = new ChessBotsTournament.GameResultInput[](2);
        results[0] = ChessBotsTournament.GameResultInput({
            gameIndex: 0, result: TournamentLib.GameResult.WhiteWins,
            pgnHash: keccak256("pgn-game-0"), resultHash: keccak256("result-0"), moveCount: 22
        });
        results[1] = ChessBotsTournament.GameResultInput({
            gameIndex: 1, result: TournamentLib.GameResult.Draw,
            pgnHash: keccak256("pgn-game-1"), resultHash: keccak256("result-1"), moveCount: 40
        });

        tournament.batchSubmitResults(tid, 1, results);
        vm.stopPrank();

        ChessBotsTournament.Game memory g0 = tournament.getGame(tid, 1, 0);
        assertEq(uint8(g0.result), uint8(TournamentLib.GameResult.WhiteWins));
        assertEq(uint8(g0.status), uint8(TournamentLib.GameStatus.Completed));
        assertEq(g0.moveCount, 22);

        ChessBotsTournament.Game memory g1 = tournament.getGame(tid, 1, 1);
        assertEq(uint8(g1.result), uint8(TournamentLib.GameResult.Draw));
        assertEq(g1.moveCount, 40);

        assertEq(tournament.totalGamesPlayed(), 2);
    }

    function test_batchUpdateStandings() public {
        uint256 tid = _setupTournamentWithPlayers();

        ChessBotsTournament.GameInput[] memory gameInputs = new ChessBotsTournament.GameInput[](2);
        gameInputs[0] = ChessBotsTournament.GameInput({ gameIndex: 0, white: agent1, black: agent2 });
        gameInputs[1] = ChessBotsTournament.GameInput({ gameIndex: 1, white: agent3, black: agent4 });

        vm.startPrank(authority);
        tournament.batchCreateAndStartGames(tid, 1, gameInputs);

        ChessBotsTournament.GameResultInput[] memory results = new ChessBotsTournament.GameResultInput[](2);
        results[0] = ChessBotsTournament.GameResultInput({ gameIndex: 0, result: TournamentLib.GameResult.WhiteWins, pgnHash: keccak256("p0"), resultHash: bytes32(0), moveCount: 20 });
        results[1] = ChessBotsTournament.GameResultInput({ gameIndex: 1, result: TournamentLib.GameResult.Draw, pgnHash: keccak256("p1"), resultHash: bytes32(0), moveCount: 30 });
        tournament.batchSubmitResults(tid, 1, results);

        ChessBotsTournament.StandingsInput[] memory standings = new ChessBotsTournament.StandingsInput[](4);
        standings[0] = ChessBotsTournament.StandingsInput({ agent: agent1, score: 2, buchholz: 0, gamesPlayed: 1, gamesWon: 1, gamesDrawn: 0, gamesLost: 0 });
        standings[1] = ChessBotsTournament.StandingsInput({ agent: agent2, score: 0, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 0, gamesLost: 1 });
        standings[2] = ChessBotsTournament.StandingsInput({ agent: agent3, score: 1, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 1, gamesLost: 0 });
        standings[3] = ChessBotsTournament.StandingsInput({ agent: agent4, score: 1, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 1, gamesLost: 0 });

        tournament.batchUpdateStandings(tid, standings);
        vm.stopPrank();

        ChessBotsTournament.Registration memory r1 = tournament.getRegistration(tid, agent1);
        assertEq(r1.score, 2);
        assertEq(r1.gamesWon, 1);

        ChessBotsTournament.Registration memory r2 = tournament.getRegistration(tid, agent2);
        assertEq(r2.score, 0);
        assertEq(r2.gamesLost, 1);
    }

    function test_executeRound() public {
        uint256 tid = _setupTournamentWithPlayers();

        ChessBotsTournament.GameInput[] memory gameInputs = new ChessBotsTournament.GameInput[](2);
        gameInputs[0] = ChessBotsTournament.GameInput({ gameIndex: 0, white: agent1, black: agent2 });
        gameInputs[1] = ChessBotsTournament.GameInput({ gameIndex: 1, white: agent3, black: agent4 });

        vm.startPrank(authority);
        tournament.batchCreateAndStartGames(tid, 1, gameInputs);

        ChessBotsTournament.GameResultInput[] memory results = new ChessBotsTournament.GameResultInput[](2);
        results[0] = ChessBotsTournament.GameResultInput({ gameIndex: 0, result: TournamentLib.GameResult.WhiteWins, pgnHash: keccak256("p0"), resultHash: keccak256("r0"), moveCount: 20 });
        results[1] = ChessBotsTournament.GameResultInput({ gameIndex: 1, result: TournamentLib.GameResult.Draw, pgnHash: keccak256("p1"), resultHash: keccak256("r1"), moveCount: 30 });

        ChessBotsTournament.StandingsInput[] memory standings = new ChessBotsTournament.StandingsInput[](4);
        standings[0] = ChessBotsTournament.StandingsInput({ agent: agent1, score: 2, buchholz: 0, gamesPlayed: 1, gamesWon: 1, gamesDrawn: 0, gamesLost: 0 });
        standings[1] = ChessBotsTournament.StandingsInput({ agent: agent2, score: 0, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 0, gamesLost: 1 });
        standings[2] = ChessBotsTournament.StandingsInput({ agent: agent3, score: 1, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 1, gamesLost: 0 });
        standings[3] = ChessBotsTournament.StandingsInput({ agent: agent4, score: 1, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 1, gamesLost: 0 });

        tournament.executeRound(tid, 1, results, standings, true);
        vm.stopPrank();

        ChessBotsTournament.Tournament memory t = tournament.getTournament(tid);
        assertEq(t.currentRound, 2);
        assertEq(uint8(t.status), uint8(TournamentLib.TournamentStatus.RoundActive));
        assertEq(tournament.totalGamesPlayed(), 2);

        ChessBotsTournament.Registration memory r1 = tournament.getRegistration(tid, agent1);
        assertEq(r1.score, 2);
        assertEq(r1.gamesWon, 1);
    }

    function test_fullBatchLifecycle() public {
        uint256 tid = _setupTournamentWithPlayers();

        vm.startPrank(authority);

        // --- Round 1 ---
        ChessBotsTournament.GameInput[] memory r1Games = new ChessBotsTournament.GameInput[](2);
        r1Games[0] = ChessBotsTournament.GameInput({ gameIndex: 0, white: agent1, black: agent2 });
        r1Games[1] = ChessBotsTournament.GameInput({ gameIndex: 1, white: agent3, black: agent4 });
        tournament.batchCreateAndStartGames(tid, 1, r1Games);

        ChessBotsTournament.GameResultInput[] memory r1Results = new ChessBotsTournament.GameResultInput[](2);
        r1Results[0] = ChessBotsTournament.GameResultInput({ gameIndex: 0, result: TournamentLib.GameResult.WhiteWins, pgnHash: keccak256("r1g0"), resultHash: bytes32(0), moveCount: 20 });
        r1Results[1] = ChessBotsTournament.GameResultInput({ gameIndex: 1, result: TournamentLib.GameResult.Draw, pgnHash: keccak256("r1g1"), resultHash: bytes32(0), moveCount: 30 });

        ChessBotsTournament.StandingsInput[] memory r1Standings = new ChessBotsTournament.StandingsInput[](4);
        r1Standings[0] = ChessBotsTournament.StandingsInput({ agent: agent1, score: 2, buchholz: 0, gamesPlayed: 1, gamesWon: 1, gamesDrawn: 0, gamesLost: 0 });
        r1Standings[1] = ChessBotsTournament.StandingsInput({ agent: agent2, score: 0, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 0, gamesLost: 1 });
        r1Standings[2] = ChessBotsTournament.StandingsInput({ agent: agent3, score: 1, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 1, gamesLost: 0 });
        r1Standings[3] = ChessBotsTournament.StandingsInput({ agent: agent4, score: 1, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 1, gamesLost: 0 });

        tournament.executeRound(tid, 1, r1Results, r1Standings, true);

        // --- Round 2 ---
        ChessBotsTournament.GameInput[] memory r2Games = new ChessBotsTournament.GameInput[](2);
        r2Games[0] = ChessBotsTournament.GameInput({ gameIndex: 0, white: agent1, black: agent3 });
        r2Games[1] = ChessBotsTournament.GameInput({ gameIndex: 1, white: agent4, black: agent2 });
        tournament.batchCreateAndStartGames(tid, 2, r2Games);

        ChessBotsTournament.GameResultInput[] memory r2Results = new ChessBotsTournament.GameResultInput[](2);
        r2Results[0] = ChessBotsTournament.GameResultInput({ gameIndex: 0, result: TournamentLib.GameResult.WhiteWins, pgnHash: keccak256("r2g0"), resultHash: bytes32(0), moveCount: 25 });
        r2Results[1] = ChessBotsTournament.GameResultInput({ gameIndex: 1, result: TournamentLib.GameResult.BlackWins, pgnHash: keccak256("r2g1"), resultHash: bytes32(0), moveCount: 35 });

        ChessBotsTournament.StandingsInput[] memory r2Standings = new ChessBotsTournament.StandingsInput[](4);
        r2Standings[0] = ChessBotsTournament.StandingsInput({ agent: agent1, score: 4, buchholz: 1, gamesPlayed: 2, gamesWon: 2, gamesDrawn: 0, gamesLost: 0 });
        r2Standings[1] = ChessBotsTournament.StandingsInput({ agent: agent2, score: 0, buchholz: 1, gamesPlayed: 2, gamesWon: 0, gamesDrawn: 0, gamesLost: 2 });
        r2Standings[2] = ChessBotsTournament.StandingsInput({ agent: agent3, score: 1, buchholz: 4, gamesPlayed: 2, gamesWon: 0, gamesDrawn: 1, gamesLost: 1 });
        r2Standings[3] = ChessBotsTournament.StandingsInput({ agent: agent4, score: 1, buchholz: 0, gamesPlayed: 2, gamesWon: 0, gamesDrawn: 1, gamesLost: 1 });

        tournament.executeRound(tid, 2, r2Results, r2Standings, false);

        // Finalize + distribute
        tournament.finalizeTournament(tid, [agent1, agent3, agent4], "ipfs://results");
        tournament.distributePrizes(tid);
        vm.stopPrank();

        // Verify balances
        assertEq(usdc.balanceOf(agent1), 1076e6);
        assertEq(usdc.balanceOf(agent3), 986e6);
        assertEq(usdc.balanceOf(agent4), 968e6);
        assertEq(usdc.balanceOf(treasury), 20e6);
        assertEq(usdc.balanceOf(address(tournament)), 0);
        assertEq(tournament.totalGamesPlayed(), 4);
    }

    // --- Gas Benchmark ---

    function test_gasBenchmark_singleVsBatch() public {
        uint256 tid = _setupTournamentWithPlayers();

        ChessBotsTournament.GameInput[] memory gameInputs = new ChessBotsTournament.GameInput[](2);
        gameInputs[0] = ChessBotsTournament.GameInput({ gameIndex: 0, white: agent1, black: agent2 });
        gameInputs[1] = ChessBotsTournament.GameInput({ gameIndex: 1, white: agent3, black: agent4 });

        vm.startPrank(authority);

        uint256 gasBefore = gasleft();
        tournament.batchCreateAndStartGames(tid, 1, gameInputs);
        uint256 batchCreateGas = gasBefore - gasleft();

        ChessBotsTournament.GameResultInput[] memory results = new ChessBotsTournament.GameResultInput[](2);
        results[0] = ChessBotsTournament.GameResultInput({ gameIndex: 0, result: TournamentLib.GameResult.WhiteWins, pgnHash: keccak256("p0"), resultHash: bytes32(0), moveCount: 20 });
        results[1] = ChessBotsTournament.GameResultInput({ gameIndex: 1, result: TournamentLib.GameResult.Draw, pgnHash: keccak256("p1"), resultHash: bytes32(0), moveCount: 30 });

        gasBefore = gasleft();
        tournament.batchSubmitResults(tid, 1, results);
        uint256 batchResultGas = gasBefore - gasleft();

        ChessBotsTournament.StandingsInput[] memory standings = new ChessBotsTournament.StandingsInput[](4);
        standings[0] = ChessBotsTournament.StandingsInput({ agent: agent1, score: 2, buchholz: 0, gamesPlayed: 1, gamesWon: 1, gamesDrawn: 0, gamesLost: 0 });
        standings[1] = ChessBotsTournament.StandingsInput({ agent: agent2, score: 0, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 0, gamesLost: 1 });
        standings[2] = ChessBotsTournament.StandingsInput({ agent: agent3, score: 1, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 1, gamesLost: 0 });
        standings[3] = ChessBotsTournament.StandingsInput({ agent: agent4, score: 1, buchholz: 0, gamesPlayed: 1, gamesWon: 0, gamesDrawn: 1, gamesLost: 0 });

        gasBefore = gasleft();
        tournament.batchUpdateStandings(tid, standings);
        uint256 batchStandingsGas = gasBefore - gasleft();

        vm.stopPrank();

        emit log_named_uint("Batch createAndStart (2 games)", batchCreateGas);
        emit log_named_uint("Batch submitResults (2 games)", batchResultGas);
        emit log_named_uint("Batch updateStandings (4 players)", batchStandingsGas);
        emit log_named_uint("Total batch round gas", batchCreateGas + batchResultGas + batchStandingsGas);
    }

    // --- Free Tier Tests ---

    function test_freeTierTournament() public {
        // Create a free tier tournament
        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Free, 8, 4,
            int64(int256(block.timestamp + 2 hours)),
            int64(int256(block.timestamp + 1 hours)),
            300, 5
        );

        // Fund the tournament with $100 USDC
        usdc.mint(authority, 100e6);
        vm.startPrank(authority);
        usdc.approve(address(tournament), 100e6);
        tournament.fundTournament(0, 100e6);
        vm.stopPrank();

        // Register agents first
        vm.prank(agent1); tournament.registerAgent("Agent1", "", TournamentLib.AgentType.OpenClaw);
        vm.prank(agent2); tournament.registerAgent("Agent2", "", TournamentLib.AgentType.SolanaAgentKit);
        vm.prank(agent3); tournament.registerAgent("Agent3", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4); tournament.registerAgent("Agent4", "", TournamentLib.AgentType.OpenClaw);

        // Register 4 agents for tournament (no USDC needed)
        vm.prank(agent1);
        tournament.registerForTournament(0);
        vm.prank(agent2);
        tournament.registerForTournament(0);
        vm.prank(agent3);
        tournament.registerForTournament(0);
        vm.prank(agent4);
        tournament.registerForTournament(0);

        // Verify agents didn't pay anything
        assertEq(usdc.balanceOf(agent1), 1000e6); // unchanged
        assertEq(usdc.balanceOf(agent2), 1000e6);

        // Verify contract has the funded amount
        ChessBotsTournament.Tournament memory t = tournament.getTournament(0);
        assertEq(t.registeredCount, 4);
        assertEq(t.entryFee, 0);
    }

    function test_freeTierLimit() public {
        // Create 10 free tournaments (max allowed)
        for (uint8 i = 0; i < 10; i++) {
            vm.prank(authority);
            tournament.createTournament(
                TournamentLib.Tier.Free, 8, 4,
                int64(int256(block.timestamp + 2 hours)),
                int64(int256(block.timestamp + 1 hours)),
                300, 5
            );
        }

        // 11th should revert
        vm.prank(authority);
        vm.expectRevert("Free tournament limit reached");
        tournament.createTournament(
            TournamentLib.Tier.Free, 8, 4,
            int64(int256(block.timestamp + 2 hours)),
            int64(int256(block.timestamp + 1 hours)),
            300, 5
        );
    }

    function test_adjustableFreeTournamentLimit() public {
        // Create 10 free tournaments (hits default limit)
        for (uint8 i = 0; i < 10; i++) {
            vm.prank(authority);
            tournament.createTournament(
                TournamentLib.Tier.Free, 8, 4,
                int64(int256(block.timestamp + 2 hours)),
                int64(int256(block.timestamp + 1 hours)),
                300, 5
            );
        }

        // 11th should revert
        vm.prank(authority);
        vm.expectRevert("Free tournament limit reached");
        tournament.createTournament(
            TournamentLib.Tier.Free, 8, 4,
            int64(int256(block.timestamp + 2 hours)),
            int64(int256(block.timestamp + 1 hours)),
            300, 5
        );

        // Authority raises the limit to 20
        vm.prank(authority);
        tournament.setFreeTournamentLimit(20);

        // Now 11th succeeds
        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Free, 8, 4,
            int64(int256(block.timestamp + 2 hours)),
            int64(int256(block.timestamp + 1 hours)),
            300, 5
        );

        // Verify counter is now 11
        (,,,,,,, , uint8 sponsoredCount,) = tournament.protocol();
        assertEq(sponsoredCount, 11);
    }

    function test_fundTournamentBeforeDistribution() public {
        // Register agents and create a free tournament
        vm.prank(agent1); tournament.registerAgent("Agent1", "", TournamentLib.AgentType.OpenClaw);
        vm.prank(agent2); tournament.registerAgent("Agent2", "", TournamentLib.AgentType.SolanaAgentKit);
        vm.prank(agent3); tournament.registerAgent("Agent3", "", TournamentLib.AgentType.Custom);
        vm.prank(agent4); tournament.registerAgent("Agent4", "", TournamentLib.AgentType.OpenClaw);

        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Free, 8, 4,
            int64(int256(block.timestamp + 2 hours)),
            int64(int256(block.timestamp + 1 hours)),
            300, 5
        );

        // Fund with initial $50
        usdc.mint(authority, 200e6);
        vm.startPrank(authority);
        usdc.approve(address(tournament), 200e6);
        tournament.fundTournament(0, 50e6);
        vm.stopPrank();

        // Register players
        vm.prank(agent1); tournament.registerForTournament(0);
        vm.prank(agent2); tournament.registerForTournament(0);
        vm.prank(agent3); tournament.registerForTournament(0);
        vm.prank(agent4); tournament.registerForTournament(0);

        // Start tournament
        vm.prank(authority);
        tournament.startTournament(0);

        // Top up with another $50 during active round
        vm.prank(authority);
        tournament.fundTournament(0, 50e6);

        // Verify total collected is $100
        assertEq(tournament.tournamentCollected(0), 100e6);
    }

    function test_cannotFundCancelledTournament() public {
        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Free, 8, 4,
            int64(int256(block.timestamp + 2 hours)),
            int64(int256(block.timestamp + 1 hours)),
            300, 5
        );

        vm.prank(authority);
        tournament.cancelTournament(0);

        usdc.mint(authority, 100e6);
        vm.startPrank(authority);
        usdc.approve(address(tournament), 100e6);
        vm.expectRevert("Tournament cancelled");
        tournament.fundTournament(0, 100e6);
        vm.stopPrank();
    }

    function test_rookieEntryFeeIs5USDC() public {
        vm.prank(agent1); tournament.registerAgent("Agent1", "", TournamentLib.AgentType.OpenClaw);

        vm.prank(authority);
        tournament.createTournament(
            TournamentLib.Tier.Rookie, 8, 4,
            int64(int256(block.timestamp + 2 hours)),
            int64(int256(block.timestamp + 1 hours)),
            300, 5
        );

        ChessBotsTournament.Tournament memory t = tournament.getTournament(0);
        assertEq(t.entryFee, 5e6); // 5 USDC

        // Register — should cost 5 USDC
        vm.prank(agent1);
        tournament.registerForTournament(0);
        assertEq(usdc.balanceOf(agent1), 995e6); // 1000 - 5 = 995
    }
}
