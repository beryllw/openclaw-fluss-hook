import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import plugin from "../index.js";
import type {
  OpenClawPluginApi,
  PluginLogger,
  PluginService,
  PluginHookMessageReceivedEvent,
  PluginHookMessageSentEvent,
  PluginHookMessageContext,
  PluginHookAgentEndEvent,
  PluginHookAgentContext,
} from "../src/types.js";

/**
 * End-to-end integration test for the fluss-hook plugin.
 *
 * Simulates the full lifecycle:
 *   register → start service → fire events → verify Fluss writes
 *
 * Uses mock FlussClientManager (via fluss-node mock) to capture what
 * would be written to Fluss.
 */

// Track all Fluss operations
const flussOps = {
  connected: false,
  dbCreated: false,
  tableCreated: false,
  appendedRows: [] as Record<string, unknown>[],
  flushed: 0,
};

// Mock fluss-node with a functional fake
vi.mock("fluss-node", () => {
  return {
    Config: vi.fn().mockImplementation((opts: Record<string, string>) => ({
      _opts: opts,
    })),
    FlussConnection: {
      create: vi.fn().mockImplementation(async () => {
        flussOps.connected = true;
        return {
          getAdmin: () => ({
            databaseExists: vi.fn().mockResolvedValue(false),
            createDatabase: vi.fn().mockImplementation(async () => {
              flussOps.dbCreated = true;
            }),
            tableExists: vi.fn().mockResolvedValue(false),
            createTable: vi.fn().mockImplementation(async () => {
              flussOps.tableCreated = true;
            }),
          }),
          getTable: vi.fn().mockImplementation(async () => ({
            newAppend: () => ({
              createWriter: () => ({
                append: (row: Record<string, unknown>) => {
                  flussOps.appendedRows.push({ ...row });
                },
                flush: async () => {
                  flussOps.flushed++;
                },
              }),
            }),
          })),
          close: vi.fn(),
        };
      }),
    },
    DatabaseDescriptor: vi.fn().mockImplementation((desc: string) => ({
      _desc: desc,
    })),
    TablePath: vi.fn().mockImplementation((db: string, table: string) => ({
      _db: db,
      _table: table,
    })),
    Schema: {
      builder: () => {
        const cols: string[] = [];
        const builder = {
          column: (name: string) => {
            cols.push(name);
            return builder;
          },
          build: () => ({ _cols: cols }),
        };
        return builder;
      },
    },
    DataTypes: {
      string: () => "STRING",
      boolean: () => "BOOLEAN",
      bigint: () => "BIGINT",
    },
    TableDescriptor: {
      builder: () => {
        const b = {
          schema: () => b,
          distributedBy: () => b,
          property: () => b,
          build: () => ({}),
        };
        return b;
      },
    },
  };
});

