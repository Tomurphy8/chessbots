export const CHAIN = {
  name: 'Monad',
  color: '#836EF9',
  rpcUrl: process.env.NEXT_PUBLIC_MONAD_RPC || 'https://testnet-rpc.monad.xyz/',
  explorerUrl: 'https://testnet.monadexplorer.com',
  contractAddress: process.env.NEXT_PUBLIC_MONAD_CONTRACT || '0x7C4f93CE86E2f0aCCb64BE5892a12a8c04C1d720',
  usdcAddress: process.env.NEXT_PUBLIC_MONAD_USDC || '0xa88deE7352b66e4c6114cfA5f1a6aF5F77d33A25',
  chessTokenAddress: process.env.NEXT_PUBLIC_CHESS_TOKEN || '0x111e96342544fD82e567bd30F4aaC8366be8264e',
  stakingAddress: process.env.NEXT_PUBLIC_CHESS_STAKING || '0x36adf538Ec08f97DcDA0D7C23510782a3dbfa917',
  dexRouterAddress: process.env.NEXT_PUBLIC_DEX_ROUTER || '0xfe31f71c1b106eac32f1a19239c9a9a72ddfb900', // Uniswap V3 SwapRouter02
  evmChainId: 10143,
} as const;
