/**
 * In-memory ring buffer for agent error/log entries.
 * Agents POST logs here; admin UI reads them.
 * No disk persistence — ephemeral by design.
 */

export interface ErrorEntry {
  id: number;
  wallet: string;
  level: 'error' | 'warn' | 'info';
  message: string;
  context?: Record<string, unknown>;
  timestamp: number;
}

const MAX_ENTRIES = 1000;

export class ErrorStore {
  private entries: ErrorEntry[] = [];
  private nextId = 1;

  /**
   * Add a log entry. Oldest entries are evicted when buffer is full.
   */
  add(wallet: string, level: ErrorEntry['level'], message: string, context?: Record<string, unknown>): ErrorEntry {
    const entry: ErrorEntry = {
      id: this.nextId++,
      wallet,
      level,
      message: message.slice(0, 2000), // cap message length
      context,
      timestamp: Date.now(),
    };

    this.entries.push(entry);

    // Evict oldest when over capacity
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }

    return entry;
  }

  /**
   * Query entries with optional filters.
   */
  query(opts?: { wallet?: string; level?: string; limit?: number }): ErrorEntry[] {
    let result = [...this.entries];

    if (opts?.wallet) {
      const w = opts.wallet.toLowerCase();
      result = result.filter(e => e.wallet.toLowerCase() === w);
    }
    if (opts?.level) {
      result = result.filter(e => e.level === opts.level);
    }

    // Newest first
    result.reverse();

    const limit = opts?.limit ?? 100;
    return result.slice(0, limit);
  }

  get size(): number {
    return this.entries.length;
  }
}