function createLogger(): PluginLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("fluss-hook plugin end-to-end", () => {
  let handlers: Record<string, Function>;
  let services: PluginService[];
  let logger: PluginLogger;

  beforeEach(() => {
    // Reset fluss operations tracker
    flussOps.connected = false;
    flussOps.dbCreated = false;
    flussOps.tableCreated = false;
    flussOps.appendedRows = [];
    flussOps.flushed = 0;

    handlers = {};
    services = [];
    logger = createLogger();

    const api: OpenClawPluginApi = {
      id: "fluss-hook",
      name: "Fluss Message Logger",
      pluginConfig: {
        bootstrapServers: "coordinator-server:9123",
        databaseName: "openclaw",
        tableName: "message_logs",
        autoCreateTable: true,
        batchSize: 3,
        flushIntervalMs: 100, // fast for testing
      },
      logger,
      on: vi.fn((hookName: string, handler: Function) => {
        handlers[hookName] = handler;
      }),
      registerService: vi.fn((service: PluginService) => {
        services.push(service);
      }),
    };

    plugin.register(api);
  });

  afterEach(async () => {
    // Stop any running services
    for (const s of services) {
      if (s.stop) await s.stop({ config: {}, stateDir: "/tmp", logger });
    }
  });

  it("registers message hooks, agent_end hook, and a service", () => {
    expect(handlers).toHaveProperty("message_received");
    expect(handlers).toHaveProperty("message_sent");
    expect(handlers).toHaveProperty("agent_end");
    expect(services).toHaveLength(1);
    expect(services[0].id).toBe("fluss-hook");
  });

  it("events push messages into the buffer and flush writes to Fluss", async () => {
    // Start the service (starts periodic flush timer)
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    const ctx: PluginHookMessageContext = {
      channelId: "webchat",
      conversationId: "conv-1",
      accountId: "user-1",
    };

    // Simulate 3 incoming messages (equals batchSize, triggers flush)
    handlers.message_received(
      { from: "user-1", content: "Hello", timestamp: 1000 } satisfies PluginHookMessageReceivedEvent,
      ctx,
    );
    handlers.message_received(
      { from: "user-1", content: "How are you?", timestamp: 2000 } satisfies PluginHookMessageReceivedEvent,
      ctx,
    );
    handlers.message_received(
      { from: "user-1", content: "Third message", timestamp: 3000 } satisfies PluginHookMessageReceivedEvent,
      ctx,
    );

    // Wait for the batch-triggered flush (async, fire-and-forget)
    await vi.waitFor(
      () => {
        expect(flussOps.connected).toBe(true);
        expect(flussOps.flushed).toBeGreaterThanOrEqual(1);
      },
      { timeout: 3000 },
    );

    // Verify all 3 rows were appended
    expect(flussOps.appendedRows).toHaveLength(3);
    expect(flussOps.appendedRows[0]).toMatchObject({
      direction: "inbound",
      channel_id: "webchat",
      from_id: "user-1",
      content: "Hello",
    });
    expect(flussOps.appendedRows[2]).toMatchObject({
      content: "Third message",
    });

    // Verify auto-create was triggered
    expect(flussOps.dbCreated).toBe(true);
    expect(flussOps.tableCreated).toBe(true);
  });

  it("message_sent events produce outbound rows", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    const ctx: PluginHookMessageContext = {
      channelId: "webchat",
      conversationId: "conv-1",
    };

    // Send 3 outbound messages to trigger batch flush
    handlers.message_sent(
      { to: "user-1", content: "AI response 1", success: true } satisfies PluginHookMessageSentEvent,
      ctx,
    );
    handlers.message_sent(
      { to: "user-1", content: "AI response 2", success: true } satisfies PluginHookMessageSentEvent,
      ctx,
    );
    handlers.message_sent(
      { to: "user-1", content: "AI response 3", success: false, error: "model error" } satisfies PluginHookMessageSentEvent,
      ctx,
    );

    await vi.waitFor(
      () => {
        expect(flussOps.flushed).toBeGreaterThanOrEqual(1);
      },
      { timeout: 3000 },
    );

    expect(flussOps.appendedRows).toHaveLength(3);
    expect(flussOps.appendedRows[0]).toMatchObject({
      direction: "outbound",
      to_id: "user-1",
      content: "AI response 1",
      success: true,
    });
    expect(flussOps.appendedRows[2]).toMatchObject({
      success: false,
      error_message: "model error",
    });
  });

  it("periodic timer flushes partial batches", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    const ctx: PluginHookMessageContext = { channelId: "webchat" };

    // Push only 1 message (below batchSize=3)
    handlers.message_received(
      { from: "user-1", content: "Single message" } satisfies PluginHookMessageReceivedEvent,
      ctx,
    );

    // Wait for the periodic flush timer (100ms interval)
    await vi.waitFor(
      () => {
        expect(flussOps.flushed).toBeGreaterThanOrEqual(1);
      },
      { timeout: 3000 },
    );

    expect(flussOps.appendedRows).toHaveLength(1);
    expect(flussOps.appendedRows[0]).toMatchObject({
      content: "Single message",
    });
  });

  it("mixed inbound/outbound messages in correct order", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    const ctx: PluginHookMessageContext = {
      channelId: "webchat",
      conversationId: "conv-1",
    };

    handlers.message_received(
      { from: "user-1", content: "Hi" } satisfies PluginHookMessageReceivedEvent,
      ctx,
    );
    handlers.message_sent(
      { to: "user-1", content: "Hello! How can I help?", success: true } satisfies PluginHookMessageSentEvent,
      ctx,
    );
    handlers.message_received(
      { from: "user-1", content: "Tell me about Fluss" } satisfies PluginHookMessageReceivedEvent,
      ctx,
    );

    // Wait for periodic timer flush
    await vi.waitFor(
      () => {
        expect(flussOps.appendedRows.length).toBe(3);
      },
      { timeout: 3000 },
    );

    expect(flussOps.appendedRows[0]).toMatchObject({ direction: "inbound", content: "Hi" });
    expect(flussOps.appendedRows[1]).toMatchObject({ direction: "outbound", content: "Hello! How can I help?" });
    expect(flussOps.appendedRows[2]).toMatchObject({ direction: "inbound", content: "Tell me about Fluss" });
  });

  it("logs info on successful initialization", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    const ctx: PluginHookMessageContext = { channelId: "test" };
    handlers.message_received(
      { from: "u1", content: "trigger init" } satisfies PluginHookMessageReceivedEvent,
      ctx,
    );

    await vi.waitFor(
      () => {
        expect(flussOps.connected).toBe(true);
      },
      { timeout: 3000 },
    );

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Connected to Fluss"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Writer ready"),
    );
  });

  it("agent_end events extract user and assistant messages", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    const event: PluginHookAgentEndEvent = {
      messages: [
        { role: "user", content: [{ type: "text", text: "What is Fluss?" }], timestamp: 4000 },
        { role: "assistant", content: [{ type: "text", text: "Fluss is a streaming storage." }], timestamp: 5000 },
        { role: "user", content: [{ type: "text", text: "Tell me more" }], timestamp: 5500 },
        { role: "assistant", content: [{ type: "text", text: "It supports real-time analytics." }], timestamp: 6000 },
      ],
      success: true,
      durationMs: 1200,
    };
    const ctx: PluginHookAgentContext = {
      agentId: "main",
      sessionKey: "main:webchat-session",
      messageProvider: "bailian",
    };

    // Fire agent_end — produces 4 rows (2 user + 2 assistant)
    handlers.agent_end(event, ctx);

    // batchSize=3, so first 3 flush immediately, 4th on periodic timer
    await vi.waitFor(
      () => {
        expect(flussOps.appendedRows.length).toBe(4);
      },
      { timeout: 3000 },
    );
    expect(flussOps.appendedRows[0]).toMatchObject({
      direction: "inbound",
      content: "What is Fluss?",
      from_id: "user",
      conversation_id: "main:webchat-session",
      timestamp: 4000,
    });
    expect(flussOps.appendedRows[1]).toMatchObject({
      direction: "outbound",
      content: "Fluss is a streaming storage.",
      from_id: "main",
      success: true,
      timestamp: 5000,
    });
    expect(flussOps.appendedRows[2]).toMatchObject({
      direction: "inbound",
      content: "Tell me more",
    });
    expect(flussOps.appendedRows[3]).toMatchObject({
      direction: "outbound",
      content: "It supports real-time analytics.",
    });
  });

  it("webchat full flow: message_received + agent_end", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    // 1. User sends message via webchat (triggers message_received)
    handlers.message_received(
      { from: "webchat-user", content: "Hello AI", timestamp: 100 } satisfies PluginHookMessageReceivedEvent,
      { channelId: "webchat", conversationId: "conv-wc" } satisfies PluginHookMessageContext,
    );

    // 2. Agent processes and finishes (triggers agent_end with both messages)
    handlers.agent_end(
      {
        messages: [
          { role: "user", content: [{ type: "text", text: "Hello AI" }], timestamp: 100 },
          { role: "assistant", content: [{ type: "text", text: "Hello! I'm here to help." }], timestamp: 200 },
        ],
        success: true,
        durationMs: 100,
      } satisfies PluginHookAgentEndEvent,
      {
        agentId: "main",
        sessionKey: "main:conv-wc",
      } satisfies PluginHookAgentContext,
    );

    // Wait for periodic flush (3 messages: 1 from message_received + 2 from agent_end = batchSize)
    await vi.waitFor(
      () => {
        expect(flussOps.appendedRows.length).toBe(3);
      },
      { timeout: 3000 },
    );

    // Verify inbound from message_received
    expect(flussOps.appendedRows[0]).toMatchObject({
      direction: "inbound",
      channel_id: "webchat",
      from_id: "webchat-user",
      content: "Hello AI",
    });
    // Verify inbound from agent_end (duplicate of user message, with source marker)
    expect(flussOps.appendedRows[1]).toMatchObject({
      direction: "inbound",
      from_id: "user",
      content: "Hello AI",
    });
    // Verify outbound from agent_end
    expect(flussOps.appendedRows[2]).toMatchObject({
      direction: "outbound",
      from_id: "main",
      conversation_id: "main:conv-wc",
      content: "Hello! I'm here to help.",
    });
  });
});
