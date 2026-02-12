// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IChessStaking.sol";

interface IERC20Staking {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title ChessStaking - Stake $CHESS for tournament fee discounts
/// @notice Users lock CHESS tokens to receive entry fee discounts across 8 tiers.
/// @dev Discount tiers (7-day lockup):
///      10,000+ CHESS → 2%    |  250,000+ CHESS → 12%
///      50,000+ CHESS → 5%    |  500,000+ CHESS → 15%
///      100,000+ CHESS → 8%   |  1,000,000+ CHESS → 18%
///                             |  2,500,000+ CHESS → 21%
///                             |  5,000,000+ CHESS → 25%
contract ChessStaking is IChessStaking {
    IERC20Staking public immutable chessToken;

    // Discount tier thresholds (18 decimals)
    uint256 public constant TIER1_THRESHOLD = 10_000e18;      // 10K CHESS
    uint256 public constant TIER2_THRESHOLD = 50_000e18;      // 50K CHESS
    uint256 public constant TIER3_THRESHOLD = 100_000e18;     // 100K CHESS
    uint256 public constant TIER4_THRESHOLD = 250_000e18;     // 250K CHESS
    uint256 public constant TIER5_THRESHOLD = 500_000e18;     // 500K CHESS
    uint256 public constant TIER6_THRESHOLD = 1_000_000e18;   // 1M CHESS
    uint256 public constant TIER7_THRESHOLD = 2_500_000e18;   // 2.5M CHESS
    uint256 public constant TIER8_THRESHOLD = 5_000_000e18;   // 5M CHESS

    // Discount amounts in basis points
    uint16 public constant TIER1_DISCOUNT = 200;   // 2%
    uint16 public constant TIER2_DISCOUNT = 500;   // 5%
    uint16 public constant TIER3_DISCOUNT = 800;   // 8%
    uint16 public constant TIER4_DISCOUNT = 1200;  // 12%
    uint16 public constant TIER5_DISCOUNT = 1500;  // 15%
    uint16 public constant TIER6_DISCOUNT = 1800;  // 18%
    uint16 public constant TIER7_DISCOUNT = 2100;  // 21%
    uint16 public constant TIER8_DISCOUNT = 2500;  // 25%

    mapping(address => uint256) private _stakedBalances;
    mapping(address => uint256) private _lastStakeTimestamp; // M-7: lockup tracking
    uint256 public totalStaked;
    uint256 public constant LOCKUP_PERIOD = 7 days; // M-7: minimum lockup

    event Staked(address indexed user, uint256 amount, uint256 totalStaked);
    event Unstaked(address indexed user, uint256 amount, uint256 totalStaked);

    constructor(address _chessToken) {
        chessToken = IERC20Staking(_chessToken);
    }

    /// @notice Stake CHESS tokens to earn fee discounts
    function stake(uint256 amount) external {
        require(amount > 0, "Cannot stake zero");
        require(chessToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        _stakedBalances[msg.sender] += amount;
        _lastStakeTimestamp[msg.sender] = block.timestamp; // M-7: record stake time
        totalStaked += amount;

        emit Staked(msg.sender, amount, _stakedBalances[msg.sender]);
    }

    /// @notice Unstake CHESS tokens
    function unstake(uint256 amount) external {
        require(amount > 0, "Cannot unstake zero");
        require(_stakedBalances[msg.sender] >= amount, "Insufficient staked balance");
        require(block.timestamp >= _lastStakeTimestamp[msg.sender] + LOCKUP_PERIOD, "Lockup period active"); // M-7

        _stakedBalances[msg.sender] -= amount;
        totalStaked -= amount;

        require(chessToken.transfer(msg.sender, amount), "Transfer failed");

        emit Unstaked(msg.sender, amount, _stakedBalances[msg.sender]);
    }

    /// @notice Get the fee discount for a user based on their staked amount
    /// @return discountBps Discount in basis points (0 to 2500)
    function getDiscount(address user) external view override returns (uint16 discountBps) {
        uint256 staked = _stakedBalances[user];
        if (staked >= TIER8_THRESHOLD) return TIER8_DISCOUNT;
        if (staked >= TIER7_THRESHOLD) return TIER7_DISCOUNT;
        if (staked >= TIER6_THRESHOLD) return TIER6_DISCOUNT;
        if (staked >= TIER5_THRESHOLD) return TIER5_DISCOUNT;
        if (staked >= TIER4_THRESHOLD) return TIER4_DISCOUNT;
        if (staked >= TIER3_THRESHOLD) return TIER3_DISCOUNT;
        if (staked >= TIER2_THRESHOLD) return TIER2_DISCOUNT;
        if (staked >= TIER1_THRESHOLD) return TIER1_DISCOUNT;
        return 0;
    }

    /// @notice Get a user's staked balance
    function stakedBalance(address user) external view override returns (uint256) {
        return _stakedBalances[user];
    }
}
