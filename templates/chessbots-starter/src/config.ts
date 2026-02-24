import { defineChain, type Address } from 'viem';

// ─── Monad Mainnet ───────────────────────────────────────────────────────────

export const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadScan', url: 'https://monadscan.com' } },
});

// ─── Addresses ───────────────────────────────────────────────────────────────

export const GATEWAY = process.env.GATEWAY_URL || 'https://agent-gateway-production-590d.up.railway.app';
export const CONTRACT: Address = '0xa6B8eA116E16321B98fa9aCCfb63Cf0933c7e787';
export const USDC: Address = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
export const FORWARDER: Address = '0x99088C6D13113219B9fdA263Acb0229677c1658A';
export const RELAYER_URL = process.env.RELAYER_URL || 'https://relayer-production-f6ec.up.railway.app';

// ─── EIP-712 Meta-Transaction Constants ──────────────────────────────────────

export const EIP712_DOMAIN = {
  name: 'ChessForwarder' as const,
  version: '1' as const,
  chainId: 143n,
  verifyingContract: FORWARDER,
};

export const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint48' },
    { name: 'data', type: 'bytes' },
  ],
} as const;

// ─── ABIs (minimal — only what the bot needs) ────────────────────────────────

export const CHESSBOTS_ABI = [
  {
    inputs: [{ name: 'tournamentId', type: 'uint256' }],
    name: 'registerForTournament',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'metadataUri', type: 'string' },
      { name: 'agentType', type: 'uint8' },
    ],
    name: 'registerAgent',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'metadataUri', type: 'string' },
      { name: 'agentType', type: 'uint8' },
      { name: 'referrer', type: 'address' },
    ],
    name: 'registerAgentWithReferral',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'tournamentId', type: 'uint256' }],
    name: 'getTournament',
    outputs: [{
      components: [
        { name: 'id', type: 'uint256' },
        { name: 'authority', type: 'address' },
        { name: 'tier', type: 'uint8' },
        { name: 'format', type: 'uint8' },
        { name: 'entryFee', type: 'uint256' },
        { name: 'status', type: 'uint8' },
        { name: 'maxPlayers', type: 'uint8' },
        { name: 'minPlayers', type: 'uint8' },
        { name: 'registeredCount', type: 'uint8' },
        { name: 'currentRound', type: 'uint8' },
        { name: 'totalRounds', type: 'uint8' },
        { name: 'teamSize', type: 'uint8' },
        { name: 'bestOf', type: 'uint8' },
        { name: 'startTime', type: 'int64' },
        { name: 'registrationDeadline', type: 'int64' },
        { name: 'baseTimeSeconds', type: 'uint32' },
        { name: 'incrementSeconds', type: 'uint32' },
        { name: 'winners', type: 'address[3]' },
        { name: 'resultsUri', type: 'string' },
        { name: 'prizeDistributed', type: 'bool' },
        { name: 'exists', type: 'bool' },
        { name: 'challengeTarget', type: 'address' },
      ],
      name: '',
      type: 'tuple',
    }],
    stateMutability: 'view',
    type: 'function',
  },
  // Referral economics
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'referralEarnings',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'referralCount',
    outputs: [{ name: '', type: 'uint16' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'referrer', type: 'address' }],
    name: 'getReferrerTier',
    outputs: [
      { name: 'tier', type: 'uint8' },
      { name: 'rateBps', type: 'uint16' },
      { name: 'count', type: 'uint16' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'claimReferralEarnings',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export const ERC20_ABI = [
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
