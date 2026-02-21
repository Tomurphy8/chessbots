// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TournamentLibV4 - Library for V4 economics overhaul
/// @notice Extends V3 with progressive rake, tournament types, and ELO brackets.
///         Prize calculation delegates to PayoutCalculator for dynamic payouts.
library TournamentLibV4 {
    uint16 constant BPS_DENOMINATOR = 10000;

    // ── Enums ──────────────────────────────────────────────────────────────

    enum Tier { Rookie, Bronze, Silver, Masters, Legends, Free }
    enum Format { Swiss, Match, Team, League }
    enum TournamentType { Standard, Satellite, Bounty }
    enum Bracket { Unrated, ClassC, ClassB, ClassA, Open }
    enum TournamentStatus { Registration, InProgress, RoundActive, RoundComplete, Completed, Cancelled }
    enum GameStatus { Pending, InProgress, Completed, Aborted }
    enum GameResult { Undecided, WhiteWins, BlackWins, Draw, WhiteForfeit, BlackForfeit }
    enum AgentType { OpenClaw, SolanaAgentKit, Custom }

    // ── Constants ──────────────────────────────────────────────────────────

    uint8 constant MIN_PLAYERS = 2;
    uint8 constant MAX_PLAYERS = 64;
    uint8 constant MAX_TEAMS = 32;
    uint8 constant TEAM_SIZE_DEFAULT = 5;
    uint256 constant LEGENDS_MIN_ENTRY = 500e6;
    uint16 constant MAX_SPONSORED_FREE_DEFAULT = 10;

    // ELO bracket boundaries
    uint16 constant CLASS_C_MAX = 1200;
    uint16 constant CLASS_B_MAX = 1600;
    uint16 constant CLASS_A_MAX = 2000;
    uint16 constant BRACKET_BUFFER = 25;

    // ── Progressive Rake ───────────────────────────────────────────────────

    /// @notice Returns the rake (protocol fee) in basis points for a given tier
    /// @dev Progressive: higher stakes = lower rake percentage
    function getRakeBps(Tier tier) internal pure returns (uint16) {
        if (tier == Tier.Free)    return 0;
        if (tier == Tier.Rookie)  return 1000;  // 10%
        if (tier == Tier.Bronze)  return 800;   // 8%
        if (tier == Tier.Silver)  return 600;   // 6%
        if (tier == Tier.Masters) return 500;   // 5%
        if (tier == Tier.Legends) return 400;   // 4%
        return 1000; // fallback
    }

    // ── Entry Fees ─────────────────────────────────────────────────────────

    /// @notice Returns the entry fee in USDC (6 decimals) for a given tier
    function entryFee(Tier tier) internal pure returns (uint256) {
        if (tier == Tier.Rookie)  return 5e6;
        if (tier == Tier.Bronze)  return 50e6;
        if (tier == Tier.Silver)  return 100e6;
        if (tier == Tier.Masters) return 250e6;
        if (tier == Tier.Free)    return 0;
        return 0; // Legends: custom fee set per tournament
    }

    // ── Round Calculation ──────────────────────────────────────────────────

    /// @notice Calculate rounds based on format and player/team count
    function calculateRoundsForFormat(
        uint8 playerCount,
        Format format,
        uint8 bestOf
    ) internal pure returns (uint8) {
        if (format == Format.Match) {
            require(bestOf == 1 || bestOf == 3 || bestOf == 5, "bestOf must be 1, 3, or 5");
            return bestOf;
        }
        if (format == Format.League) {
            require(playerCount >= 2, "Need at least 2 players for league");
            return playerCount - 1;
        }
        // Swiss and Team: log2 calculation
        return calculateRounds(playerCount);
    }

    /// @notice Swiss round calculation (log2)
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

    // ── Validation ─────────────────────────────────────────────────────────

    function validateMinPlayers(uint8 minPlayers, Format format) internal pure {
        if (format == Format.Match) {
            require(minPlayers == 2, "Match requires exactly 2 players");
        } else {
            require(minPlayers >= 2, "Need at least 2 players");
        }
    }

    function validateMaxPlayers(uint8 maxPlayers, Format format) internal pure {
        if (format == Format.Match) {
            require(maxPlayers == 2, "Match requires exactly 2 players");
        } else {
            require(maxPlayers >= 2 && maxPlayers <= MAX_PLAYERS, "Invalid player count");
        }
    }

    // ── Bracket Logic ──────────────────────────────────────────────────────

    /// @notice Determine bracket from ELO rating with hysteresis buffer
    /// @param elo Current ELO rating
    /// @param currentBracket Agent's current bracket (for buffer logic)
    /// @param tournamentCount Number of rated tournaments completed
    function resolveBracket(
        uint16 elo,
        Bracket currentBracket,
        uint16 tournamentCount
    ) internal pure returns (Bracket) {
        // Unrated agents stay unrated until 10 tournaments
        if (tournamentCount < 10) return Bracket.Unrated;

        // Apply hysteresis buffer to prevent oscillation
        if (currentBracket == Bracket.ClassC) {
            // Stay ClassC unless clearly in ClassB territory
            if (elo >= CLASS_C_MAX + BRACKET_BUFFER) return Bracket.ClassB;
            return Bracket.ClassC;
        }
        if (currentBracket == Bracket.ClassB) {
            if (elo < CLASS_C_MAX - BRACKET_BUFFER) return Bracket.ClassC;
            if (elo >= CLASS_B_MAX + BRACKET_BUFFER) return Bracket.ClassA;
            return Bracket.ClassB;
        }
        if (currentBracket == Bracket.ClassA) {
            if (elo < CLASS_B_MAX - BRACKET_BUFFER) return Bracket.ClassB;
            return Bracket.ClassA;
        }

        // Fresh bracket assignment (no hysteresis needed)
        if (elo < CLASS_C_MAX) return Bracket.ClassC;
        if (elo < CLASS_B_MAX) return Bracket.ClassB;
        return Bracket.ClassA;
    }

    /// @notice Check if an agent's bracket is eligible for a tournament bracket
    /// @param agentBracket Agent's current bracket
    /// @param tournamentBracket Tournament's required bracket
    function isBracketEligible(
        Bracket agentBracket,
        Bracket tournamentBracket
    ) internal pure returns (bool) {
        // Open tournaments accept anyone
        if (tournamentBracket == Bracket.Open) return true;

        // Exact match
        if (agentBracket == tournamentBracket) return true;

        // Unrated agents can enter Unrated or ClassC
        if (agentBracket == Bracket.Unrated) {
            return tournamentBracket == Bracket.Unrated || tournamentBracket == Bracket.ClassC;
        }

        return false;
    }
}
