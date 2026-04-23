import type { FlussHookConfig, PluginHookName, PluginLogger } from "./types.js";
import type { EventSink } from "./sink.js";

const MAX_BUFFER_SIZE_PER_TABLE = 10000;

/**
 * 多表内存缓冲区，批量刷写到 Fluss。
 *
 * 每种 hook 类型拥有独立的缓冲区。当批次大小达到阈值或定时器触发时执行刷写。
 * 所有错误会被捕获并记录日志，不会阻塞事件流。
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
   * 将一行数据推入指定 hook 表的缓冲区。
   * 当批次大小达到阈值时触发异步刷写。
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
   * 启动定时刷写计时器。
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
   * 清除定时刷写计时器，不执行最终刷写。
   */
  clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 停止定时刷写计时器，执行最终刷写并关闭客户端。
   */
  async stop(): Promise<void> {
    this.clearTimer();
    await this.flushAll();
    this.sink.close();
    this.logger.info("[fluss-hook] Buffer stopped");
  }

  /**
   * 刷写所有有缓冲数据的表。
   */
  async flushAll(): Promise<void> {
    const hookNames = Array.from(this.buffers.keys());
    await Promise.all(hookNames.map((name) => this.flushTable(name)));
  }

  /**
   * 刷写指定 hook 表的缓冲数据。
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
