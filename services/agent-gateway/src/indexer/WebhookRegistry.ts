import type { TournamentNotification } from './TournamentWatcher.js';

const MAX_URL_LENGTH = 256;
const DELIVERY_TIMEOUT_MS = 5_000;
const MAX_WEBHOOKS = 1_000;

interface WebhookEntry {
  wallet: string;
  url: string;
  registeredAt: number;
  deliveries: number;
  failures: number;
  lastDeliveryAt: number | null;
}

/**
 * In-memory webhook registry. Agents register a URL to receive POST notifications
 * when new tournaments are created. Webhooks are ephemeral — they don't survive
 * gateway restarts. Agents should re-register on reconnect.
 */
export class WebhookRegistry {
  private webhooks = new Map<string, WebhookEntry>();

  /**
   * Register or update a webhook URL for a wallet.
   * Max 1 webhook per wallet.
   */
  register(wallet: string, url: string): { ok: boolean; error?: string } {
    const normalized = wallet.toLowerCase();

    // Validate URL
    if (!url || url.length > MAX_URL_LENGTH) {
      return { ok: false, error: `URL must be 1-${MAX_URL_LENGTH} characters` };
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: 'Invalid URL format' };
    }

    if (parsed.protocol !== 'https:') {
      return { ok: false, error: 'Only HTTPS URLs are allowed' };
    }

    // Block private/reserved IPs
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('172.') ||
      hostname.endsWith('.local')
    ) {
      return { ok: false, error: 'Private/local URLs are not allowed' };
    }

    // Cap total webhooks
    if (!this.webhooks.has(normalized) && this.webhooks.size >= MAX_WEBHOOKS) {
      return { ok: false, error: 'Webhook registry is full' };
    }

    this.webhooks.set(normalized, {
      wallet: normalized,
      url,
      registeredAt: Date.now(),
      deliveries: 0,
      failures: 0,
      lastDeliveryAt: null,
    });

    console.log(`WebhookRegistry: Registered webhook for ${normalized.slice(0, 10)}... → ${parsed.hostname}`);
    return { ok: true };
  }

  /**
   * Remove a webhook for a wallet.
   */
  unregister(wallet: string): boolean {
    return this.webhooks.delete(wallet.toLowerCase());
  }

  /**
   * Get webhook info for a wallet (or null if not registered).
   */
  get(wallet: string): WebhookEntry | null {
    return this.webhooks.get(wallet.toLowerCase()) ?? null;
  }

  /**
   * Get total registered webhook count.
   */
  get size(): number {
    return this.webhooks.size;
  }

  /**
   * Deliver a tournament notification to all registered webhooks.
   * Best-effort, fire-and-forget. Failed deliveries are logged but not retried.
   */
  async deliverAll(notification: TournamentNotification): Promise<void> {
    if (this.webhooks.size === 0) return;

    const payload = JSON.stringify({
      event: 'tournament:created',
      tournament: notification,
      timestamp: Math.floor(Date.now() / 1000),
    });

    const entries = [...this.webhooks.values()];
    const results = await Promise.allSettled(
      entries.map(entry => this.deliver(entry, payload))
    );

    let delivered = 0;
    let failed = 0;
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        delivered++;
      } else {
        failed++;
      }
    }

    if (delivered > 0 || failed > 0) {
      console.log(`WebhookRegistry: Delivered tournament #${notification.tournamentId} to ${delivered}/${entries.length} webhooks (${failed} failed)`);
    }
  }

  private async deliver(entry: WebhookEntry, payload: string): Promise<boolean> {
    try {
      const response = await fetch(entry.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });

      entry.deliveries++;
      entry.lastDeliveryAt = Date.now();

      if (!response.ok) {
        entry.failures++;
        console.warn(`WebhookRegistry: ${entry.wallet.slice(0, 10)}... returned ${response.status}`);
        return false;
      }

      return true;
    } catch (err) {
      entry.failures++;
      entry.deliveries++;
      entry.lastDeliveryAt = Date.now();
      return false;
    }
  }
}
