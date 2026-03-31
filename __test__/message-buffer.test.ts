import { describe, it, expect, vi, beforeEach } from "vitest";
import { MultiTableBuffer } from "../src/message-buffer.js";
import type { FlussClientManager } from "../src/fluss-client.js";
import type { FlussHookConfig, PluginLogger } from "../src/types.js";

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
    ensureConnected: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as FlussClientManager;
}

function createConfig(overrides?: Partial<FlussHookConfig>): FlussHookConfig {
  return {
    bootstrapServers: "localhost:9223",
    databaseName: "test_db",
    tablePrefix: "hook_",
    batchSize: 3,
    flushIntervalMs: 1000,
    autoCreateTable: true,
    bucketCount: 4,
    ...overrides,
  };
}

function createRow(id: number): Record<string, unknown> {
  return { agent_id: `agent-${id}`, timestamp: Date.now() };
}

describe("MultiTableBuffer", () => {
  let client: ReturnType<typeof createMockFlussClient>;
  let logger: PluginLogger;

  beforeEach(() => {
    client = createMockFlussClient();
    logger = createMockLogger();
  });

  it("buffers rows without immediate flush", () => {
    const buffer = new MultiTableBuffer(client, createConfig(), logger);

    buffer.push("agent_end", createRow(1));
    buffer.push("agent_end", createRow(2));

    expect(client.appendBatch).not.toHaveBeenCalled();
  });

  it("triggers flush when batch size reached for a specific table", async () => {
    const buffer = new MultiTableBuffer(client, createConfig({ batchSize: 2 }), logger);

    buffer.push("agent_end", createRow(1));
    buffer.push("agent_end", createRow(2));

    await vi.waitFor(() => {
      expect(client.appendBatch).toHaveBeenCalledTimes(1);
    });

    expect(client.appendBatch).toHaveBeenCalledWith("agent_end", expect.any(Array));
    const batch = (client.appendBatch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(batch).toHaveLength(2);
  });

  it("keeps separate buffers per table", async () => {
    const buffer = new MultiTableBuffer(client, createConfig({ batchSize: 2 }), logger);

    buffer.push("agent_end", createRow(1));
    buffer.push("session_start", createRow(2));

    // Neither should trigger (each has only 1 row, batchSize=2)
    expect(client.appendBatch).not.toHaveBeenCalled();

    // Now push one more to agent_end to trigger flush
    buffer.push("agent_end", createRow(3));

    await vi.waitFor(() => {
      expect(client.appendBatch).toHaveBeenCalledTimes(1);
    });

    expect(client.appendBatch).toHaveBeenCalledWith("agent_end", expect.any(Array));
  });

  it("flushAll sends all tables", async () => {
    const buffer = new MultiTableBuffer(client, createConfig({ batchSize: 100 }), logger);

    buffer.push("agent_end", createRow(1));
    buffer.push("session_start", createRow(2));
    buffer.push("message_received", createRow(3));

    await buffer.flushAll();

    expect(client.appendBatch).toHaveBeenCalledTimes(3);
    const hookNames = (client.appendBatch as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(hookNames).toContain("agent_end");
    expect(hookNames).toContain("session_start");
    expect(hookNames).toContain("message_received");
  });

  it("flushTable skips when buffer is empty", async () => {
    const buffer = new MultiTableBuffer(client, createConfig(), logger);

    await buffer.flushTable("agent_end");

    expect(client.appendBatch).not.toHaveBeenCalled();
  });

  it("logs error on flush failure without throwing", async () => {
    const failClient = createMockFlussClient({
      appendBatch: vi.fn().mockRejectedValue(new Error("connection lost")),
    });
    const buffer = new MultiTableBuffer(failClient, createConfig({ batchSize: 100 }), logger);

    buffer.push("agent_end", createRow(1));
    await buffer.flushTable("agent_end");

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("connection lost"),
    );
  });

  it("stop() flushes remaining and closes client", async () => {
    const buffer = new MultiTableBuffer(client, createConfig({ batchSize: 100 }), logger);
    buffer.start();

    buffer.push("agent_end", createRow(1));
    buffer.push("session_end", createRow(2));

    await buffer.stop();

    expect(client.appendBatch).toHaveBeenCalledTimes(2);
    expect(client.close).toHaveBeenCalled();
  });

  it("warns when per-table buffer exceeds max size", () => {
    const buffer = new MultiTableBuffer(
      client,
      createConfig({ batchSize: 20000 }),
      logger,
    );

    for (let i = 0; i < 10001; i++) {
      buffer.push("agent_end", createRow(i));
    }

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Buffer full for agent_end"),
    );
  });
});
