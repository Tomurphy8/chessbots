export const CHAIN = {
  name: 'Monad',
  color: '#836EF9',
  rpcUrl: (process.env.NEXT_PUBLIC_MONAD_RPC || 'https://rpc.monad.xyz').trim(),
  explorerUrl: 'https://monadscan.com',
  contractAddress: (process.env.NEXT_PUBLIC_MONAD_CONTRACT || '0x0e2663b0DCD9b7408d51C6972f679B81a5A7477e').trim(),
  usdcAddress: (process.env.NEXT_PUBLIC_MONAD_USDC || '0x754704Bc059F8C67012fEd69BC8A327a5aafb603').trim(),
  chessTokenAddress: (process.env.NEXT_PUBLIC_CHESS_TOKEN || '0xC138bA72CE0234448FCCab4B2208a1681c5BA1fa').trim(),
  stakingAddress: (process.env.NEXT_PUBLIC_CHESS_STAKING || '0xf242D07Ba9Aed9997c893B515678bc468D86E32C').trim(),
  bettingPoolAddress: (process.env.NEXT_PUBLIC_BETTING_POOL || '0x2b7d1D75AF4fA998bF4C93E84710623BCACC8dA9').trim(),
  gatewayUrl: (process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3002').trim(),
  dexRouterAddress: (process.env.NEXT_PUBLIC_DEX_ROUTER || '0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137').trim(),
  // V3 contract address (deployed alongside V2; V2 stays live for historical tournaments)
  v3ContractAddress: (process.env.NEXT_PUBLIC_V3_CONTRACT || '0x0e2663b0DCD9b7408d51C6972f679B81a5A7477e').trim(),
  // V4 Economics contracts (deployed Feb 22, 2026)
  v4ContractAddress: (process.env.NEXT_PUBLIC_V4_CONTRACT || '0xa6B8eA116E16321B98fa9aCCfb63Cf0933c7e787').trim(),
  revenueRouterAddress: (process.env.NEXT_PUBLIC_REVENUE_ROUTER || '0xBFAD25C55265Cd5bAeA76dc79413530D4772DB80').trim(),
  eloContractAddress: '0xc2088CD0663b07d910FF765a005A7Ef6a0A73195',
  seasonContractAddress: '0x9762544DfdE282c1c3255A26B02608f23bC04260',
  seasonRewardsAddress: '0xA5D8b8ba8dC07f1a993c632A4E6f47f375746879',
  satelliteContractAddress: '0x44CdFC9Ad6Fd28fc51a2042FfbAF543cc55c33f9',
  bountyContractAddress: '0x2570f4d8E4a51ad95F9725A2fC7563961DcAb680',
  stakingV2Address: '0x34b0b056A4C981c1624b1652e29331293A5E6570',
  forwarderAddress: '0x99088C6D13113219B9fdA263Acb0229677c1658A',
  // V2 contract address (historical tournaments, agents, and stats)
  v2ContractAddress: '0xCB030eE8Ee385f91F4372585Fe1fa3147FA192B8',
  // Legacy contracts — cumulative stats are summed across all deployments
  legacyContracts: [
    '0xCB030eE8Ee385f91F4372585Fe1fa3147FA192B8',  // V2
    '0x952d995DA79deDC98dD20A18036eb7464f0002fd',  // V3 (uint8 free tournament limit)
  ] as readonly string[],
  evmChainId: 143,
  siteUrl: 'https://chessbots.io',
} as const;
