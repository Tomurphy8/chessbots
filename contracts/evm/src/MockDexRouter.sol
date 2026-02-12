// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockDexRouter - Simulates Uniswap V3 SwapRouter for testing
/// @notice Takes USDC in, transfers CHESS out at a fixed 1:1000 rate (1 USDC = 1000 CHESS)
/// @dev Only for use in Foundry tests. Not deployed to production.
contract MockDexRouter {
    address public usdc;
    address public chessToken;

    // Fixed rate: 1 USDC (6 decimals) = 1000 CHESS (18 decimals)
    // So 1e6 USDC = 1000e18 CHESS → multiplier = 1000 * 1e12
    uint256 public constant RATE = 1000e12;

    constructor(address _usdc, address _chessToken) {
        usdc = _usdc;
        chessToken = _chessToken;
    }

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    /// @notice Simulates a swap: pulls USDC, sends CHESS at fixed rate
    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut) {
        require(params.tokenIn == usdc, "Wrong tokenIn");
        require(params.tokenOut == chessToken, "Wrong tokenOut");

        // Pull USDC from caller
        (bool success,) = usdc.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), params.amountIn)
        );
        require(success, "USDC transfer failed");

        // Calculate output: 1 USDC = 1000 CHESS
        amountOut = params.amountIn * RATE;
        require(amountOut >= params.amountOutMinimum, "Insufficient output");

        // Transfer CHESS to recipient
        (bool success2,) = chessToken.call(
            abi.encodeWithSignature("transfer(address,uint256)", params.recipient, amountOut)
        );
        require(success2, "CHESS transfer failed");
    }
}
