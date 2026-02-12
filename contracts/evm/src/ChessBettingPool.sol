// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./libraries/TournamentLib.sol";

interface IERC20Betting {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title ChessBettingPool — Spectator Side Bets for ChessBots Tournaments
/// @notice Allows spectators to place bets on individual tournament games
/// @dev Reads game results from ChessBotsTournament via getGame(). 3% vig (configurable).
contract ChessBettingPool {

    // ── Types ──────────────────────────────────────────────────────────

    enum Prediction { WhiteWins, BlackWins, Draw }
    enum PoolStatus { Open, Settled, Cancelled }

    struct BetPool {
        uint256 tournamentId;
        uint8 round;
        uint8 gameIndex;
        PoolStatus status;
        Prediction winningPrediction;
        uint256 totalWhiteWins;
        uint256 totalBlackWins;
        uint256 totalDraw;
        uint256 vigCollected;
        bool exists;
    }

    struct Bet {
        Prediction prediction;
        uint256 amount;
        bool claimed;
    }

    // ── Events ─────────────────────────────────────────────────────────

    event BetPoolCreated(uint256 indexed poolId, uint256 indexed tournamentId, uint8 round, uint8 gameIndex);
    event BetPlaced(uint256 indexed poolId, address indexed bettor, Prediction prediction, uint256 amount);
    event BetPoolSettled(uint256 indexed poolId, Prediction winningPrediction, uint256 vigAmount);
    event BetPoolCancelled(uint256 indexed poolId);
    event WinningsClaimed(uint256 indexed poolId, address indexed bettor, uint256 payout);
    event RefundClaimed(uint256 indexed poolId, address indexed bettor, uint256 amount);
    event VigBpsUpdated(uint16 oldVig, uint16 newVig);
    event MinBetUpdated(uint256 oldMin, uint256 newMin);
    event AuthorityTransferProposed(address indexed current, address indexed pending);
    event AuthorityTransferAccepted(address indexed oldAuthority, address indexed newAuthority);
    event PausedStateChanged(bool paused);

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

    IERC20Betting public immutable usdc;
    address public immutable tournamentContract;
    address public treasury;
    address public authority;
    address public pendingAuthority;

    uint16 public vigBps;           // default 300 = 3%
    uint256 public minBetAmount;    // default 1 USDC
    bool public paused;

    uint256 public nextPoolId;
    mapping(uint256 => BetPool) public betPools;
    mapping(uint256 => mapping(address => Bet)) public bets; // poolId => bettor => Bet
    mapping(bytes32 => uint256) public gameToPool;            // game key => poolId

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
        require(_vigBps <= 1000, "Vig too high"); // max 10%

        usdc = IERC20Betting(_usdc);
        tournamentContract = _tournamentContract;
        treasury = _treasury;
        authority = msg.sender;
        vigBps = _vigBps;
        minBetAmount = 1e6; // 1 USDC
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

    // ── Pool Management ────────────────────────────────────────────────

    /// @notice Create a bet pool for a specific game
    /// @param tournamentId The tournament ID
    /// @param round The round number
    /// @param gameIndex The game index within the round
    function createBetPool(
        uint256 tournamentId,
        uint8 round,
        uint8 gameIndex
    ) external onlyAuthority whenNotPaused returns (uint256 poolId) {
        // Verify game exists via tournament contract
        (bool success, bytes memory data) = tournamentContract.staticcall(
            abi.encodeWithSignature("getGame(uint256,uint8,uint8)", tournamentId, round, gameIndex)
        );
        require(success, "Game lookup failed");

        // Decode the Game struct to check it exists and isn't completed
        (
            ,  // tournamentId
            ,  // round
            ,  // gameIndex
            ,  // white
            ,  // black
            TournamentLib.GameStatus status,
            ,  // result
            ,  // moveCount
            ,  // startedAt
            ,  // endedAt
            ,  // pgnHash
            ,  // resultHash
            ,  // arbiter
            bool exists
        ) = abi.decode(data, (
            uint256, uint8, uint8, address, address,
            TournamentLib.GameStatus, TournamentLib.GameResult,
            uint16, int64, int64, bytes32, bytes32, address, bool
        ));

        require(exists, "Game does not exist");
        require(
            status == TournamentLib.GameStatus.Pending || status == TournamentLib.GameStatus.InProgress,
            "Game already completed"
        );

        poolId = nextPoolId++;
        betPools[poolId] = BetPool({
            tournamentId: tournamentId,
            round: round,
            gameIndex: gameIndex,
            status: PoolStatus.Open,
            winningPrediction: Prediction.WhiteWins, // placeholder, only meaningful after settlement
            totalWhiteWins: 0,
            totalBlackWins: 0,
            totalDraw: 0,
            vigCollected: 0,
            exists: true
        });

        // Index for frontend lookup
        gameToPool[keccak256(abi.encode(tournamentId, round, gameIndex))] = poolId;

        emit BetPoolCreated(poolId, tournamentId, round, gameIndex);
    }

    // ── Betting ────────────────────────────────────────────────────────

    /// @notice Place a bet on a game outcome
    /// @param poolId The bet pool ID
    /// @param prediction WhiteWins, BlackWins, or Draw
    /// @param amount USDC amount to bet (6 decimals)
    function placeBet(
        uint256 poolId,
        Prediction prediction,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        BetPool storage pool = betPools[poolId];
        require(pool.exists, "Pool does not exist");
        require(pool.status == PoolStatus.Open, "Pool not open");
        require(amount >= minBetAmount, "Below minimum bet");
        require(bets[poolId][msg.sender].amount == 0, "Already bet on this pool");

        // Verify game hasn't completed yet
        (bool success, bytes memory data) = tournamentContract.staticcall(
            abi.encodeWithSignature("getGame(uint256,uint8,uint8)", pool.tournamentId, pool.round, pool.gameIndex)
        );
        require(success, "Game lookup failed");

        (
            ,,,,,
            TournamentLib.GameStatus status,
            ,,,,,,, // skip remaining fields
        ) = abi.decode(data, (
            uint256, uint8, uint8, address, address,
            TournamentLib.GameStatus, TournamentLib.GameResult,
            uint16, int64, int64, bytes32, bytes32, address, bool
        ));

        require(
            status == TournamentLib.GameStatus.Pending || status == TournamentLib.GameStatus.InProgress,
            "Game already completed"
        );

        // Transfer USDC from bettor
        require(usdc.transferFrom(msg.sender, address(this), amount), "USDC transfer failed");

        // Record bet
        bets[poolId][msg.sender] = Bet({
            prediction: prediction,
            amount: amount,
            claimed: false
        });

        // Update pool totals
        if (prediction == Prediction.WhiteWins) {
            pool.totalWhiteWins += amount;
        } else if (prediction == Prediction.BlackWins) {
            pool.totalBlackWins += amount;
        } else {
            pool.totalDraw += amount;
        }

        emit BetPlaced(poolId, msg.sender, prediction, amount);
    }

    // ── Settlement ─────────────────────────────────────────────────────

    /// @notice Settle a bet pool by reading the game result from the tournament contract
    /// @param poolId The bet pool ID to settle
    function settleBets(uint256 poolId) external onlyAuthority nonReentrant {
        BetPool storage pool = betPools[poolId];
        require(pool.exists, "Pool does not exist");
        require(pool.status == PoolStatus.Open, "Pool not open");

        // Read game result from tournament contract
        (bool success, bytes memory data) = tournamentContract.staticcall(
            abi.encodeWithSignature("getGame(uint256,uint8,uint8)", pool.tournamentId, pool.round, pool.gameIndex)
        );
        require(success, "Game lookup failed");

        (
            ,,,,,
            TournamentLib.GameStatus status,
            TournamentLib.GameResult result,
            ,,,,,, // skip remaining fields
        ) = abi.decode(data, (
            uint256, uint8, uint8, address, address,
            TournamentLib.GameStatus, TournamentLib.GameResult,
            uint16, int64, int64, bytes32, bytes32, address, bool
        ));

        require(status == TournamentLib.GameStatus.Completed, "Game not completed");
        require(result != TournamentLib.GameResult.Undecided, "Result undecided");

        // Map game result to prediction
        Prediction winningPrediction;
        if (result == TournamentLib.GameResult.WhiteWins || result == TournamentLib.GameResult.BlackForfeit) {
            winningPrediction = Prediction.WhiteWins;
        } else if (result == TournamentLib.GameResult.BlackWins || result == TournamentLib.GameResult.WhiteForfeit) {
            winningPrediction = Prediction.BlackWins;
        } else {
            // Draw
            winningPrediction = Prediction.Draw;
        }

        pool.winningPrediction = winningPrediction;
        pool.status = PoolStatus.Settled;

        // Calculate and transfer vig
        uint256 totalPool = pool.totalWhiteWins + pool.totalBlackWins + pool.totalDraw;
        uint256 winningTotal = _getPoolTotal(pool, winningPrediction);
        uint256 losingTotal = totalPool - winningTotal;

        if (losingTotal > 0) {
            uint256 vig = (losingTotal * vigBps) / TournamentLib.BPS_DENOMINATOR;
            pool.vigCollected = vig;
            require(usdc.transfer(treasury, vig), "Vig transfer failed");
        }

        emit BetPoolSettled(poolId, winningPrediction, pool.vigCollected);
    }

    /// @notice Cancel a bet pool (allows refunds)
    /// @param poolId The bet pool to cancel
    function cancelBetPool(uint256 poolId) external onlyAuthority {
        BetPool storage pool = betPools[poolId];
        require(pool.exists, "Pool does not exist");
        require(pool.status == PoolStatus.Open, "Pool not open");

        pool.status = PoolStatus.Cancelled;
        emit BetPoolCancelled(poolId);
    }

    // ── Claims ─────────────────────────────────────────────────────────

    /// @notice Claim winnings from a settled bet pool
    /// @param poolId The bet pool to claim from
    function claimWinnings(uint256 poolId) external nonReentrant {
        BetPool storage pool = betPools[poolId];
        require(pool.exists, "Pool does not exist");
        require(pool.status == PoolStatus.Settled, "Pool not settled");

        Bet storage bet = bets[poolId][msg.sender];
        require(bet.amount > 0, "No bet placed");
        require(!bet.claimed, "Already claimed");
        require(bet.prediction == pool.winningPrediction, "Not a winning bet");

        bet.claimed = true;

        // Calculate payout
        uint256 totalPool = pool.totalWhiteWins + pool.totalBlackWins + pool.totalDraw;
        uint256 winningTotal = _getPoolTotal(pool, pool.winningPrediction);
        uint256 losingTotal = totalPool - winningTotal;
        uint256 distributable = losingTotal - pool.vigCollected;

        // payout = original bet + proportional share of losing pool (minus vig)
        uint256 payout = bet.amount + (distributable * bet.amount / winningTotal);

        require(usdc.transfer(msg.sender, payout), "Payout transfer failed");
        emit WinningsClaimed(poolId, msg.sender, payout);
    }

    /// @notice Claim refund from a cancelled bet pool
    /// @param poolId The bet pool to claim refund from
    function claimRefund(uint256 poolId) external nonReentrant {
        BetPool storage pool = betPools[poolId];
        require(pool.exists, "Pool does not exist");
        require(pool.status == PoolStatus.Cancelled, "Pool not cancelled");

        Bet storage bet = bets[poolId][msg.sender];
        require(bet.amount > 0, "No bet placed");
        require(!bet.claimed, "Already refunded");

        bet.claimed = true;
        require(usdc.transfer(msg.sender, bet.amount), "Refund transfer failed");
        emit RefundClaimed(poolId, msg.sender, bet.amount);
    }

    // ── Views ──────────────────────────────────────────────────────────

    /// @notice Get total amount bet in a pool
    function getPoolTotal(uint256 poolId) external view returns (uint256) {
        BetPool storage pool = betPools[poolId];
        require(pool.exists, "Pool does not exist");
        return pool.totalWhiteWins + pool.totalBlackWins + pool.totalDraw;
    }

    /// @notice Get a bettor's bet details
    function getBet(uint256 poolId, address bettor) external view returns (Prediction, uint256, bool) {
        Bet storage bet = bets[poolId][bettor];
        return (bet.prediction, bet.amount, bet.claimed);
    }

    /// @notice Look up the pool ID for a specific game
    /// @return poolId The pool ID, exists Whether a pool exists for this game
    function getPoolIdForGame(uint256 tournamentId, uint8 round, uint8 gameIndex) external view returns (uint256 poolId, bool exists) {
        bytes32 key = keccak256(abi.encode(tournamentId, round, gameIndex));
        poolId = gameToPool[key];
        exists = betPools[poolId].exists;
    }

    /// @notice Get pool totals broken down by prediction
    function getPoolBreakdown(uint256 poolId) external view returns (uint256 whiteWins, uint256 blackWins, uint256 draw) {
        BetPool storage pool = betPools[poolId];
        return (pool.totalWhiteWins, pool.totalBlackWins, pool.totalDraw);
    }

    // ── Admin ──────────────────────────────────────────────────────────

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

    // ── Internal ───────────────────────────────────────────────────────

    function _getPoolTotal(BetPool storage pool, Prediction prediction) internal view returns (uint256) {
        if (prediction == Prediction.WhiteWins) return pool.totalWhiteWins;
        if (prediction == Prediction.BlackWins) return pool.totalBlackWins;
        return pool.totalDraw;
    }
}
