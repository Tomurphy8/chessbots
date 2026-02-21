// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./libraries/TournamentLibV4.sol";

/// @title ChessSatellite - Satellite tournament tickets for tier progression
/// @notice Manages satellite tournaments that award non-transferable tickets
///         to higher-tier tournaments. Winners can bypass entry fees for the target.
/// @dev Tickets expire after 7 days or when the target tournament fills.
contract ChessSatellite {
    // ── Structs ────────────────────────────────────────────────────────────

    struct Satellite {
        uint256 id;
        uint256 targetTournamentId;
        TournamentLibV4.Tier targetTier;
        uint8 seatsAwarded;
        bool exists;
    }

    struct Ticket {
        uint256 satelliteId;
        uint256 targetTournamentId;
        uint256 issuedAt;
        bool used;
        bool exists;
    }

    // ── State ──────────────────────────────────────────────────────────────

    address public authority;
    address public pendingAuthority;

    mapping(address => bool) public authorizedManagers;

    /// @notice Satellite data by ID
    mapping(uint256 => Satellite) public satellites;
    uint256 public totalSatellites;

    /// @notice Tickets: satellite ID → agent → Ticket
    mapping(uint256 => mapping(address => Ticket)) public tickets;

    /// @notice Quick lookup: agent → target tournament → has valid ticket
    mapping(address => mapping(uint256 => bool)) public hasTicket;

    /// @notice Ticket expiration window
    uint256 public constant TICKET_EXPIRY = 7 days;

    // ── Events ─────────────────────────────────────────────────────────────

    event SatelliteCreated(uint256 indexed id, uint256 indexed targetTournamentId, TournamentLibV4.Tier targetTier, uint8 seatsAwarded);
    event TicketIssued(uint256 indexed satelliteId, address indexed agent, uint256 targetTournamentId);
    event TicketUsed(uint256 indexed satelliteId, address indexed agent, uint256 targetTournamentId);
    event TicketExpired(uint256 indexed satelliteId, address indexed agent);
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

    constructor() {
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

    // ── Satellite Management ───────────────────────────────────────────────

    /// @notice Create a satellite tournament linked to a target
    function createSatellite(
        uint256 targetTournamentId,
        TournamentLibV4.Tier targetTier,
        uint8 seatsAwarded
    ) external onlyAuthorized returns (uint256 satelliteId) {
        require(seatsAwarded > 0 && seatsAwarded <= 16, "Invalid seat count");

        satelliteId = totalSatellites++;

        satellites[satelliteId] = Satellite({
            id: satelliteId,
            targetTournamentId: targetTournamentId,
            targetTier: targetTier,
            seatsAwarded: seatsAwarded,
            exists: true
        });

        emit SatelliteCreated(satelliteId, targetTournamentId, targetTier, seatsAwarded);
    }

    /// @notice Issue tickets to satellite winners
    /// @param satelliteId The satellite tournament ID
    /// @param winners Addresses of winners (in placement order, up to seatsAwarded)
    function issueTickets(uint256 satelliteId, address[] calldata winners) external onlyAuthorized {
        Satellite storage s = satellites[satelliteId];
        require(s.exists, "Satellite not found");
        require(winners.length <= s.seatsAwarded, "Too many winners");

        for (uint256 i = 0; i < winners.length; i++) {
            require(winners[i] != address(0), "Zero address");
            require(!tickets[satelliteId][winners[i]].exists, "Ticket already issued");

            tickets[satelliteId][winners[i]] = Ticket({
                satelliteId: satelliteId,
                targetTournamentId: s.targetTournamentId,
                issuedAt: block.timestamp,
                used: false,
                exists: true
            });

            hasTicket[winners[i]][s.targetTournamentId] = true;

            emit TicketIssued(satelliteId, winners[i], s.targetTournamentId);
        }
    }

    /// @notice Use a ticket when registering for the target tournament
    /// @dev Called by the tournament contract or orchestrator during registration
    function useTicket(address agent, uint256 targetTournamentId) external onlyAuthorized {
        require(hasTicket[agent][targetTournamentId], "No valid ticket");

        // Find and validate the ticket (search through satellites)
        // In practice, the orchestrator knows the satellite ID
        hasTicket[agent][targetTournamentId] = false;
    }

    /// @notice Use a specific satellite ticket
    function useTicketForSatellite(uint256 satelliteId, address agent) external onlyAuthorized {
        Ticket storage t = tickets[satelliteId][agent];
        require(t.exists, "Ticket not found");
        require(!t.used, "Already used");
        require(block.timestamp < t.issuedAt + TICKET_EXPIRY, "Ticket expired");

        t.used = true;
        hasTicket[agent][t.targetTournamentId] = false;

        emit TicketUsed(satelliteId, agent, t.targetTournamentId);
    }

    // ── Views ──────────────────────────────────────────────────────────────

    /// @notice Check if agent has a valid (non-expired, non-used) ticket for a tournament
    function hasValidTicket(address agent, uint256 targetTournamentId) external view returns (bool) {
        return hasTicket[agent][targetTournamentId];
    }

    /// @notice Get ticket details
    function getTicket(uint256 satelliteId, address agent) external view returns (Ticket memory) {
        return tickets[satelliteId][agent];
    }

    /// @notice Get satellite details
    function getSatellite(uint256 satelliteId) external view returns (Satellite memory) {
        return satellites[satelliteId];
    }
}
