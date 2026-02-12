// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library TournamentLib {
    uint16 constant BPS_DENOMINATOR = 10000;
    uint16 constant FIRST_PLACE_BPS = 7000;
    uint16 constant SECOND_PLACE_BPS = 2000;
    // Third place gets remainder

    uint8 constant MIN_PLAYERS = 4;
    uint8 constant MAX_PLAYERS = 64;

    enum Tier { Rookie, Bronze, Silver, Masters, Legends, Free }
    enum TournamentStatus { Registration, InProgress, RoundActive, RoundComplete, Completed, Cancelled }
    enum GameStatus { Pending, InProgress, Completed, Aborted }
    enum GameResult { Undecided, WhiteWins, BlackWins, Draw, WhiteForfeit, BlackForfeit }
    enum AgentType { OpenClaw, SolanaAgentKit, Custom }

    uint256 constant LEGENDS_MIN_ENTRY = 500e6;  // 500 USDC minimum for Legends tier
    uint8 constant MAX_SPONSORED_FREE_DEFAULT = 10; // Default limit for sponsored free tournaments

    function entryFee(Tier tier) internal pure returns (uint256) {
        if (tier == Tier.Rookie) return 5e6;      // 5 USDC (6 decimals)
        if (tier == Tier.Bronze) return 50e6;    // 50 USDC
        if (tier == Tier.Silver) return 100e6;   // 100 USDC
        if (tier == Tier.Masters) return 250e6;  // 250 USDC
        if (tier == Tier.Free) return 0;         // Free: $0 entry, sponsored prize pool
        return 0;                                 // Legends: custom (set at creation)
    }

    function calculateRounds(uint8 playerCount) internal pure returns (uint8) {
        if (playerCount <= 1) return 0;
        uint8 rounds = 0;
        uint256 n = playerCount - 1;
        while (n > 0) {
            n >>= 1;
            rounds++;
        }
        return rounds;
    }

    function calculatePrizes(
        uint256 totalPool,
        uint16 protocolFeeBps
    ) internal pure returns (
        uint256 firstPrize,
        uint256 secondPrize,
        uint256 thirdPrize,
        uint256 protocolFee
    ) {
        protocolFee = (totalPool * protocolFeeBps) / BPS_DENOMINATOR;
        uint256 playerPool = totalPool - protocolFee;
        firstPrize = (playerPool * FIRST_PLACE_BPS) / BPS_DENOMINATOR;
        secondPrize = (playerPool * SECOND_PLACE_BPS) / BPS_DENOMINATOR;
        thirdPrize = playerPool - firstPrize - secondPrize;
    }
}
