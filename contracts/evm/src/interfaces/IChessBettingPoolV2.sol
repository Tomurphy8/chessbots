// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IChessBettingPoolV2 - Events interface for permissionless prediction markets
interface IChessBettingPoolV2 {
    enum MarketType { GameOutcome, TournamentWinner, TournamentTop3, HeadToHead, OverUnder }
    enum MarketStatus { Open, Resolved, Voided }

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
}
