// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IERC20Minimal.sol";

/// @title ChessStakingV2 - Stake $CHESS to back agents and share winnings
/// @notice Extends staking with agent backing: stake CHESS on agents to cover
///         their entry fees and receive a share of their tournament winnings.
/// @dev Backing tiers:
///      10K+ CHESS  → 25% coverage, 75/25 win split (agent/staker)
///      50K+ CHESS  → 50% coverage, 65/35 win split
///      100K+ CHESS → 75% coverage, 60/40 win split
///      250K+ CHESS → 100% coverage, 55/45 win split
contract ChessStakingV2 {
    // ── Types ─────────────────────────────────────────────────────────────

    struct BackerPosition {
        uint256 chessStaked;       // CHESS staked on this agent
        uint256 usdcDeposited;     // USDC deposited for entry fee coverage
        uint256 totalEarned;       // Lifetime USDC earned from this agent
        uint256 lastStakeTime;     // For cooldown enforcement
    }

    struct AgentPool {
        uint256 totalChessStaked;  // Total CHESS backing this agent
        uint256 totalUsdcPool;     // Total USDC available for entry coverage
        uint256 backerCount;       // Number of active backers
        bool exists;
    }

    // ── Constants ─────────────────────────────────────────────────────────

    uint256 public constant TIER1_THRESHOLD = 10_000e18;   // 10K CHESS
    uint256 public constant TIER2_THRESHOLD = 50_000e18;   // 50K CHESS
    uint256 public constant TIER3_THRESHOLD = 100_000e18;  // 100K CHESS
    uint256 public constant TIER4_THRESHOLD = 250_000e18;  // 250K CHESS

    uint16 public constant TIER1_COVERAGE = 2500;  // 25%
    uint16 public constant TIER2_COVERAGE = 5000;  // 50%
    uint16 public constant TIER3_COVERAGE = 7500;  // 75%
    uint16 public constant TIER4_COVERAGE = 10000; // 100%

    // Agent share of winnings in basis points
    uint16 public constant TIER1_AGENT_SHARE = 7500;  // 75%
    uint16 public constant TIER2_AGENT_SHARE = 6500;  // 65%
    uint16 public constant TIER3_AGENT_SHARE = 6000;  // 60%
    uint16 public constant TIER4_AGENT_SHARE = 5500;  // 55%

    uint256 public constant UNSTAKE_COOLDOWN = 7 days;

    // ── State ─────────────────────────────────────────────────────────────

    address public authority;
    address public pendingAuthority;
    address public authorizedManager;  // V4 tournament contract

    IERC20Minimal public immutable chessToken;
    IERC20Minimal public immutable usdcToken;

    // backer => agent => position
    mapping(address => mapping(address => BackerPosition)) public positions;

    // agent => pool info
    mapping(address => AgentPool) public agentPools;

    // agent => backer list (for pro-rata distribution)
    mapping(address => address[]) internal _agentBackers;

    // ── Events ────────────────────────────────────────────────────────────

    event Backed(address indexed backer, address indexed agent, uint256 chessAmount, uint256 usdcAmount);
    event Unstaked(address indexed backer, address indexed agent, uint256 chessAmount, uint256 usdcReturned);
    event EntryCovered(address indexed agent, uint256 tournamentId, uint256 amountCovered);
    event WinningsDistributed(address indexed agent, uint256 tournamentId, uint256 agentShare, uint256 stakerTotal);
    event BackerPaid(address indexed backer, address indexed agent, uint256 amount);

    // ── Modifiers ─────────────────────────────────────────────────────────

    modifier onlyAuthority() {
        require(msg.sender == authority, "Not authority");
        _;
    }

    modifier onlyManager() {
        require(msg.sender == authorizedManager, "Not manager");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────

    constructor(address _chess, address _usdc) {
        require(_chess != address(0) && _usdc != address(0), "Zero address");
        chessToken = IERC20Minimal(_chess);
        usdcToken = IERC20Minimal(_usdc);
        authority = msg.sender;
    }

    // ── Backing ───────────────────────────────────────────────────────────

    /// @notice Back an agent by staking CHESS and optionally depositing USDC
    /// @param agent The agent to back
    /// @param chessAmount CHESS tokens to stake
    /// @param usdcAmount USDC to deposit for entry fee coverage
    function backAgent(address agent, uint256 chessAmount, uint256 usdcAmount) external {
        require(agent != address(0), "Zero agent");
        require(chessAmount > 0 || usdcAmount > 0, "Nothing to stake");

        BackerPosition storage pos = positions[msg.sender][agent];

        if (chessAmount > 0) {
            require(chessToken.transferFrom(msg.sender, address(this), chessAmount), "CHESS transfer failed");
            pos.chessStaked += chessAmount;
            agentPools[agent].totalChessStaked += chessAmount;
        }

        if (usdcAmount > 0) {
            require(usdcToken.transferFrom(msg.sender, address(this), usdcAmount), "USDC transfer failed");
            pos.usdcDeposited += usdcAmount;
            agentPools[agent].totalUsdcPool += usdcAmount;
        }

        pos.lastStakeTime = block.timestamp;

        // Track backer if new
        if (!agentPools[agent].exists) {
            agentPools[agent].exists = true;
        }
        // Add to backer list if first time backing this agent
        if (pos.chessStaked == chessAmount && pos.usdcDeposited == usdcAmount) {
            _agentBackers[agent].push(msg.sender);
            agentPools[agent].backerCount++;
        }

        emit Backed(msg.sender, agent, chessAmount, usdcAmount);
    }

    /// @notice Withdraw staked CHESS and remaining USDC from an agent
    /// @param agent The agent to unstake from
    /// @param chessAmount CHESS to withdraw
    function withdrawBacking(address agent, uint256 chessAmount) external {
        BackerPosition storage pos = positions[msg.sender][agent];
        require(chessAmount > 0, "Zero amount");
        require(pos.chessStaked >= chessAmount, "Insufficient stake");
        require(block.timestamp >= pos.lastStakeTime + UNSTAKE_COOLDOWN, "Cooldown active");

        pos.chessStaked -= chessAmount;
        agentPools[agent].totalChessStaked -= chessAmount;

        require(chessToken.transfer(msg.sender, chessAmount), "Transfer failed");

        emit Unstaked(msg.sender, agent, chessAmount, 0);
    }

    /// @notice Withdraw deposited USDC from an agent's backing pool
    /// @param agent The agent to withdraw USDC from
    /// @param usdcAmount USDC to withdraw
    function withdrawUsdc(address agent, uint256 usdcAmount) external {
        BackerPosition storage pos = positions[msg.sender][agent];
        require(usdcAmount > 0, "Zero amount");
        require(pos.usdcDeposited >= usdcAmount, "Insufficient USDC");
        require(block.timestamp >= pos.lastStakeTime + UNSTAKE_COOLDOWN, "Cooldown active");

        pos.usdcDeposited -= usdcAmount;
        agentPools[agent].totalUsdcPool -= usdcAmount;

        require(usdcToken.transfer(msg.sender, usdcAmount), "Transfer failed");

        emit Unstaked(msg.sender, agent, 0, usdcAmount);
    }

    // ── Entry Fee Coverage ────────────────────────────────────────────────

    /// @notice Cover an agent's entry fee from their backing pool
    /// @param agent The agent entering a tournament
    /// @param entryFee The full entry fee
    /// @return covered Amount covered by backers
    function coverEntryFee(address agent, uint256 entryFee) external onlyManager returns (uint256 covered) {
        AgentPool storage pool = agentPools[agent];
        if (!pool.exists || pool.totalChessStaked == 0) return 0;

        uint16 coverageBps = getCoverageBps(pool.totalChessStaked);
        covered = (entryFee * coverageBps) / 10000;

        if (covered > pool.totalUsdcPool) {
            covered = pool.totalUsdcPool;
        }

        if (covered == 0) return 0;

        // Deduct pro-rata from each backer's USDC deposit
        address[] storage backers = _agentBackers[agent];
        uint256 remaining = covered;

        for (uint256 i = 0; i < backers.length && remaining > 0; i++) {
            BackerPosition storage pos = positions[backers[i]][agent];
            if (pos.usdcDeposited == 0) continue;

            uint256 share = (covered * pos.usdcDeposited) / pool.totalUsdcPool;
            if (share > pos.usdcDeposited) share = pos.usdcDeposited;
            if (share > remaining) share = remaining;

            pos.usdcDeposited -= share;
            remaining -= share;
        }

        pool.totalUsdcPool -= covered;

        // Transfer USDC to the tournament contract (msg.sender)
        require(usdcToken.transfer(msg.sender, covered), "Coverage transfer failed");

        emit EntryCovered(agent, 0, covered);
        return covered;
    }

    // ── Winnings Distribution ─────────────────────────────────────────────

    /// @notice Distribute tournament winnings between agent and backers
    /// @param agent The winning agent
    /// @param tournamentId Tournament ID
    /// @param totalWinnings Total USDC won
    function distributeWinnings(
        address agent,
        uint256 tournamentId,
        uint256 totalWinnings
    ) external onlyManager {
        require(totalWinnings > 0, "Zero winnings");

        // Pull USDC from caller (V4 tournament contract)
        require(usdcToken.transferFrom(msg.sender, address(this), totalWinnings), "Pull winnings failed");

        AgentPool storage pool = agentPools[agent];
        if (!pool.exists || pool.totalChessStaked == 0) {
            // No backers — agent gets everything
            require(usdcToken.transfer(agent, totalWinnings), "Transfer to agent failed");
            emit WinningsDistributed(agent, tournamentId, totalWinnings, 0);
            return;
        }

        uint16 agentShareBps = getAgentShareBps(pool.totalChessStaked);
        uint256 agentAmount = (totalWinnings * agentShareBps) / 10000;
        uint256 stakerTotal = totalWinnings - agentAmount;

        // Pay agent
        require(usdcToken.transfer(agent, agentAmount), "Agent payment failed");

        // Distribute staker share pro-rata based on CHESS staked
        address[] storage backers = _agentBackers[agent];
        uint256 distributed;

        for (uint256 i = 0; i < backers.length; i++) {
            BackerPosition storage pos = positions[backers[i]][agent];
            if (pos.chessStaked == 0) continue;

            uint256 backerShare = (stakerTotal * pos.chessStaked) / pool.totalChessStaked;
            if (backerShare == 0) continue;

            pos.totalEarned += backerShare;
            // Add earnings back to backer's USDC deposit (auto-compound)
            pos.usdcDeposited += backerShare;
            pool.totalUsdcPool += backerShare;
            distributed += backerShare;

            emit BackerPaid(backers[i], agent, backerShare);
        }

        // Any rounding dust goes to agent
        if (stakerTotal > distributed) {
            require(usdcToken.transfer(agent, stakerTotal - distributed), "Dust transfer failed");
            agentAmount += stakerTotal - distributed;
        }

        emit WinningsDistributed(agent, tournamentId, agentAmount, distributed);
    }

    // ── View Functions ────────────────────────────────────────────────────

    /// @notice Get coverage tier based on total CHESS staked for an agent
    function getCoverageBps(uint256 totalChess) public pure returns (uint16) {
        if (totalChess >= TIER4_THRESHOLD) return TIER4_COVERAGE;
        if (totalChess >= TIER3_THRESHOLD) return TIER3_COVERAGE;
        if (totalChess >= TIER2_THRESHOLD) return TIER2_COVERAGE;
        if (totalChess >= TIER1_THRESHOLD) return TIER1_COVERAGE;
        return 0;
    }

    /// @notice Get agent's share of winnings based on backing level
    function getAgentShareBps(uint256 totalChess) public pure returns (uint16) {
        if (totalChess >= TIER4_THRESHOLD) return TIER4_AGENT_SHARE;
        if (totalChess >= TIER3_THRESHOLD) return TIER3_AGENT_SHARE;
        if (totalChess >= TIER2_THRESHOLD) return TIER2_AGENT_SHARE;
        if (totalChess >= TIER1_THRESHOLD) return TIER1_AGENT_SHARE;
        return 10000; // No backers = agent gets 100%
    }

    /// @notice Get a backer's position for an agent
    function getPosition(address backer, address agent) external view returns (BackerPosition memory) {
        return positions[backer][agent];
    }

    /// @notice Get an agent's backing pool info
    function getAgentPool(address agent) external view returns (AgentPool memory) {
        return agentPools[agent];
    }

    /// @notice Get all backers for an agent
    function getBackers(address agent) external view returns (address[] memory) {
        return _agentBackers[agent];
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    function setManager(address _manager) external onlyAuthority {
        require(_manager != address(0), "Zero address");
        authorizedManager = _manager;
    }

    function proposeAuthority(address _new) external onlyAuthority {
        require(_new != address(0), "Zero address");
        pendingAuthority = _new;
    }

    function acceptAuthority() external {
        require(msg.sender == pendingAuthority, "Not pending");
        authority = msg.sender;
        pendingAuthority = address(0);
    }
}
