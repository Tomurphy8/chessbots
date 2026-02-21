// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../libraries/TournamentLibV4.sol";

/// @title IChessBotsTournamentV4 - Events interface for V4 economics overhaul
/// @notice Extends V3 events with dynamic payouts, progressive rake, brackets,
///         tournament types, heartbeat, and revenue routing.
interface IChessBotsTournamentV4 {
    // ── Core Events (V3 compatible) ────────────────────────────────────────

    event ProtocolInitialized(address indexed authority, address treasury);
    event AgentRegistered(address indexed wallet, string name, TournamentLibV4.AgentType agentType);
    event TournamentCreated(
        uint256 indexed id,
        TournamentLibV4.Tier tier,
        TournamentLibV4.Format format,
        TournamentLibV4.TournamentType tournamentType,
        TournamentLibV4.Bracket bracket,
        uint256 entryFee,
        uint8 maxPlayers
    );
    event AgentJoined(uint256 indexed tournamentId, address indexed agent, uint8 registeredCount);
    event TournamentStarted(uint256 indexed tournamentId, uint8 totalRounds);
    event TournamentCancelled(uint256 indexed tournamentId);

    // ── Game Events ────────────────────────────────────────────────────────

    event GameCreated(uint256 indexed tournamentId, uint8 round, uint8 gameIndex, address white, address black);
    event GameStarted(uint256 indexed tournamentId, uint8 round, uint8 gameIndex);
    event GameResultSubmitted(uint256 indexed tournamentId, uint8 round, uint8 gameIndex, TournamentLibV4.GameResult result);
    event StandingsUpdated(uint256 indexed tournamentId, uint8 round);
    event RoundAdvanced(uint256 indexed tournamentId, uint8 newRound);
    event RoundGamesCreated(uint256 indexed tournamentId, uint8 round, uint8 gameCount);
    event RoundResultsSubmitted(uint256 indexed tournamentId, uint8 round, uint8 resultCount);

    // ── V4: Dynamic Payout Events ──────────────────────────────────────────

    /// @notice Emitted when tournament is finalized with full ranked list
    event TournamentFinalized(uint256 indexed tournamentId, address[] rankedPlayers);

    /// @notice Emitted when prizes are distributed with dynamic payouts
    event PrizesDistributed(
        uint256 indexed tournamentId,
        uint256 totalPool,
        uint256 playerPool,
        uint256 protocolFee,
        uint8 paidSlots
    );

    /// @notice Emitted for each individual prize payment
    event PrizePaid(uint256 indexed tournamentId, address indexed agent, uint8 rank, uint256 amount);

    /// @notice Emitted when protocol revenue is routed to RevenueRouter
    event RevenueRouted(uint256 indexed tournamentId, uint256 amount, address indexed router);

    // ── Tokenomics Events ──────────────────────────────────────────────────

    event ChessTokenUpdated(address indexed token);
    event DexRouterUpdated(address indexed router);
    event StakingContractUpdated(address indexed staking);
    event RevenueRouterUpdated(address indexed router);
    event DiscountApplied(uint256 indexed tournamentId, address indexed agent, uint16 discountBps, uint256 discountAmount);

    // ── Admin Events ───────────────────────────────────────────────────────

    event PausedStateChanged(bool paused);
    event RefundClaimed(uint256 indexed tournamentId, address indexed agent, uint256 amount);
    event AuthorityTransferProposed(address indexed currentAuthority, address indexed pendingAuthority);
    event AuthorityTransferAccepted(address indexed oldAuthority, address indexed newAuthority);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event TournamentFunded(uint256 indexed tournamentId, uint256 amount);
    event FreeTournamentLimitUpdated(uint16 newLimit);
    event RakeOverrideSet(TournamentLibV4.Tier indexed tier, uint16 newRakeBps);

    // ── Referral Events ────────────────────────────────────────────────────

    event ReferralRegistered(address indexed agent, address indexed referrer);
    event ReferralBonusAccrued(uint256 indexed tournamentId, address indexed referrer, address indexed referee, uint256 amount);
    event ReferralEarningsClaimed(address indexed referrer, uint256 amount);
    event ReferralTierChanged(address indexed referrer, uint8 newTier, uint16 newRateBps);

    // ── Sponsorship Events ─────────────────────────────────────────────────

    event TournamentSponsored(uint256 indexed tournamentId, address indexed sponsor, uint256 amount, uint256 platformFee);

    // ── V3 Compat: Team Events ─────────────────────────────────────────────

    event TeamRegistered(uint256 indexed tournamentId, uint8 indexed teamId, address indexed captain, uint8 memberCount);
    event MatchChallengeCreated(uint256 indexed tournamentId, address indexed challenger, address indexed opponent);

    // ── V4: Heartbeat Events ───────────────────────────────────────────────

    event HeartbeatReceived(address indexed agent, uint256 timestamp);
    event HeartbeatWindowUpdated(uint256 newWindow);

    // ── V4: Bracket Events ─────────────────────────────────────────────────

    event BracketRegistrationRejected(uint256 indexed tournamentId, address indexed agent, TournamentLibV4.Bracket agentBracket, TournamentLibV4.Bracket required);
}
