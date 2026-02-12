// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IChessStaking {
    function getDiscount(address user) external view returns (uint16 discountBps);
    function stakedBalance(address user) external view returns (uint256);
}
