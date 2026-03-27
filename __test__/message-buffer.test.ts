import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageBuffer } from "../src/message-buffer.js";
import type { FlussClientManager } from "../src/fluss-client.js";
import type { FlussHookConfig, FlussMessageRow, PluginLogger } from "../src/types.js";

function createMockLogger(): PluginLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createMockFlussClient(overrides?: Partial<FlussClientManager>) {
  return {
    appendBatch: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    ensureReady: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as FlussClientManager;
}

function createConfig(overrides?: Partial<FlussHookConfig>): FlussHookConfig {
  return {
    bootstrapServers: "localhost:9223",
    databaseName: "test_db",
    tableName: "test_table",
    batchSize: 3,
    flushIntervalMs: 1000,
    autoCreateTable: true,
    bucketCount: 4,
    ...overrides,
  };
}

function createRow(id: number): FlussMessageRow {
  return {
    direction: "inbound",
    channel_id: "test",
    conversation_id: `conv-${id}`,
    account_id: "acc-1",
    from_id: `user-${id}`,
    to_id: "",
    content: `message ${id}`,
    success: true,
    error_message: "",
    metadata: "{}",
    timestamp: Date.now(),
  };
}

describe("MessageBuffer", () => {
  let client: ReturnType<typeof createMockFlussClient>;
  let logger: PluginLogger;

  beforeEach(() => {
    client = createMockFlussClient();
    logger = createMockLogger();
  });

  it("buffers messages without immediate flush", () => {
    const buffer = new MessageBuffer(client, createConfig(), logger);

    buffer.push(createRow(1));
    buffer.push(createRow(2));

    // batchSize=3, so 2 messages should not trigger flush
    expect(client.appendBatch).not.toHaveBeenCalled();
  });

  it("triggers flush when batch size reached", async () => {
    const buffer = new MessageBuffer(client, createConfig({ batchSize: 2 }), logger);

    buffer.push(createRow(1));
    buffer.push(createRow(2));

    // Wait for the fire-and-forget flush to complete
    await vi.waitFor(() => {
      expect(client.appendBatch).toHaveBeenCalledTimes(1);
    });

    const batch = (client.appendBatch as ReturnType<typeof vi.fn>).mock.calls[0][0] as FlussMessageRow[];
    expect(batch).toHaveLength(2);
    expect(batch[0].from_id).toBe("user-1");
    expect(batch[1].from_id).toBe("user-2");
  });

  it("flush() sends all buffered messages", async () => {
    const buffer = new MessageBuffer(client, createConfig({ batchSize: 100 }), logger);

    buffer.push(createRow(1));
    buffer.push(createRow(2));
    buffer.push(createRow(3));

    await buffer.flush();

    expect(client.appendBatch).toHaveBeenCalledTimes(1);
    const batch = (client.appendBatch as ReturnType<typeof vi.fn>).mock.calls[0][0] as FlussMessageRow[];
    expect(batch).toHaveLength(3);
  });

  it("flush() skips when buffer is empty", async () => {
    const buffer = new MessageBuffer(client, createConfig(), logger);

    await buffer.flush();

    expect(client.appendBatch).not.toHaveBeenCalled();
  });

  it("logs error on flush failure without throwing", async () => {
    const failClient = createMockFlussClient({
      appendBatch: vi.fn().mockRejectedValue(new Error("connection lost")),
    });
    const buffer = new MessageBuffer(failClient, createConfig({ batchSize: 100 }), logger);

    buffer.push(createRow(1));

    // Should not throw
    await buffer.flush();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("connection lost"),
    );
  });

  it("stop() flushes remaining and closes client", async () => {
    const buffer = new MessageBuffer(client, createConfig({ batchSize: 100 }), logger);
    buffer.start();

    buffer.push(createRow(1));
    buffer.push(createRow(2));

    await buffer.stop();

    expect(client.appendBatch).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalled();
  });

  it("warns when buffer exceeds max size", () => {
    const buffer = new MessageBuffer(
      client,
      createConfig({ batchSize: 20000 }),
      logger,
    );

    // Push more than MAX_BUFFER_SIZE (10000)
    for (let i = 0; i < 10001; i++) {
      buffer.push(createRow(i));
    }

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Buffer full"),
    );
  });
});
