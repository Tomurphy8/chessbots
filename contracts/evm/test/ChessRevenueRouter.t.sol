// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChessRevenueRouter.sol";

contract MockUSDCRouter {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockChessToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockDexRouter {
    MockUSDCRouter public usdc;
    MockChessToken public chess;
    uint256 public rate; // CHESS per USDC (scaled by 1e18)

    constructor(address _usdc, address _chess, uint256 _rate) {
        usdc = MockUSDCRouter(_usdc);
        chess = MockChessToken(_chess);
        rate = _rate;
    }

    function exactInputSingle(ISwapRouter.ExactInputSingleParams calldata params) external returns (uint256) {
        // Take USDC from caller
        usdc.transferFrom(msg.sender, address(this), params.amountIn);

        // Calculate CHESS output
        uint256 chessOut = (params.amountIn * rate) / 1e18;
        require(chessOut >= params.amountOutMinimum, "Slippage exceeded");

        // Send CHESS to recipient
        chess.transfer(params.recipient, chessOut);
        return chessOut;
    }
}

contract ChessRevenueRouterTest is Test {
    ChessRevenueRouter public router;
    MockUSDCRouter public usdc;
    MockChessToken public chess;
    MockDexRouter public dex;

    address authority = address(1);
    address treasury = address(2);
    address seasonRewards = address(3);
    address sender = address(10);

    address constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    function setUp() public {
        usdc = new MockUSDCRouter();
        chess = new MockChessToken();

        // 1 USDC = 100 CHESS (rate = 100e18)
        dex = new MockDexRouter(address(usdc), address(chess), 100e18);

        // Mint CHESS to DEX for swaps
        chess.mint(address(dex), 1_000_000e18);

        router = new ChessRevenueRouter(address(usdc), treasury, authority);

        // Configure router
        vm.startPrank(authority);
        router.setChessToken(address(chess));
        router.setDexRouter(address(dex));
        router.setSeasonRewards(seasonRewards);
        vm.stopPrank();
    }

    function _fundAndRoute(uint256 amount) internal {
        usdc.mint(sender, amount);
        vm.prank(sender);
        usdc.approve(address(router), amount);
        vm.prank(sender);
        router.routeRevenue(amount);
    }

    // ================================================================
    //                    REVENUE INTAKE TESTS
    // ================================================================

    function test_routeRevenue_accumulates() public {
        _fundAndRoute(100e6);
        assertEq(router.pendingRevenue(), 100e6);

        _fundAndRoute(50e6);
        assertEq(router.pendingRevenue(), 150e6);
    }

    function test_routeRevenue_zeroReverts() public {
        vm.expectRevert("Zero amount");
        router.routeRevenue(0);
    }

    // ================================================================
    //                   BUYBACK & ROUTE TESTS
    // ================================================================

    function test_executeBuyback_splits80_10_10() public {
        _fundAndRoute(100e6); // 100 USDC

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 burnBefore = chess.balanceOf(BURN_ADDRESS);
        uint256 seasonBefore = chess.balanceOf(seasonRewards);

        router.executeBuybackAndRoute(0);

        // 10% USDC to treasury = 10 USDC
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, 10e6);

        // 90% USDC swapped → CHESS
        // 90 USDC * 100 CHESS/USDC = 9000 CHESS
        uint256 totalChess = 9000e6; // mock uses 6 decimals same as USDC math

        // 8/9 burned, 1/9 to season
        uint256 chessToSeason = totalChess / 9; // 1000
        uint256 chessBurned = totalChess - chessToSeason; // 8000

        assertEq(chess.balanceOf(BURN_ADDRESS) - burnBefore, chessBurned);
        assertEq(chess.balanceOf(seasonRewards) - seasonBefore, chessToSeason);

        // Pending revenue should be zero
        assertEq(router.pendingRevenue(), 0);
    }

    function test_executeBuyback_minAmountRequired() public {
        _fundAndRoute(5e6); // 5 USDC < 10 USDC minimum

        vm.expectRevert("Min 10 USDC required");
        router.executeBuybackAndRoute(0);
    }

    function test_executeBuyback_noDexFallsBackToTreasury() public {
        // Deploy fresh router without DEX config
        ChessRevenueRouter freshRouter = new ChessRevenueRouter(address(usdc), treasury, authority);

        usdc.mint(sender, 100e6);
        vm.prank(sender);
        usdc.approve(address(freshRouter), 100e6);
        vm.prank(sender);
        freshRouter.routeRevenue(100e6);

        uint256 treasuryBefore = usdc.balanceOf(treasury);

        freshRouter.executeBuybackAndRoute(0);

        // All 100 USDC goes to treasury
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, 100e6);
        assertEq(freshRouter.pendingRevenue(), 0);
    }

    function test_executeBuyback_noSeasonRewardsBurnsAll() public {
        // Deploy router without season rewards
        ChessRevenueRouter noSeasonRouter = new ChessRevenueRouter(address(usdc), treasury, authority);
        vm.startPrank(authority);
        noSeasonRouter.setChessToken(address(chess));
        noSeasonRouter.setDexRouter(address(dex));
        vm.stopPrank();

        usdc.mint(sender, 100e6);
        vm.prank(sender);
        usdc.approve(address(noSeasonRouter), 100e6);
        vm.prank(sender);
        noSeasonRouter.routeRevenue(100e6);

        uint256 burnBefore = chess.balanceOf(BURN_ADDRESS);

        noSeasonRouter.executeBuybackAndRoute(0);

        // All CHESS should be burned (season rewards = address(0))
        // 90 USDC * 100 = 9000 CHESS all burned
        uint256 totalChess = 9000e6;
        assertEq(chess.balanceOf(BURN_ADDRESS) - burnBefore, totalChess);
    }

    // ================================================================
    //                    ADMIN TESTS
    // ================================================================

    function test_setSeasonRewards() public {
        address newSR = address(99);
        vm.prank(authority);
        router.setSeasonRewards(newSR);
        assertEq(router.seasonRewards(), newSR);
    }

    function test_setTreasury() public {
        address newTreasury = address(88);
        vm.prank(authority);
        router.setTreasury(newTreasury);
        assertEq(router.treasury(), newTreasury);
    }

    function test_onlyAuthorityCanConfigure() public {
        vm.prank(sender);
        vm.expectRevert("Unauthorized");
        router.setSeasonRewards(address(99));

        vm.prank(sender);
        vm.expectRevert("Unauthorized");
        router.setTreasury(address(88));

        vm.prank(sender);
        vm.expectRevert("Unauthorized");
        router.setChessToken(address(77));

        vm.prank(sender);
        vm.expectRevert("Unauthorized");
        router.setDexRouter(address(66));
    }

    // ================================================================
    //                 AUTHORITY TRANSFER TESTS
    // ================================================================

    function test_authorityTransfer() public {
        address newAuth = address(55);

        vm.prank(authority);
        router.proposeAuthority(newAuth);
        assertEq(router.pendingAuthority(), newAuth);

        vm.prank(newAuth);
        router.acceptAuthority();
        assertEq(router.authority(), newAuth);
        assertEq(router.pendingAuthority(), address(0));
    }

    function test_authorityTransfer_onlyPendingCanAccept() public {
        vm.prank(authority);
        router.proposeAuthority(address(55));

        vm.prank(sender);
        vm.expectRevert("Not pending authority");
        router.acceptAuthority();
    }

    // ================================================================
    //                    CONSTANTS VERIFICATION
    // ================================================================

    function test_constants() public view {
        assertEq(router.BURN_BPS(), 8000);
        assertEq(router.SEASON_BPS(), 1000);
        assertEq(router.TREASURY_BPS(), 1000);
        assertEq(router.BPS_DENOMINATOR(), 10000);
        assertEq(router.MIN_BUYBACK_AMOUNT(), 10e6);
        assertEq(router.BURN_ADDRESS(), BURN_ADDRESS);
    }
}
