'use client';

import { useState, useEffect } from 'react';
import { createPublicClient, http, formatUnits, type Address, defineChain } from 'viem';
import { CHAIN } from '@/lib/chains';
import { CHESSBOTS_ABI } from '@/lib/contracts/evm';

const monad = defineChain({
  id: CHAIN.evmChainId,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [CHAIN.rpcUrl] } },
});

const publicClient = createPublicClient({
  chain: monad,
  transport: http(CHAIN.rpcUrl),
});

const CONTRACT = CHAIN.contractAddress as Address;

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif'];

export interface SponsorInfo {
  sponsor: string;
  name: string;
  uri: string;
  amount: string; // formatted USDC
}

export interface SponsorResult {
  sponsor: SponsorInfo | null;
  hasSponsor: boolean;
  isImageUri: boolean;
  loading: boolean;
}

export function useSponsor(tournamentId: number): SponsorResult {
  const [sponsor, setSponsor] = useState<SponsorInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSponsor() {
      try {
        setLoading(true);
        const data = await publicClient.readContract({
          address: CONTRACT,
          abi: CHESSBOTS_ABI,
          functionName: 'getSponsor',
          args: [BigInt(tournamentId)],
        }) as any;

        // If sponsor address is zero, no sponsor
        if (!data.sponsor || data.sponsor === '0x0000000000000000000000000000000000000000') {
          setSponsor(null);
        } else {
          setSponsor({
            sponsor: data.sponsor,
            name: data.name,
            uri: data.uri,
            amount: formatUnits(BigInt(data.amount), 6),
          });
        }
      } catch {
        // Contract reverts when no sponsor exists — this is expected
        setSponsor(null);
      } finally {
        setLoading(false);
      }
    }

    fetchSponsor();
  }, [tournamentId]);

  const isImageUri = sponsor?.uri
    ? IMAGE_EXTENSIONS.some(ext => sponsor.uri.toLowerCase().endsWith(ext))
    : false;

  return {
    sponsor,
    hasSponsor: sponsor !== null,
    isImageUri,
    loading,
  };
}
