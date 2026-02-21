// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./libraries/ELOCalculator.sol";
import "./libraries/TournamentLibV4.sol";

/// @title ChessELO - On-chain ELO rating and bracket management
/// @notice Standalone contract managing agent ELO ratings and bracket assignments.
///         Called by the tournament orchestrator after each tournament to update ratings.
/// @dev Bracket transitions use 25-point hysteresis buffer from TournamentLibV4.
contract ChessELO {
    // ── State ──────────────────────────────────────────────────────────────

    /// @notice Protocol authority for admin operations
    address public authority;

    /// @notice Pending authority for two-step transfer
    address public pendingAuthority;

    /// @notice Agent ELO ratings
    mapping(address => uint16) public elo;

    /// @notice Number of rated tournaments completed per agent
    mapping(address => uint16) public tournamentCount;

    /// @notice Current bracket per agent
    mapping(address => TournamentLibV4.Bracket) public bracket;

    /// @notice Whether an agent has been initialized in this contract
    mapping(address => bool) public initialized;

    /// @notice Addresses authorized to submit rating updates (tournament orchestrator)
    mapping(address => bool) public authorizedUpdaters;

    // ── Events ─────────────────────────────────────────────────────────────

    event ELORatingUpdated(
        address indexed agent,
        uint16 oldElo,
        uint16 newElo,
        uint256 indexed tournamentId
    );

    event BracketChanged(
        address indexed agent,
        TournamentLibV4.Bracket oldBracket,
        TournamentLibV4.Bracket newBracket
    );

    event AgentInitialized(address indexed agent, uint16 startingElo);

    event UpdaterAuthorized(address indexed updater, bool authorized);

    // ── Modifiers ──────────────────────────────────────────────────────────

    modifier onlyAuthority() {
        require(msg.sender == authority, "Unauthorized");
        _;
    }

    modifier onlyAuthorized() {
        require(authorizedUpdaters[msg.sender] || msg.sender == authority, "Not authorized updater");
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────────

    constructor() {
        authority = msg.sender;
    }

    // ── Admin ──────────────────────────────────────────────────────────────

    function setAuthorizedUpdater(address updater, bool authorized) external onlyAuthority {
        require(updater != address(0), "Zero address");
        authorizedUpdaters[updater] = authorized;
        emit UpdaterAuthorized(updater, authorized);
    }

    function proposeAuthority(address _newAuthority) external onlyAuthority {
        require(_newAuthority != address(0), "Zero address");
        pendingAuthority = _newAuthority;
    }

    function acceptAuthority() external {
        require(msg.sender == pendingAuthority, "Not pending authority");
        authority = msg.sender;
        pendingAuthority = address(0);
    }

    // ── Initialization ─────────────────────────────────────────────────────

    /// @notice Initialize an agent's ELO rating (called when agent registers)
    /// @param agent Agent wallet address
    /// @param startingElo Starting ELO (typically 1200)
    function initializeAgent(address agent, uint16 startingElo) external onlyAuthorized {
        require(agent != address(0), "Zero address");
        require(!initialized[agent], "Already initialized");
        require(startingElo >= ELOCalculator.MIN_RATING && startingElo <= ELOCalculator.MAX_RATING, "Invalid ELO");

        elo[agent] = startingElo;
        bracket[agent] = TournamentLibV4.Bracket.Unrated;
        initialized[agent] = true;

        emit AgentInitialized(agent, startingElo);
    }

    // ── Rating Updates ─────────────────────────────────────────────────────

    /// @notice Batch update ratings after a tournament completes
    /// @dev Called by the tournament orchestrator with game results
    /// @param tournamentId The tournament that just completed
    /// @param players Array of player addresses (order doesn't matter)
    /// @param opponents Array of opponent addresses (parallel to players)
    /// @param results Array of results: 1000 = win, 500 = draw, 0 = loss (parallel)
    function updateRatings(
        uint256 tournamentId,
        address[] calldata players,
        address[] calldata opponents,
        uint256[] calldata results
    ) external onlyAuthorized {
        require(players.length == opponents.length && players.length == results.length, "Array length mismatch");
        require(players.length > 0, "Empty arrays");

        for (uint256 i = 0; i < players.length; i++) {
            address player = players[i];
            address opponent = opponents[i];

            require(initialized[player], "Player not initialized");
            require(initialized[opponent], "Opponent not initialized");
            require(results[i] == 0 || results[i] == 500 || results[i] == 1000, "Invalid result");

            uint16 oldElo = elo[player];
            uint16 kFactor = ELOCalculator.getKFactor(tournamentCount[player]);
            uint256 expectedScore = ELOCalculator.calculateExpectedScore(oldElo, elo[opponent]);

            uint16 newElo = ELOCalculator.calculateNewRating(oldElo, kFactor, results[i], expectedScore);
            elo[player] = newElo;

            if (newElo != oldElo) {
                emit ELORatingUpdated(player, oldElo, newElo, tournamentId);
            }
        }
    }

    /// @notice Record tournament completion and update brackets for participants
    /// @dev Called after updateRatings to bump tournament count and recalculate brackets
    /// @param participants Array of agents who completed the tournament
    function recordTournamentCompletion(address[] calldata participants) external onlyAuthorized {
        for (uint256 i = 0; i < participants.length; i++) {
            address agent = participants[i];
            require(initialized[agent], "Agent not initialized");

            tournamentCount[agent]++;

            // Recalculate bracket with hysteresis
            TournamentLibV4.Bracket oldBracket = bracket[agent];
            TournamentLibV4.Bracket newBracket = TournamentLibV4.resolveBracket(
                elo[agent],
                oldBracket,
                tournamentCount[agent]
            );

            if (newBracket != oldBracket) {
                bracket[agent] = newBracket;
                emit BracketChanged(agent, oldBracket, newBracket);
            }
        }
    }

    // ── Views ──────────────────────────────────────────────────────────────

    /// @notice Get an agent's current ELO rating
    function getELO(address agent) external view returns (uint16) {
        return elo[agent];
    }

    /// @notice Get an agent's current bracket
    function getBracket(address agent) external view returns (TournamentLibV4.Bracket) {
        return bracket[agent];
    }

    /// @notice Get an agent's full rating profile
    function getProfile(address agent) external view returns (
        uint16 rating,
        TournamentLibV4.Bracket agentBracket,
        uint16 tournaments,
        bool isInitialized
    ) {
        return (elo[agent], bracket[agent], tournamentCount[agent], initialized[agent]);
    }

    /// @notice Check if an agent is eligible for a tournament bracket
    function isEligible(address agent, TournamentLibV4.Bracket tournamentBracket) external view returns (bool) {
        return TournamentLibV4.isBracketEligible(bracket[agent], tournamentBracket);
    }
}
