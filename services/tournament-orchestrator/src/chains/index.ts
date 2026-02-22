import { ChainConfig } from '../types/index.js';

// TO-C2: Fail-fast if required environment variables are missing (no hardcoded fallbacks)
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`FATAL: Required environment variable ${name} is not set.`);
  }
  return value;
}

// Lazy initialization — only evaluated when getChainConfig() is called
let _config: ChainConfig | null = null;

export function getChainConfig(): ChainConfig {
  if (!_config) {
    _config = {
      rpcUrl: process.env.MONAD_RPC || 'https://rpc.monad.xyz/',
      contractAddress: requireEnv('MONAD_CONTRACT'),
      usdcAddress: requireEnv('MONAD_USDC'),
      chessTokenAddress: requireEnv('CHESS_TOKEN'),
      stakingAddress: requireEnv('CHESS_STAKING'),
      privateKey: requireEnv('PRIVATE_KEY'),
      // V4 Economics contracts (deployed Feb 22, 2026)
      v4ContractAddress: process.env.V4_CONTRACT || '0xa6B8eA116E16321B98fa9aCCfb63Cf0933c7e787',
      revenueRouterAddress: process.env.REVENUE_ROUTER || '0xBFAD25C55265Cd5bAeA76dc79413530D4772DB80',
      eloContractAddress: process.env.ELO_CONTRACT || '0xc2088CD0663b07d910FF765a005A7Ef6a0A73195',
      seasonContractAddress: process.env.SEASON_CONTRACT || '0x9762544DfdE282c1c3255A26B02608f23bC04260',
    };
  }
  return _config;
}

export function isDeployed(): boolean {
  try {
    const config = getChainConfig();
    return config.contractAddress !== '' && config.privateKey !== '';
  } catch {
    return false;
  }
}
