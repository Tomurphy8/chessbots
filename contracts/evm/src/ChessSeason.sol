// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./libraries/TournamentLibV4.sol";

/// @title ChessSeason - Competitive season management with point tracking
/// @notice Manages 4-week seasons with tier-weighted points, consistency bonuses,
///         and season leaderboards. Points are awarded per tier and placement.
/// @dev Season points tables per spec:
///      Tier    | 1st | 2nd | 3rd | 4th-8th | Participation
///      Free    | 10  |  7  |  5  |    3    |      1
///      Rookie  | 25  | 18  | 12  |    8    |      3
///      Bronze  | 50  | 35  | 25  | 15      |      5
///      Silver  | 100 | 70  | 50  | 30      |     10
///      Masters | 200 | 140 | 100 | 60      |     20
///      Legends | 400 | 280 | 200 | 120     |     40
contract ChessSeason {
    // ── Structs ────────────────────────────────────────────────────────────

    struct Season {
        uint256 id;
        uint256 startTime;
        uint256 endTime;
        bool rewardsDistributed;
        bool exists;
    }

    // ── State ──────────────────────────────────────────────────────────────

    address public authority;
    address public pendingAuthority;

    /// @notice Addresses authorized to record tournament results
    mapping(address => bool) public authorizedRecorders;

    /// @notice Season data by ID
    mapping(uint256 => Season) public seasons;

    /// @notice Current season ID
    uint256 public currentSeasonId;

    /// @notice Total seasons created
    uint256 public totalSeasons;

    /// @notice Season points per agent per season
    mapping(uint256 => mapping(address => uint256)) public seasonPoints;

    /// @notice Tournament count per agent per season (for consistency bonus)
    mapping(uint256 => mapping(address => uint16)) public seasonTournamentCount;

    /// @notice Tracks which tournaments have already been recorded for a season
    mapping(uint256 => mapping(uint256 => bool)) public tournamentRecorded;

    // ── Constants ──────────────────────────────────────────────────────────

    uint256 public constant DEFAULT_SEASON_DURATION = 4 weeks;

    /// @notice Consistency bonus multiplier thresholds (in basis points)
    uint16 public constant CONSISTENCY_BONUS_10_BPS = 12500;  // 1.25x at 10+ tournaments
    uint16 public constant CONSISTENCY_BONUS_20_BPS = 15000;  // 1.5x at 20+ tournaments
    uint16 public constant BPS_BASE = 10000;

    // ── Events ─────────────────────────────────────────────────────────────

    event SeasonStarted(uint256 indexed seasonId, uint256 startTime, uint256 endTime);
    event SeasonEnded(uint256 indexed seasonId);
    event TournamentResultRecorded(
        uint256 indexed seasonId,
        uint256 indexed tournamentId,
        uint8 playerCount,
        TournamentLibV4.Tier tier
    );
    event SeasonPointsAwarded(
        uint256 indexed seasonId,
        address indexed agent,
        uint256 points,
        uint16 placement,
        TournamentLibV4.Tier tier
    );
    event RecorderAuthorized(address indexed recorder, bool authorized);

    // ── Modifiers ──────────────────────────────────────────────────────────

    modifier onlyAuthority() {
        require(msg.sender == authority, "Unauthorized");
        _;
    }

    modifier onlyAuthorized() {
        require(authorizedRecorders[msg.sender] || msg.sender == authority, "Not authorized");
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────────

    constructor() {
        authority = msg.sender;
    }

    // ── Admin ──────────────────────────────────────────────────────────────

    function setAuthorizedRecorder(address recorder, bool authorized) external onlyAuthority {
        require(recorder != address(0), "Zero address");
        authorizedRecorders[recorder] = authorized;
        emit RecorderAuthorized(recorder, authorized);
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

    // ── Season Lifecycle ───────────────────────────────────────────────────

    /// @notice Start a new season
    /// @param duration Season duration in seconds (0 for default 4 weeks)
    function startSeason(uint256 duration) external onlyAuthority {
        // End current season if one is active
        if (totalSeasons > 0) {
            Season storage current = seasons[currentSeasonId];
            if (current.exists && block.timestamp >= current.endTime) {
                // Season already expired, just mark it
            } else if (current.exists) {
                revert("Current season still active");
            }
        }

        uint256 dur = duration > 0 ? duration : DEFAULT_SEASON_DURATION;
        uint256 seasonId = totalSeasons;

        seasons[seasonId] = Season({
            id: seasonId,
            startTime: block.timestamp,
            endTime: block.timestamp + dur,
            rewardsDistributed: false,
            exists: true
        });

        currentSeasonId = seasonId;
        totalSeasons++;

        emit SeasonStarted(seasonId, block.timestamp, block.timestamp + dur);
    }

    /// @notice End the current season early (admin only)
    function endSeason() external onlyAuthority {
        Season storage current = seasons[currentSeasonId];
        require(current.exists, "No active season");
        current.endTime = block.timestamp;
        emit SeasonEnded(currentSeasonId);
    }

    // ── Tournament Result Recording ────────────────────────────────────────

    /// @notice Record tournament results and award season points
    /// @param seasonId Season to record for
    /// @param tournamentId Tournament that completed
    /// @param agents Agents in placement order (1st, 2nd, 3rd, ...)
    /// @param tier Tournament tier
    function recordTournamentResult(
        uint256 seasonId,
        uint256 tournamentId,
        address[] calldata agents,
        TournamentLibV4.Tier tier
    ) external onlyAuthorized {
        Season storage s = seasons[seasonId];
        require(s.exists, "Season not found");
        require(!tournamentRecorded[seasonId][tournamentId], "Already recorded");

        tournamentRecorded[seasonId][tournamentId] = true;

        for (uint256 i = 0; i < agents.length; i++) {
            uint16 placement = uint16(i + 1);
            uint256 points = _getPoints(tier, placement);

            seasonPoints[seasonId][agents[i]] += points;
            seasonTournamentCount[seasonId][agents[i]]++;

            emit SeasonPointsAwarded(seasonId, agents[i], points, placement, tier);
        }

        emit TournamentResultRecorded(seasonId, tournamentId, uint8(agents.length), tier);
    }

    /// @notice Mark season rewards as distributed
    function markRewardsDistributed(uint256 seasonId) external onlyAuthority {
        Season storage s = seasons[seasonId];
        require(s.exists, "Season not found");
        require(!s.rewardsDistributed, "Already distributed");
        s.rewardsDistributed = true;
    }

    // ── Views ──────────────────────────────────────────────────────────────

    /// @notice Get current season info
    function getCurrentSeason() external view returns (uint256 seasonId, uint256 startTime, uint256 endTime, bool active) {
        if (totalSeasons == 0) return (0, 0, 0, false);
        Season storage s = seasons[currentSeasonId];
        return (s.id, s.startTime, s.endTime, block.timestamp < s.endTime);
    }

    /// @notice Get agent's season points with consistency bonus applied
    function getSeasonPointsWithBonus(uint256 seasonId, address agent) external view returns (uint256) {
        uint256 basePoints = seasonPoints[seasonId][agent];
        uint16 tournamentCount = seasonTournamentCount[seasonId][agent];
        return _applyConsistencyBonus(basePoints, tournamentCount);
    }

    /// @notice Get raw (pre-bonus) season points
    function getSeasonPoints(uint256 seasonId, address agent) external view returns (uint256) {
        return seasonPoints[seasonId][agent];
    }

    /// @notice Get tournament count for consistency bonus tracking
    function getTournamentCount(uint256 seasonId, address agent) external view returns (uint16) {
        return seasonTournamentCount[seasonId][agent];
    }

    /// @notice Get the consistency bonus multiplier for a tournament count
    function getConsistencyMultiplier(uint16 tournamentCount) external pure returns (uint16) {
        if (tournamentCount >= 20) return CONSISTENCY_BONUS_20_BPS;
        if (tournamentCount >= 10) return CONSISTENCY_BONUS_10_BPS;
        return BPS_BASE;
    }

    // ── Internal ───────────────────────────────────────────────────────────

    /// @notice Get base points for a tier and placement
    function _getPoints(TournamentLibV4.Tier tier, uint16 placement) internal pure returns (uint256) {
        if (tier == TournamentLibV4.Tier.Free) {
            if (placement == 1) return 10;
            if (placement == 2) return 7;
            if (placement == 3) return 5;
            if (placement <= 8) return 3;
            return 1;
        }
        if (tier == TournamentLibV4.Tier.Rookie) {
            if (placement == 1) return 25;
            if (placement == 2) return 18;
            if (placement == 3) return 12;
            if (placement <= 8) return 8;
            return 3;
        }
        if (tier == TournamentLibV4.Tier.Bronze) {
            if (placement == 1) return 50;
            if (placement == 2) return 35;
            if (placement == 3) return 25;
            if (placement <= 8) return 15;
            return 5;
        }
        if (tier == TournamentLibV4.Tier.Silver) {
            if (placement == 1) return 100;
            if (placement == 2) return 70;
            if (placement == 3) return 50;
            if (placement <= 8) return 30;
            return 10;
        }
        if (tier == TournamentLibV4.Tier.Masters) {
            if (placement == 1) return 200;
            if (placement == 2) return 140;
            if (placement == 3) return 100;
            if (placement <= 8) return 60;
            return 20;
        }
        // Legends
        if (placement == 1) return 400;
        if (placement == 2) return 280;
        if (placement == 3) return 200;
        if (placement <= 8) return 120;
        return 40;
    }

    /// @notice Apply consistency bonus based on tournament count
    function _applyConsistencyBonus(uint256 basePoints, uint16 tournamentCount) internal pure returns (uint256) {
        if (tournamentCount >= 20) {
            return (basePoints * CONSISTENCY_BONUS_20_BPS) / BPS_BASE;
        }
        if (tournamentCount >= 10) {
            return (basePoints * CONSISTENCY_BONUS_10_BPS) / BPS_BASE;
        }
        return basePoints;
    }
}
