// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./libraries/TournamentLibV4.sol";

interface IERC20BettingV3 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @dev Minimal interface for reading from ChessBotsTournamentV4
interface ITournamentReaderV4 {
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

    function getTournament(uint256 tournamentId) external view returns (Tournament memory);
    function getGame(uint256 tournamentId, uint8 round, uint8 gameIndex) external view returns (Game memory);
    function getRegistration(uint256 tournamentId, address agent) external view returns (Registration memory);
    function getRankedPlayers(uint256 tournamentId) external view returns (address[] memory);
}

/// @title ChessBettingPoolV3 — Permissionless Prediction Markets for ChessBots (V4-compatible)
/// @notice Anyone can create markets, place bets, and trigger resolution. Parimutuel payouts with configurable vig.
/// @dev Reads game/tournament results from ChessBotsTournamentV4 via staticcall.
contract ChessBettingPoolV3 {

    // ── Types ──────────────────────────────────────────────────────────

    enum MarketType { GameOutcome, TournamentWinner, TournamentTop3, HeadToHead, OverUnder }
    enum MarketStatus { Open, Resolved, Voided }

    struct Market {
        MarketType marketType;
        MarketStatus status;
        uint256 tournamentId;
        uint8 round;            // GameOutcome, OverUnder
        uint8 gameIndex;        // GameOutcome, OverUnder
        address agentA;         // HeadToHead, TournamentTop3
        address agentB;         // HeadToHead
        uint16 threshold;       // OverUnder (move count threshold)
        uint8 numOutcomes;
        uint8 winningOutcome;   // 255 = unresolved
        address creator;
        uint256 totalPool;
        uint256 vigCollected;
        bool bondClaimed;
        bool exists;
    }

    struct Bet {
        uint8 outcome;
        uint256 amount;
        bool claimed;
    }

    // ── Events ─────────────────────────────────────────────────────────

    event MarketCreated(uint256 indexed marketId, MarketType marketType, uint256 indexed tournamentId, address indexed creator);
    event BetPlaced(uint256 indexed marketId, address indexed bettor, uint8 outcome, uint256 amount);
    event MarketResolved(uint256 indexed marketId, uint8 winningOutcome, uint256 totalPool, uint256 vigAmount);
    event MarketVoided(uint256 indexed marketId);
    event WinningsClaimed(uint256 indexed marketId, address indexed bettor, uint256 payout);
    event RefundClaimed(uint256 indexed marketId, address indexed bettor, uint256 amount);
    event BondReturned(uint256 indexed marketId, address indexed creator, uint256 amount);
    event VigBpsUpdated(uint16 oldVig, uint16 newVig);
    event MinBetUpdated(uint256 oldMin, uint256 newMin);
    event PausedStateChanged(bool paused);
    event AuthorityTransferProposed(address indexed current, address indexed pending);
    event AuthorityTransferAccepted(address indexed oldAuthority, address indexed newAuthority);

    // ── Reentrancy Guard ───────────────────────────────────────────────

    uint256 private _reentrancyStatus;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    modifier nonReentrant() {
        require(_reentrancyStatus != _ENTERED, "ReentrancyGuard: reentrant call");
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    // ── State ──────────────────────────────────────────────────────────

    IERC20BettingV3 public immutable usdc;
    ITournamentReaderV4 public immutable tournamentContract;
    address public treasury;
    address public authority;
    address public pendingAuthority;

    uint256 public constant CREATION_BOND = 5e6;    // 5 USDC
    uint8 public constant MAX_OUTCOMES = 64;
    uint16 public vigBps;                            // default 300 = 3%
    uint256 public minBetAmount;                     // default 1 USDC
    bool public paused;

    uint256 public nextMarketId;
    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(uint8 => uint256)) public outcomeTotals;  // marketId => outcome => total USDC
    mapping(uint256 => mapping(address => Bet)) public bets;             // marketId => bettor => Bet
    mapping(bytes32 => uint256) public marketKeys;                        // deterministic key => marketId
    mapping(bytes32 => bool) public marketKeyExists;                      // key => whether a market exists

    // TournamentWinner: store snapshotted agent list per market
    mapping(uint256 => address[]) public marketAgents;  // marketId => agent addresses (outcome index = array index)

    // ── Constructor ────────────────────────────────────────────────────

    constructor(
        address _usdc,
        address _tournamentContract,
        address _treasury,
        uint16 _vigBps
    ) {
        require(_usdc != address(0), "Invalid USDC");
        require(_tournamentContract != address(0), "Invalid tournament");
        require(_treasury != address(0), "Invalid treasury");
        require(_vigBps <= 1000, "Vig too high");

        usdc = IERC20BettingV3(_usdc);
        tournamentContract = ITournamentReaderV4(_tournamentContract);
        treasury = _treasury;
        authority = msg.sender;
        vigBps = _vigBps;
        minBetAmount = 1e6;
        _reentrancyStatus = _NOT_ENTERED;
    }

    // ── Modifiers ──────────────────────────────────────────────────────

    modifier onlyAuthority() {
        require(msg.sender == authority, "Not authority");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Contract paused");
        _;
    }

    // ════════════════════════════════════════════════════════════════════
    //                      MARKET CREATION
    // ════════════════════════════════════════════════════════════════════

    /// @notice Create a market for a game outcome (White/Black/Draw)
    function createGameOutcomeMarket(
        uint256 tournamentId,
        uint8 round,
        uint8 gameIndex
    ) external whenNotPaused nonReentrant returns (uint256 marketId) {
        bytes32 key = keccak256(abi.encode("GameOutcome", tournamentId, round, gameIndex));
        require(!marketKeyExists[key], "Market already exists");

        _requireGameNotCompleted(tournamentId, round, gameIndex);

        require(usdc.transferFrom(msg.sender, address(this), CREATION_BOND), "Bond transfer failed");

        marketId = nextMarketId++;
        markets[marketId] = Market({
            marketType: MarketType.GameOutcome,
            status: MarketStatus.Open,
            tournamentId: tournamentId,
            round: round,
            gameIndex: gameIndex,
            agentA: address(0),
            agentB: address(0),
            threshold: 0,
            numOutcomes: 3,
            winningOutcome: 255,
            creator: msg.sender,
            totalPool: 0,
            vigCollected: 0,
            bondClaimed: false,
            exists: true
        });

        marketKeys[key] = marketId;
        marketKeyExists[key] = true;

        emit MarketCreated(marketId, MarketType.GameOutcome, tournamentId, msg.sender);
    }

    /// @notice Create a market for who will win a tournament
    function createTournamentWinnerMarket(
        uint256 tournamentId,
        address[] calldata agents
    ) external whenNotPaused nonReentrant returns (uint256 marketId) {
        bytes32 key = keccak256(abi.encode("TournamentWinner", tournamentId));
        require(!marketKeyExists[key], "Market already exists");
        require(agents.length >= 2, "Need at least 2 agents");
        require(agents.length <= MAX_OUTCOMES, "Too many agents");

        _requireTournamentNotCompleted(tournamentId);

        for (uint256 i = 0; i < agents.length; i++) {
            require(_isRegistered(tournamentId, agents[i]), "Agent not registered");
            for (uint256 j = 0; j < i; j++) {
                require(agents[i] != agents[j], "Duplicate agent");
            }
        }

        require(usdc.transferFrom(msg.sender, address(this), CREATION_BOND), "Bond transfer failed");

        marketId = nextMarketId++;
        markets[marketId] = Market({
            marketType: MarketType.TournamentWinner,
            status: MarketStatus.Open,
            tournamentId: tournamentId,
            round: 0,
            gameIndex: 0,
            agentA: address(0),
            agentB: address(0),
            threshold: 0,
            numOutcomes: uint8(agents.length),
            winningOutcome: 255,
            creator: msg.sender,
            totalPool: 0,
            vigCollected: 0,
            bondClaimed: false,
            exists: true
        });

        for (uint256 i = 0; i < agents.length; i++) {
            marketAgents[marketId].push(agents[i]);
        }

        marketKeys[key] = marketId;
        marketKeyExists[key] = true;

        emit MarketCreated(marketId, MarketType.TournamentWinner, tournamentId, msg.sender);
    }

    /// @notice Create a market for whether a specific agent finishes top 3
    function createTournamentTop3Market(
        uint256 tournamentId,
        address agent
    ) external whenNotPaused nonReentrant returns (uint256 marketId) {
        bytes32 key = keccak256(abi.encode("TournamentTop3", tournamentId, agent));
        require(!marketKeyExists[key], "Market already exists");

        _requireTournamentNotCompleted(tournamentId);
        require(_isRegistered(tournamentId, agent), "Agent not registered");

        require(usdc.transferFrom(msg.sender, address(this), CREATION_BOND), "Bond transfer failed");

        marketId = nextMarketId++;
        markets[marketId] = Market({
            marketType: MarketType.TournamentTop3,
            status: MarketStatus.Open,
            tournamentId: tournamentId,
            round: 0,
            gameIndex: 0,
            agentA: agent,
            agentB: address(0),
            threshold: 0,
            numOutcomes: 2,  // 0 = Yes, 1 = No
            winningOutcome: 255,
            creator: msg.sender,
            totalPool: 0,
            vigCollected: 0,
            bondClaimed: false,
            exists: true
        });

        marketKeys[key] = marketId;
        marketKeyExists[key] = true;

        emit MarketCreated(marketId, MarketType.TournamentTop3, tournamentId, msg.sender);
    }

    /// @notice Create a head-to-head market comparing two agents' tournament scores
    function createHeadToHeadMarket(
        uint256 tournamentId,
        address agentA,
        address agentB
    ) external whenNotPaused nonReentrant returns (uint256 marketId) {
        require(agentA != agentB, "Same agent");
        (address first, address second) = agentA < agentB ? (agentA, agentB) : (agentB, agentA);

        bytes32 key = keccak256(abi.encode("HeadToHead", tournamentId, first, second));
        require(!marketKeyExists[key], "Market already exists");

        _requireTournamentNotCompleted(tournamentId);
        require(_isRegistered(tournamentId, agentA), "AgentA not registered");
        require(_isRegistered(tournamentId, agentB), "AgentB not registered");

        require(usdc.transferFrom(msg.sender, address(this), CREATION_BOND), "Bond transfer failed");

        marketId = nextMarketId++;
        markets[marketId] = Market({
            marketType: MarketType.HeadToHead,
            status: MarketStatus.Open,
            tournamentId: tournamentId,
            round: 0,
            gameIndex: 0,
            agentA: agentA,
            agentB: agentB,
            threshold: 0,
            numOutcomes: 3,  // 0 = AgentA, 1 = AgentB, 2 = Tie
            winningOutcome: 255,
            creator: msg.sender,
            totalPool: 0,
            vigCollected: 0,
            bondClaimed: false,
            exists: true
        });

        marketKeys[key] = marketId;
        marketKeyExists[key] = true;

        emit MarketCreated(marketId, MarketType.HeadToHead, tournamentId, msg.sender);
    }

    /// @notice Create an over/under market on total move count in a game
    function createOverUnderMarket(
        uint256 tournamentId,
        uint8 round,
        uint8 gameIndex,
        uint16 moveThreshold
    ) external whenNotPaused nonReentrant returns (uint256 marketId) {
        require(moveThreshold > 0, "Threshold must be > 0");

        bytes32 key = keccak256(abi.encode("OverUnder", tournamentId, round, gameIndex, moveThreshold));
        require(!marketKeyExists[key], "Market already exists");

        _requireGameNotCompleted(tournamentId, round, gameIndex);

        require(usdc.transferFrom(msg.sender, address(this), CREATION_BOND), "Bond transfer failed");

        marketId = nextMarketId++;
        markets[marketId] = Market({
            marketType: MarketType.OverUnder,
            status: MarketStatus.Open,
            tournamentId: tournamentId,
            round: round,
            gameIndex: gameIndex,
            agentA: address(0),
            agentB: address(0),
            threshold: moveThreshold,
            numOutcomes: 2,  // 0 = Over, 1 = Under
            winningOutcome: 255,
            creator: msg.sender,
            totalPool: 0,
            vigCollected: 0,
            bondClaimed: false,
            exists: true
        });

        marketKeys[key] = marketId;
        marketKeyExists[key] = true;

        emit MarketCreated(marketId, MarketType.OverUnder, tournamentId, msg.sender);
    }

    // ════════════════════════════════════════════════════════════════════
    //                           BETTING
    // ════════════════════════════════════════════════════════════════════

    /// @notice Place a bet on a market outcome
    function placeBet(
        uint256 marketId,
        uint8 outcome,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(market.status == MarketStatus.Open, "Market not open");
        require(outcome < market.numOutcomes, "Invalid outcome");
        require(amount >= minBetAmount, "Below minimum bet");
        require(bets[marketId][msg.sender].amount == 0, "Already bet on this market");

        if (market.marketType == MarketType.GameOutcome || market.marketType == MarketType.OverUnder) {
            _requireGameNotCompleted(market.tournamentId, market.round, market.gameIndex);
        } else {
            _requireTournamentNotCompleted(market.tournamentId);
        }

        require(usdc.transferFrom(msg.sender, address(this), amount), "USDC transfer failed");

        bets[marketId][msg.sender] = Bet({
            outcome: outcome,
            amount: amount,
            claimed: false
        });

        outcomeTotals[marketId][outcome] += amount;
        market.totalPool += amount;

        emit BetPlaced(marketId, msg.sender, outcome, amount);
    }

    // ════════════════════════════════════════════════════════════════════
    //                    RESOLUTION (permissionless)
    // ════════════════════════════════════════════════════════════════════

    /// @notice Resolve a market by reading the result from the tournament contract
    function resolveMarket(uint256 marketId) external nonReentrant {
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(market.status == MarketStatus.Open, "Market not open");

        TournamentLibV4.TournamentStatus tStatus = _getTournamentStatus(market.tournamentId);
        if (tStatus == TournamentLibV4.TournamentStatus.Cancelled) {
            _voidMarket(marketId);
            return;
        }

        if (market.marketType == MarketType.GameOutcome) {
            _resolveGameOutcome(marketId);
        } else if (market.marketType == MarketType.TournamentWinner) {
            _resolveTournamentWinner(marketId);
        } else if (market.marketType == MarketType.TournamentTop3) {
            _resolveTournamentTop3(marketId);
        } else if (market.marketType == MarketType.HeadToHead) {
            _resolveHeadToHead(marketId);
        } else if (market.marketType == MarketType.OverUnder) {
            _resolveOverUnder(marketId);
        }
    }

    /// @notice Authority can void any market (emergency use)
    function voidMarket(uint256 marketId) external onlyAuthority {
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(market.status == MarketStatus.Open, "Market not open");
        _voidMarket(marketId);
    }

    // ── Resolution Internals ───────────────────────────────────────────

    function _resolveGameOutcome(uint256 marketId) internal {
        Market storage market = markets[marketId];

        (TournamentLibV4.GameStatus gStatus, TournamentLibV4.GameResult result, ) =
            _getGameResult(market.tournamentId, market.round, market.gameIndex);

        if (gStatus == TournamentLibV4.GameStatus.Aborted) {
            _voidMarket(marketId);
            return;
        }

        require(gStatus == TournamentLibV4.GameStatus.Completed, "Game not completed");
        require(result != TournamentLibV4.GameResult.Undecided, "Result undecided");

        uint8 winOutcome;
        if (result == TournamentLibV4.GameResult.WhiteWins || result == TournamentLibV4.GameResult.BlackForfeit) {
            winOutcome = 0;
        } else if (result == TournamentLibV4.GameResult.BlackWins || result == TournamentLibV4.GameResult.WhiteForfeit) {
            winOutcome = 1;
        } else {
            winOutcome = 2;
        }

        _settleMarket(marketId, winOutcome);
    }

    function _resolveTournamentWinner(uint256 marketId) internal {
        Market storage market = markets[marketId];

        (TournamentLibV4.TournamentStatus tStatus, address[3] memory winners) =
            _getTournamentResult(market.tournamentId);
        require(tStatus == TournamentLibV4.TournamentStatus.Completed, "Tournament not completed");

        address winner = winners[0];

        address[] storage agents = marketAgents[marketId];
        uint8 winOutcome = 255;
        for (uint8 i = 0; i < agents.length; i++) {
            if (agents[i] == winner) {
                winOutcome = i;
                break;
            }
        }

        if (winOutcome == 255) {
            _voidMarket(marketId);
            return;
        }

        _settleMarket(marketId, winOutcome);
    }

    function _resolveTournamentTop3(uint256 marketId) internal {
        Market storage market = markets[marketId];

        (TournamentLibV4.TournamentStatus tStatus, address[3] memory winners) =
            _getTournamentResult(market.tournamentId);
        require(tStatus == TournamentLibV4.TournamentStatus.Completed, "Tournament not completed");

        bool inTop3 = (market.agentA == winners[0] || market.agentA == winners[1] || market.agentA == winners[2]);
        uint8 winOutcome = inTop3 ? 0 : 1;

        _settleMarket(marketId, winOutcome);
    }

    function _resolveHeadToHead(uint256 marketId) internal {
        Market storage market = markets[marketId];

        TournamentLibV4.TournamentStatus tStatus = _getTournamentStatus(market.tournamentId);
        require(tStatus == TournamentLibV4.TournamentStatus.Completed, "Tournament not completed");

        uint16 scoreA = _getAgentScore(market.tournamentId, market.agentA);
        uint16 scoreB = _getAgentScore(market.tournamentId, market.agentB);

        uint8 winOutcome;
        if (scoreA > scoreB) {
            winOutcome = 0;
        } else if (scoreB > scoreA) {
            winOutcome = 1;
        } else {
            winOutcome = 2;
        }

        _settleMarket(marketId, winOutcome);
    }

    function _resolveOverUnder(uint256 marketId) internal {
        Market storage market = markets[marketId];

        (TournamentLibV4.GameStatus gStatus, , uint16 moveCount) =
            _getGameResult(market.tournamentId, market.round, market.gameIndex);

        if (gStatus == TournamentLibV4.GameStatus.Aborted) {
            _voidMarket(marketId);
            return;
        }

        require(gStatus == TournamentLibV4.GameStatus.Completed, "Game not completed");

        uint8 winOutcome = moveCount > market.threshold ? 0 : 1;

        _settleMarket(marketId, winOutcome);
    }

    // ── Settlement Math ────────────────────────────────────────────────

    function _settleMarket(uint256 marketId, uint8 winOutcome) internal {
        Market storage market = markets[marketId];
        uint256 winningTotal = outcomeTotals[marketId][winOutcome];

        if (winningTotal == 0) {
            _voidMarket(marketId);
            return;
        }

        market.status = MarketStatus.Resolved;
        market.winningOutcome = winOutcome;

        uint256 losingTotal = market.totalPool - winningTotal;
        if (losingTotal > 0) {
            uint256 vig = (losingTotal * vigBps) / TournamentLibV4.BPS_DENOMINATOR;
            market.vigCollected = vig;
            require(usdc.transfer(treasury, vig), "Vig transfer failed");
        }

        emit MarketResolved(marketId, winOutcome, market.totalPool, market.vigCollected);
    }

    function _voidMarket(uint256 marketId) internal {
        markets[marketId].status = MarketStatus.Voided;
        emit MarketVoided(marketId);
    }

    // ════════════════════════════════════════════════════════════════════
    //                           CLAIMS
    // ════════════════════════════════════════════════════════════════════

    /// @notice Claim winnings from a resolved market
    function claimWinnings(uint256 marketId) external nonReentrant {
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(market.status == MarketStatus.Resolved, "Market not resolved");

        Bet storage bet = bets[marketId][msg.sender];
        require(bet.amount > 0, "No bet placed");
        require(!bet.claimed, "Already claimed");
        require(bet.outcome == market.winningOutcome, "Not a winning bet");

        bet.claimed = true;

        uint256 winningTotal = outcomeTotals[marketId][market.winningOutcome];
        uint256 losingTotal = market.totalPool - winningTotal;
        uint256 distributable = losingTotal - market.vigCollected;

        uint256 payout = bet.amount + (distributable * bet.amount / winningTotal);

        require(usdc.transfer(msg.sender, payout), "Payout transfer failed");
        emit WinningsClaimed(marketId, msg.sender, payout);
    }

    /// @notice Claim refund from a voided market
    function claimRefund(uint256 marketId) external nonReentrant {
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(market.status == MarketStatus.Voided, "Market not voided");

        Bet storage bet = bets[marketId][msg.sender];
        require(bet.amount > 0, "No bet placed");
        require(!bet.claimed, "Already refunded");

        bet.claimed = true;
        require(usdc.transfer(msg.sender, bet.amount), "Refund transfer failed");
        emit RefundClaimed(marketId, msg.sender, bet.amount);
    }

    /// @notice Creator claims back their bond after market is resolved or voided
    function claimCreatorBond(uint256 marketId) external nonReentrant {
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(market.status != MarketStatus.Open, "Market still open");
        require(msg.sender == market.creator, "Not market creator");
        require(!market.bondClaimed, "Bond already claimed");

        market.bondClaimed = true;
        require(usdc.transfer(msg.sender, CREATION_BOND), "Bond return failed");
        emit BondReturned(marketId, msg.sender, CREATION_BOND);
    }

    // ════════════════════════════════════════════════════════════════════
    //                           VIEWS
    // ════════════════════════════════════════════════════════════════════

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    function getMarketOutcomeTotals(uint256 marketId) external view returns (uint256[] memory) {
        uint8 n = markets[marketId].numOutcomes;
        uint256[] memory totals = new uint256[](n);
        for (uint8 i = 0; i < n; i++) {
            totals[i] = outcomeTotals[marketId][i];
        }
        return totals;
    }

    function getBet(uint256 marketId, address bettor) external view returns (uint8 outcome, uint256 amount, bool claimed) {
        Bet storage bet = bets[marketId][bettor];
        return (bet.outcome, bet.amount, bet.claimed);
    }

    function getMarketByKey(bytes32 key) external view returns (uint256 marketId, bool exists) {
        marketId = marketKeys[key];
        exists = marketKeyExists[key];
    }

    function getMarketAgents(uint256 marketId) external view returns (address[] memory) {
        return marketAgents[marketId];
    }

    // ════════════════════════════════════════════════════════════════════
    //                           ADMIN
    // ════════════════════════════════════════════════════════════════════

    function setVigBps(uint16 _vigBps) external onlyAuthority {
        require(_vigBps <= 1000, "Vig too high");
        emit VigBpsUpdated(vigBps, _vigBps);
        vigBps = _vigBps;
    }

    function setMinBetAmount(uint256 _minBetAmount) external onlyAuthority {
        require(_minBetAmount > 0, "Min bet must be > 0");
        emit MinBetUpdated(minBetAmount, _minBetAmount);
        minBetAmount = _minBetAmount;
    }

    function setTreasury(address _treasury) external onlyAuthority {
        require(_treasury != address(0), "Invalid treasury");
        treasury = _treasury;
    }

    function setPaused(bool _paused) external onlyAuthority {
        paused = _paused;
        emit PausedStateChanged(_paused);
    }

    function proposeAuthorityTransfer(address _newAuthority) external onlyAuthority {
        require(_newAuthority != address(0), "Invalid authority");
        pendingAuthority = _newAuthority;
        emit AuthorityTransferProposed(authority, _newAuthority);
    }

    function acceptAuthorityTransfer() external {
        require(msg.sender == pendingAuthority, "Not pending authority");
        emit AuthorityTransferAccepted(authority, pendingAuthority);
        authority = pendingAuthority;
        pendingAuthority = address(0);
    }

    // ════════════════════════════════════════════════════════════════════
    //                   INTERNAL: Tournament Contract Reads
    // ════════════════════════════════════════════════════════════════════

    function _requireGameNotCompleted(uint256 tournamentId, uint8 round, uint8 gameIndex) internal view {
        ITournamentReaderV4.Game memory game = tournamentContract.getGame(tournamentId, round, gameIndex);
        require(game.exists, "Game does not exist");
        require(
            game.status == TournamentLibV4.GameStatus.Pending || game.status == TournamentLibV4.GameStatus.InProgress,
            "Game already completed"
        );
    }

    function _requireTournamentNotCompleted(uint256 tournamentId) internal view {
        TournamentLibV4.TournamentStatus status = _getTournamentStatus(tournamentId);
        require(
            status == TournamentLibV4.TournamentStatus.Registration ||
            status == TournamentLibV4.TournamentStatus.InProgress ||
            status == TournamentLibV4.TournamentStatus.RoundActive ||
            status == TournamentLibV4.TournamentStatus.RoundComplete,
            "Tournament completed or cancelled"
        );
    }

    function _getTournamentStatus(uint256 tournamentId) internal view returns (TournamentLibV4.TournamentStatus) {
        ITournamentReaderV4.Tournament memory t = tournamentContract.getTournament(tournamentId);
        return t.status;
    }

    /// @notice Get tournament result using V4's ranked players list
    /// @dev V4 stores winners via getRankedPlayers() instead of in the Tournament struct
    function _getTournamentResult(uint256 tournamentId)
        internal view
        returns (TournamentLibV4.TournamentStatus status, address[3] memory winners)
    {
        ITournamentReaderV4.Tournament memory t = tournamentContract.getTournament(tournamentId);
        status = t.status;

        // V4: fetch ranked players list and extract top 3
        address[] memory ranked = tournamentContract.getRankedPlayers(tournamentId);
        if (ranked.length >= 1) winners[0] = ranked[0];
        if (ranked.length >= 2) winners[1] = ranked[1];
        if (ranked.length >= 3) winners[2] = ranked[2];
    }

    function _getGameResult(uint256 tournamentId, uint8 round, uint8 gameIndex)
        internal view
        returns (TournamentLibV4.GameStatus status, TournamentLibV4.GameResult result, uint16 moveCount)
    {
        ITournamentReaderV4.Game memory game = tournamentContract.getGame(tournamentId, round, gameIndex);
        return (game.status, game.result, game.moveCount);
    }

    function _getAgentScore(uint256 tournamentId, address agent) internal view returns (uint16) {
        ITournamentReaderV4.Registration memory reg = tournamentContract.getRegistration(tournamentId, agent);
        return reg.score;
    }

    function _isRegistered(uint256 tournamentId, address agent) internal view returns (bool) {
        try tournamentContract.getRegistration(tournamentId, agent) returns (ITournamentReaderV4.Registration memory reg) {
            return reg.exists;
        } catch {
            return false;
        }
    }
}
