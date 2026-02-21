// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IERC20Minimal.sol";
import "./libraries/TournamentLibV4.sol";
import "./libraries/PayoutCalculator.sol";

/// @title ChessBounty - Bounty tournament mechanics with knockout bounties
/// @notice Manages bounty tournaments where entry fees are split 50/50 between
///         a central prize pool and individual agent bounties. When a player wins,
///         they collect the loser's full accumulated bounty. Draws = no transfer.
/// @dev The central pool (50% minus rake) is distributed via standard payout tables.
///      Individual bounties are cumulative — winning streaks snowball.
contract ChessBounty {
    // ── Structs ────────────────────────────────────────────────────────────

    struct BountyTournament {
        uint256 tournamentId;
        uint256 totalPool;
        uint256 bountyPool;
        uint256 centralPool;
        uint8 playerCount;
        bool initialized;
        bool finalized;
    }

    // ── State ──────────────────────────────────────────────────────────────

    address public authority;
    address public pendingAuthority;
    IERC20Minimal public immutable usdc;

    mapping(address => bool) public authorizedManagers;

    /// @notice Bounty tournament data
    mapping(uint256 => BountyTournament) public bountyTournaments;

    /// @notice Per-agent bounty balance within a tournament
    mapping(uint256 => mapping(address => uint256)) public agentBounty;

    /// @notice Track unclaimed bounties per agent per tournament
    mapping(uint256 => mapping(address => bool)) public bountyClaimed;

    // ── Events ─────────────────────────────────────────────────────────────

    event BountyTournamentInitialized(uint256 indexed tournamentId, uint256 bountyPool, uint256 centralPool, uint8 playerCount);
    event BountyTransferred(uint256 indexed tournamentId, address indexed winner, address indexed loser, uint256 amount);
    event BountyClaimed(uint256 indexed tournamentId, address indexed agent, uint256 amount);
    event ManagerAuthorized(address indexed manager, bool authorized);

    // ── Modifiers ──────────────────────────────────────────────────────────

    modifier onlyAuthority() {
        require(msg.sender == authority, "Unauthorized");
        _;
    }

    modifier onlyAuthorized() {
        require(authorizedManagers[msg.sender] || msg.sender == authority, "Not authorized");
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────────

    constructor(address _usdc) {
        require(_usdc != address(0), "Zero address");
        usdc = IERC20Minimal(_usdc);
        authority = msg.sender;
    }

    // ── Admin ──────────────────────────────────────────────────────────────

    function setAuthorizedManager(address manager, bool authorized) external onlyAuthority {
        require(manager != address(0), "Zero address");
        authorizedManagers[manager] = authorized;
        emit ManagerAuthorized(manager, authorized);
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

    // ── Bounty Initialization ──────────────────────────────────────────────

    /// @notice Initialize bounties for a tournament
    /// @dev Called after registration closes. Splits total collected into:
    ///      50% bounty pool (divided equally among players)
    ///      50% central pool (distributed via payout tables after rake)
    /// @param tournamentId The V4 tournament ID
    /// @param totalCollected Total USDC collected from entry fees
    /// @param players Array of registered player addresses
    function initializeBounties(
        uint256 tournamentId,
        uint256 totalCollected,
        address[] calldata players
    ) external onlyAuthorized {
        require(!bountyTournaments[tournamentId].initialized, "Already initialized");
        require(players.length >= 2, "Need at least 2 players");
        require(totalCollected > 0, "Zero pool");

        uint256 bountyPool = totalCollected / 2;
        uint256 centralPool = totalCollected - bountyPool;
        uint256 perPlayerBounty = bountyPool / players.length;

        bountyTournaments[tournamentId] = BountyTournament({
            tournamentId: tournamentId,
            totalPool: totalCollected,
            bountyPool: bountyPool,
            centralPool: centralPool,
            playerCount: uint8(players.length),
            initialized: true,
            finalized: false
        });

        // Distribute equal bounty to each player
        for (uint256 i = 0; i < players.length; i++) {
            agentBounty[tournamentId][players[i]] = perPlayerBounty;
        }

        emit BountyTournamentInitialized(tournamentId, bountyPool, centralPool, uint8(players.length));
    }

    // ── Bounty Transfers ───────────────────────────────────────────────────

    /// @notice Transfer bounty from loser to winner after a game
    /// @dev Cumulative — winner gets loser's entire accumulated bounty
    function transferBounty(
        uint256 tournamentId,
        address winner,
        address loser
    ) external onlyAuthorized {
        BountyTournament storage bt = bountyTournaments[tournamentId];
        require(bt.initialized, "Not initialized");
        require(!bt.finalized, "Already finalized");

        uint256 loserBounty = agentBounty[tournamentId][loser];
        if (loserBounty > 0) {
            agentBounty[tournamentId][loser] = 0;
            agentBounty[tournamentId][winner] += loserBounty;
            emit BountyTransferred(tournamentId, winner, loser, loserBounty);
        }
    }

    /// @notice Finalize bounty tournament — marks it for claiming
    function finalizeBounties(uint256 tournamentId) external onlyAuthorized {
        BountyTournament storage bt = bountyTournaments[tournamentId];
        require(bt.initialized, "Not initialized");
        require(!bt.finalized, "Already finalized");
        bt.finalized = true;
    }

    /// @notice Agent claims their accumulated bounty after tournament
    function claimBounty(uint256 tournamentId) external {
        BountyTournament storage bt = bountyTournaments[tournamentId];
        require(bt.finalized, "Not finalized");
        require(!bountyClaimed[tournamentId][msg.sender], "Already claimed");

        uint256 amount = agentBounty[tournamentId][msg.sender];
        require(amount > 0, "No bounty to claim");

        bountyClaimed[tournamentId][msg.sender] = true;
        require(usdc.transfer(msg.sender, amount), "Transfer failed");

        emit BountyClaimed(tournamentId, msg.sender, amount);
    }

    // ── Views ──────────────────────────────────────────────────────────────

    /// @notice Get agent's current bounty in a tournament
    function getAgentBounty(uint256 tournamentId, address agent) external view returns (uint256) {
        return agentBounty[tournamentId][agent];
    }

    /// @notice Get bounty tournament details
    function getBountyTournament(uint256 tournamentId) external view returns (BountyTournament memory) {
        return bountyTournaments[tournamentId];
    }

    /// @notice Get the central pool amount (for standard payout distribution)
    function getCentralPool(uint256 tournamentId) external view returns (uint256) {
        return bountyTournaments[tournamentId].centralPool;
    }
}
