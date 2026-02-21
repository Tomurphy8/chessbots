// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ChessForwarder - ERC-2771 Meta-Transaction Forwarder
/// @notice Enables gasless tournament registration and heartbeats for chess agents.
///         Agents sign EIP-712 typed data off-chain; a relayer submits the transaction.
/// @dev Implements the ERC-2771 pattern: the forwarder appends msg.sender to calldata
///      so the target contract (V4) can extract the original signer via _msgSender().
contract ChessForwarder {
    struct ForwardRequest {
        address from;       // Original signer
        address to;         // Target contract (V4)
        uint256 value;      // ETH value (typically 0)
        uint256 gas;        // Gas limit for the call
        uint256 nonce;      // Replay protection
        uint48 deadline;    // Request expiry timestamp
        bytes data;         // Encoded function call
    }

    bytes32 private constant _TYPEHASH = keccak256(
        "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
    );

    // EIP-712 domain separator
    bytes32 private immutable _DOMAIN_SEPARATOR;
    bytes32 private constant _DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    // Nonces for replay protection
    mapping(address => uint256) private _nonces;

    // Rate limiting: per-agent cooldown between meta-txs
    mapping(address => uint256) public lastForwardTime;
    uint256 public forwardCooldown = 30 seconds;

    // Authority for configuration
    address public authority;

    // Allowed target contracts (whitelist)
    mapping(address => bool) public allowedTargets;

    // ── Events ────────────────────────────────────────────────────────────

    event Forwarded(address indexed from, address indexed to, uint256 nonce, bool success);
    event TargetUpdated(address indexed target, bool allowed);

    // ── Constructor ───────────────────────────────────────────────────────

    constructor() {
        authority = msg.sender;
        _DOMAIN_SEPARATOR = keccak256(abi.encode(
            _DOMAIN_TYPEHASH,
            keccak256("ChessForwarder"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    // ── Core ──────────────────────────────────────────────────────────────

    /// @notice Execute a meta-transaction on behalf of `req.from`
    /// @param req The forward request signed by the agent
    /// @param signature EIP-712 signature from req.from
    /// @return success Whether the forwarded call succeeded
    /// @return returndata Return data from the forwarded call
    function execute(
        ForwardRequest calldata req,
        bytes calldata signature
    ) external payable returns (bool success, bytes memory returndata) {
        // Verify signature
        require(_verify(req, signature), "Invalid signature");

        // Check deadline
        require(block.timestamp <= req.deadline, "Request expired");

        // Check and increment nonce
        uint256 currentNonce = _nonces[req.from];
        require(currentNonce == req.nonce, "Invalid nonce");
        _nonces[req.from] = currentNonce + 1;

        // Rate limiting
        require(
            block.timestamp >= lastForwardTime[req.from] + forwardCooldown,
            "Rate limited"
        );
        lastForwardTime[req.from] = block.timestamp;

        // Target whitelist
        require(allowedTargets[req.to], "Target not allowed");

        // Forward the call, appending the original sender (ERC-2771)
        (success, returndata) = req.to.call{gas: req.gas, value: req.value}(
            abi.encodePacked(req.data, req.from)
        );

        emit Forwarded(req.from, req.to, currentNonce, success);
    }

    /// @notice Verify a forward request signature without executing
    function verify(ForwardRequest calldata req, bytes calldata signature) external view returns (bool) {
        return _verify(req, signature);
    }

    /// @notice Get the current nonce for an address
    function getNonce(address from) external view returns (uint256) {
        return _nonces[from];
    }

    /// @notice Get the EIP-712 domain separator
    function domainSeparator() external view returns (bytes32) {
        return _DOMAIN_SEPARATOR;
    }

    // ── Internal ──────────────────────────────────────────────────────────

    function _verify(ForwardRequest calldata req, bytes calldata signature) internal view returns (bool) {
        bytes32 structHash = keccak256(abi.encode(
            _TYPEHASH,
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
            _DOMAIN_SEPARATOR,
            structHash
        ));

        address signer = _recover(digest, signature);
        return signer == req.from;
    }

    function _recover(bytes32 hash, bytes calldata signature) internal pure returns (address) {
        require(signature.length == 65, "Invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        // EIP-2 check: s must be in the lower half order
        require(
            uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
            "Invalid s value"
        );

        if (v < 27) v += 27;
        require(v == 27 || v == 28, "Invalid v value");

        address signer = ecrecover(hash, v, r, s);
        require(signer != address(0), "Invalid signer");
        return signer;
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    function setAllowedTarget(address target, bool allowed) external {
        require(msg.sender == authority, "Not authority");
        allowedTargets[target] = allowed;
        emit TargetUpdated(target, allowed);
    }

    function setCooldown(uint256 _cooldown) external {
        require(msg.sender == authority, "Not authority");
        require(_cooldown <= 5 minutes, "Cooldown too high");
        forwardCooldown = _cooldown;
    }

    function setAuthority(address _new) external {
        require(msg.sender == authority, "Not authority");
        require(_new != address(0), "Zero address");
        authority = _new;
    }
}
