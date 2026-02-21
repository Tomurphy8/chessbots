// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/libraries/PayoutCalculator.sol";

contract PayoutCalculatorTest is Test {
    // ================================================================
    //                    PAYOUT STRUCTURE TESTS
    // ================================================================

    function test_winnerTakeAll_fieldSize1() public pure {
        uint16[] memory pct = PayoutCalculator.getPayoutStructure(1);
        assertEq(pct.length, 1);
        assertEq(pct[0], 10000);
    }

    function test_winnerTakeAll_fieldSize2() public pure {
        uint16[] memory pct = PayoutCalculator.getPayoutStructure(2);
        assertEq(pct.length, 1);
        assertEq(pct[0], 10000);
    }

    function test_8playerTable_fieldSize3() public pure {
        uint16[] memory pct = PayoutCalculator.getPayoutStructure(3);
        assertEq(pct.length, 3);
        assertEq(pct[0], 5500);
        assertEq(pct[1], 3000);
        assertEq(pct[2], 1500);
    }

    function test_8playerTable_fieldSize8() public pure {
        uint16[] memory pct = PayoutCalculator.getPayoutStructure(8);
        assertEq(pct.length, 3);
        _assertSumIs10000(pct);
    }

    function test_16playerTable_fieldSize9() public pure {
        uint16[] memory pct = PayoutCalculator.getPayoutStructure(9);
        assertEq(pct.length, 5);
        assertEq(pct[0], 4500);
        assertEq(pct[1], 2500);
        assertEq(pct[2], 1500);
        assertEq(pct[3], 1000);
        assertEq(pct[4], 500);
    }

    function test_16playerTable_fieldSize16() public pure {
        uint16[] memory pct = PayoutCalculator.getPayoutStructure(16);
        assertEq(pct.length, 5);
        _assertSumIs10000(pct);
    }

    function test_32playerTable_fieldSize17() public pure {
        uint16[] memory pct = PayoutCalculator.getPayoutStructure(17);
        assertEq(pct.length, 8);
        assertEq(pct[0], 3800);
        _assertSumIs10000(pct);
    }

    function test_32playerTable_fieldSize32() public pure {
        uint16[] memory pct = PayoutCalculator.getPayoutStructure(32);
        assertEq(pct.length, 8);
        _assertSumIs10000(pct);
    }

    function test_64playerTable_fieldSize33() public pure {
        uint16[] memory pct = PayoutCalculator.getPayoutStructure(33);
        assertEq(pct.length, 12);
        assertEq(pct[0], 3000);
        _assertSumIs10000(pct);
    }

    function test_64playerTable_fieldSize64() public pure {
        uint16[] memory pct = PayoutCalculator.getPayoutStructure(64);
        assertEq(pct.length, 12);
        _assertSumIs10000(pct);
    }

    // ================================================================
    //                     PAID SLOTS TESTS
    // ================================================================

    function test_paidSlots() public pure {
        assertEq(PayoutCalculator.getPaidSlots(1), 1);
        assertEq(PayoutCalculator.getPaidSlots(2), 1);
        assertEq(PayoutCalculator.getPaidSlots(3), 3);
        assertEq(PayoutCalculator.getPaidSlots(8), 3);
        assertEq(PayoutCalculator.getPaidSlots(9), 5);
        assertEq(PayoutCalculator.getPaidSlots(16), 5);
        assertEq(PayoutCalculator.getPaidSlots(17), 8);
        assertEq(PayoutCalculator.getPaidSlots(32), 8);
        assertEq(PayoutCalculator.getPaidSlots(33), 12);
        assertEq(PayoutCalculator.getPaidSlots(64), 12);
    }

    // ================================================================
    //                    CALCULATE PAYOUTS TESTS
    // ================================================================

    function test_calculatePayouts_8players() public pure {
        uint256 pool = 1000e6; // 1000 USDC
        uint256[] memory amounts = PayoutCalculator.calculatePayouts(pool, 8);

        assertEq(amounts.length, 3);
        assertEq(amounts[0], 550e6); // 55%
        assertEq(amounts[1], 300e6); // 30%

        // Last slot absorbs rounding dust
        uint256 total;
        for (uint256 i; i < amounts.length; i++) total += amounts[i];
        assertEq(total, pool);
    }

    function test_calculatePayouts_16players() public pure {
        uint256 pool = 5000e6; // 5000 USDC
        uint256[] memory amounts = PayoutCalculator.calculatePayouts(pool, 16);

        assertEq(amounts.length, 5);
        assertEq(amounts[0], 2250e6); // 45%
        assertEq(amounts[1], 1250e6); // 25%
        assertEq(amounts[2], 750e6);  // 15%
        assertEq(amounts[3], 500e6);  // 10%

        uint256 total;
        for (uint256 i; i < amounts.length; i++) total += amounts[i];
        assertEq(total, pool);
    }

    function test_calculatePayouts_32players() public pure {
        uint256 pool = 10000e6;
        uint256[] memory amounts = PayoutCalculator.calculatePayouts(pool, 32);

        assertEq(amounts.length, 8);
        assertEq(amounts[0], 3800e6); // 38%

        uint256 total;
        for (uint256 i; i < amounts.length; i++) total += amounts[i];
        assertEq(total, pool);
    }

    function test_calculatePayouts_64players() public pure {
        uint256 pool = 32000e6;
        uint256[] memory amounts = PayoutCalculator.calculatePayouts(pool, 64);

        assertEq(amounts.length, 12);

        uint256 total;
        for (uint256 i; i < amounts.length; i++) total += amounts[i];
        assertEq(total, pool);
    }

    function test_calculatePayouts_winnerTakeAll() public pure {
        uint256 pool = 100e6;
        uint256[] memory amounts = PayoutCalculator.calculatePayouts(pool, 2);

        assertEq(amounts.length, 1);
        assertEq(amounts[0], pool);
    }

    function test_calculatePayouts_roundingDust() public pure {
        // Use a pool that doesn't divide evenly
        uint256 pool = 999999; // 0.999999 USDC
        uint256[] memory amounts = PayoutCalculator.calculatePayouts(pool, 8);

        uint256 total;
        for (uint256 i; i < amounts.length; i++) total += amounts[i];
        assertEq(total, pool, "Rounding dust must be absorbed");
    }

    function test_calculatePayouts_oddPool() public pure {
        uint256 pool = 7777777; // odd amount
        uint256[] memory amounts = PayoutCalculator.calculatePayouts(pool, 64);

        uint256 total;
        for (uint256 i; i < amounts.length; i++) total += amounts[i];
        assertEq(total, pool, "Total must equal pool for any amount");
    }

    // ================================================================
    //                     SUM VERIFICATION
    // ================================================================

    function test_allTablesSum10000() public pure {
        _assertSumIs10000(PayoutCalculator.getPayoutStructure(2));
        _assertSumIs10000(PayoutCalculator.getPayoutStructure(8));
        _assertSumIs10000(PayoutCalculator.getPayoutStructure(16));
        _assertSumIs10000(PayoutCalculator.getPayoutStructure(32));
        _assertSumIs10000(PayoutCalculator.getPayoutStructure(64));
    }

    // ================================================================
    //                        HELPERS
    // ================================================================

    function _assertSumIs10000(uint16[] memory pct) internal pure {
        uint256 sum;
        for (uint256 i; i < pct.length; i++) sum += pct[i];
        assertEq(sum, 10000, "Percentages must sum to 10000 bps");
    }
}
