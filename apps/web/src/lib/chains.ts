export const CHAIN = {
  name: 'Monad',
  color: '#836EF9',
  rpcUrl: (process.env.NEXT_PUBLIC_MONAD_RPC || 'https://rpc.monad.xyz').trim(),
  explorerUrl: 'https://monadscan.com',
  contractAddress: (process.env.NEXT_PUBLIC_MONAD_CONTRACT || '0x34FAAfaf58750bc259d89Dd232FadAE5C1a4E7aa').trim(),
  usdcAddress: (process.env.NEXT_PUBLIC_MONAD_USDC || '0x754704Bc059F8C67012fEd69BC8A327a5aafb603').trim(),
  chessTokenAddress: (process.env.NEXT_PUBLIC_CHESS_TOKEN || '0x6b375B2306CD1C39de6BDA4f0bCfF49b44a5e35C').trim(),
  stakingAddress: (process.env.NEXT_PUBLIC_CHESS_STAKING || '0x66c3770E0732C94A7a9df044c79E0859cAc5eB53').trim(),
  bettingPoolAddress: (process.env.NEXT_PUBLIC_BETTING_POOL || '0xb87fCb0D46Be37550DEDF3e3f2db23f6d29E2749').trim(),
  gatewayUrl: (process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3002').trim(),
  dexRouterAddress: (process.env.NEXT_PUBLIC_DEX_ROUTER || '0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137').trim(),
  evmChainId: 143,
} as const;
