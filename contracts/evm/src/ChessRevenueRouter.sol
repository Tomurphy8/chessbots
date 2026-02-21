// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IERC20Minimal.sol";

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

/// @title ChessRevenueRouter - Protocol revenue splitter with buyback-and-burn
/// @notice Receives USDC protocol revenue and routes it:
///         80% → buy $CHESS via DEX → burn (0xdead)
///         10% → buy $CHESS via DEX → ChessSeasonRewards
///         10% → USDC direct to treasury multisig
/// @dev Permissionless execution of buyback once revenue accumulates.
///      Two-step authority transfer for safety.
contract ChessRevenueRouter {
    // ============================================================
    //                        CONSTANTS
    // ============================================================

    /// @notice Dead address used as burn destination for $CHESS
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /// @notice 80% of revenue buys CHESS to burn
    uint16 public constant BURN_BPS = 8000;

    /// @notice 10% of revenue buys CHESS for season rewards
    uint16 public constant SEASON_BPS = 1000;

    /// @notice 10% of revenue sent as USDC to treasury
    uint16 public constant TREASURY_BPS = 1000;

    /// @notice Basis point denominator
    uint16 public constant BPS_DENOMINATOR = 10000;

    /// @notice Minimum USDC (10 USDC with 6 decimals) required to trigger buyback
    uint256 public constant MIN_BUYBACK_AMOUNT = 10e6;

    // ============================================================
    //                      STATE VARIABLES
    // ============================================================

    /// @notice Admin address for configuration functions
    address public authority;

    /// @notice Pending authority for two-step transfer
    address public pendingAuthority;

    /// @notice Treasury multisig that receives USDC
    address public treasury;

    /// @notice ChessSeasonRewards contract that receives bought $CHESS
    address public seasonRewards;

    /// @notice USDC token (immutable after deployment)
    IERC20Minimal public immutable usdc;

    /// @notice $CHESS protocol token
    IERC20Minimal public chessToken;

    /// @notice DEX router for USDC → CHESS swaps
    ISwapRouter public dexRouter;

    /// @notice Accumulated USDC waiting to be routed
    uint256 public pendingRevenue;

    // ============================================================
    //                     REENTRANCY GUARD
    // ============================================================

    uint256 private _reentrancyStatus;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    modifier nonReentrant() {
        require(_reentrancyStatus != _ENTERED, "ReentrancyGuard: reentrant call");
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    // ============================================================
    //                        MODIFIERS
    // ============================================================

    modifier onlyAuthority() {
        require(msg.sender == authority, "Unauthorized");
        _;
    }

    // ============================================================
    //                         EVENTS
    // ============================================================

    /// @notice Emitted when USDC revenue is received from tournament contracts
    event RevenueReceived(address indexed from, uint256 amount);

    /// @notice Emitted when accumulated revenue is routed (treasury + burn + season rewards)
    event RevenueRouted(uint256 usdcToTreasury, uint256 chessBurned, uint256 chessToSeasonRewards);

    /// @notice Emitted when the season rewards address is updated
    event SeasonRewardsUpdated(address indexed newAddress);

    /// @notice Emitted when the treasury address is updated
    event TreasuryUpdated(address indexed newAddress);

    /// @notice Emitted when the CHESS token address is configured
    event ChessTokenUpdated(address indexed token);

    /// @notice Emitted when the DEX router address is configured
    event DexRouterUpdated(address indexed router);

    // ============================================================
    //                       CONSTRUCTOR
    // ============================================================

    /// @notice Deploy the revenue router
    /// @param _usdc USDC token address
    /// @param _treasury Treasury multisig address
    /// @param _authority Admin address for configuration
    constructor(address _usdc, address _treasury, address _authority) {
        require(_usdc != address(0), "Zero USDC address");
        require(_treasury != address(0), "Zero treasury address");
        require(_authority != address(0), "Zero authority address");

        usdc = IERC20Minimal(_usdc);
        treasury = _treasury;
        authority = _authority;
        _reentrancyStatus = _NOT_ENTERED;
    }

    // ============================================================
    //                     REVENUE INTAKE
    // ============================================================

    /// @notice Called by the V4 tournament contract during prize distribution
    ///         to route protocol revenue through this contract.
    /// @param usdcAmount Amount of USDC to transfer from caller
    function routeRevenue(uint256 usdcAmount) external nonReentrant {
        require(usdcAmount > 0, "Zero amount");
        require(usdc.transferFrom(msg.sender, address(this), usdcAmount), "USDC transfer failed");

        pendingRevenue += usdcAmount;

        emit RevenueReceived(msg.sender, usdcAmount);
    }

    // ============================================================
    //                  BUYBACK & ROUTE EXECUTION
    // ============================================================

    /// @notice Permissionless trigger to execute the revenue split.
    ///         Sends 10% USDC to treasury. Swaps remaining 90% for CHESS.
    ///         Of the CHESS received: 8/9 to burn address, 1/9 to seasonRewards.
    ///         If chessToken/dexRouter not configured, sends all USDC to treasury.
    ///         If seasonRewards not set, sends all CHESS to burn.
    /// @param minChessOut Minimum CHESS tokens expected from DEX swap (slippage protection)
    function executeBuybackAndRoute(uint256 minChessOut) external nonReentrant {
        require(pendingRevenue >= MIN_BUYBACK_AMOUNT, "Min 10 USDC required");

        uint256 totalAmount = pendingRevenue;
        pendingRevenue = 0;

        // --- Edge case: DEX not configured, send everything to treasury ---
        bool buybackConfigured = address(chessToken) != address(0) && address(dexRouter) != address(0);
        if (!buybackConfigured) {
            require(usdc.transfer(treasury, totalAmount), "Treasury transfer failed");
            emit RevenueRouted(totalAmount, 0, 0);
            return;
        }

        // --- Normal flow: split and swap ---

        // 10% USDC to treasury
        uint256 treasuryAmount = (totalAmount * TREASURY_BPS) / BPS_DENOMINATOR;

        // Remaining 90% swapped to CHESS
        uint256 swapAmount = totalAmount - treasuryAmount;

        // Send USDC to treasury
        if (treasuryAmount > 0) {
            require(usdc.transfer(treasury, treasuryAmount), "Treasury transfer failed");
        }

        // Approve DEX router for the swap amount
        usdc.approve(address(dexRouter), 0);
        require(usdc.approve(address(dexRouter), swapAmount), "Approve failed");

        // Swap USDC → CHESS via DEX, receive tokens to this contract
        uint256 chessReceived = dexRouter.exactInputSingle(ISwapRouter.ExactInputSingleParams({
            tokenIn: address(usdc),
            tokenOut: address(chessToken),
            fee: 3000,
            recipient: address(this),
            amountIn: swapAmount,
            amountOutMinimum: minChessOut,
            sqrtPriceLimitX96: 0
        }));

        // Split CHESS: 8/9 burn, 1/9 season rewards
        uint256 chessToBurn;
        uint256 chessToSeason;

        if (seasonRewards == address(0)) {
            // Edge case: seasonRewards not set, burn all CHESS
            chessToBurn = chessReceived;
            chessToSeason = 0;
        } else {
            chessToSeason = chessReceived / 9;          // 1/9 ≈ 10% of 90% = 10% total
            chessToBurn = chessReceived - chessToSeason; // 8/9 ≈ 80% of 90% = 80% total
        }

        // Send CHESS to burn address
        if (chessToBurn > 0) {
            require(chessToken.transfer(BURN_ADDRESS, chessToBurn), "Burn transfer failed");
        }

        // Send CHESS to season rewards
        if (chessToSeason > 0) {
            require(chessToken.transfer(seasonRewards, chessToSeason), "Season rewards transfer failed");
        }

        emit RevenueRouted(treasuryAmount, chessToBurn, chessToSeason);
    }

    // ============================================================
    //                    ADMIN CONFIGURATION
    // ============================================================

    /// @notice Set the ChessSeasonRewards contract address
    /// @param _seasonRewards New season rewards contract address
    function setSeasonRewards(address _seasonRewards) external onlyAuthority {
        require(_seasonRewards != address(0), "Zero address");
        seasonRewards = _seasonRewards;
        emit SeasonRewardsUpdated(_seasonRewards);
    }

    /// @notice Update the treasury multisig address
    /// @param _treasury New treasury address
    function setTreasury(address _treasury) external onlyAuthority {
        require(_treasury != address(0), "Zero address");
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    /// @notice Set the $CHESS token address
    /// @param _token CHESS token contract address
    function setChessToken(address _token) external onlyAuthority {
        require(_token != address(0), "Zero address");
        chessToken = IERC20Minimal(_token);
        emit ChessTokenUpdated(_token);
    }

    /// @notice Set the DEX router address for USDC → CHESS swaps
    /// @param _router DEX router contract address
    function setDexRouter(address _router) external onlyAuthority {
        require(_router != address(0), "Zero address");
        // Revoke approval from old router if one was set
        if (address(dexRouter) != address(0)) {
            usdc.approve(address(dexRouter), 0);
        }
        dexRouter = ISwapRouter(_router);
        emit DexRouterUpdated(_router);
    }

    // ============================================================
    //                   AUTHORITY TRANSFER
    // ============================================================

    /// @notice Propose a new authority (two-step transfer)
    /// @param _newAuthority Address of the proposed new authority
    function proposeAuthority(address _newAuthority) external onlyAuthority {
        require(_newAuthority != address(0), "Zero address");
        pendingAuthority = _newAuthority;
    }

    /// @notice Accept authority transfer (must be called by the pending authority)
    function acceptAuthority() external {
        require(msg.sender == pendingAuthority, "Not pending authority");
        authority = msg.sender;
        pendingAuthority = address(0);
    }
}
