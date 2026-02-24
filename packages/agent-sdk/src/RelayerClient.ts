import type { Address, Hex } from 'viem';

// Production relayer URL on Railway (updated after deployment)
const DEFAULT_RELAYER_URL = 'https://relayer-production.up.railway.app';

export interface RelayRequest {
  from: string;
  to: string;
  value: string;
  gas: string;
  nonce: string;
  deadline: number;
  data: string;
}

export interface RelayResponse {
  success: boolean;
  txHash: Hex;
}

export class RelayerClient {
  private baseUrl: string;

  constructor(relayerUrl?: string) {
    this.baseUrl = (relayerUrl || DEFAULT_RELAYER_URL).replace(/\/$/, '');
  }

  /** Get the current forwarder nonce for an address */
  async getNonce(address: Address): Promise<bigint> {
    const res = await this._fetch(`/nonce/${address}`);
    return BigInt(res.nonce);
  }

  /** Submit a signed forward request to the relayer */
  async relay(request: RelayRequest, signature: Hex): Promise<RelayResponse> {
    return this._fetch('/relay', {
      method: 'POST',
      body: JSON.stringify({ request, signature }),
    });
  }

  /** Check if relayer is reachable (3s timeout) */
  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async _fetch(
    path: string,
    opts: { method?: string; body?: string } = {},
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: opts.body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Relayer ${opts.method || 'GET'} ${path} failed (${res.status}): ${text}`,
      );
    }

    return res.json();
  }
}
