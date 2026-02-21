// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ELOCalculator - Pure math library for ELO rating calculations
/// @notice Standard chess ELO formula with configurable K-factor
/// @dev All calculations use scaled integers (1000x) to avoid floating point
library ELOCalculator {
    /// @notice Scale factor for expected score calculations (3 decimal places)
    uint256 constant SCALE = 1000;

    /// @notice K-factor for provisional players (< 10 rated tournaments)
    uint16 constant K_PROVISIONAL = 40;

    /// @notice K-factor for established players (>= 10 rated tournaments)
    uint16 constant K_ESTABLISHED = 20;

    /// @notice Minimum ELO rating (floor)
    uint16 constant MIN_RATING = 100;

    /// @notice Maximum ELO rating (ceiling)
    uint16 constant MAX_RATING = 3000;

    /// @notice Default starting ELO for new agents
    uint16 constant DEFAULT_RATING = 1200;

    /// @notice Calculate expected score using the standard ELO formula
    /// @dev E(A) = 1 / (1 + 10^((Rb - Ra) / 400))
    ///      Returns result scaled by SCALE (1000)
    ///      Uses lookup table approximation for 10^(x/400)
    /// @param playerRating The player's current ELO rating
    /// @param opponentRating The opponent's current ELO rating
    /// @return expectedScore The expected score scaled by 1000 (e.g., 750 = 0.75)
    function calculateExpectedScore(
        uint16 playerRating,
        uint16 opponentRating
    ) internal pure returns (uint256 expectedScore) {
        // Rating difference clamped to [-400, 400] for table lookup
        int256 diff = int256(uint256(opponentRating)) - int256(uint256(playerRating));

        // Clamp to prevent extreme values
        if (diff > 400) diff = 400;
        if (diff < -400) diff = -400;

        // Lookup table for 1 / (1 + 10^(d/400)) * 1000
        // Pre-computed at 50-point intervals from -400 to +400
        // For values between intervals, use nearest value
        if (diff <= -400) return 909;
        if (diff <= -350) return 894;
        if (diff <= -300) return 849;
        if (diff <= -250) return 808;
        if (diff <= -200) return 760;
        if (diff <= -150) return 703;
        if (diff <= -100) return 640;
        if (diff <= -50)  return 571;
        if (diff <= 0)    return 500;
        if (diff <= 50)   return 429;
        if (diff <= 100)  return 360;
        if (diff <= 150)  return 297;
        if (diff <= 200)  return 240;
        if (diff <= 250)  return 192;
        if (diff <= 300)  return 151;
        if (diff <= 350)  return 106;
        return 91; // diff <= 400
    }

    /// @notice Calculate new ELO rating after a game
    /// @dev newRating = oldRating + K * (actualScore - expectedScore)
    ///      actualScore: SCALE for win, SCALE/2 for draw, 0 for loss
    /// @param oldRating Player's current rating
    /// @param kFactor K-factor to use (40 provisional, 20 established)
    /// @param actualScore Actual game result (1000 = win, 500 = draw, 0 = loss)
    /// @param expectedScore Expected score from calculateExpectedScore (scaled by 1000)
    /// @return newRating Updated rating clamped to [MIN_RATING, MAX_RATING]
    function calculateNewRating(
        uint16 oldRating,
        uint16 kFactor,
        uint256 actualScore,
        uint256 expectedScore
    ) internal pure returns (uint16 newRating) {
        int256 change;
        if (actualScore >= expectedScore) {
            change = int256((uint256(kFactor) * (actualScore - expectedScore)) / SCALE);
        } else {
            change = -int256((uint256(kFactor) * (expectedScore - actualScore)) / SCALE);
        }

        int256 result = int256(uint256(oldRating)) + change;

        // Clamp to valid range
        if (result < int256(uint256(MIN_RATING))) return MIN_RATING;
        if (result > int256(uint256(MAX_RATING))) return MAX_RATING;
        return uint16(uint256(result));
    }

    /// @notice Get the appropriate K-factor based on tournament count
    /// @param tournamentCount Number of rated tournaments completed
    /// @return kFactor 40 for provisional, 20 for established
    function getKFactor(uint16 tournamentCount) internal pure returns (uint16) {
        return tournamentCount < 10 ? K_PROVISIONAL : K_ESTABLISHED;
    }
}
