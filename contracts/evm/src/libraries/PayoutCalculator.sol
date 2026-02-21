// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PayoutCalculator
/// @notice Pure library for calculating dynamic payout structures based on tournament field size.
/// @dev All percentages are expressed in basis points (10000 = 100%). Payout tables are
///      selected by the nearest-smaller bracket to the actual field size.
library PayoutCalculator {
    uint16 constant BPS_DENOMINATOR = 10000;

    // ──────────────────────────────────────────────
    //  Payout tables (basis points, sum = 10000)
    // ──────────────────────────────────────────────

    // 8-player bracket — 3 paid positions
    uint16 constant P8_1 = 5500;
    uint16 constant P8_2 = 3000;
    uint16 constant P8_3 = 1500;

    // 16-player bracket — 5 paid positions
    uint16 constant P16_1 = 4500;
    uint16 constant P16_2 = 2500;
    uint16 constant P16_3 = 1500;
    uint16 constant P16_4 = 1000;
    uint16 constant P16_5 = 500;

    // 32-player bracket — 8 paid positions
    uint16 constant P32_1 = 3800;
    uint16 constant P32_2 = 2200;
    uint16 constant P32_3 = 1400;
    uint16 constant P32_4 = 900;
    uint16 constant P32_5 = 700;
    uint16 constant P32_6 = 500;
    uint16 constant P32_7 = 300;
    uint16 constant P32_8 = 200;

    // 64-player bracket — 12 paid positions
    uint16 constant P64_1  = 3000;
    uint16 constant P64_2  = 1800;
    uint16 constant P64_3  = 1200;
    uint16 constant P64_4  = 900;
    uint16 constant P64_5  = 700;
    uint16 constant P64_6  = 500;
    uint16 constant P64_7  = 400;
    uint16 constant P64_8  = 350;
    uint16 constant P64_9  = 300;
    uint16 constant P64_10 = 300;
    uint16 constant P64_11 = 300;
    uint16 constant P64_12 = 250;

    // ──────────────────────────────────────────────
    //  Public-facing helpers
    // ──────────────────────────────────────────────

    /// @notice Returns the payout percentage array for the bracket that fits `fieldSize`.
    /// @dev Bracket selection rules:
    ///      - fieldSize <= 2  : winner-take-all  [10000]
    ///      - fieldSize <= 8  : 8-player table   (3 paid)
    ///      - fieldSize <= 16 : 16-player table  (5 paid)
    ///      - fieldSize <= 32 : 32-player table  (8 paid)
    ///      - fieldSize >= 33 : 64-player table  (12 paid)
    /// @param fieldSize The number of players registered in the tournament.
    /// @return percentages An array of payout percentages in basis points, one per paid slot.
    function getPayoutStructure(uint256 fieldSize) internal pure returns (uint16[] memory percentages) {
        if (fieldSize <= 2) {
            percentages = new uint16[](1);
            percentages[0] = BPS_DENOMINATOR; // 10000 bps — winner takes all
            return percentages;
        }

        if (fieldSize <= 8) {
            percentages = new uint16[](3);
            percentages[0] = P8_1;
            percentages[1] = P8_2;
            percentages[2] = P8_3;
            return percentages;
        }

        if (fieldSize <= 16) {
            percentages = new uint16[](5);
            percentages[0] = P16_1;
            percentages[1] = P16_2;
            percentages[2] = P16_3;
            percentages[3] = P16_4;
            percentages[4] = P16_5;
            return percentages;
        }

        if (fieldSize <= 32) {
            percentages = new uint16[](8);
            percentages[0] = P32_1;
            percentages[1] = P32_2;
            percentages[2] = P32_3;
            percentages[3] = P32_4;
            percentages[4] = P32_5;
            percentages[5] = P32_6;
            percentages[6] = P32_7;
            percentages[7] = P32_8;
            return percentages;
        }

        // 33+ players — use the 64-player table
        percentages = new uint16[](12);
        percentages[0]  = P64_1;
        percentages[1]  = P64_2;
        percentages[2]  = P64_3;
        percentages[3]  = P64_4;
        percentages[4]  = P64_5;
        percentages[5]  = P64_6;
        percentages[6]  = P64_7;
        percentages[7]  = P64_8;
        percentages[8]  = P64_9;
        percentages[9]  = P64_10;
        percentages[10] = P64_11;
        percentages[11] = P64_12;
    }

    /// @notice Returns the number of paid positions for a given field size.
    /// @param fieldSize The number of players registered in the tournament.
    /// @return The count of positions that receive a payout.
    function getPaidSlots(uint256 fieldSize) internal pure returns (uint8) {
        if (fieldSize <= 2) return 1;
        if (fieldSize <= 8) return 3;
        if (fieldSize <= 16) return 5;
        if (fieldSize <= 32) return 8;
        return 12;
    }

    /// @notice Calculates concrete USDC payout amounts for each paid position.
    /// @dev The last paid position absorbs any rounding dust so that the sum of
    ///      all payouts equals `playerPool` exactly.
    /// @param playerPool Total prize pool in USDC (after protocol fees).
    /// @param fieldSize  The number of players registered in the tournament.
    /// @return amounts An array of USDC amounts, one per paid slot (highest first).
    function calculatePayouts(
        uint256 playerPool,
        uint256 fieldSize
    ) internal pure returns (uint256[] memory amounts) {
        uint16[] memory pct = getPayoutStructure(fieldSize);
        uint256 slots = pct.length;
        amounts = new uint256[](slots);

        uint256 distributed;
        for (uint256 i; i < slots - 1; ) {
            amounts[i] = (playerPool * pct[i]) / BPS_DENOMINATOR;
            distributed += amounts[i];
            unchecked { ++i; }
        }

        // Last slot absorbs rounding dust
        amounts[slots - 1] = playerPool - distributed;
    }
}
