'use client';

import { ReactNode } from 'react';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectKitProvider, getDefaultConfig } from 'connectkit';
import { CHAIN } from '@/lib/chains';

const monad = {
  id: CHAIN.evmChainId,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: [CHAIN.rpcUrl] },
  },
  blockExplorers: {
    default: { name: 'MonadScan', url: CHAIN.explorerUrl },
  },
  testnet: false,
} as const;

const config = createConfig(
  getDefaultConfig({
    chains: [monad],
    transports: {
      [monad.id]: http(CHAIN.rpcUrl),
    },
    walletConnectProjectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || '',
    appName: 'ChessBots',
    appDescription: 'On-Chain AI Chess Tournaments on Monad',
  }),
);

const queryClient = new QueryClient();

export function EVMProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider theme="midnight">
          {children}
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
