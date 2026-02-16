// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../libraries/TournamentLib.sol";

interface IChessBotsTournament {
    event ProtocolInitialized(address indexed authority, address treasury, uint16 protocolFeeBps);
    event AgentRegistered(address indexed wallet, string name, TournamentLib.AgentType agentType);
    event TournamentCreated(uint256 indexed id, TournamentLib.Tier tier, uint256 entryFee, uint8 maxPlayers);
    event AgentJoined(uint256 indexed tournamentId, address indexed agent, uint8 registeredCount);
    event TournamentStarted(uint256 indexed tournamentId, uint8 totalRounds);
    event TournamentCancelled(uint256 indexed tournamentId);
    event GameCreated(uint256 indexed tournamentId, uint8 round, uint8 gameIndex, address white, address black);
    event GameStarted(uint256 indexed tournamentId, uint8 round, uint8 gameIndex);
    event GameResultSubmitted(uint256 indexed tournamentId, uint8 round, uint8 gameIndex, TournamentLib.GameResult result);
    event StandingsUpdated(uint256 indexed tournamentId, uint8 round);
    event RoundAdvanced(uint256 indexed tournamentId, uint8 newRound);
    event TournamentFinalized(uint256 indexed tournamentId, address first, address second, address third);
    event PrizesDistributed(uint256 indexed tournamentId, uint256 totalPool, uint256 firstPrize, uint256 secondPrize, uint256 thirdPrize, uint256 protocolFee);

    // Batch operation events
    event RoundGamesCreated(uint256 indexed tournamentId, uint8 round, uint8 gameCount);
    event RoundResultsSubmitted(uint256 indexed tournamentId, uint8 round, uint8 resultCount);

    // Tokenomics events
    event BuybackAccumulated(uint256 indexed tournamentId, uint256 amount);
    event BuybackExecuted(uint256 usdcAmount, uint256 chessBurned);
    event ChessTokenUpdated(address indexed token);
    event DexRouterUpdated(address indexed router);
    event StakingContractUpdated(address indexed staking);
    event DiscountApplied(uint256 indexed tournamentId, address indexed agent, uint16 discountBps, uint256 discountAmount);

    // Security audit events
    event PausedStateChanged(bool paused);
    event RefundClaimed(uint256 indexed tournamentId, address indexed agent, uint256 amount);
    event AuthorityTransferProposed(address indexed currentAuthority, address indexed pendingAuthority);
    event AuthorityTransferAccepted(address indexed oldAuthority, address indexed newAuthority);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event TournamentFunded(uint256 indexed tournamentId, uint256 amount);
    event FreeTournamentLimitUpdated(uint8 newLimit);

    // Referral events (V2: Tiers + Extended Cap)
    event ReferralRegistered(address indexed agent, address indexed referrer);
    event ReferralBonusAccrued(uint256 indexed tournamentId, address indexed referrer, address indexed referee, uint256 amount);
    event ReferralEarningsClaimed(address indexed referrer, uint256 amount);
    event ReferralTierChanged(address indexed referrer, uint8 newTier, uint16 newRateBps);

    // Sponsorship events (Proposal C)
    event TournamentSponsored(uint256 indexed tournamentId, address indexed sponsor, uint256 amount, uint256 platformFee);
}
