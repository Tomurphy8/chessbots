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
      rpcUrl: process.env.MONAD_RPC || 'https://testnet-rpc.monad.xyz/',
      contractAddress: requireEnv('MONAD_CONTRACT'),
      usdcAddress: requireEnv('MONAD_USDC'),
      chessTokenAddress: requireEnv('CHESS_TOKEN'),
      stakingAddress: requireEnv('CHESS_STAKING'),
      privateKey: requireEnv('PRIVATE_KEY'),
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
