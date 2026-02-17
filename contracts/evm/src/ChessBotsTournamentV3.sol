// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IChessBotsTournamentV3.sol";
import "./interfaces/IChessStaking.sol";
import "./libraries/TournamentLibV3.sol";

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IChessToken {
    function burn(uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
}

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut);
}

/// @title ChessBotsTournamentV3 - Multi-format tournament contract
/// @notice Supports Swiss, 1v1 Match, Team, and League formats
/// @dev V3 extends V2 with: format field, team rosters, relaxed constraints for 1v1,
///      format-conditional prize distribution, and league round calculations.
contract ChessBotsTournamentV3 is IChessBotsTournamentV3 {
    using TournamentLibV3 for TournamentLibV3.Tier;

    // --- Structs ---

    struct ProtocolState {
        address authority;
        address treasury;
        uint16 protocolFeeBps;
        uint16 buybackShareBps;
        uint16 treasuryShareBps;
        uint64 totalTournaments;
        uint256 totalPrizeDistributed;
        bool paused;
        uint8 sponsoredFreeTournaments;
        uint8 maxFreeTournaments;
    }

    uint64 public totalGamesPlayed;

    struct AgentProfile {
        address wallet;
        string name;
        string metadataUri;
        TournamentLibV3.AgentType agentType;
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
        TournamentLibV3.Tier tier;
        TournamentLibV3.Format format;      // V3: Swiss, Match, Team, League
        uint256 entryFee;
        TournamentLibV3.TournamentStatus status;
        uint8 maxPlayers;
        uint8 minPlayers;
        uint8 registeredCount;
        uint8 currentRound;
        uint8 totalRounds;
        uint8 teamSize;                      // V3: 0 for non-team, 5 for 5-a-side
        uint8 bestOf;                        // V3: for Match format (1, 3, or 5)
        int64 startTime;
        int64 registrationDeadline;
        uint32 baseTimeSeconds;
        uint32 incrementSeconds;
        address[3] winners;
        string resultsUri;
        bool prizeDistributed;
        bool exists;
        address challengeTarget;             // V3: for Match format — target opponent (address(0) = open)
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
        TournamentLibV3.GameStatus status;
        TournamentLibV3.GameResult result;
        uint16 moveCount;
        int64 startedAt;
        int64 endedAt;
        bytes32 pgnHash;
        bytes32 resultHash;
        address arbiter;
        bool exists;
    }

    // --- Batch Input Structs ---

    struct GameInput {
        uint8 gameIndex;
        address white;
        address black;
    }

    struct GameResultInput {
        uint8 gameIndex;
        TournamentLibV3.GameResult result;
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

    // --- State ---

    ProtocolState public protocol;
    IERC20 public immutable usdc;

    mapping(address => AgentProfile) public agents;
    mapping(uint256 => Tournament) public tournaments;
    mapping(uint256 => mapping(address => Registration)) public registrations;
    mapping(bytes32 => Game) public games;

    // --- Tokenomics State ---
    IERC20 public chessToken;
    address public dexRouter;
    IChessStaking public stakingContract;
    uint256 public pendingBuyback;
    mapping(uint256 => uint256) public tournamentCollected;
    mapping(uint256 => mapping(address => uint256)) public playerPayment;

    // --- Referral State ---
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

    // --- Sponsorship State ---
    struct Sponsorship {
        address sponsor;
        string name;
        string uri;
        uint256 amount;
    }
    mapping(uint256 => Sponsorship) public tournamentSponsors;
    uint16 public constant SPONSOR_PLATFORM_FEE_BPS = 1000;

    // --- V3: Team State ---
    mapping(uint256 => mapping(uint8 => address[])) public teamRosters;  // tournamentId => teamId => members
    mapping(uint256 => uint8) public teamCount;                           // tournamentId => number of teams registered
    mapping(uint256 => mapping(address => uint8)) public agentTeamId;    // tournamentId => agent => teamId

    // --- Reentrancy ---
    uint256 private _reentrancyStatus;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    // --- Modifiers ---

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

    // --- Authority Transfer ---
    address public pendingAuthority;
    mapping(uint256 => mapping(address => bool)) public refundClaimed;

    // --- Constructor ---

    constructor(
        address _usdc,
        address _treasury,
        uint16 _protocolFeeBps,
        uint16 _buybackShareBps,
        uint16 _treasuryShareBps
    ) {
        require(_usdc != address(0), "Zero USDC address");
        require(_treasury != address(0), "Zero treasury address");
        require(_protocolFeeBps <= 2000, "Protocol fee too high");
        require(_buybackShareBps + _treasuryShareBps == TournamentLibV3.BPS_DENOMINATOR, "Invalid fee config");

        usdc = IERC20(_usdc);
        protocol.authority = msg.sender;
        protocol.treasury = _treasury;
        protocol.protocolFeeBps = _protocolFeeBps;
        protocol.buybackShareBps = _buybackShareBps;
        protocol.treasuryShareBps = _treasuryShareBps;
        protocol.maxFreeTournaments = TournamentLibV3.MAX_SPONSORED_FREE_DEFAULT;
        _reentrancyStatus = _NOT_ENTERED;

        emit ProtocolInitialized(msg.sender, _treasury, _protocolFeeBps);
    }

    // --- Authority Transfer ---

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

    function setFreeTournamentLimit(uint8 _newLimit) external onlyAuthority {
        protocol.maxFreeTournaments = _newLimit;
        emit FreeTournamentLimitUpdated(_newLimit);
    }

    function fundTournament(uint256 tournamentId, uint256 amount) external onlyAuthority nonReentrant {
        Tournament storage t = tournaments[tournamentId];
        require(t.exists, "Tournament not found");
        require(!t.prizeDistributed, "Prizes already distributed");
        require(t.status != TournamentLibV3.TournamentStatus.Cancelled, "Tournament cancelled");
        require(amount > 0, "Zero amount");

        require(usdc.transferFrom(msg.sender, address(this), amount), "USDC transfer failed");
        tournamentCollected[tournamentId] += amount;

        emit TournamentFunded(tournamentId, amount);
    }

    // --- Referral Claims ---

    function claimReferralEarnings() external nonReentrant {
        uint256 amount = referralEarnings[msg.sender];
        require(amount > 0, "No referral earnings");
        referralEarnings[msg.sender] = 0;
        require(usdc.transfer(msg.sender, amount), "Referral transfer failed");
        emit ReferralEarningsClaimed(msg.sender, amount);
    }

    // --- Sponsorship ---

    function sponsorTournament(
        uint256 tournamentId,
        uint256 amount,
        string calldata sponsorName,
        string calldata sponsorUri
    ) external whenNotPaused nonReentrant {
        Tournament storage t = tournaments[tournamentId];
        require(t.exists, "Tournament not found");
        require(!t.prizeDistributed, "Prizes already distributed");
        require(t.status != TournamentLibV3.TournamentStatus.Cancelled, "Tournament cancelled");
        require(amount > 0, "Zero amount");
        require(tournamentSponsors[tournamentId].sponsor == address(0), "Already sponsored");
        require(bytes(sponsorName).length > 0 && bytes(sponsorName).length <= 64, "Invalid sponsor name");

        require(usdc.transferFrom(msg.sender, address(this), amount), "USDC transfer failed");

        uint256 platformFee = (amount * SPONSOR_PLATFORM_FEE_BPS) / TournamentLibV3.BPS_DENOMINATOR;
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

    // --- Tokenomics Configuration ---

    function setChessToken(address _token) external onlyAuthority {
        require(_token != address(0), "Zero address");
        chessToken = IERC20(_token);
        emit ChessTokenUpdated(_token);
    }

    function setDexRouter(address _router) external onlyAuthority {
        require(_router != address(0), "Zero address");
        if (dexRouter != address(0)) {
            usdc.approve(dexRouter, 0);
        }
        dexRouter = _router;
        emit DexRouterUpdated(_router);
    }

    function setStakingContract(address _staking) external onlyAuthority {
        require(_staking != address(0), "Zero address");
        stakingContract = IChessStaking(_staking);
        emit StakingContractUpdated(_staking);
    }

    // --- Agents ---

    function registerAgent(
        string calldata name,
        string calldata metadataUri,
        TournamentLibV3.AgentType agentType
    ) external whenNotPaused {
        _registerAgent(name, metadataUri, agentType, address(0));
    }

    function registerAgentWithReferral(
        string calldata name,
        string calldata metadataUri,
        TournamentLibV3.AgentType agentType,
        address referrer
    ) external whenNotPaused {
        _registerAgent(name, metadataUri, agentType, referrer);
    }

    function _registerAgent(
        string calldata name,
        string calldata metadataUri,
        TournamentLibV3.AgentType agentType,
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

    // ============================================================
    //                    V3: TOURNAMENT CREATION
    // ============================================================

    /// @notice Create a tournament with a specific format
    function createTournament(
        TournamentLibV3.Tier tier,
        TournamentLibV3.Format format,
        uint8 maxPlayers,
        uint8 minPlayers,
        int64 startTime,
        int64 registrationDeadline,
        uint32 baseTimeSeconds,
        uint32 incrementSeconds
    ) external onlyRegisteredAgentOrAuthority whenNotPaused {
        _createTournament(tier, format, maxPlayers, minPlayers, startTime, registrationDeadline,
            baseTimeSeconds, incrementSeconds, 0, 0, 1, address(0));
    }

    /// @notice Create a 1v1 match challenge targeting a specific opponent
    function createMatchChallenge(
        TournamentLibV3.Tier tier,
        int64 startTime,
        int64 registrationDeadline,
        uint32 baseTimeSeconds,
        uint32 incrementSeconds,
        uint8 bestOf,
        address opponent
    ) external onlyRegisteredAgentOrAuthority whenNotPaused {
        _createTournament(tier, TournamentLibV3.Format.Match, 2, 2, startTime, registrationDeadline,
            baseTimeSeconds, incrementSeconds, 0, 0, bestOf, opponent);
    }

    /// @notice Create a team tournament
    function createTeamTournament(
        TournamentLibV3.Tier tier,
        uint8 maxTeams,
        uint8 minTeams,
        int64 startTime,
        int64 registrationDeadline,
        uint32 baseTimeSeconds,
        uint32 incrementSeconds,
        uint8 teamSize
    ) external onlyRegisteredAgentOrAuthority whenNotPaused {
        require(teamSize >= 2 && teamSize <= 10, "Team size must be 2-10");
        require(maxTeams >= 2 && maxTeams <= TournamentLibV3.MAX_TEAMS, "Invalid team count");
        require(minTeams >= 2 && minTeams <= maxTeams, "Invalid min teams");
        _createTournament(tier, TournamentLibV3.Format.Team, maxTeams, minTeams, startTime, registrationDeadline,
            baseTimeSeconds, incrementSeconds, 0, teamSize, 0, address(0));
    }

    /// @notice Create a Legends tier tournament with custom entry fee
    function createLegendsTournament(
        TournamentLibV3.Format format,
        uint8 maxPlayers,
        uint8 minPlayers,
        int64 startTime,
        int64 registrationDeadline,
        uint32 baseTimeSeconds,
        uint32 incrementSeconds,
        uint256 customEntryFee
    ) external onlyRegisteredAgentOrAuthority whenNotPaused {
        require(customEntryFee >= TournamentLibV3.LEGENDS_MIN_ENTRY, "Legends min 500 USDC");
        _createTournament(
            TournamentLibV3.Tier.Legends, format, maxPlayers, minPlayers,
            startTime, registrationDeadline, baseTimeSeconds, incrementSeconds,
            customEntryFee, 0, 1, address(0)
        );
    }

    function _createTournament(
        TournamentLibV3.Tier tier,
        TournamentLibV3.Format format,
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
        // Format-aware validation
        TournamentLibV3.validateMinPlayers(minPlayers, format);
        TournamentLibV3.validateMaxPlayers(maxPlayers, format);
        require(minPlayers <= maxPlayers, "Invalid min players");
        require(baseTimeSeconds > 0, "Invalid time control");
        require(startTime > 0, "Invalid start time");
        require(registrationDeadline > 0, "Invalid deadline");
        require(uint256(uint64(registrationDeadline)) > block.timestamp, "Deadline must be in future");
        require(uint256(uint64(startTime)) > block.timestamp, "Start must be in future");
        require(registrationDeadline < startTime, "Deadline must be before start");

        // Match format: validate bestOf
        if (format == TournamentLibV3.Format.Match) {
            require(bestOf == 1 || bestOf == 3 || bestOf == 5, "bestOf must be 1, 3, or 5");
        }

        // Free tier: enforce sponsored limit
        if (tier == TournamentLibV3.Tier.Free) {
            require(protocol.sponsoredFreeTournaments < protocol.maxFreeTournaments, "Free tournament limit reached");
            protocol.sponsoredFreeTournaments++;
        }

        uint256 fee = tier == TournamentLibV3.Tier.Legends ? customEntryFee : tier.entryFee();

        uint256 id = protocol.totalTournaments;
        protocol.totalTournaments++;

        tournaments[id] = Tournament({
            id: id,
            authority: msg.sender,
            tier: tier,
            format: format,
            entryFee: fee,
            status: TournamentLibV3.TournamentStatus.Registration,
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
            winners: [address(0), address(0), address(0)],
            resultsUri: "",
            prizeDistributed: false,
            exists: true,
            challengeTarget: challengeTarget
        });

        emit TournamentCreated(id, tier, format, fee, maxPlayers);

        // Emit match challenge event if targeting specific opponent
        if (format == TournamentLibV3.Format.Match && challengeTarget != address(0)) {
            emit MatchChallengeCreated(id, msg.sender, challengeTarget);
        }
    }

    // ============================================================
    //                    REGISTRATION
    // ============================================================

    function registerForTournament(uint256 tournamentId) external whenNotPaused nonReentrant {
        Tournament storage t = tournaments[tournamentId];
        require(t.exists, "Tournament not found");
        require(t.status == TournamentLibV3.TournamentStatus.Registration, "Not in registration");
        require(t.registeredCount < t.maxPlayers, "Tournament full");
        require(agents[msg.sender].registered, "Agent not registered");
        require(!registrations[tournamentId][msg.sender].exists, "Already registered");
        require(block.timestamp < uint256(uint64(t.registrationDeadline)), "Registration closed");

        // V3: Match challenge — only target opponent can join (if specified)
        if (t.format == TournamentLibV3.Format.Match && t.challengeTarget != address(0)) {
            // Creator auto-registered at creation, opponent must be the target
            if (t.registeredCount > 0) {
                require(msg.sender == t.challengeTarget, "Not the challenged opponent");
            }
        }

        // V3: Team format — agents register via registerTeam(), not individually
        require(t.format != TournamentLibV3.Format.Team, "Use registerTeam for team tournaments");

        // Payment
        if (t.entryFee > 0) {
            uint256 actualFee = t.entryFee;
            if (address(stakingContract) != address(0)) {
                uint16 discountBps = stakingContract.getDiscount(msg.sender);
                if (discountBps > 0) {
                    uint256 discount = (t.entryFee * discountBps) / TournamentLibV3.BPS_DENOMINATOR;
                    actualFee = t.entryFee - discount;
                    emit DiscountApplied(tournamentId, msg.sender, discountBps, discount);
                }
            }

            address referrer = agents[msg.sender].referredBy;
            if (referrer != address(0)) {
                uint256 refereeDiscount = (actualFee * REFEREE_DISCOUNT_BPS) / TournamentLibV3.BPS_DENOMINATOR;
                actualFee -= refereeDiscount;
                tournamentRefereeDiscounts[tournamentId] += refereeDiscount;
            }

            require(usdc.transferFrom(msg.sender, address(this), actualFee), "USDC transfer failed");
            tournamentCollected[tournamentId] += actualFee;
            playerPayment[tournamentId][msg.sender] = actualFee;

            if (referrer != address(0)) {
                uint16 rateBps;
                if (referralTournamentsRemaining[msg.sender] > 0) {
                    rateBps = getReferrerTierBps(referrer);
                    referralTournamentsRemaining[msg.sender]--;
                } else {
                    rateBps = REFERRAL_LONG_TAIL_BPS;
                }
                uint256 referralBonus = (actualFee * rateBps) / TournamentLibV3.BPS_DENOMINATOR;
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

    // ============================================================
    //                    V3: TEAM REGISTRATION
    // ============================================================

    /// @notice Register a team for a team tournament. Captain pays entry fee for the team.
    ///         All members must be registered agents.
    function registerTeam(
        uint256 tournamentId,
        address[] calldata members
    ) external whenNotPaused nonReentrant {
        Tournament storage t = tournaments[tournamentId];
        require(t.exists, "Tournament not found");
        require(t.format == TournamentLibV3.Format.Team, "Not a team tournament");
        require(t.status == TournamentLibV3.TournamentStatus.Registration, "Not in registration");
        require(t.registeredCount < t.maxPlayers, "Tournament full");
        require(members.length == t.teamSize, "Wrong team size");
        require(block.timestamp < uint256(uint64(t.registrationDeadline)), "Registration closed");

        // Captain must be a registered agent
        require(agents[msg.sender].registered, "Captain not registered");

        uint8 newTeamId = teamCount[tournamentId];
        teamCount[tournamentId]++;

        // Register each member
        for (uint256 i = 0; i < members.length; i++) {
            require(agents[members[i]].registered, "Member not registered");
            require(!registrations[tournamentId][members[i]].exists, "Member already in tournament");

            // Check not already on another team in this tournament
            require(agentTeamId[tournamentId][members[i]] == 0 || newTeamId == 0, "Already on a team");
            // Use teamId+1 to distinguish from default 0
            if (newTeamId > 0) {
                require(agentTeamId[tournamentId][members[i]] == 0, "Already on a team");
            }

            agentTeamId[tournamentId][members[i]] = newTeamId + 1; // 1-indexed to avoid default collision
            registrations[tournamentId][members[i]] = Registration({
                agent: members[i],
                score: 0, buchholz: 0,
                gamesPlayed: 0, gamesWon: 0, gamesDrawn: 0, gamesLost: 0,
                finalRank: 0, active: true, exists: true
            });
        }

        teamRosters[tournamentId][newTeamId] = members;

        // Captain pays entry fee for the team
        if (t.entryFee > 0) {
            uint256 actualFee = t.entryFee;
            if (address(stakingContract) != address(0)) {
                uint16 discountBps = stakingContract.getDiscount(msg.sender);
                if (discountBps > 0) {
                    uint256 discount = (t.entryFee * discountBps) / TournamentLibV3.BPS_DENOMINATOR;
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

    /// @notice Get team roster for a tournament
    function getTeamRoster(uint256 tournamentId, uint8 _teamId) external view returns (address[] memory) {
        return teamRosters[tournamentId][_teamId];
    }

    /// @notice Get number of teams in a tournament
    function getTeamCount(uint256 tournamentId) external view returns (uint8) {
        return teamCount[tournamentId];
    }

    // ============================================================
    //                    TOURNAMENT LIFECYCLE
    // ============================================================

    function startTournament(uint256 tournamentId) external onlyTournamentAuthority(tournamentId) {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLibV3.TournamentStatus.Registration, "Not in registration");
        require(t.registeredCount >= t.minPlayers, "Not enough players");

        // V3: Format-aware round calculation
        t.totalRounds = TournamentLibV3.calculateRoundsForFormat(t.registeredCount, t.format, t.bestOf);
        t.currentRound = 1;
        t.status = TournamentLibV3.TournamentStatus.RoundActive;

        emit TournamentStarted(tournamentId, t.totalRounds);
    }

    function cancelTournament(uint256 tournamentId) external onlyTournamentAuthority(tournamentId) {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLibV3.TournamentStatus.Registration, "Can only cancel during registration");
        t.status = TournamentLibV3.TournamentStatus.Cancelled;
        emit TournamentCancelled(tournamentId);
    }

    function claimRefund(uint256 tournamentId) external nonReentrant {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLibV3.TournamentStatus.Cancelled, "Not cancelled");
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

    // --- Games ---

    function _gameKey(uint256 tournamentId, uint8 round, uint8 gameIndex) internal pure returns (bytes32) {
        return keccak256(abi.encode(tournamentId, round, gameIndex));
    }

    function batchCreateAndStartGames(
        uint256 tournamentId,
        uint8 round,
        GameInput[] calldata gameInputs
    ) external onlyTournamentAuthority(tournamentId) {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLibV3.TournamentStatus.RoundActive, "Not in active round");
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
                status: TournamentLibV3.GameStatus.InProgress,
                result: TournamentLibV3.GameResult.Undecided,
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

    /// @notice Execute a full round: submit results + update standings + optionally advance
    function executeRound(
        uint256 tournamentId,
        uint8 round,
        GameResultInput[] calldata results,
        StandingsInput[] calldata standings,
        bool advance
    ) external onlyTournamentAuthority(tournamentId) {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLibV3.TournamentStatus.RoundActive, "Not in active round");
        require(t.currentRound == round, "Wrong round");

        int64 now_ = int64(int256(block.timestamp));
        for (uint256 i = 0; i < results.length; i++) {
            require(results[i].result != TournamentLibV3.GameResult.Undecided, "Invalid result");

            bytes32 key = _gameKey(tournamentId, round, results[i].gameIndex);
            Game storage g = games[key];
            require(g.exists, "Game not found");
            require(g.status == TournamentLibV3.GameStatus.InProgress, "Game not in progress");

            g.result = results[i].result;
            g.status = TournamentLibV3.GameStatus.Completed;
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

        t.status = TournamentLibV3.TournamentStatus.RoundComplete;
        emit StandingsUpdated(tournamentId, round);
        emit RoundResultsSubmitted(tournamentId, round, uint8(results.length));

        if (advance && t.currentRound < t.totalRounds) {
            t.currentRound++;
            t.status = TournamentLibV3.TournamentStatus.RoundActive;
            emit RoundAdvanced(tournamentId, t.currentRound);
        }
    }

    function advanceRound(uint256 tournamentId) external onlyTournamentAuthority(tournamentId) {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLibV3.TournamentStatus.RoundComplete, "Round not complete");
        require(t.currentRound < t.totalRounds, "All rounds played");

        t.currentRound++;
        t.status = TournamentLibV3.TournamentStatus.RoundActive;

        emit RoundAdvanced(tournamentId, t.currentRound);
    }

    // ============================================================
    //                    V3: FINALIZATION (format-aware)
    // ============================================================

    function finalizeTournament(
        uint256 tournamentId,
        address[3] calldata winners,
        string calldata resultsUri
    ) external onlyTournamentAuthority(tournamentId) {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLibV3.TournamentStatus.RoundComplete, "Not round complete");
        require(t.currentRound == t.totalRounds, "Not all rounds played");

        if (t.format == TournamentLibV3.Format.Match) {
            // V3: Match format — only winner required, allow zero addresses for 2nd/3rd
            require(registrations[tournamentId][winners[0]].exists, "Winner not registered");
            // winners[1] and winners[2] can be address(0) for 1v1
        } else if (t.registeredCount <= 2) {
            // 2-player format: only validate non-zero winners
            require(registrations[tournamentId][winners[0]].exists, "Winner 1 not registered");
            if (winners[1] != address(0)) {
                require(registrations[tournamentId][winners[1]].exists, "Winner 2 not registered");
            }
        } else {
            // Swiss/Team/League with 3+ players: validate all 3 distinct winners
            require(registrations[tournamentId][winners[0]].exists, "Winner 1 not registered");
            require(registrations[tournamentId][winners[1]].exists, "Winner 2 not registered");
            require(registrations[tournamentId][winners[2]].exists, "Winner 3 not registered");
            require(winners[0] != winners[1] && winners[1] != winners[2] && winners[0] != winners[2], "Duplicate winners");
        }

        t.winners = winners;
        t.resultsUri = resultsUri;
        t.status = TournamentLibV3.TournamentStatus.Completed;

        emit TournamentFinalized(tournamentId, winners[0], winners[1], winners[2]);
    }

    // ============================================================
    //                    V3: PRIZE DISTRIBUTION (format-aware)
    // ============================================================

    function distributePrizes(uint256 tournamentId) external onlyTournamentAuthority(tournamentId) nonReentrant {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLibV3.TournamentStatus.Completed, "Not completed");
        require(!t.prizeDistributed, "Already distributed");

        uint256 totalPool = tournamentCollected[tournamentId];
        require(totalPool > 0, "No funds to distribute");

        // V3: Format-aware prize calculation
        (uint256 firstPrize, uint256 secondPrize, uint256 thirdPrize, uint256 protocolFee) =
            TournamentLibV3.calculatePrizesForFormat(totalPool, protocol.protocolFeeBps, t.format);

        // Subtract referral bonuses from protocol fee
        uint256 referralTotal = tournamentReferralBonuses[tournamentId];
        if (referralTotal > 0) {
            require(referralTotal <= protocolFee, "Referral exceeds protocol fee");
            protocolFee -= referralTotal;
        }

        t.prizeDistributed = true;

        // Distribute prizes
        if (firstPrize > 0 && t.winners[0] != address(0)) {
            require(usdc.transfer(t.winners[0], firstPrize), "1st prize failed");
            agents[t.winners[0]].totalEarnings += uint64(firstPrize);
        }
        if (secondPrize > 0 && t.winners[1] != address(0)) {
            require(usdc.transfer(t.winners[1], secondPrize), "2nd prize failed");
            agents[t.winners[1]].totalEarnings += uint64(secondPrize);
        }
        if (thirdPrize > 0 && t.winners[2] != address(0)) {
            require(usdc.transfer(t.winners[2], thirdPrize), "3rd prize failed");
            agents[t.winners[2]].totalEarnings += uint64(thirdPrize);
        }

        // For Match format: if no 2nd/3rd winner, remaining goes to 1st
        if (t.format == TournamentLibV3.Format.Match) {
            uint256 unclaimed = 0;
            if (t.winners[1] == address(0)) unclaimed += secondPrize;
            if (t.winners[2] == address(0)) unclaimed += thirdPrize;
            if (unclaimed > 0 && t.winners[0] != address(0)) {
                require(usdc.transfer(t.winners[0], unclaimed), "Unclaimed prize failed");
                agents[t.winners[0]].totalEarnings += uint64(unclaimed);
            }
        }

        // Split protocol fee: buyback vs treasury
        if (protocolFee > 0) {
            bool buybackConfigured = address(chessToken) != address(0) && dexRouter != address(0);
            if (buybackConfigured) {
                uint256 buybackAmount = (protocolFee * protocol.buybackShareBps) / TournamentLibV3.BPS_DENOMINATOR;
                uint256 treasuryAmount = protocolFee - buybackAmount;
                pendingBuyback += buybackAmount;
                if (treasuryAmount > 0) {
                    require(usdc.transfer(protocol.treasury, treasuryAmount), "Treasury transfer failed");
                }
                emit BuybackAccumulated(tournamentId, buybackAmount);
            } else {
                require(usdc.transfer(protocol.treasury, protocolFee), "Fee transfer failed");
            }
        }

        protocol.totalPrizeDistributed += totalPool - protocolFee;

        emit PrizesDistributed(tournamentId, totalPool, firstPrize, secondPrize, thirdPrize, protocolFee);
    }

    // --- Buyback ---

    function executeBuyback(uint256 minChessOut) external onlyAuthority nonReentrant {
        require(address(chessToken) != address(0) && dexRouter != address(0), "Buyback not configured");
        require(pendingBuyback >= 10e6, "Min 10 USDC to buyback");

        uint256 amount = pendingBuyback;
        pendingBuyback = 0;

        usdc.approve(dexRouter, 0);
        require(usdc.approve(dexRouter, amount), "Approve failed");

        ISwapRouter(dexRouter).exactInputSingle(ISwapRouter.ExactInputSingleParams({
            tokenIn: address(usdc),
            tokenOut: address(chessToken),
            fee: 3000,
            recipient: address(this),
            amountIn: amount,
            amountOutMinimum: minChessOut,
            sqrtPriceLimitX96: 0
        }));

        uint256 chessBal = chessToken.balanceOf(address(this));
        IChessToken(address(chessToken)).burn(chessBal);

        emit BuybackExecuted(amount, chessBal);
    }

    // --- Views ---

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
}
