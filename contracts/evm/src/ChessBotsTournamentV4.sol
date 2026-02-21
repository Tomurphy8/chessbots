// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IChessBotsTournamentV4.sol";
import "./interfaces/IChessStaking.sol";
import "./interfaces/IERC20Minimal.sol";
import "./libraries/TournamentLibV4.sol";
import "./libraries/PayoutCalculator.sol";

interface IRevenueRouter {
    function routeRevenue(uint256 usdcAmount) external;
}

/// @title ChessBotsTournamentV4 - Dynamic payouts, progressive rake, brackets
/// @notice V4 extends V3 with: dynamic payout tables that scale with field size,
///         per-tier progressive rake, bracket-filtered registration, heartbeat system,
///         and all protocol revenue routed through ChessRevenueRouter.
/// @dev V3 remains live for historical tournaments. V4 is deployed as a new contract.
contract ChessBotsTournamentV4 is IChessBotsTournamentV4 {
    using TournamentLibV4 for TournamentLibV4.Tier;

    // ── Structs ────────────────────────────────────────────────────────────

    struct ProtocolState {
        address authority;
        address treasury;
        uint64 totalTournaments;
        uint256 totalPrizeDistributed;
        bool paused;
        uint16 sponsoredFreeTournaments;
        uint16 maxFreeTournaments;
    }

    uint64 public totalGamesPlayed;

    struct AgentProfile {
        address wallet;
        string name;
        string metadataUri;
        TournamentLibV4.AgentType agentType;
        uint16 eloRating;
        uint32 gamesPlayed;
        uint32 gamesWon;
        uint32 gamesDrawn;
        uint32 gamesLost;
        uint64 totalEarnings;
        address referredBy;
        bool registered;
    }

    struct Tournament {
        uint256 id;
        address authority;
        TournamentLibV4.Tier tier;
        TournamentLibV4.Format format;
        TournamentLibV4.TournamentType tournamentType;
        TournamentLibV4.Bracket bracket;
        uint256 entryFee;
        TournamentLibV4.TournamentStatus status;
        uint8 maxPlayers;
        uint8 minPlayers;
        uint8 registeredCount;
        uint8 currentRound;
        uint8 totalRounds;
        uint8 teamSize;
        uint8 bestOf;
        int64 startTime;
        int64 registrationDeadline;
        uint32 baseTimeSeconds;
        uint32 incrementSeconds;
        string resultsUri;
        bool prizeDistributed;
        bool exists;
        address challengeTarget;
    }

    struct Registration {
        address agent;
        uint16 score;
        uint16 buchholz;
        uint8 gamesPlayed;
        uint8 gamesWon;
        uint8 gamesDrawn;
        uint8 gamesLost;
        uint8 finalRank;
        bool active;
        bool exists;
    }

    struct Game {
        uint256 tournamentId;
        uint8 round;
        uint8 gameIndex;
        address white;
        address black;
        TournamentLibV4.GameStatus status;
        TournamentLibV4.GameResult result;
        uint16 moveCount;
        int64 startedAt;
        int64 endedAt;
        bytes32 pgnHash;
        bytes32 resultHash;
        address arbiter;
        bool exists;
    }

    // ── Batch Input Structs ────────────────────────────────────────────────

    struct GameInput {
        uint8 gameIndex;
        address white;
        address black;
    }

    struct GameResultInput {
        uint8 gameIndex;
        TournamentLibV4.GameResult result;
        bytes32 pgnHash;
        bytes32 resultHash;
        uint16 moveCount;
    }

    struct StandingsInput {
        address agent;
        uint16 score;
        uint16 buchholz;
        uint8 gamesPlayed;
        uint8 gamesWon;
        uint8 gamesDrawn;
        uint8 gamesLost;
    }

    // ── State ──────────────────────────────────────────────────────────────

    ProtocolState public protocol;
    IERC20Minimal public immutable usdc;

    mapping(address => AgentProfile) public agents;
    mapping(uint256 => Tournament) public tournaments;
    mapping(uint256 => mapping(address => Registration)) public registrations;
    mapping(bytes32 => Game) public games;

    // V4: ranked finalization — stores full ranked list per tournament
    mapping(uint256 => address[]) public tournamentRankedPlayers;

    // ── Tokenomics State ───────────────────────────────────────────────────

    IERC20Minimal public chessToken;
    address public dexRouter;
    IChessStaking public stakingContract;
    IRevenueRouter public revenueRouter;

    mapping(uint256 => uint256) public tournamentCollected;
    mapping(uint256 => mapping(address => uint256)) public playerPayment;

    // V4: Per-tier rake overrides (0 = use default from TournamentLibV4)
    mapping(TournamentLibV4.Tier => uint16) public rakeOverrides;

    // ── Referral State ─────────────────────────────────────────────────────

    mapping(address => uint256) public referralEarnings;
    mapping(address => uint16) public referralTournamentsRemaining;
    mapping(uint256 => uint256) public tournamentReferralBonuses;
    mapping(address => uint16) public referralCount;
    mapping(uint256 => uint256) public tournamentRefereeDiscounts;

    uint16 public constant REFERRAL_FULL_RATE_TOURNAMENTS = 25;
    uint16 public constant REFERRAL_LONG_TAIL_BPS = 200;
    uint16 public constant REFEREE_DISCOUNT_BPS = 100;
    uint16 public constant TIER_BRONZE_BPS = 500;
    uint16 public constant TIER_SILVER_BPS = 700;
    uint16 public constant TIER_GOLD_BPS = 1000;
    uint16 public constant TIER_SILVER_THRESHOLD = 10;
    uint16 public constant TIER_GOLD_THRESHOLD = 25;

    // ── Sponsorship State ──────────────────────────────────────────────────

    struct Sponsorship {
        address sponsor;
        string name;
        string uri;
        uint256 amount;
    }
    mapping(uint256 => Sponsorship) public tournamentSponsors;
    uint16 public constant SPONSOR_PLATFORM_FEE_BPS = 1000;

    // ── Team State ─────────────────────────────────────────────────────────

    mapping(uint256 => mapping(uint8 => address[])) public teamRosters;
    mapping(uint256 => uint8) public teamCount;
    mapping(uint256 => mapping(address => uint8)) public agentTeamId;

    // ── V4: Heartbeat State ────────────────────────────────────────────────

    mapping(address => uint256) public lastHeartbeat;
    uint256 public heartbeatWindow = 2 hours;

    // ── Reentrancy ─────────────────────────────────────────────────────────

    uint256 private _reentrancyStatus;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    // ── Authority Transfer ─────────────────────────────────────────────────

    address public pendingAuthority;
    mapping(uint256 => mapping(address => bool)) public refundClaimed;

    // ── Modifiers ──────────────────────────────────────────────────────────

    modifier nonReentrant() {
        require(_reentrancyStatus != _ENTERED, "ReentrancyGuard: reentrant call");
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    modifier onlyAuthority() {
        require(msg.sender == protocol.authority, "Unauthorized");
        _;
    }

    modifier onlyRegisteredAgentOrAuthority() {
        require(
            agents[msg.sender].registered || msg.sender == protocol.authority,
            "Must be registered agent or authority"
        );
        _;
    }

    modifier onlyTournamentAuthority(uint256 tournamentId) {
        require(
            msg.sender == tournaments[tournamentId].authority || msg.sender == protocol.authority,
            "Unauthorized"
        );
        _;
    }

    modifier whenNotPaused() {
        require(!protocol.paused, "Protocol paused");
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────────

    constructor(address _usdc, address _treasury) {
        require(_usdc != address(0), "Zero USDC address");
        require(_treasury != address(0), "Zero treasury address");

        usdc = IERC20Minimal(_usdc);
        protocol.authority = msg.sender;
        protocol.treasury = _treasury;
        protocol.maxFreeTournaments = TournamentLibV4.MAX_SPONSORED_FREE_DEFAULT;
        _reentrancyStatus = _NOT_ENTERED;

        emit ProtocolInitialized(msg.sender, _treasury);
    }

    // ════════════════════════════════════════════════════════════════════════
    //                           ADMIN FUNCTIONS
    // ════════════════════════════════════════════════════════════════════════

    function proposeAuthority(address _newAuthority) external onlyAuthority {
        require(_newAuthority != address(0), "Zero address");
        pendingAuthority = _newAuthority;
        emit AuthorityTransferProposed(msg.sender, _newAuthority);
    }

    function acceptAuthority() external {
        require(msg.sender == pendingAuthority, "Not pending authority");
        address oldAuthority = protocol.authority;
        protocol.authority = msg.sender;
        pendingAuthority = address(0);
        emit AuthorityTransferAccepted(oldAuthority, msg.sender);
    }

    function setPaused(bool _paused) external onlyAuthority {
        protocol.paused = _paused;
        emit PausedStateChanged(_paused);
    }

    function setTreasury(address _newTreasury) external onlyAuthority {
        require(_newTreasury != address(0), "Zero address");
        address oldTreasury = protocol.treasury;
        protocol.treasury = _newTreasury;
        emit TreasuryUpdated(oldTreasury, _newTreasury);
    }

    function setFreeTournamentLimit(uint16 _newLimit) external onlyAuthority {
        protocol.maxFreeTournaments = _newLimit;
        emit FreeTournamentLimitUpdated(_newLimit);
    }

    function setChessToken(address _token) external onlyAuthority {
        require(_token != address(0), "Zero address");
        chessToken = IERC20Minimal(_token);
        emit ChessTokenUpdated(_token);
    }

    function setDexRouter(address _router) external onlyAuthority {
        require(_router != address(0), "Zero address");
        dexRouter = _router;
        emit DexRouterUpdated(_router);
    }

    function setStakingContract(address _staking) external onlyAuthority {
        require(_staking != address(0), "Zero address");
        stakingContract = IChessStaking(_staking);
        emit StakingContractUpdated(_staking);
    }

    function setRevenueRouter(address _router) external onlyAuthority {
        require(_router != address(0), "Zero address");
        revenueRouter = IRevenueRouter(_router);
        emit RevenueRouterUpdated(_router);
    }

    /// @notice Override the default rake for a specific tier
    /// @param tier The tier to override
    /// @param newRakeBps New rake in basis points (0 to use default, max 2000)
    function setRakeOverride(TournamentLibV4.Tier tier, uint16 newRakeBps) external onlyAuthority {
        require(newRakeBps <= 2000, "Rake too high");
        rakeOverrides[tier] = newRakeBps;
        emit RakeOverrideSet(tier, newRakeBps);
    }

    /// @notice Set the heartbeat window (time before agent is considered inactive)
    function setHeartbeatWindow(uint256 _window) external onlyAuthority {
        require(_window >= 30 minutes && _window <= 24 hours, "Invalid window");
        heartbeatWindow = _window;
        emit HeartbeatWindowUpdated(_window);
    }

    function fundTournament(uint256 tournamentId, uint256 amount) external onlyAuthority nonReentrant {
        Tournament storage t = tournaments[tournamentId];
        require(t.exists, "Tournament not found");
        require(!t.prizeDistributed, "Prizes already distributed");
        require(t.status != TournamentLibV4.TournamentStatus.Cancelled, "Tournament cancelled");
        require(amount > 0, "Zero amount");

        require(usdc.transferFrom(msg.sender, address(this), amount), "USDC transfer failed");
        tournamentCollected[tournamentId] += amount;

        emit TournamentFunded(tournamentId, amount);
    }

    // ════════════════════════════════════════════════════════════════════════
    //                           HEARTBEAT
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Agent sends periodic heartbeat to prove liveness
    function heartbeat() external {
        require(agents[msg.sender].registered, "Agent not registered");
        lastHeartbeat[msg.sender] = block.timestamp;
        emit HeartbeatReceived(msg.sender, block.timestamp);
    }

    // ════════════════════════════════════════════════════════════════════════
    //                           REFERRAL CLAIMS
    // ════════════════════════════════════════════════════════════════════════

    function claimReferralEarnings() external nonReentrant {
        uint256 amount = referralEarnings[msg.sender];
        require(amount > 0, "No referral earnings");
        referralEarnings[msg.sender] = 0;
        require(usdc.transfer(msg.sender, amount), "Referral transfer failed");
        emit ReferralEarningsClaimed(msg.sender, amount);
    }

    // ════════════════════════════════════════════════════════════════════════
    //                           SPONSORSHIP
    // ════════════════════════════════════════════════════════════════════════

    function sponsorTournament(
        uint256 tournamentId,
        uint256 amount,
        string calldata sponsorName,
        string calldata sponsorUri
    ) external whenNotPaused nonReentrant {
        Tournament storage t = tournaments[tournamentId];
        require(t.exists, "Tournament not found");
        require(!t.prizeDistributed, "Prizes already distributed");
        require(t.status != TournamentLibV4.TournamentStatus.Cancelled, "Tournament cancelled");
        require(amount > 0, "Zero amount");
        require(tournamentSponsors[tournamentId].sponsor == address(0), "Already sponsored");
        require(bytes(sponsorName).length > 0 && bytes(sponsorName).length <= 64, "Invalid sponsor name");

        require(usdc.transferFrom(msg.sender, address(this), amount), "USDC transfer failed");

        uint256 platformFee = (amount * SPONSOR_PLATFORM_FEE_BPS) / TournamentLibV4.BPS_DENOMINATOR;
        uint256 prizeContribution = amount - platformFee;

        if (platformFee > 0) {
            require(usdc.transfer(protocol.treasury, platformFee), "Treasury transfer failed");
        }

        tournamentCollected[tournamentId] += prizeContribution;

        tournamentSponsors[tournamentId] = Sponsorship({
            sponsor: msg.sender,
            name: sponsorName,
            uri: sponsorUri,
            amount: amount
        });

        emit TournamentSponsored(tournamentId, msg.sender, amount, platformFee);
    }

    function getSponsor(uint256 tournamentId) external view returns (Sponsorship memory) {
        return tournamentSponsors[tournamentId];
    }

    // ════════════════════════════════════════════════════════════════════════
    //                           AGENT REGISTRATION
    // ════════════════════════════════════════════════════════════════════════

    function registerAgent(
        string calldata name,
        string calldata metadataUri,
        TournamentLibV4.AgentType agentType
    ) external whenNotPaused {
        _registerAgent(name, metadataUri, agentType, address(0));
    }

    function registerAgentWithReferral(
        string calldata name,
        string calldata metadataUri,
        TournamentLibV4.AgentType agentType,
        address referrer
    ) external whenNotPaused {
        _registerAgent(name, metadataUri, agentType, referrer);
    }

    function _registerAgent(
        string calldata name,
        string calldata metadataUri,
        TournamentLibV4.AgentType agentType,
        address referrer
    ) internal {
        require(!agents[msg.sender].registered, "Already registered");
        require(bytes(name).length > 0 && bytes(name).length <= 32, "Invalid name");

        if (referrer != address(0)) {
            require(referrer != msg.sender, "Cannot self-refer");
            require(agents[referrer].registered, "Referrer not registered");
        }

        agents[msg.sender] = AgentProfile({
            wallet: msg.sender,
            name: name,
            metadataUri: metadataUri,
            agentType: agentType,
            eloRating: 1200,
            gamesPlayed: 0,
            gamesWon: 0,
            gamesDrawn: 0,
            gamesLost: 0,
            totalEarnings: 0,
            referredBy: referrer,
            registered: true
        });

        // Initialize heartbeat so new agents have grace period
        lastHeartbeat[msg.sender] = block.timestamp;

        if (referrer != address(0)) {
            referralTournamentsRemaining[msg.sender] = REFERRAL_FULL_RATE_TOURNAMENTS;
            referralCount[referrer]++;
            uint16 newCount = referralCount[referrer];
            if (newCount == TIER_SILVER_THRESHOLD || newCount == TIER_GOLD_THRESHOLD) {
                emit ReferralTierChanged(referrer, newCount >= TIER_GOLD_THRESHOLD ? 2 : 1, getReferrerTierBps(referrer));
            }
            emit ReferralRegistered(msg.sender, referrer);
        }

        emit AgentRegistered(msg.sender, name, agentType);
    }

    // ════════════════════════════════════════════════════════════════════════
    //                        TOURNAMENT CREATION
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Create a standard tournament with bracket filter
    function createTournament(
        TournamentLibV4.Tier tier,
        TournamentLibV4.Format format,
        TournamentLibV4.Bracket bracket,
        uint8 maxPlayers,
        uint8 minPlayers,
        int64 startTime,
        int64 registrationDeadline,
        uint32 baseTimeSeconds,
        uint32 incrementSeconds
    ) external onlyRegisteredAgentOrAuthority whenNotPaused {
        _createTournament(
            tier, format, TournamentLibV4.TournamentType.Standard, bracket,
            maxPlayers, minPlayers, startTime, registrationDeadline,
            baseTimeSeconds, incrementSeconds, 0, 0, 1, address(0)
        );
    }

    /// @notice Create a 1v1 match challenge
    function createMatchChallenge(
        TournamentLibV4.Tier tier,
        int64 startTime,
        int64 registrationDeadline,
        uint32 baseTimeSeconds,
        uint32 incrementSeconds,
        uint8 bestOf,
        address opponent
    ) external onlyRegisteredAgentOrAuthority whenNotPaused {
        _createTournament(
            tier, TournamentLibV4.Format.Match, TournamentLibV4.TournamentType.Standard,
            TournamentLibV4.Bracket.Open,
            2, 2, startTime, registrationDeadline,
            baseTimeSeconds, incrementSeconds, 0, 0, bestOf, opponent
        );
    }

    /// @notice Create a team tournament
    function createTeamTournament(
        TournamentLibV4.Tier tier,
        TournamentLibV4.Bracket bracket,
        uint8 maxTeams,
        uint8 minTeams,
        int64 startTime,
        int64 registrationDeadline,
        uint32 baseTimeSeconds,
        uint32 incrementSeconds,
        uint8 teamSize
    ) external onlyRegisteredAgentOrAuthority whenNotPaused {
        require(teamSize >= 2 && teamSize <= 10, "Team size must be 2-10");
        require(maxTeams >= 2 && maxTeams <= TournamentLibV4.MAX_TEAMS, "Invalid team count");
        require(minTeams >= 2 && minTeams <= maxTeams, "Invalid min teams");
        _createTournament(
            tier, TournamentLibV4.Format.Team, TournamentLibV4.TournamentType.Standard, bracket,
            maxTeams, minTeams, startTime, registrationDeadline,
            baseTimeSeconds, incrementSeconds, 0, teamSize, 0, address(0)
        );
    }

    /// @notice Create a Legends tier tournament with custom entry fee
    function createLegendsTournament(
        TournamentLibV4.Format format,
        TournamentLibV4.Bracket bracket,
        uint8 maxPlayers,
        uint8 minPlayers,
        int64 startTime,
        int64 registrationDeadline,
        uint32 baseTimeSeconds,
        uint32 incrementSeconds,
        uint256 customEntryFee
    ) external onlyRegisteredAgentOrAuthority whenNotPaused {
        require(customEntryFee >= TournamentLibV4.LEGENDS_MIN_ENTRY, "Legends min 500 USDC");
        _createTournament(
            TournamentLibV4.Tier.Legends, format, TournamentLibV4.TournamentType.Standard, bracket,
            maxPlayers, minPlayers, startTime, registrationDeadline,
            baseTimeSeconds, incrementSeconds, customEntryFee, 0, 1, address(0)
        );
    }

    function _createTournament(
        TournamentLibV4.Tier tier,
        TournamentLibV4.Format format,
        TournamentLibV4.TournamentType tournamentType,
        TournamentLibV4.Bracket bracket,
        uint8 maxPlayers,
        uint8 minPlayers,
        int64 startTime,
        int64 registrationDeadline,
        uint32 baseTimeSeconds,
        uint32 incrementSeconds,
        uint256 customEntryFee,
        uint8 teamSize,
        uint8 bestOf,
        address challengeTarget
    ) internal {
        TournamentLibV4.validateMinPlayers(minPlayers, format);
        TournamentLibV4.validateMaxPlayers(maxPlayers, format);
        require(minPlayers <= maxPlayers, "Invalid min players");
        require(baseTimeSeconds > 0, "Invalid time control");
        require(startTime > 0, "Invalid start time");
        require(registrationDeadline > 0, "Invalid deadline");
        require(uint256(uint64(registrationDeadline)) > block.timestamp, "Deadline must be in future");
        require(uint256(uint64(startTime)) > block.timestamp, "Start must be in future");
        require(registrationDeadline < startTime, "Deadline must be before start");

        if (format == TournamentLibV4.Format.Match) {
            require(bestOf == 1 || bestOf == 3 || bestOf == 5, "bestOf must be 1, 3, or 5");
        }

        if (tier == TournamentLibV4.Tier.Free) {
            require(protocol.sponsoredFreeTournaments < protocol.maxFreeTournaments, "Free tournament limit reached");
            protocol.sponsoredFreeTournaments++;
        }

        uint256 fee = tier == TournamentLibV4.Tier.Legends ? customEntryFee : tier.entryFee();

        uint256 id = protocol.totalTournaments;
        protocol.totalTournaments++;

        tournaments[id] = Tournament({
            id: id,
            authority: msg.sender,
            tier: tier,
            format: format,
            tournamentType: tournamentType,
            bracket: bracket,
            entryFee: fee,
            status: TournamentLibV4.TournamentStatus.Registration,
            maxPlayers: maxPlayers,
            minPlayers: minPlayers,
            registeredCount: 0,
            currentRound: 0,
            totalRounds: 0,
            teamSize: teamSize,
            bestOf: bestOf > 0 ? bestOf : 1,
            startTime: startTime,
            registrationDeadline: registrationDeadline,
            baseTimeSeconds: baseTimeSeconds,
            incrementSeconds: incrementSeconds,
            resultsUri: "",
            prizeDistributed: false,
            exists: true,
            challengeTarget: challengeTarget
        });

        emit TournamentCreated(id, tier, format, tournamentType, bracket, fee, maxPlayers);

        if (format == TournamentLibV4.Format.Match && challengeTarget != address(0)) {
            emit MatchChallengeCreated(id, msg.sender, challengeTarget);
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //                          REGISTRATION
    // ════════════════════════════════════════════════════════════════════════

    function registerForTournament(uint256 tournamentId) external whenNotPaused nonReentrant {
        Tournament storage t = tournaments[tournamentId];
        require(t.exists, "Tournament not found");
        require(t.status == TournamentLibV4.TournamentStatus.Registration, "Not in registration");
        require(t.registeredCount < t.maxPlayers, "Tournament full");
        require(agents[msg.sender].registered, "Agent not registered");
        require(!registrations[tournamentId][msg.sender].exists, "Already registered");
        require(block.timestamp < uint256(uint64(t.registrationDeadline)), "Registration closed");

        // V3 compat: Match challenge — only target opponent can join
        if (t.format == TournamentLibV4.Format.Match && t.challengeTarget != address(0)) {
            if (t.registeredCount > 0) {
                require(msg.sender == t.challengeTarget, "Not the challenged opponent");
            }
        }

        // Team format: use registerTeam() instead
        require(t.format != TournamentLibV4.Format.Team, "Use registerTeam for team tournaments");

        // V4: Bracket eligibility check
        if (t.bracket != TournamentLibV4.Bracket.Open) {
            TournamentLibV4.Bracket agentBracket = _getAgentBracket(msg.sender);
            require(
                TournamentLibV4.isBracketEligible(agentBracket, t.bracket),
                "Bracket ineligible"
            );
        }

        // Payment with progressive rake awareness
        if (t.entryFee > 0) {
            uint256 actualFee = t.entryFee;

            // Staking discount
            if (address(stakingContract) != address(0)) {
                uint16 discountBps = stakingContract.getDiscount(msg.sender);
                if (discountBps > 0) {
                    uint256 discount = (t.entryFee * discountBps) / TournamentLibV4.BPS_DENOMINATOR;
                    actualFee = t.entryFee - discount;
                    emit DiscountApplied(tournamentId, msg.sender, discountBps, discount);
                }
            }

            // Referee discount
            address referrer = agents[msg.sender].referredBy;
            if (referrer != address(0)) {
                uint256 refereeDiscount = (actualFee * REFEREE_DISCOUNT_BPS) / TournamentLibV4.BPS_DENOMINATOR;
                actualFee -= refereeDiscount;
                tournamentRefereeDiscounts[tournamentId] += refereeDiscount;
            }

            require(usdc.transferFrom(msg.sender, address(this), actualFee), "USDC transfer failed");
            tournamentCollected[tournamentId] += actualFee;
            playerPayment[tournamentId][msg.sender] = actualFee;

            // Referral bonus
            if (referrer != address(0)) {
                uint16 rateBps;
                if (referralTournamentsRemaining[msg.sender] > 0) {
                    rateBps = getReferrerTierBps(referrer);
                    referralTournamentsRemaining[msg.sender]--;
                } else {
                    rateBps = REFERRAL_LONG_TAIL_BPS;
                }
                uint256 referralBonus = (actualFee * rateBps) / TournamentLibV4.BPS_DENOMINATOR;
                referralEarnings[referrer] += referralBonus;
                tournamentReferralBonuses[tournamentId] += referralBonus;
                emit ReferralBonusAccrued(tournamentId, referrer, msg.sender, referralBonus);
            }
        }

        registrations[tournamentId][msg.sender] = Registration({
            agent: msg.sender,
            score: 0, buchholz: 0,
            gamesPlayed: 0, gamesWon: 0, gamesDrawn: 0, gamesLost: 0,
            finalRank: 0, active: true, exists: true
        });

        t.registeredCount++;
        emit AgentJoined(tournamentId, msg.sender, t.registeredCount);
    }

    // ════════════════════════════════════════════════════════════════════════
    //                         TEAM REGISTRATION
    // ════════════════════════════════════════════════════════════════════════

    function registerTeam(
        uint256 tournamentId,
        address[] calldata members
    ) external whenNotPaused nonReentrant {
        Tournament storage t = tournaments[tournamentId];
        require(t.exists, "Tournament not found");
        require(t.format == TournamentLibV4.Format.Team, "Not a team tournament");
        require(t.status == TournamentLibV4.TournamentStatus.Registration, "Not in registration");
        require(t.registeredCount < t.maxPlayers, "Tournament full");
        require(members.length == t.teamSize, "Wrong team size");
        require(block.timestamp < uint256(uint64(t.registrationDeadline)), "Registration closed");
        require(agents[msg.sender].registered, "Captain not registered");

        uint8 newTeamId = teamCount[tournamentId];
        teamCount[tournamentId]++;

        for (uint256 i = 0; i < members.length; i++) {
            require(agents[members[i]].registered, "Member not registered");
            require(!registrations[tournamentId][members[i]].exists, "Member already in tournament");
            if (newTeamId > 0) {
                require(agentTeamId[tournamentId][members[i]] == 0, "Already on a team");
            }

            agentTeamId[tournamentId][members[i]] = newTeamId + 1;
            registrations[tournamentId][members[i]] = Registration({
                agent: members[i],
                score: 0, buchholz: 0,
                gamesPlayed: 0, gamesWon: 0, gamesDrawn: 0, gamesLost: 0,
                finalRank: 0, active: true, exists: true
            });
        }

        teamRosters[tournamentId][newTeamId] = members;

        if (t.entryFee > 0) {
            uint256 actualFee = t.entryFee;
            if (address(stakingContract) != address(0)) {
                uint16 discountBps = stakingContract.getDiscount(msg.sender);
                if (discountBps > 0) {
                    uint256 discount = (t.entryFee * discountBps) / TournamentLibV4.BPS_DENOMINATOR;
                    actualFee = t.entryFee - discount;
                }
            }
            require(usdc.transferFrom(msg.sender, address(this), actualFee), "USDC transfer failed");
            tournamentCollected[tournamentId] += actualFee;
            playerPayment[tournamentId][msg.sender] = actualFee;
        }

        t.registeredCount++;
        emit TeamRegistered(tournamentId, newTeamId, msg.sender, uint8(members.length));
        emit AgentJoined(tournamentId, msg.sender, t.registeredCount);
    }

    function getTeamRoster(uint256 tournamentId, uint8 _teamId) external view returns (address[] memory) {
        return teamRosters[tournamentId][_teamId];
    }

    function getTeamCount(uint256 tournamentId) external view returns (uint8) {
        return teamCount[tournamentId];
    }

    // ════════════════════════════════════════════════════════════════════════
    //                       TOURNAMENT LIFECYCLE
    // ════════════════════════════════════════════════════════════════════════

    function startTournament(uint256 tournamentId) external onlyTournamentAuthority(tournamentId) {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLibV4.TournamentStatus.Registration, "Not in registration");
        require(t.registeredCount >= t.minPlayers, "Not enough players");

        t.totalRounds = TournamentLibV4.calculateRoundsForFormat(t.registeredCount, t.format, t.bestOf);
        t.currentRound = 1;
        t.status = TournamentLibV4.TournamentStatus.RoundActive;

        emit TournamentStarted(tournamentId, t.totalRounds);
    }

    function cancelTournament(uint256 tournamentId) external onlyTournamentAuthority(tournamentId) {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLibV4.TournamentStatus.Registration, "Can only cancel during registration");
        t.status = TournamentLibV4.TournamentStatus.Cancelled;
        emit TournamentCancelled(tournamentId);
    }

    function claimRefund(uint256 tournamentId) external nonReentrant {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLibV4.TournamentStatus.Cancelled, "Not cancelled");
        require(registrations[tournamentId][msg.sender].exists, "Not registered");
        require(!refundClaimed[tournamentId][msg.sender], "Already refunded");

        uint256 refundAmount = playerPayment[tournamentId][msg.sender];
        refundClaimed[tournamentId][msg.sender] = true;

        if (refundAmount > 0) {
            tournamentCollected[tournamentId] -= refundAmount;
            require(usdc.transfer(msg.sender, refundAmount), "Refund transfer failed");
        }
        emit RefundClaimed(tournamentId, msg.sender, refundAmount);
    }

    // ── Games ──────────────────────────────────────────────────────────────

    function _gameKey(uint256 tournamentId, uint8 round, uint8 gameIndex) internal pure returns (bytes32) {
        return keccak256(abi.encode(tournamentId, round, gameIndex));
    }

    function batchCreateAndStartGames(
        uint256 tournamentId,
        uint8 round,
        GameInput[] calldata gameInputs
    ) external onlyTournamentAuthority(tournamentId) {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLibV4.TournamentStatus.RoundActive, "Not in active round");
        require(t.currentRound == round, "Wrong round");

        int64 now_ = int64(int256(block.timestamp));

        for (uint256 i = 0; i < gameInputs.length; i++) {
            require(registrations[tournamentId][gameInputs[i].white].exists, "White not registered");
            require(registrations[tournamentId][gameInputs[i].black].exists, "Black not registered");
            bytes32 key = _gameKey(tournamentId, round, gameInputs[i].gameIndex);
            require(!games[key].exists, "Game already exists");

            games[key] = Game({
                tournamentId: tournamentId,
                round: round,
                gameIndex: gameInputs[i].gameIndex,
                white: gameInputs[i].white,
                black: gameInputs[i].black,
                status: TournamentLibV4.GameStatus.InProgress,
                result: TournamentLibV4.GameResult.Undecided,
                moveCount: 0,
                startedAt: now_,
                endedAt: 0,
                pgnHash: bytes32(0),
                resultHash: bytes32(0),
                arbiter: msg.sender,
                exists: true
            });

            emit GameCreated(tournamentId, round, gameInputs[i].gameIndex, gameInputs[i].white, gameInputs[i].black);
            emit GameStarted(tournamentId, round, gameInputs[i].gameIndex);
        }

        emit RoundGamesCreated(tournamentId, round, uint8(gameInputs.length));
    }

    function executeRound(
        uint256 tournamentId,
        uint8 round,
        GameResultInput[] calldata results,
        StandingsInput[] calldata standings,
        bool advance
    ) external onlyTournamentAuthority(tournamentId) {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLibV4.TournamentStatus.RoundActive, "Not in active round");
        require(t.currentRound == round, "Wrong round");

        int64 now_ = int64(int256(block.timestamp));
        for (uint256 i = 0; i < results.length; i++) {
            require(results[i].result != TournamentLibV4.GameResult.Undecided, "Invalid result");

            bytes32 key = _gameKey(tournamentId, round, results[i].gameIndex);
            Game storage g = games[key];
            require(g.exists, "Game not found");
            require(g.status == TournamentLibV4.GameStatus.InProgress, "Game not in progress");

            g.result = results[i].result;
            g.status = TournamentLibV4.GameStatus.Completed;
            g.pgnHash = results[i].pgnHash;
            g.resultHash = results[i].resultHash;
            g.moveCount = results[i].moveCount;
            g.endedAt = now_;
            g.arbiter = msg.sender;

            emit GameResultSubmitted(tournamentId, round, results[i].gameIndex, results[i].result);
        }

        totalGamesPlayed += uint64(results.length);

        for (uint256 i = 0; i < standings.length; i++) {
            Registration storage r = registrations[tournamentId][standings[i].agent];
            require(r.exists, "Not registered");
            require(
                standings[i].gamesWon + standings[i].gamesDrawn + standings[i].gamesLost == standings[i].gamesPlayed,
                "Stats mismatch"
            );

            AgentProfile storage agent = agents[standings[i].agent];
            if (agent.registered) {
                uint8 newGames = standings[i].gamesPlayed > r.gamesPlayed ? standings[i].gamesPlayed - r.gamesPlayed : 0;
                uint8 newWins = standings[i].gamesWon > r.gamesWon ? standings[i].gamesWon - r.gamesWon : 0;
                uint8 newDraws = standings[i].gamesDrawn > r.gamesDrawn ? standings[i].gamesDrawn - r.gamesDrawn : 0;
                uint8 newLosses = standings[i].gamesLost > r.gamesLost ? standings[i].gamesLost - r.gamesLost : 0;
                agent.gamesPlayed += uint32(newGames);
                agent.gamesWon += uint32(newWins);
                agent.gamesDrawn += uint32(newDraws);
                agent.gamesLost += uint32(newLosses);
            }

            r.score = standings[i].score;
            r.buchholz = standings[i].buchholz;
            r.gamesPlayed = standings[i].gamesPlayed;
            r.gamesWon = standings[i].gamesWon;
            r.gamesDrawn = standings[i].gamesDrawn;
            r.gamesLost = standings[i].gamesLost;
        }

        t.status = TournamentLibV4.TournamentStatus.RoundComplete;
        emit StandingsUpdated(tournamentId, round);
        emit RoundResultsSubmitted(tournamentId, round, uint8(results.length));

        if (advance && t.currentRound < t.totalRounds) {
            t.currentRound++;
            t.status = TournamentLibV4.TournamentStatus.RoundActive;
            emit RoundAdvanced(tournamentId, t.currentRound);
        }
    }

    function advanceRound(uint256 tournamentId) external onlyTournamentAuthority(tournamentId) {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLibV4.TournamentStatus.RoundComplete, "Round not complete");
        require(t.currentRound < t.totalRounds, "All rounds played");

        t.currentRound++;
        t.status = TournamentLibV4.TournamentStatus.RoundActive;

        emit RoundAdvanced(tournamentId, t.currentRound);
    }

    // ════════════════════════════════════════════════════════════════════════
    //                     V4: FINALIZATION (ranked list)
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Finalize tournament with full ranked player list
    /// @param rankedPlayers Addresses in order: 1st, 2nd, 3rd, ... last
    function finalizeTournament(
        uint256 tournamentId,
        address[] calldata rankedPlayers,
        string calldata resultsUri
    ) external onlyTournamentAuthority(tournamentId) {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLibV4.TournamentStatus.RoundComplete, "Not round complete");
        require(t.currentRound == t.totalRounds, "Not all rounds played");
        require(rankedPlayers.length > 0, "Empty ranked list");

        // Validate all ranked players are registered
        for (uint256 i = 0; i < rankedPlayers.length; i++) {
            require(registrations[tournamentId][rankedPlayers[i]].exists, "Player not registered");
            // Set final rank
            registrations[tournamentId][rankedPlayers[i]].finalRank = uint8(i + 1);
        }

        // Store full ranked list
        tournamentRankedPlayers[tournamentId] = rankedPlayers;
        t.resultsUri = resultsUri;
        t.status = TournamentLibV4.TournamentStatus.Completed;

        emit TournamentFinalized(tournamentId, rankedPlayers);
    }

    // ════════════════════════════════════════════════════════════════════════
    //                  V4: PRIZE DISTRIBUTION (dynamic payouts)
    // ════════════════════════════════════════════════════════════════════════

    function distributePrizes(uint256 tournamentId) external onlyTournamentAuthority(tournamentId) nonReentrant {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLibV4.TournamentStatus.Completed, "Not completed");
        require(!t.prizeDistributed, "Already distributed");

        uint256 totalPool = tournamentCollected[tournamentId];
        require(totalPool > 0, "No funds to distribute");

        address[] storage ranked = tournamentRankedPlayers[tournamentId];
        require(ranked.length > 0, "No ranked players");

        // V4: Progressive rake — use tier-specific rate
        uint16 rakeBps = _getEffectiveRake(t.tier);
        uint256 protocolFee = (totalPool * rakeBps) / TournamentLibV4.BPS_DENOMINATOR;

        // Subtract referral bonuses from protocol fee
        uint256 referralTotal = tournamentReferralBonuses[tournamentId];
        if (referralTotal > 0 && referralTotal <= protocolFee) {
            protocolFee -= referralTotal;
        }

        uint256 playerPool = totalPool - protocolFee;

        // V4: Dynamic payout calculation based on field size
        uint256 fieldSize = ranked.length;
        uint256[] memory payouts;

        if (t.format == TournamentLibV4.Format.Match) {
            // Match: winner takes all
            payouts = new uint256[](1);
            payouts[0] = playerPool;
        } else {
            // Use PayoutCalculator for dynamic distribution
            payouts = PayoutCalculator.calculatePayouts(playerPool, fieldSize);
        }

        t.prizeDistributed = true;

        // Distribute to ranked players
        uint256 totalDistributed = 0;
        for (uint256 i = 0; i < payouts.length && i < ranked.length; i++) {
            if (payouts[i] > 0 && ranked[i] != address(0)) {
                require(usdc.transfer(ranked[i], payouts[i]), "Prize transfer failed");
                agents[ranked[i]].totalEarnings += uint64(payouts[i]);
                totalDistributed += payouts[i];
                emit PrizePaid(tournamentId, ranked[i], uint8(i + 1), payouts[i]);
            }
        }

        // Route protocol fee through RevenueRouter
        if (protocolFee > 0) {
            if (address(revenueRouter) != address(0)) {
                require(usdc.approve(address(revenueRouter), protocolFee), "Approve failed");
                revenueRouter.routeRevenue(protocolFee);
                emit RevenueRouted(tournamentId, protocolFee, address(revenueRouter));
            } else {
                // Fallback: send to treasury if router not configured
                require(usdc.transfer(protocol.treasury, protocolFee), "Fee transfer failed");
            }
        }

        protocol.totalPrizeDistributed += totalDistributed;

        emit PrizesDistributed(tournamentId, totalPool, playerPool, protocolFee, uint8(payouts.length));
    }

    // ════════════════════════════════════════════════════════════════════════
    //                              VIEWS
    // ════════════════════════════════════════════════════════════════════════

    function getGame(uint256 tournamentId, uint8 round, uint8 gameIndex) external view returns (Game memory) {
        return games[_gameKey(tournamentId, round, gameIndex)];
    }

    function getRegistration(uint256 tournamentId, address agent) external view returns (Registration memory) {
        return registrations[tournamentId][agent];
    }

    function getTournament(uint256 tournamentId) external view returns (Tournament memory) {
        return tournaments[tournamentId];
    }

    function getAgent(address wallet) external view returns (AgentProfile memory) {
        return agents[wallet];
    }

    function getRankedPlayers(uint256 tournamentId) external view returns (address[] memory) {
        return tournamentRankedPlayers[tournamentId];
    }

    /// @notice Get the effective rake for a tier (override or default)
    function getEffectiveRake(TournamentLibV4.Tier tier) external view returns (uint16) {
        return _getEffectiveRake(tier);
    }

    /// @notice Get payout structure preview for a given field size
    function getPayoutPreview(uint256 fieldSize) external pure returns (uint16[] memory) {
        return PayoutCalculator.getPayoutStructure(fieldSize);
    }

    function getReferrerTierBps(address referrer) public view returns (uint16) {
        uint16 count = referralCount[referrer];
        if (count >= TIER_GOLD_THRESHOLD) return TIER_GOLD_BPS;
        if (count >= TIER_SILVER_THRESHOLD) return TIER_SILVER_BPS;
        return TIER_BRONZE_BPS;
    }

    function getReferrerTier(address referrer) external view returns (uint8 tier, uint16 rateBps, uint16 count) {
        count = referralCount[referrer];
        rateBps = getReferrerTierBps(referrer);
        if (count >= TIER_GOLD_THRESHOLD) tier = 2;
        else if (count >= TIER_SILVER_THRESHOLD) tier = 1;
        else tier = 0;
    }

    // ── Internal Helpers ───────────────────────────────────────────────────

    function _getEffectiveRake(TournamentLibV4.Tier tier) internal view returns (uint16) {
        uint16 override_ = rakeOverrides[tier];
        if (override_ > 0) return override_;
        return TournamentLibV4.getRakeBps(tier);
    }

    /// @notice Get agent bracket (stub — will be replaced when ChessELO is integrated)
    function _getAgentBracket(address agent) internal view returns (TournamentLibV4.Bracket) {
        AgentProfile storage a = agents[agent];
        // Placeholder: derive bracket from stored ELO
        // Full implementation will query ChessELO contract in Phase 3
        if (a.gamesPlayed < 10) return TournamentLibV4.Bracket.Unrated;
        if (a.eloRating < TournamentLibV4.CLASS_C_MAX) return TournamentLibV4.Bracket.ClassC;
        if (a.eloRating < TournamentLibV4.CLASS_B_MAX) return TournamentLibV4.Bracket.ClassB;
        return TournamentLibV4.Bracket.ClassA;
    }
}
