import type { FlussHookConfig, FlussMessageRow, PluginLogger } from "./types.js";
import type { FlussClientManager } from "./fluss-client.js";

const MAX_BUFFER_SIZE = 10000;

/**
 * In-memory message buffer with batch flushing to Fluss.
 *
 * Messages are buffered and flushed either when the batch size is reached
 * or on a regular interval. All errors are caught and logged without
 * blocking the message flow.
 */
export class MessageBuffer {
  private buffer: FlussMessageRow[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private flussClient: FlussClientManager;
  private config: FlussHookConfig;
  private logger: PluginLogger;

  constructor(
    flussClient: FlussClientManager,
    config: FlussHookConfig,
    logger: PluginLogger,
  ) {
    this.flussClient = flussClient;
    this.config = config;
    this.logger = logger;
  }

  /**
   * Push a message row into the buffer.
   * Triggers an async flush if the batch size threshold is reached.
   */
  push(row: FlussMessageRow): void {
    // Drop oldest messages if buffer is full
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      this.buffer.shift();
      this.logger.warn("[fluss-hook] Buffer full, dropping oldest message");
    }

    this.buffer.push(row);

    if (this.buffer.length >= this.config.batchSize) {
      void this.flush();
    }
  }

  /**
   * Start the periodic flush timer.
   */
  start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      void this.flush();
    }, this.config.flushIntervalMs);

    this.logger.info(
      `[fluss-hook] Buffer started (batchSize=${this.config.batchSize}, flushInterval=${this.config.flushIntervalMs}ms)`,
    );
  }

  /**
   * Stop the periodic flush timer, perform a final flush, and close the client.
   */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // Final flush
    await this.flush();

    this.flussClient.close();
    this.logger.info("[fluss-hook] Buffer stopped");
  }

  /**
   * Flush all buffered messages to Fluss.
   * Errors are caught and logged without re-throwing.
   */
  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) {
      return;
    }

    this.flushing = true;
    const batch = this.buffer.splice(0);

    try {
      await this.flussClient.appendBatch(batch);
      this.logger.debug?.(
        `[fluss-hook] Flushed ${batch.length} messages to Fluss`,
      );
    } catch (err) {
      this.logger.error(
        `[fluss-hook] Flush failed (${batch.length} messages dropped): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.flushing = false;
    }
  }
}
