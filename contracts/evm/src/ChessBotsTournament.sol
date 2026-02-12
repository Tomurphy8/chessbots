// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IChessBotsTournament.sol";
import "./interfaces/IChessStaking.sol";
import "./libraries/TournamentLib.sol";

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

contract ChessBotsTournament is IChessBotsTournament {
    using TournamentLib for TournamentLib.Tier;

    // --- Structs ---

    struct ProtocolState {
        address authority;
        address treasury;
        uint16 protocolFeeBps;
        uint16 buybackShareBps;
        uint16 treasuryShareBps;
        uint64 totalTournaments;
        uint256 totalPrizeDistributed; // SC-H1(R6): upgraded from uint64 to prevent silent truncation
        bool paused;
        uint8 sponsoredFreeTournaments;  // Count of free tier tournaments created
        uint8 maxFreeTournaments;        // Adjustable limit (default 10)
        // totalGamesPlayed moved to separate slot to avoid serialization
    }

    // Separate counter to avoid storage conflicts in parallel execution
    uint64 public totalGamesPlayed;

    struct AgentProfile {
        address wallet;
        string name;
        string metadataUri;
        TournamentLib.AgentType agentType;
        uint16 eloRating;
        uint32 gamesPlayed;
        uint32 gamesWon;
        uint32 gamesDrawn;
        uint32 gamesLost;
        uint64 totalEarnings;
        bool registered;
    }

    struct Tournament {
        uint256 id;
        address authority;
        TournamentLib.Tier tier;
        uint256 entryFee;
        TournamentLib.TournamentStatus status;
        uint8 maxPlayers;
        uint8 minPlayers;
        uint8 registeredCount;
        uint8 currentRound;
        uint8 totalRounds;
        int64 startTime;
        int64 registrationDeadline;
        uint32 baseTimeSeconds;
        uint32 incrementSeconds;
        address[3] winners;
        string resultsUri;
        bool prizeDistributed;
        bool exists;
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
        TournamentLib.GameStatus status;
        TournamentLib.GameResult result;
        uint16 moveCount;
        int64 startedAt;
        int64 endedAt;
        bytes32 pgnHash;      // Changed: hash of PGN (serve full PGN from IPFS/Arweave)
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
        TournamentLib.GameResult result;
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

    IERC20 public chessToken;           // $CHESS token (address(0) = not configured)
    address public dexRouter;            // Uniswap V3 SwapRouter (address(0) = not configured)
    IChessStaking public stakingContract; // ChessStaking (address(0) = not configured)
    uint256 public pendingBuyback;       // Accumulated USDC for buyback
    mapping(uint256 => uint256) public tournamentCollected; // Actual USDC collected per tournament
    mapping(uint256 => mapping(address => uint256)) public playerPayment; // Actual amount each player paid

    // Reentrancy guard
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

    // --- Refund tracking ---
    mapping(uint256 => mapping(address => bool)) public refundClaimed;

    // --- Constructor (SC-C1: merged initialize to prevent front-running) ---

    constructor(
        address _usdc,
        address _treasury,
        uint16 _protocolFeeBps,
        uint16 _buybackShareBps,
        uint16 _treasuryShareBps
    ) {
        require(_usdc != address(0), "Zero USDC address");
        require(_treasury != address(0), "Zero treasury address");
        require(_protocolFeeBps <= 2000, "Protocol fee too high"); // SC-C3: cap at 20%
        require(_buybackShareBps + _treasuryShareBps == TournamentLib.BPS_DENOMINATOR, "Invalid fee config");

        usdc = IERC20(_usdc);
        protocol.authority = msg.sender;
        protocol.treasury = _treasury;
        protocol.protocolFeeBps = _protocolFeeBps;
        protocol.buybackShareBps = _buybackShareBps;
        protocol.treasuryShareBps = _treasuryShareBps;
        protocol.maxFreeTournaments = TournamentLib.MAX_SPONSORED_FREE_DEFAULT;
        _reentrancyStatus = _NOT_ENTERED;

        emit ProtocolInitialized(msg.sender, _treasury, _protocolFeeBps);
    }

    // --- Authority Transfer (L-2: two-step transfer) ---

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
        emit PausedStateChanged(_paused); // L-1: emit pause event
    }

    function setTreasury(address _newTreasury) external onlyAuthority {
        require(_newTreasury != address(0), "Zero address");
        address oldTreasury = protocol.treasury;
        protocol.treasury = _newTreasury;
        emit TreasuryUpdated(oldTreasury, _newTreasury);
    }

    /// @notice Adjust the maximum number of free tier tournaments that can be created
    function setFreeTournamentLimit(uint8 _newLimit) external onlyAuthority {
        protocol.maxFreeTournaments = _newLimit;
        emit FreeTournamentLimitUpdated(_newLimit);
    }

    /// @notice Fund a tournament's prize pool (for Free tier sponsored tournaments).
    ///         Authority deposits USDC to cover the prize pool. Can be called
    ///         at any time before prizes are distributed, allowing top-ups.
    function fundTournament(uint256 tournamentId, uint256 amount) external onlyAuthority nonReentrant {
        Tournament storage t = tournaments[tournamentId];
        require(t.exists, "Tournament not found");
        require(!t.prizeDistributed, "Prizes already distributed");
        require(t.status != TournamentLib.TournamentStatus.Cancelled, "Tournament cancelled");
        require(amount > 0, "Zero amount");

        require(usdc.transferFrom(msg.sender, address(this), amount), "USDC transfer failed");
        tournamentCollected[tournamentId] += amount;

        emit TournamentFunded(tournamentId, amount);
    }

    // --- Tokenomics Configuration (I-4: zero address checks) ---

    function setChessToken(address _token) external onlyAuthority {
        require(_token != address(0), "Zero address");
        chessToken = IERC20(_token);
        emit ChessTokenUpdated(_token);
    }

    function setDexRouter(address _router) external onlyAuthority {
        require(_router != address(0), "Zero address");
        // SC-H5: revoke old router approval before setting new one
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
        TournamentLib.AgentType agentType
    ) external whenNotPaused {
        require(!agents[msg.sender].registered, "Already registered");
        require(bytes(name).length > 0 && bytes(name).length <= 32, "Invalid name");

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
            registered: true
        });

        emit AgentRegistered(msg.sender, name, agentType);
    }

    // --- Tournaments ---

    function createTournament(
        TournamentLib.Tier tier,
        uint8 maxPlayers,
        uint8 minPlayers,
        int64 startTime,
        int64 registrationDeadline,
        uint32 baseTimeSeconds,
        uint32 incrementSeconds
    ) external onlyAuthority whenNotPaused {
        _createTournament(tier, maxPlayers, minPlayers, startTime, registrationDeadline, baseTimeSeconds, incrementSeconds, 0);
    }

    /// @notice Create a Legends tier tournament with a custom entry fee.
    ///         Entry fee must be >= 500 USDC. Agents wager as much as they want.
    function createLegendsTournament(
        uint8 maxPlayers,
        uint8 minPlayers,
        int64 startTime,
        int64 registrationDeadline,
        uint32 baseTimeSeconds,
        uint32 incrementSeconds,
        uint256 customEntryFee
    ) external onlyAuthority whenNotPaused {
        require(customEntryFee >= TournamentLib.LEGENDS_MIN_ENTRY, "Legends min 500 USDC");
        _createTournament(
            TournamentLib.Tier.Legends, maxPlayers, minPlayers,
            startTime, registrationDeadline, baseTimeSeconds, incrementSeconds,
            customEntryFee
        );
    }

    function _createTournament(
        TournamentLib.Tier tier,
        uint8 maxPlayers,
        uint8 minPlayers,
        int64 startTime,
        int64 registrationDeadline,
        uint32 baseTimeSeconds,
        uint32 incrementSeconds,
        uint256 customEntryFee
    ) internal {
        require(maxPlayers >= TournamentLib.MIN_PLAYERS && maxPlayers <= TournamentLib.MAX_PLAYERS, "Invalid player count");
        require(minPlayers >= TournamentLib.MIN_PLAYERS && minPlayers <= maxPlayers, "Invalid min players");
        require(baseTimeSeconds > 0, "Invalid time control");
        require(startTime > 0, "Invalid start time"); // M-3, L-5: validate positive
        require(registrationDeadline > 0, "Invalid deadline"); // M-3: validate positive
        require(uint256(uint64(registrationDeadline)) > block.timestamp, "Deadline must be in future"); // L-5
        require(uint256(uint64(startTime)) > block.timestamp, "Start must be in future"); // L-5
        require(registrationDeadline < startTime, "Deadline must be before start");

        // Free tier: enforce sponsored limit
        if (tier == TournamentLib.Tier.Free) {
            require(protocol.sponsoredFreeTournaments < protocol.maxFreeTournaments, "Free tournament limit reached");
            protocol.sponsoredFreeTournaments++;
        }

        uint256 fee = tier == TournamentLib.Tier.Legends ? customEntryFee : tier.entryFee();

        uint256 id = protocol.totalTournaments;
        protocol.totalTournaments++;

        tournaments[id] = Tournament({
            id: id,
            authority: msg.sender,
            tier: tier,
            entryFee: fee,
            status: TournamentLib.TournamentStatus.Registration,
            maxPlayers: maxPlayers,
            minPlayers: minPlayers,
            registeredCount: 0,
            currentRound: 0,
            totalRounds: 0,
            startTime: startTime,
            registrationDeadline: registrationDeadline,
            baseTimeSeconds: baseTimeSeconds,
            incrementSeconds: incrementSeconds,
            winners: [address(0), address(0), address(0)],
            resultsUri: "",
            prizeDistributed: false,
            exists: true
        });

        emit TournamentCreated(id, tier, fee, maxPlayers);
    }

    function registerForTournament(uint256 tournamentId) external whenNotPaused nonReentrant {
        Tournament storage t = tournaments[tournamentId];
        require(t.exists, "Tournament not found");
        require(t.status == TournamentLib.TournamentStatus.Registration, "Not in registration");
        require(t.registeredCount < t.maxPlayers, "Tournament full");
        require(agents[msg.sender].registered, "Agent not registered");
        require(!registrations[tournamentId][msg.sender].exists, "Already registered");
        require(block.timestamp < uint256(uint64(t.registrationDeadline)), "Registration closed");

        // Free tier: skip payment entirely
        if (t.entryFee > 0) {
            // Calculate fee with staking discount
            uint256 actualFee = t.entryFee;
            if (address(stakingContract) != address(0)) {
                uint16 discountBps = stakingContract.getDiscount(msg.sender);
                if (discountBps > 0) {
                    uint256 discount = (t.entryFee * discountBps) / TournamentLib.BPS_DENOMINATOR;
                    actualFee = t.entryFee - discount;
                    emit DiscountApplied(tournamentId, msg.sender, discountBps, discount);
                }
            }

            require(usdc.transferFrom(msg.sender, address(this), actualFee), "USDC transfer failed");
            tournamentCollected[tournamentId] += actualFee;
            playerPayment[tournamentId][msg.sender] = actualFee; // Track exact amount paid for accurate refunds
        }

        registrations[tournamentId][msg.sender] = Registration({
            agent: msg.sender,
            score: 0,
            buchholz: 0,
            gamesPlayed: 0,
            gamesWon: 0,
            gamesDrawn: 0,
            gamesLost: 0,
            finalRank: 0,
            active: true,
            exists: true
        });

        t.registeredCount++;
        emit AgentJoined(tournamentId, msg.sender, t.registeredCount);
    }

    function startTournament(uint256 tournamentId) external onlyTournamentAuthority(tournamentId) {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLib.TournamentStatus.Registration, "Not in registration");
        require(t.registeredCount >= t.minPlayers, "Not enough players");

        t.totalRounds = TournamentLib.calculateRounds(t.registeredCount);
        t.currentRound = 1;
        t.status = TournamentLib.TournamentStatus.RoundActive;

        emit TournamentStarted(tournamentId, t.totalRounds);
    }

    function cancelTournament(uint256 tournamentId) external onlyTournamentAuthority(tournamentId) {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLib.TournamentStatus.Registration, "Can only cancel during registration");
        t.status = TournamentLib.TournamentStatus.Cancelled;
        emit TournamentCancelled(tournamentId);
    }

    /// @notice Claim refund for a cancelled tournament (SC-H1)
    /// Fixed: Uses exact payment tracking instead of approximate division
    function claimRefund(uint256 tournamentId) external nonReentrant {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLib.TournamentStatus.Cancelled, "Not cancelled");
        require(registrations[tournamentId][msg.sender].exists, "Not registered");
        require(!refundClaimed[tournamentId][msg.sender], "Already refunded");

        // Use exact amount player paid (not approximate division)
        uint256 refundAmount = playerPayment[tournamentId][msg.sender];
        refundClaimed[tournamentId][msg.sender] = true;

        // Free tier players have nothing to refund
        if (refundAmount > 0) {
            tournamentCollected[tournamentId] -= refundAmount;
            require(usdc.transfer(msg.sender, refundAmount), "Refund transfer failed");
        }
        emit RefundClaimed(tournamentId, msg.sender, refundAmount);
    }

    // --- Games (Single) ---

    function _gameKey(uint256 tournamentId, uint8 round, uint8 gameIndex) internal pure returns (bytes32) {
        return keccak256(abi.encode(tournamentId, round, gameIndex)); // M-4: use abi.encode
    }

    function createGame(
        uint256 tournamentId,
        uint8 round,
        uint8 gameIndex,
        address white,
        address black
    ) external onlyTournamentAuthority(tournamentId) {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLib.TournamentStatus.RoundActive, "Not in active round");
        require(t.currentRound == round, "Wrong round");

        // M-6: validate players are registered
        require(registrations[tournamentId][white].exists, "White not registered");
        require(registrations[tournamentId][black].exists, "Black not registered");

        bytes32 key = _gameKey(tournamentId, round, gameIndex);
        require(!games[key].exists, "Game already exists");

        games[key] = Game({
            tournamentId: tournamentId,
            round: round,
            gameIndex: gameIndex,
            white: white,
            black: black,
            status: TournamentLib.GameStatus.Pending,
            result: TournamentLib.GameResult.Undecided,
            moveCount: 0,
            startedAt: 0,
            endedAt: 0,
            pgnHash: bytes32(0),
            resultHash: bytes32(0),
            arbiter: msg.sender,
            exists: true
        });

        emit GameCreated(tournamentId, round, gameIndex, white, black);
    }

    function startGame(
        uint256 tournamentId,
        uint8 round,
        uint8 gameIndex
    ) external onlyTournamentAuthority(tournamentId) {
        bytes32 key = _gameKey(tournamentId, round, gameIndex);
        Game storage g = games[key];
        require(g.exists, "Game not found");
        require(g.status == TournamentLib.GameStatus.Pending, "Game not pending");

        g.status = TournamentLib.GameStatus.InProgress;
        g.startedAt = int64(int256(block.timestamp));

        emit GameStarted(tournamentId, round, gameIndex);
    }

    function submitGameResult(
        uint256 tournamentId,
        uint8 round,
        uint8 gameIndex,
        TournamentLib.GameResult result,
        bytes32 pgnHash,
        bytes32 resultHash,
        uint16 moveCount
    ) external onlyTournamentAuthority(tournamentId) {
        require(result != TournamentLib.GameResult.Undecided, "Invalid result");

        bytes32 key = _gameKey(tournamentId, round, gameIndex);
        Game storage g = games[key];
        require(g.exists, "Game not found");
        require(g.status == TournamentLib.GameStatus.InProgress, "Game not in progress");

        g.result = result;
        g.status = TournamentLib.GameStatus.Completed;
        g.pgnHash = pgnHash;
        g.resultHash = resultHash;
        g.moveCount = moveCount;
        g.endedAt = int64(int256(block.timestamp));
        g.arbiter = msg.sender;

        // Increment in separate storage slot (not packed with protocol state)
        totalGamesPlayed++;

        emit GameResultSubmitted(tournamentId, round, gameIndex, result);
    }

    // --- Batch Operations (Gas Optimized) ---

    /// @notice Create and start all games for a round in a single transaction.
    ///         Saves ~21,000 base tx cost per game vs individual calls.
    function batchCreateAndStartGames(
        uint256 tournamentId,
        uint8 round,
        GameInput[] calldata gameInputs
    ) external onlyTournamentAuthority(tournamentId) {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLib.TournamentStatus.RoundActive, "Not in active round");
        require(t.currentRound == round, "Wrong round");

        int64 now_ = int64(int256(block.timestamp));

        for (uint256 i = 0; i < gameInputs.length; i++) {
            // M-6: validate players are registered
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
                status: TournamentLib.GameStatus.InProgress,
                result: TournamentLib.GameResult.Undecided,
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

    /// @notice Submit all game results for a round in a single transaction.
    ///         Saves ~21,000 base tx cost per game vs individual calls.
    function batchSubmitResults(
        uint256 tournamentId,
        uint8 round,
        GameResultInput[] calldata results
    ) external onlyTournamentAuthority(tournamentId) {
        int64 now_ = int64(int256(block.timestamp));

        for (uint256 i = 0; i < results.length; i++) {
            require(results[i].result != TournamentLib.GameResult.Undecided, "Invalid result");

            bytes32 key = _gameKey(tournamentId, round, results[i].gameIndex);
            Game storage g = games[key];
            require(g.exists, "Game not found");
            require(g.status == TournamentLib.GameStatus.InProgress, "Game not in progress");

            g.result = results[i].result;
            g.status = TournamentLib.GameStatus.Completed;
            g.pgnHash = results[i].pgnHash;
            g.resultHash = results[i].resultHash;
            g.moveCount = results[i].moveCount;
            g.endedAt = now_;
            g.arbiter = msg.sender;

            emit GameResultSubmitted(tournamentId, round, results[i].gameIndex, results[i].result);
        }

        // Single counter increment for entire batch
        totalGamesPlayed += uint64(results.length);

        emit RoundResultsSubmitted(tournamentId, round, uint8(results.length));
    }

    /// @notice Update standings for all players after a round in a single transaction.
    ///         Also transitions tournament status to RoundComplete.
    ///         SC-H2(R6): Syncs AgentProfile global stats from per-tournament Registration data.
    function batchUpdateStandings(
        uint256 tournamentId,
        StandingsInput[] calldata standings
    ) external onlyTournamentAuthority(tournamentId) {
        Tournament storage t = tournaments[tournamentId];
        require(
            t.status == TournamentLib.TournamentStatus.RoundActive ||
            t.status == TournamentLib.TournamentStatus.RoundComplete,
            "Invalid tournament state"
        );

        for (uint256 i = 0; i < standings.length; i++) {
            Registration storage r = registrations[tournamentId][standings[i].agent];
            require(r.exists, "Not registered");
            // M-1: validate stats consistency
            require(
                standings[i].gamesWon + standings[i].gamesDrawn + standings[i].gamesLost == standings[i].gamesPlayed,
                "Stats mismatch"
            );

            // SC-H2(R6): Compute delta and update global AgentProfile stats
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

        // Transition to RoundComplete in one shot
        if (t.status == TournamentLib.TournamentStatus.RoundActive) {
            t.status = TournamentLib.TournamentStatus.RoundComplete;
        }

        emit StandingsUpdated(tournamentId, t.currentRound);
    }

    /// @notice Execute a full round in one tx: submit all results + update all standings + advance round.
    ///         Maximum gas savings for the orchestrator — one tx per round instead of ~50.
    function executeRound(
        uint256 tournamentId,
        uint8 round,
        GameResultInput[] calldata results,
        StandingsInput[] calldata standings,
        bool advance
    ) external onlyTournamentAuthority(tournamentId) {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLib.TournamentStatus.RoundActive, "Not in active round"); // M-2
        require(t.currentRound == round, "Wrong round");

        // Submit all results
        int64 now_ = int64(int256(block.timestamp));
        for (uint256 i = 0; i < results.length; i++) {
            require(results[i].result != TournamentLib.GameResult.Undecided, "Invalid result");

            bytes32 key = _gameKey(tournamentId, round, results[i].gameIndex);
            Game storage g = games[key];
            require(g.exists, "Game not found");
            require(g.status == TournamentLib.GameStatus.InProgress, "Game not in progress");

            g.result = results[i].result;
            g.status = TournamentLib.GameStatus.Completed;
            g.pgnHash = results[i].pgnHash;
            g.resultHash = results[i].resultHash;
            g.moveCount = results[i].moveCount;
            g.endedAt = now_;
            g.arbiter = msg.sender;

            emit GameResultSubmitted(tournamentId, round, results[i].gameIndex, results[i].result);
        }

        totalGamesPlayed += uint64(results.length);

        // Update all standings
        for (uint256 i = 0; i < standings.length; i++) {
            Registration storage r = registrations[tournamentId][standings[i].agent];
            require(r.exists, "Not registered");
            // M-1: validate stats consistency
            require(
                standings[i].gamesWon + standings[i].gamesDrawn + standings[i].gamesLost == standings[i].gamesPlayed,
                "Stats mismatch"
            );

            // SC-H2(R6): Update global AgentProfile stats (delta-based)
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

        t.status = TournamentLib.TournamentStatus.RoundComplete;
        emit StandingsUpdated(tournamentId, round);
        emit RoundResultsSubmitted(tournamentId, round, uint8(results.length));

        // Optionally advance to next round
        if (advance && t.currentRound < t.totalRounds) {
            t.currentRound++;
            t.status = TournamentLib.TournamentStatus.RoundActive;
            emit RoundAdvanced(tournamentId, t.currentRound);
        }
    }

    // --- Standings (Single) ---

    function updateStandings(
        uint256 tournamentId,
        address agent,
        uint16 score,
        uint16 buchholz,
        uint8 _gamesPlayed,
        uint8 _gamesWon,
        uint8 _gamesDrawn,
        uint8 _gamesLost
    ) external onlyTournamentAuthority(tournamentId) {
        Tournament storage t = tournaments[tournamentId];
        require(
            t.status == TournamentLib.TournamentStatus.RoundActive ||
            t.status == TournamentLib.TournamentStatus.RoundComplete,
            "Invalid tournament state"
        );

        Registration storage r = registrations[tournamentId][agent];
        require(r.exists, "Not registered");
        // SC-H1: validate stats consistency (matching batch path)
        require(
            _gamesWon + _gamesDrawn + _gamesLost == _gamesPlayed,
            "Stats mismatch"
        );

        r.score = score;
        r.buchholz = buchholz;
        r.gamesPlayed = _gamesPlayed;
        r.gamesWon = _gamesWon;
        r.gamesDrawn = _gamesDrawn;
        r.gamesLost = _gamesLost;

        if (t.status == TournamentLib.TournamentStatus.RoundActive) {
            t.status = TournamentLib.TournamentStatus.RoundComplete;
        }

        emit StandingsUpdated(tournamentId, t.currentRound);
    }

    function advanceRound(uint256 tournamentId) external onlyTournamentAuthority(tournamentId) {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLib.TournamentStatus.RoundComplete, "Round not complete");
        require(t.currentRound < t.totalRounds, "All rounds played");

        t.currentRound++;
        t.status = TournamentLib.TournamentStatus.RoundActive;

        emit RoundAdvanced(tournamentId, t.currentRound);
    }

    // --- Finalization ---

    function finalizeTournament(
        uint256 tournamentId,
        address[3] calldata winners,
        string calldata resultsUri
    ) external onlyTournamentAuthority(tournamentId) {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLib.TournamentStatus.RoundComplete, "Not round complete");
        require(t.currentRound == t.totalRounds, "Not all rounds played");

        // SC-C2: validate winners are registered participants
        require(registrations[tournamentId][winners[0]].exists, "Winner 1 not registered");
        require(registrations[tournamentId][winners[1]].exists, "Winner 2 not registered");
        require(registrations[tournamentId][winners[2]].exists, "Winner 3 not registered");

        // Validate winners are distinct addresses
        require(winners[0] != winners[1] && winners[1] != winners[2] && winners[0] != winners[2], "Duplicate winners");

        t.winners = winners;
        t.resultsUri = resultsUri;
        t.status = TournamentLib.TournamentStatus.Completed;

        emit TournamentFinalized(tournamentId, winners[0], winners[1], winners[2]);
    }

    function distributePrizes(uint256 tournamentId) external onlyTournamentAuthority(tournamentId) nonReentrant {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentLib.TournamentStatus.Completed, "Not completed");
        require(!t.prizeDistributed, "Already distributed");

        // SC-H2: Use actual collected amount only — no insolvency-prone fallback
        uint256 totalPool = tournamentCollected[tournamentId];
        require(totalPool > 0, "No funds to distribute");

        (uint256 firstPrize, uint256 secondPrize, uint256 thirdPrize, uint256 protocolFee) =
            TournamentLib.calculatePrizes(totalPool, protocol.protocolFeeBps);

        t.prizeDistributed = true;

        // Distribute player prizes and update agent earnings
        if (firstPrize > 0) {
            require(usdc.transfer(t.winners[0], firstPrize), "1st prize failed");
            agents[t.winners[0]].totalEarnings += uint64(firstPrize); // SC-H2(R6)
        }
        if (secondPrize > 0) {
            require(usdc.transfer(t.winners[1], secondPrize), "2nd prize failed");
            agents[t.winners[1]].totalEarnings += uint64(secondPrize); // SC-H2(R6)
        }
        if (thirdPrize > 0) {
            require(usdc.transfer(t.winners[2], thirdPrize), "3rd prize failed");
            agents[t.winners[2]].totalEarnings += uint64(thirdPrize); // SC-H2(R6)
        }

        // Split protocol fee: buyback vs treasury
        if (protocolFee > 0) {
            bool buybackConfigured = address(chessToken) != address(0) && dexRouter != address(0);
            if (buybackConfigured) {
                uint256 buybackAmount = (protocolFee * protocol.buybackShareBps) / TournamentLib.BPS_DENOMINATOR;
                uint256 treasuryAmount = protocolFee - buybackAmount;

                pendingBuyback += buybackAmount;
                if (treasuryAmount > 0) {
                    require(usdc.transfer(protocol.treasury, treasuryAmount), "Treasury transfer failed");
                }
                emit BuybackAccumulated(tournamentId, buybackAmount);
            } else {
                // Graceful degradation: no token configured → all to treasury
                require(usdc.transfer(protocol.treasury, protocolFee), "Fee transfer failed");
            }
        }

        protocol.totalPrizeDistributed += totalPool - protocolFee;

        emit PrizesDistributed(tournamentId, totalPool, firstPrize, secondPrize, thirdPrize, protocolFee);
    }

    // --- Buyback ---

    /// @notice Execute a buyback: swap accumulated USDC for CHESS and burn.
    ///         SC-H4: Restricted to authority to prevent sandwich attacks.
    /// @param minChessOut Minimum CHESS tokens to receive (slippage protection)
    function executeBuyback(uint256 minChessOut) external onlyAuthority nonReentrant {
        require(address(chessToken) != address(0) && dexRouter != address(0), "Buyback not configured");
        require(pendingBuyback >= 10e6, "Min 10 USDC to buyback");

        // CEI: zero state before external calls
        uint256 amount = pendingBuyback;
        pendingBuyback = 0;

        // SC-H5: Reset approval before setting new one
        usdc.approve(dexRouter, 0);
        require(usdc.approve(dexRouter, amount), "Approve failed");

        // Swap USDC → CHESS via DEX
        ISwapRouter(dexRouter).exactInputSingle(ISwapRouter.ExactInputSingleParams({
            tokenIn: address(usdc),
            tokenOut: address(chessToken),
            fee: 3000,       // 0.3% pool fee tier
            recipient: address(this),
            amountIn: amount,
            amountOutMinimum: minChessOut,
            sqrtPriceLimitX96: 0
        }));

        // Burn all received CHESS
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
}
