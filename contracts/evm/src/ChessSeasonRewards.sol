// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IERC20Minimal.sol";

/// @title ChessSeasonRewards - Treasury for $CHESS season rewards
/// @notice Holds $CHESS tokens for season reward distribution.
///         Receives tokens from ChessRevenueRouter (10% of protocol revenue)
///         and from initial protocol allocation (26M CHESS).
contract ChessSeasonRewards {
    // ── State ──────────────────────────────────────────────────────────────

    address public authority;
    address public pendingAuthority;
    IERC20Minimal public immutable chessToken;

    /// @notice Total CHESS distributed across all seasons
    uint256 public totalDistributed;

    /// @notice Per-season distribution tracking
    mapping(uint256 => uint256) public seasonDistributed;

    // ── Events ─────────────────────────────────────────────────────────────

    event RewardDeposited(address indexed from, uint256 amount);
    event RewardsDistributed(uint256 indexed seasonId, uint256 totalAmount, uint8 recipientCount);
    event RewardPaid(uint256 indexed seasonId, address indexed recipient, uint256 amount);

    // ── Modifiers ──────────────────────────────────────────────────────────

    modifier onlyAuthority() {
        require(msg.sender == authority, "Unauthorized");
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────────

    constructor(address _chessToken) {
        require(_chessToken != address(0), "Zero address");
        chessToken = IERC20Minimal(_chessToken);
        authority = msg.sender;
    }

    // ── Deposit ────────────────────────────────────────────────────────────

    /// @notice Deposit CHESS tokens (from RevenueRouter or initial allocation)
    /// @param amount Amount of CHESS to deposit
    function deposit(uint256 amount) external {
        require(amount > 0, "Zero amount");
        require(chessToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        emit RewardDeposited(msg.sender, amount);
    }

    // ── Distribution ───────────────────────────────────────────────────────

    /// @notice Distribute season rewards to top performers
    /// @param seasonId Season these rewards are for
    /// @param recipients Addresses to receive rewards
    /// @param amounts CHESS amounts per recipient
    function distributeRewards(
        uint256 seasonId,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyAuthority {
        require(recipients.length == amounts.length, "Array length mismatch");
        require(recipients.length > 0, "Empty arrays");

        uint256 total;
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "Zero recipient");
            require(amounts[i] > 0, "Zero amount");
            total += amounts[i];
        }

        require(chessToken.balanceOf(address(this)) >= total, "Insufficient balance");

        for (uint256 i = 0; i < recipients.length; i++) {
            require(chessToken.transfer(recipients[i], amounts[i]), "Transfer failed");
            emit RewardPaid(seasonId, recipients[i], amounts[i]);
        }

        totalDistributed += total;
        seasonDistributed[seasonId] += total;

        emit RewardsDistributed(seasonId, total, uint8(recipients.length));
    }

    // ── Views ──────────────────────────────────────────────────────────────

    /// @notice Get current CHESS balance available for rewards
    function balance() external view returns (uint256) {
        return chessToken.balanceOf(address(this));
    }

    // ── Authority ──────────────────────────────────────────────────────────

    function proposeAuthority(address _newAuthority) external onlyAuthority {
        require(_newAuthority != address(0), "Zero address");
        pendingAuthority = _newAuthority;
    }

    function acceptAuthority() external {
        require(msg.sender == pendingAuthority, "Not pending authority");
        authority = msg.sender;
        pendingAuthority = address(0);
    }
}
