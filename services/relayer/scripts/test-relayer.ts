/**
 * End-to-end test for the ChessBots meta-transaction relayer.
 *
 * Flow:
 *   1. Generate a throwaway agent wallet
 *   2. Get current nonce from relayer
 *   3. Construct a ForwardRequest targeting V4.registerAgent()
 *   4. Sign it with EIP-712
 *   5. Submit to relayer POST /relay
 *   6. Verify on-chain
 *
 * Usage:
 *   npx tsx scripts/test-relayer.ts
 */

import {
  createPublicClient,
  http,
  encodeFunctionData,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

// ── Config ──────────────────────────────────────────────────────────────────

const RELAYER_URL = "http://localhost:3004";
const RPC_URL = "https://rpc.monad.xyz";
const CHAIN_ID = 143;

const FORWARDER_ADDRESS = "0x99088C6D13113219B9fdA263Acb0229677c1658A" as Address;
const V4_ADDRESS = "0xa6B8eA116E16321B98fa9aCCfb63Cf0933c7e787" as Address;

// ── EIP-712 Types ───────────────────────────────────────────────────────────

const EIP712_DOMAIN = {
  name: "ChessForwarder",
  version: "1",
  chainId: BigInt(CHAIN_ID),
  verifyingContract: FORWARDER_ADDRESS,
} as const;

const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
} as const;

// V4 ABI (just registerAgent)
const V4_ABI = [
  {
    name: "registerAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agent", type: "address" },
      { name: "name", type: "string" },
      { name: "metadataUri", type: "string" },
      { name: "referrer", type: "address" },
    ],
    outputs: [],
  },
] as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fetchJson(url: string, opts?: RequestInit) {
  const res = await fetch(url, opts);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  ChessBots Relayer E2E Test");
  console.log("═══════════════════════════════════════════════════\n");

  // 1. Health check
  console.log("1️⃣  Checking relayer health...");
  const health = await fetchJson(`${RELAYER_URL}/health`);
  console.log(`   ✅ Relayer up | wallet=${health.address} | forwarder=${health.forwarder}\n`);

  // 2. Generate test agent
  const agentKey = generatePrivateKey();
  const agentAccount = privateKeyToAccount(agentKey);
  console.log(`2️⃣  Generated test agent: ${agentAccount.address}\n`);

  // 3. Get nonce
  console.log("3️⃣  Fetching nonce from relayer...");
  const nonceResp = await fetchJson(`${RELAYER_URL}/nonce/${agentAccount.address}`);
  const nonce = BigInt(nonceResp.nonce);
  console.log(`   ✅ Nonce: ${nonce}\n`);

  // 4. Build the ForwardRequest
  console.log("4️⃣  Building ForwardRequest...");

  // Encode V4.registerAgent(agent, name, metadataUri, referrer)
  const calldata = encodeFunctionData({
    abi: V4_ABI,
    functionName: "registerAgent",
    args: [
      agentAccount.address,
      "RelayerTestBot",
      "",
      "0x0000000000000000000000000000000000000000" as Address,
    ],
  });

  const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
  const gasLimit = 500000n;

  const forwardRequest = {
    from: agentAccount.address,
    to: V4_ADDRESS,
    value: 0n,
    gas: gasLimit,
    nonce: nonce,
    deadline: deadline,
    data: calldata,
  };

  console.log(`   Target: ${V4_ADDRESS}`);
  console.log(`   Function: registerAgent("RelayerTestBot")`);
  console.log(`   Deadline: ${new Date(deadline * 1000).toISOString()}`);
  console.log(`   Gas: ${gasLimit}\n`);

  // 5. Sign EIP-712
  console.log("5️⃣  Signing EIP-712 typed data...");
  const signature = await agentAccount.signTypedData({
    domain: EIP712_DOMAIN,
    types: FORWARD_REQUEST_TYPES,
    primaryType: "ForwardRequest",
    message: forwardRequest,
  });
  console.log(`   ✅ Signature: ${signature.slice(0, 20)}...${signature.slice(-8)}\n`);

  // 6. Submit to relayer
  console.log("6️⃣  Submitting to relayer POST /relay...");
  const relayPayload = {
    request: {
      from: forwardRequest.from,
      to: forwardRequest.to,
      value: forwardRequest.value.toString(),
      gas: forwardRequest.gas.toString(),
      nonce: forwardRequest.nonce.toString(),
      deadline: forwardRequest.deadline,
      data: forwardRequest.data,
    },
    signature,
  };

  let relayResult: any;
  try {
    relayResult = await fetchJson(`${RELAYER_URL}/relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(relayPayload),
    });
  } catch (err: any) {
    console.log(`   ❌ Relay failed: ${err.message}`);
    console.log("\n   This might be expected if registerAgent reverts (e.g., 'already registered').");
    console.log("   The important thing is that the signature was verified and tx was submitted.\n");
    process.exit(1);
  }

  console.log(`   ✅ Relay result: success=${relayResult.success} txHash=${relayResult.txHash}\n`);

  // 7. Verify on-chain
  console.log("7️⃣  Verifying on-chain...");
  const publicClient = createPublicClient({
    chain: {
      id: CHAIN_ID,
      name: "Monad",
      nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
      rpcUrls: { default: { http: [RPC_URL] } },
    },
    transport: http(RPC_URL),
  });

  const receipt = await publicClient.getTransactionReceipt({ hash: relayResult.txHash });
  console.log(`   Status: ${receipt.status}`);
  console.log(`   Gas used: ${receipt.gasUsed}`);
  console.log(`   Block: ${receipt.blockNumber}`);

  // Check for Forwarded event
  const forwardedTopic = "0x" + Buffer.from(
    "Forwarded(address,address,uint256,bool)"
  ).toString(); // Not actual keccak — just check logs exist

  if (receipt.logs.length > 0) {
    console.log(`   Events emitted: ${receipt.logs.length}`);
  }

  // 8. Check nonce incremented
  const newNonceResp = await fetchJson(`${RELAYER_URL}/nonce/${agentAccount.address}`);
  const newNonce = BigInt(newNonceResp.nonce);
  console.log(`   Nonce after: ${newNonce} (was ${nonce})\n`);

  if (newNonce > nonce) {
    console.log("═══════════════════════════════════════════════════");
    console.log("  ✅ RELAYER E2E TEST PASSED!");
    console.log("  Agent registered via meta-transaction.");
    console.log("  Zero gas paid by agent.");
    console.log("═══════════════════════════════════════════════════");
  } else {
    console.log("═══════════════════════════════════════════════════");
    console.log("  ⚠️  Nonce did not increment — check tx receipt");
    console.log("═══════════════════════════════════════════════════");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
