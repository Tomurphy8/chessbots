import { type PublicClient, type Address, type AbiEvent, type Log } from 'viem';

/**
 * Reusable chunked event scanner for Monad's 100-block eth_getLogs limit.
 * Scans forward from a deploy block to latest, yielding batches of logs.
 * Uses parallel chunk requests for throughput while respecting RPC limits.
 */
export class EventScanner {
  private publicClient: PublicClient;
  private contractAddress: Address;
  private deployBlock: bigint;

  // Monad limits getLogs to 100-block range
  private static readonly CHUNK_SIZE = 99n;
  // Concurrent requests per batch
  private static readonly PARALLEL_BATCH = 5;

  constructor(publicClient: PublicClient, contractAddress: Address, deployBlock: bigint) {
    this.publicClient = publicClient;
    this.contractAddress = contractAddress;
    this.deployBlock = deployBlock;
  }

  /**
   * Scan events from `fromBlock` to `toBlock` (defaults to deploy block → latest).
   * Returns all matching logs.
   */
  async scan(
    eventAbi: AbiEvent,
    fromBlock?: bigint,
    toBlock?: bigint,
    args?: Record<string, unknown>,
  ): Promise<Log[]> {
    const start = fromBlock ?? this.deployBlock;
    const end = toBlock ?? await this.publicClient.getBlockNumber();

    if (start > end) return [];

    const allLogs: Log[] = [];
    const totalChunks = Number((end - start) / EventScanner.CHUNK_SIZE) + 1;
    let processedChunks = 0;

    // Process chunks in parallel batches
    let cursor = start;
    while (cursor <= end) {
      const batch: Array<{ from: bigint; to: bigint }> = [];
      for (let i = 0; i < EventScanner.PARALLEL_BATCH && cursor <= end; i++) {
        const chunkEnd = cursor + EventScanner.CHUNK_SIZE > end ? end : cursor + EventScanner.CHUNK_SIZE;
        batch.push({ from: cursor, to: chunkEnd });
        cursor = chunkEnd + 1n;
      }

      const results = await Promise.allSettled(
        batch.map(({ from, to }) =>
          this.publicClient.getLogs({
            address: this.contractAddress,
            event: eventAbi,
            fromBlock: from,
            toBlock: to,
            ...(args ? { args } : {}),
          } as any)
        )
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.length > 0) {
          allLogs.push(...result.value);
        }
      }

      processedChunks += batch.length;

      // Progress logging every 500 chunks
      if (processedChunks % 500 === 0 || processedChunks === totalChunks) {
        const pct = ((processedChunks / totalChunks) * 100).toFixed(1);
        console.log(`  EventScanner: ${processedChunks}/${totalChunks} chunks (${pct}%) — ${allLogs.length} events found`);
      }
    }

    return allLogs;
  }

  /**
   * Get the current latest block number.
   */
  async getLatestBlock(): Promise<bigint> {
    return this.publicClient.getBlockNumber();
  }
}
