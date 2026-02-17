// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TournamentLibV3 - Library for V3 multi-format tournaments
/// @notice Extends V2 with Format enum and format-aware prize/round calculations
library TournamentLibV3 {
    uint16 constant BPS_DENOMINATOR = 10000;

    // Swiss prize split (same as V2)
    uint16 constant SWISS_FIRST_BPS = 7000;
    uint16 constant SWISS_SECOND_BPS = 2000;
    // Third gets remainder (~10%)

    // League prize split (rewards deeper standings)
    uint16 constant LEAGUE_FIRST_BPS = 5000;
    uint16 constant LEAGUE_SECOND_BPS = 3000;
    // Third gets remainder (~20%)

    // Match: winner takes all (no split constants needed)

    // Team: same as Swiss (captain receives, team splits off-chain)
    uint16 constant TEAM_FIRST_BPS = 7000;
    uint16 constant TEAM_SECOND_BPS = 2000;

    uint8 constant MIN_PLAYERS = 2;   // Lowered from 4 for 1v1 matches
    uint8 constant MAX_PLAYERS = 64;
    uint8 constant MAX_TEAMS = 32;    // Max teams per team tournament
    uint8 constant TEAM_SIZE_DEFAULT = 5;

    enum Tier { Rookie, Bronze, Silver, Masters, Legends, Free }
    enum Format { Swiss, Match, Team, League }
    enum TournamentStatus { Registration, InProgress, RoundActive, RoundComplete, Completed, Cancelled }
    enum GameStatus { Pending, InProgress, Completed, Aborted }
    enum GameResult { Undecided, WhiteWins, BlackWins, Draw, WhiteForfeit, BlackForfeit }
    enum AgentType { OpenClaw, SolanaAgentKit, Custom }

    uint256 constant LEGENDS_MIN_ENTRY = 500e6;
    uint8 constant MAX_SPONSORED_FREE_DEFAULT = 10;

    function entryFee(Tier tier) internal pure returns (uint256) {
        if (tier == Tier.Rookie) return 5e6;
        if (tier == Tier.Bronze) return 50e6;
        if (tier == Tier.Silver) return 100e6;
        if (tier == Tier.Masters) return 250e6;
        if (tier == Tier.Free) return 0;
        return 0; // Legends: custom
    }

    /// @notice Calculate rounds based on format and player/team count
    /// @param playerCount Number of players (or teams for Team format)
    /// @param format Tournament format
    /// @param bestOf For Match format: number of games in the series (1, 3, or 5)
    function calculateRoundsForFormat(
        uint8 playerCount,
        Format format,
        uint8 bestOf
    ) internal pure returns (uint8) {
        if (format == Format.Match) {
            // 1v1: bestOf games (1, 3, or 5)
            require(bestOf == 1 || bestOf == 3 || bestOf == 5, "bestOf must be 1, 3, or 5");
            return bestOf;
        }
        if (format == Format.League) {
            // Round-robin: every player plays every other player once
            require(playerCount >= 2, "Need at least 2 players for league");
            return playerCount - 1;
        }
        // Swiss and Team: log2 calculation (same as V2)
        return calculateRounds(playerCount);
    }

    /// @notice Swiss round calculation (V2 compatible)
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

    /// @notice Calculate prizes based on format
    function calculatePrizesForFormat(
        uint256 totalPool,
        uint16 protocolFeeBps,
        Format format
    ) internal pure returns (
        uint256 firstPrize,
        uint256 secondPrize,
        uint256 thirdPrize,
        uint256 protocolFee
    ) {
        protocolFee = (totalPool * protocolFeeBps) / BPS_DENOMINATOR;
        uint256 playerPool = totalPool - protocolFee;

        if (format == Format.Match) {
            // Winner takes all
            firstPrize = playerPool;
            secondPrize = 0;
            thirdPrize = 0;
        } else if (format == Format.League) {
            // 50/30/20 split
            firstPrize = (playerPool * LEAGUE_FIRST_BPS) / BPS_DENOMINATOR;
            secondPrize = (playerPool * LEAGUE_SECOND_BPS) / BPS_DENOMINATOR;
            thirdPrize = playerPool - firstPrize - secondPrize;
        } else {
            // Swiss and Team: 70/20/10 (V2 compatible)
            firstPrize = (playerPool * SWISS_FIRST_BPS) / BPS_DENOMINATOR;
            secondPrize = (playerPool * SWISS_SECOND_BPS) / BPS_DENOMINATOR;
            thirdPrize = playerPool - firstPrize - secondPrize;
        }
    }

    /// @notice Validate min players based on format
    function validateMinPlayers(uint8 minPlayers, Format format) internal pure {
        if (format == Format.Match) {
            require(minPlayers == 2, "Match requires exactly 2 players");
        } else {
            require(minPlayers >= 2, "Need at least 2 players");
        }
    }

    /// @notice Validate max players based on format
    function validateMaxPlayers(uint8 maxPlayers, Format format) internal pure {
        if (format == Format.Match) {
            require(maxPlayers == 2, "Match requires exactly 2 players");
        } else {
            require(maxPlayers >= 2 && maxPlayers <= MAX_PLAYERS, "Invalid player count");
        }
    }
}
