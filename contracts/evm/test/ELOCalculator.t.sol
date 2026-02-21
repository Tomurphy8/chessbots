// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/libraries/ELOCalculator.sol";

contract ELOCalculatorTest is Test {
    // ================================================================
    //                  EXPECTED SCORE TESTS
    // ================================================================

    function test_equalRatings_returns500() public pure {
        uint256 expected = ELOCalculator.calculateExpectedScore(1200, 1200);
        assertEq(expected, 500); // 0.500
    }

    function test_higherRating_expectsHigherScore() public pure {
        uint256 expected = ELOCalculator.calculateExpectedScore(1400, 1200);
        assertTrue(expected > 500);
        // +200 diff → ~0.760
        assertEq(expected, 760);
    }

    function test_lowerRating_expectsLowerScore() public pure {
        uint256 expected = ELOCalculator.calculateExpectedScore(1200, 1400);
        assertTrue(expected < 500);
        // -200 diff → ~0.240
        assertEq(expected, 240);
    }

    function test_extremeAdvantage() public pure {
        uint256 expected = ELOCalculator.calculateExpectedScore(2000, 1200);
        // Clamped to +400 → 909
        assertEq(expected, 909);
    }

    function test_extremeDisadvantage() public pure {
        uint256 expected = ELOCalculator.calculateExpectedScore(800, 1600);
        // Clamped to -400 → 91
        assertEq(expected, 91);
    }

    function test_symmetricExpectedScores() public pure {
        uint256 expectA = ELOCalculator.calculateExpectedScore(1200, 1400);
        uint256 expectB = ELOCalculator.calculateExpectedScore(1400, 1200);
        // Should sum to approximately 1000 (rounding may cause ±1)
        uint256 sum = expectA + expectB;
        assertTrue(sum >= 998 && sum <= 1002, "Expected scores should sum to ~1000");
    }

    // ================================================================
    //                  NEW RATING TESTS
    // ================================================================

    function test_winAgainstEqual_ratingIncreases() public pure {
        // 1200 vs 1200, K=40, win
        uint256 expected = ELOCalculator.calculateExpectedScore(1200, 1200);
        uint16 newRating = ELOCalculator.calculateNewRating(1200, 40, 1000, expected);
        // K * (1.0 - 0.5) = 40 * 0.5 = 20
        assertEq(newRating, 1220);
    }

    function test_lossAgainstEqual_ratingDecreases() public pure {
        uint256 expected = ELOCalculator.calculateExpectedScore(1200, 1200);
        uint16 newRating = ELOCalculator.calculateNewRating(1200, 40, 0, expected);
        // K * (0.0 - 0.5) = 40 * -0.5 = -20
        assertEq(newRating, 1180);
    }

    function test_drawAgainstEqual_noChange() public pure {
        uint256 expected = ELOCalculator.calculateExpectedScore(1200, 1200);
        uint16 newRating = ELOCalculator.calculateNewRating(1200, 40, 500, expected);
        // K * (0.5 - 0.5) = 0
        assertEq(newRating, 1200);
    }

    function test_upsetWin_largeGain() public pure {
        // 1000 beats 1400 (unexpected)
        uint256 expected = ELOCalculator.calculateExpectedScore(1000, 1400);
        uint16 newRating = ELOCalculator.calculateNewRating(1000, 40, 1000, expected);
        // Expected ~0.091, actual 1.0, gain = 40 * (1.0 - 0.091) ≈ 36
        assertTrue(newRating > 1030, "Upset win should give large gain");
    }

    function test_expectedWin_smallGain() public pure {
        // 1400 beats 1000 (expected)
        uint256 expected = ELOCalculator.calculateExpectedScore(1400, 1000);
        uint16 newRating = ELOCalculator.calculateNewRating(1400, 20, 1000, expected);
        // Expected ~0.909, actual 1.0, gain = 20 * (1.0 - 0.909) ≈ 2
        assertTrue(newRating <= 1404, "Expected win should give small gain");
        assertTrue(newRating >= 1400, "Should not decrease after win");
    }

    function test_ratingFloor() public pure {
        // Very low rating loses
        uint256 expected = ELOCalculator.calculateExpectedScore(100, 500);
        uint16 newRating = ELOCalculator.calculateNewRating(100, 40, 0, expected);
        assertEq(newRating, 100, "Should not go below MIN_RATING");
    }

    function test_ratingCeiling() public pure {
        // Very high rating wins
        uint256 expected = ELOCalculator.calculateExpectedScore(3000, 2500);
        uint16 newRating = ELOCalculator.calculateNewRating(3000, 40, 1000, expected);
        assertEq(newRating, 3000, "Should not exceed MAX_RATING");
    }

    // ================================================================
    //                  K-FACTOR TESTS
    // ================================================================

    function test_kFactor_provisional() public pure {
        assertEq(ELOCalculator.getKFactor(0), 40);
        assertEq(ELOCalculator.getKFactor(5), 40);
        assertEq(ELOCalculator.getKFactor(9), 40);
    }

    function test_kFactor_established() public pure {
        assertEq(ELOCalculator.getKFactor(10), 20);
        assertEq(ELOCalculator.getKFactor(100), 20);
    }

    // ================================================================
    //                  CONSTANTS TESTS
    // ================================================================

    function test_constants() public pure {
        assertEq(ELOCalculator.SCALE, 1000);
        assertEq(ELOCalculator.K_PROVISIONAL, 40);
        assertEq(ELOCalculator.K_ESTABLISHED, 20);
        assertEq(ELOCalculator.MIN_RATING, 100);
        assertEq(ELOCalculator.MAX_RATING, 3000);
        assertEq(ELOCalculator.DEFAULT_RATING, 1200);
    }
}
