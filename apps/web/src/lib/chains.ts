export const CHAIN = {
  name: 'Monad',
  color: '#836EF9',
  rpcUrl: (process.env.NEXT_PUBLIC_MONAD_RPC || 'https://rpc.monad.xyz').trim(),
  explorerUrl: 'https://monadscan.com',
  contractAddress: (process.env.NEXT_PUBLIC_MONAD_CONTRACT || '0x952d995DA79deDC98dD20A18036eb7464f0002fd').trim(),
  usdcAddress: (process.env.NEXT_PUBLIC_MONAD_USDC || '0x754704Bc059F8C67012fEd69BC8A327a5aafb603').trim(),
  chessTokenAddress: (process.env.NEXT_PUBLIC_CHESS_TOKEN || '0xC138bA72CE0234448FCCab4B2208a1681c5BA1fa').trim(),
  stakingAddress: (process.env.NEXT_PUBLIC_CHESS_STAKING || '0xf242D07Ba9Aed9997c893B515678bc468D86E32C').trim(),
  bettingPoolAddress: (process.env.NEXT_PUBLIC_BETTING_POOL || '0x2b7d1D75AF4fA998bF4C93E84710623BCACC8dA9').trim(),
  gatewayUrl: (process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3002').trim(),
  dexRouterAddress: (process.env.NEXT_PUBLIC_DEX_ROUTER || '0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137').trim(),
  // V3 contract address (deployed alongside V2; V2 stays live for historical tournaments)
  v3ContractAddress: (process.env.NEXT_PUBLIC_V3_CONTRACT || '0x952d995DA79deDC98dD20A18036eb7464f0002fd').trim(),
  // V2 contract address (historical tournaments, agents, and stats)
  v2ContractAddress: '0xCB030eE8Ee385f91F4372585Fe1fa3147FA192B8',
  evmChainId: 143,
  siteUrl: 'https://chessbots.io',
} as const;
