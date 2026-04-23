import type { FlussHookConfig, PluginHookName, PluginLogger } from "./types.js";
import type { EventSink } from "./sink.js";

const MAX_BUFFER_SIZE_PER_TABLE = 10000;

/**
 * Multi-table in-memory buffer with batch flushing to Fluss.
 *
 * Each hook type has its own buffer. Rows are flushed either when
 * the batch size is reached or on a regular interval.
 * All errors are caught and logged without blocking the event flow.
 */
export class MultiTableBuffer {
  private buffers: Map<PluginHookName, Record<string, unknown>[]> = new Map();
  private flushing: Set<PluginHookName> = new Set();
  private timer: ReturnType<typeof setInterval> | null = null;
  private sink: EventSink;
  private config: FlussHookConfig;
  private logger: PluginLogger;

  constructor(
    sink: EventSink,
    config: FlussHookConfig,
    logger: PluginLogger,
  ) {
    this.sink = sink;
    this.config = config;
    this.logger = logger;
  }

  /**
   * Push a row into the buffer for a specific hook table.
   * Triggers an async flush if the batch size threshold is reached.
   */
  push(hookName: PluginHookName, row: Record<string, unknown>): void {
    let buffer = this.buffers.get(hookName);
    if (!buffer) {
      buffer = [];
      this.buffers.set(hookName, buffer);
    }

    if (buffer.length >= MAX_BUFFER_SIZE_PER_TABLE) {
      buffer.shift();
      this.logger.warn(
        `[fluss-hook] Buffer full for ${hookName}, dropping oldest row`,
      );
    }

    buffer.push(row);

    if (buffer.length >= this.config.batchSize) {
      void this.flushTable(hookName);
    }
  }

  /**
   * Start the periodic flush timer.
   */
  start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      void this.flushAll();
    }, this.config.flushIntervalMs);

    this.logger.info(
      `[fluss-hook] Buffer started (batchSize=${this.config.batchSize}, flushInterval=${this.config.flushIntervalMs}ms)`,
    );
  }

  /**
   * Clear the periodic flush timer without performing a final flush.
   */
  clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Stop the periodic flush timer, perform a final flush, and close the client.
   */
  async stop(): Promise<void> {
    this.clearTimer();
    await this.flushAll();
    this.sink.close();
    this.logger.info("[fluss-hook] Buffer stopped");
  }

  /**
   * Flush all tables that have buffered rows.
   */
  async flushAll(): Promise<void> {
    const hookNames = Array.from(this.buffers.keys());
    await Promise.all(hookNames.map((name) => this.flushTable(name)));
  }

  /**
   * Flush buffered rows for a specific hook table.
   */
  async flushTable(hookName: PluginHookName): Promise<void> {
    const buffer = this.buffers.get(hookName);
    if (!buffer || buffer.length === 0 || this.flushing.has(hookName)) {
      return;
    }

    this.flushing.add(hookName);
    const batch = buffer.splice(0);

    try {
      await this.sink.appendBatch(hookName, batch);
      this.logger.debug?.(
        `[fluss-hook] Flushed ${batch.length} rows to ${hookName}`,
      );
    } catch (err) {
      this.logger.error(
        `[fluss-hook] Flush failed for ${hookName} (${batch.length} rows dropped): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.flushing.delete(hookName);
    }
  }
}
