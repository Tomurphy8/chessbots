// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChessForwarder.sol";

/// @dev Simple target contract that records the sender
contract MockTarget {
    address public lastSender;
    uint256 public lastValue;

    function doSomething(uint256 val) external {
        // In ERC-2771, the real sender is appended to calldata
        // For simplicity in tests, we just record msg.sender
        lastSender = msg.sender;
        lastValue = val;
    }

    function doSomethingWithERC2771(uint256 val) external {
        lastValue = val;
        // Extract ERC-2771 sender from last 20 bytes of calldata
        if (msg.data.length >= 24) { // 4 (selector) + 32 (uint256) + 20 (address) - but with packed encoding it varies
            lastSender = address(bytes20(msg.data[msg.data.length - 20:]));
        } else {
            lastSender = msg.sender;
        }
    }

    function revertingFunction() external pure {
        revert("Target reverted");
    }
}

contract ChessForwarderTest is Test {
    ChessForwarder public forwarder;
    MockTarget public target;

    address authority = address(1);
    uint256 agentKey = 0xA11CE;
    address agent;

    // EIP-712 constants matching ChessForwarder constructor
    bytes32 constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 constant REQUEST_TYPEHASH = keccak256(
        "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
    );

    function setUp() public {
        agent = vm.addr(agentKey);

        vm.prank(authority);
        forwarder = new ChessForwarder();

        target = new MockTarget();

        // Whitelist the target
        vm.prank(authority);
        forwarder.setAllowedTarget(address(target), true);

        // Disable cooldown for tests
        vm.prank(authority);
        forwarder.setCooldown(0);
    }

    function _buildDomainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("ChessForwarder"),
            keccak256("1"),
            block.chainid,
            address(forwarder)
        ));
    }

    function _signRequest(
        ChessForwarder.ForwardRequest memory req,
        uint256 privateKey
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            REQUEST_TYPEHASH,
            req.from,
            req.to,
            req.value,
            req.gas,
            req.nonce,
            req.deadline,
            keccak256(req.data)
        ));

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            _buildDomainSeparator(),
            structHash
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _makeRequest() internal view returns (ChessForwarder.ForwardRequest memory) {
        return ChessForwarder.ForwardRequest({
            from: agent,
            to: address(target),
            value: 0,
            gas: 100_000,
            nonce: forwarder.getNonce(agent),
            deadline: uint48(block.timestamp + 1 hours),
            data: abi.encodeWithSelector(MockTarget.doSomething.selector, 42)
        });
    }

    // ================================================================
    //                  SIGNATURE VERIFICATION
    // ================================================================

    function test_verifyValidSignature() public view {
        ChessForwarder.ForwardRequest memory req = _makeRequest();
        bytes memory sig = _signRequest(req, agentKey);
        assertTrue(forwarder.verify(req, sig));
    }

    function test_verifyInvalidSignature() public view {
        ChessForwarder.ForwardRequest memory req = _makeRequest();
        // Sign with wrong key
        bytes memory sig = _signRequest(req, 0xBEEF);
        assertFalse(forwarder.verify(req, sig));
    }

    function test_verifyTamperedData() public view {
        ChessForwarder.ForwardRequest memory req = _makeRequest();
        bytes memory sig = _signRequest(req, agentKey);
        // Tamper with nonce
        req.nonce = 999;
        assertFalse(forwarder.verify(req, sig));
    }

    // ================================================================
    //                  EXECUTION TESTS
    // ================================================================

    function test_executeForward() public {
        ChessForwarder.ForwardRequest memory req = _makeRequest();
        bytes memory sig = _signRequest(req, agentKey);

        (bool success,) = forwarder.execute(req, sig);
        assertTrue(success);
        assertEq(target.lastValue(), 42);
    }

    function test_nonceIncrementsAfterExecution() public {
        assertEq(forwarder.getNonce(agent), 0);

        ChessForwarder.ForwardRequest memory req = _makeRequest();
        bytes memory sig = _signRequest(req, agentKey);

        forwarder.execute(req, sig);
        assertEq(forwarder.getNonce(agent), 1);
    }

    function test_replayProtection() public {
        ChessForwarder.ForwardRequest memory req = _makeRequest();
        bytes memory sig = _signRequest(req, agentKey);

        // First execution succeeds
        forwarder.execute(req, sig);

        // Replay fails (nonce already used)
        vm.expectRevert("Invalid nonce");
        forwarder.execute(req, sig);
    }

    function test_expiredRequestReverts() public {
        ChessForwarder.ForwardRequest memory req = _makeRequest();
        req.deadline = uint48(block.timestamp - 1); // Already expired
        bytes memory sig = _signRequest(req, agentKey);

        vm.expectRevert("Request expired");
        forwarder.execute(req, sig);
    }

    function test_wrongNonceReverts() public {
        ChessForwarder.ForwardRequest memory req = _makeRequest();
        req.nonce = 5; // Wrong nonce
        bytes memory sig = _signRequest(req, agentKey);

        vm.expectRevert("Invalid nonce");
        forwarder.execute(req, sig);
    }

    function test_invalidSignatureReverts() public {
        ChessForwarder.ForwardRequest memory req = _makeRequest();
        bytes memory sig = _signRequest(req, 0xBEEF); // Wrong signer

        vm.expectRevert("Invalid signature");
        forwarder.execute(req, sig);
    }

    // ================================================================
    //                  RATE LIMITING
    // ================================================================

    function test_rateLimiting() public {
        // Warp to a real timestamp so rate limit math works
        vm.warp(1000);

        // Set cooldown to 60 seconds
        vm.prank(authority);
        forwarder.setCooldown(60);

        // First request succeeds (lastForwardTime=0, 1000 >= 0+60)
        ChessForwarder.ForwardRequest memory req1 = _makeRequest();
        bytes memory sig1 = _signRequest(req1, agentKey);
        forwarder.execute(req1, sig1);

        // Second request too soon (lastForwardTime=1000, 1000 >= 1000+60 = false)
        ChessForwarder.ForwardRequest memory req2 = ChessForwarder.ForwardRequest({
            from: agent,
            to: address(target),
            value: 0,
            gas: 100_000,
            nonce: forwarder.getNonce(agent),
            deadline: uint48(block.timestamp + 1 hours),
            data: abi.encodeWithSelector(MockTarget.doSomething.selector, 99)
        });
        bytes memory sig2 = _signRequest(req2, agentKey);

        vm.expectRevert("Rate limited");
        forwarder.execute(req2, sig2);

        // After cooldown, it works
        vm.warp(block.timestamp + 61);
        (bool success,) = forwarder.execute(req2, sig2);
        assertTrue(success);
    }

    // ================================================================
    //                  TARGET WHITELIST
    // ================================================================

    function test_nonAllowedTargetReverts() public {
        address badTarget = address(0x999);
        ChessForwarder.ForwardRequest memory req = _makeRequest();
        req.to = badTarget;
        bytes memory sig = _signRequest(req, agentKey);

        vm.expectRevert("Target not allowed");
        forwarder.execute(req, sig);
    }

    function test_setAllowedTarget() public {
        address newTarget = address(0x888);
        assertFalse(forwarder.allowedTargets(newTarget));

        vm.prank(authority);
        forwarder.setAllowedTarget(newTarget, true);
        assertTrue(forwarder.allowedTargets(newTarget));

        vm.prank(authority);
        forwarder.setAllowedTarget(newTarget, false);
        assertFalse(forwarder.allowedTargets(newTarget));
    }

    // ================================================================
    //                  TARGET REVERT HANDLING
    // ================================================================

    function test_targetRevertReturnsFailure() public {
        ChessForwarder.ForwardRequest memory req = _makeRequest();
        req.data = abi.encodeWithSelector(MockTarget.revertingFunction.selector);
        bytes memory sig = _signRequest(req, agentKey);

        (bool success,) = forwarder.execute(req, sig);
        assertFalse(success);
    }

    // ================================================================
    //                  ADMIN TESTS
    // ================================================================

    function test_onlyAuthorityCanSetTarget() public {
        vm.prank(address(99));
        vm.expectRevert("Not authority");
        forwarder.setAllowedTarget(address(0x888), true);
    }

    function test_onlyAuthorityCanSetCooldown() public {
        vm.prank(address(99));
        vm.expectRevert("Not authority");
        forwarder.setCooldown(60);
    }

    function test_cooldownTooHighReverts() public {
        vm.prank(authority);
        vm.expectRevert("Cooldown too high");
        forwarder.setCooldown(10 minutes);
    }

    function test_domainSeparator() public view {
        bytes32 expected = _buildDomainSeparator();
        assertEq(forwarder.domainSeparator(), expected);
    }
}
