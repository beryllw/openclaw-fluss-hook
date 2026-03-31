import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import plugin from "../index.js";
import type {
  OpenClawPluginApi,
  PluginLogger,
  PluginService,
  PluginHookName,
} from "../src/types.js";

/**
 * End-to-end integration test for the fluss-hook plugin (multi-table).
 *
 * Simulates the full lifecycle:
 *   register -> start service -> fire events -> verify Fluss writes
 *
 * Uses mock FlussClientManager (via fluss-node mock) to capture what
 * would be written to Fluss across multiple tables.
 */

// Track all Fluss operations per table
const flussOps = {
  connected: false,
  dbCreated: false,
  tablesCreated: new Set<string>(),
  // tableName -> rows[]
  appendedRows: new Map<string, Record<string, unknown>[]>(),
  flushed: 0,
};

function getRows(tableName: string): Record<string, unknown>[] {
  return flussOps.appendedRows.get(tableName) ?? [];
}

// Mock fluss-node with a functional fake supporting multi-table writers
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
            createTable: vi.fn().mockImplementation(async (_path: unknown, _desc: unknown) => {
              const p = _path as { _db: string; _table: string };
              flussOps.tablesCreated.add(p._table);
            }),
          }),
          getTable: vi.fn().mockImplementation(async (path: unknown) => {
            const p = path as { _db: string; _table: string };
            const tableName = p._table;
            return {
              newAppend: () => ({
                createWriter: () => ({
                  append: (row: Record<string, unknown>) => {
                    let rows = flussOps.appendedRows.get(tableName);
                    if (!rows) {
                      rows = [];
                      flussOps.appendedRows.set(tableName, rows);
                    }
                    rows.push({ ...row });
                  },
                  flush: async () => {
                    flussOps.flushed++;
                  },
                }),
              }),
            };
          }),
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
        const builder: Record<string, Function> = {
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
      int: () => "INT",
    },
    TableDescriptor: {
      builder: () => {
        const b: Record<string, Function> = {
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

describe("fluss-hook plugin end-to-end (multi-table)", () => {
  let handlers: Record<string, Function>;
  let services: PluginService[];
  let logger: PluginLogger;

  beforeEach(() => {
    flussOps.connected = false;
    flussOps.dbCreated = false;
    flussOps.tablesCreated.clear();
    flussOps.appendedRows.clear();
    flussOps.flushed = 0;

    handlers = {};
    services = [];
    logger = createLogger();

    const api: OpenClawPluginApi = {
      pluginConfig: {
        bootstrapServers: "coordinator-server:9123",
        databaseName: "openclaw",
        tablePrefix: "hook_",
        autoCreateTable: true,
        batchSize: 3,
        flushIntervalMs: 100,
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
    for (const s of services) {
      if (s.stop) await s.stop({ config: {}, stateDir: "/tmp", logger });
    }
  });

  it("registers all 14 hooks and a service", () => {
    const hookNames: PluginHookName[] = [
      "before_agent_start", "agent_end", "before_compaction", "after_compaction",
      "message_received", "message_sending", "message_sent",
      "before_tool_call", "after_tool_call", "tool_result_persist",
      "session_start", "session_end", "gateway_start", "gateway_stop",
    ];
    for (const name of hookNames) {
      expect(handlers).toHaveProperty(name);
    }
    expect(services).toHaveLength(1);
    expect(services[0].id).toBe("fluss-hook");
  });

  it("agent_end events write to hook_agent_end table", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    for (let i = 0; i < 3; i++) {
      handlers.agent_end(
        { messages: [{ role: "user", content: `msg-${i}` }], success: true, durationMs: i * 100 },
        { agentId: "main", sessionKey: "s1" },
      );
    }

    await vi.waitFor(() => {
      expect(flussOps.flushed).toBeGreaterThanOrEqual(1);
    }, { timeout: 3000 });

    const rows = getRows("hook_agent_end");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ success: true, agent_id: "main" });
  });

  it("message_received events write to hook_message_received table", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    for (let i = 0; i < 3; i++) {
      handlers.message_received(
        { from: `user-${i}`, content: `Hello ${i}`, timestamp: 1000 + i },
        { channelId: "webchat", conversationId: "conv-1" },
      );
    }

    await vi.waitFor(() => {
      expect(flussOps.flushed).toBeGreaterThanOrEqual(1);
    }, { timeout: 3000 });

    const rows = getRows("hook_message_received");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      from_id: "user-0",
      content: "Hello 0",
      channel_id: "webchat",
    });
  });

  it("different hook types write to separate tables", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    handlers.agent_end(
      { messages: [], success: true },
      { agentId: "main" },
    );
    handlers.session_start(
      { sessionId: "s1" },
      { sessionId: "s1" },
    );
    handlers.gateway_start(
      { port: 3000 },
      { port: 3000 },
    );

    await vi.waitFor(() => {
      // Wait for periodic timer flush
      expect(flussOps.flushed).toBeGreaterThanOrEqual(3);
    }, { timeout: 3000 });

    expect(getRows("hook_agent_end")).toHaveLength(1);
    expect(getRows("hook_session_start")).toHaveLength(1);
    expect(getRows("hook_gateway_start")).toHaveLength(1);
  });

  it("tool hooks write to separate tables", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    // Fire 3 before_tool_call events to trigger batch flush
    for (let i = 0; i < 3; i++) {
      handlers.before_tool_call(
        { toolName: `tool-${i}`, params: { x: i } },
        { agentId: "a1", sessionKey: "s1", toolName: `tool-${i}` },
      );
    }

    await vi.waitFor(() => {
      expect(getRows("hook_before_tool_call")).toHaveLength(3);
    }, { timeout: 3000 });

    expect(getRows("hook_before_tool_call")[0]).toMatchObject({
      tool_name: "tool-0",
      agent_id: "a1",
    });
  });

  it("periodic timer flushes partial batches across tables", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    // Push 1 row each to 3 tables (below batchSize=3)
    handlers.agent_end(
      { messages: [], success: true },
      { agentId: "main" },
    );
    handlers.session_start(
      { sessionId: "s1" },
      { sessionId: "s1" },
    );

    await vi.waitFor(() => {
      expect(flussOps.flushed).toBeGreaterThanOrEqual(2);
    }, { timeout: 3000 });

    expect(getRows("hook_agent_end")).toHaveLength(1);
    expect(getRows("hook_session_start")).toHaveLength(1);
  });

  it("auto-creates database and tables", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    handlers.agent_end(
      { messages: [], success: true },
      { agentId: "main" },
    );

    await vi.waitFor(() => {
      expect(flussOps.connected).toBe(true);
      expect(flussOps.flushed).toBeGreaterThanOrEqual(1);
    }, { timeout: 3000 });

    expect(flussOps.dbCreated).toBe(true);
    expect(flussOps.tablesCreated).toContain("hook_agent_end");
  });

  it("logs connection and registration info", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    handlers.agent_end(
      { messages: [], success: true },
      {},
    );

    await vi.waitFor(() => {
      expect(flussOps.connected).toBe(true);
    }, { timeout: 3000 });

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Connected to Fluss"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Plugin registered (14 hooks)"),
    );
  });

  // ===========================================================================
  // All 14 hooks delivery verification
  // ===========================================================================

  it("before_agent_start delivers to hook_before_agent_start", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    handlers.before_agent_start(
      { prompt: "You are a helpful assistant", messages: [{ role: "system", content: "sys" }] },
      { agentId: "main", sessionKey: "s1", workspaceDir: "/ws", messageProvider: "bailian" },
    );

    await vi.waitFor(() => {
      expect(getRows("hook_before_agent_start")).toHaveLength(1);
    }, { timeout: 3000 });

    expect(getRows("hook_before_agent_start")[0]).toMatchObject({
      prompt: "You are a helpful assistant",
      agent_id: "main",
      session_key: "s1",
      workspace_dir: "/ws",
      message_provider: "bailian",
    });
  });

  it("agent_end delivers to hook_agent_end with correct fields", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    handlers.agent_end(
      { messages: [{ role: "user", content: "hi" }], success: false, error: "timeout", durationMs: 1234 },
      { agentId: "main", sessionKey: "s1", messageProvider: "openai" },
    );

    await vi.waitFor(() => {
      expect(getRows("hook_agent_end")).toHaveLength(1);
    }, { timeout: 3000 });

    const row = getRows("hook_agent_end")[0];
    expect(row).toMatchObject({
      success: false,
      error: "timeout",
      duration_ms: 1234,
      agent_id: "main",
      message_provider: "openai",
    });
    expect(row.messages).toContain('"role":"user"');
  });

  it("before_compaction delivers to hook_before_compaction", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    handlers.before_compaction(
      { messageCount: 50, tokenCount: 12000 },
      { agentId: "main", sessionKey: "s1" },
    );

    await vi.waitFor(() => {
      expect(getRows("hook_before_compaction")).toHaveLength(1);
    }, { timeout: 3000 });

    expect(getRows("hook_before_compaction")[0]).toMatchObject({
      message_count: 50,
      token_count: 12000,
      agent_id: "main",
    });
  });

  it("after_compaction delivers to hook_after_compaction", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    handlers.after_compaction(
      { messageCount: 50, tokenCount: 12000, compactedCount: 15 },
      { agentId: "main", sessionKey: "s1" },
    );

    await vi.waitFor(() => {
      expect(getRows("hook_after_compaction")).toHaveLength(1);
    }, { timeout: 3000 });

    expect(getRows("hook_after_compaction")[0]).toMatchObject({
      message_count: 50,
      token_count: 12000,
      compacted_count: 15,
      agent_id: "main",
    });
  });

  it("message_received delivers to hook_message_received with correct fields", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    handlers.message_received(
      { from: "user-42", content: "Hello world", timestamp: 9876, metadata: { lang: "zh" } },
      { channelId: "telegram", accountId: "acc-1", conversationId: "conv-99" },
    );

    await vi.waitFor(() => {
      expect(getRows("hook_message_received")).toHaveLength(1);
    }, { timeout: 3000 });

    expect(getRows("hook_message_received")[0]).toMatchObject({
      from_id: "user-42",
      content: "Hello world",
      event_timestamp: 9876,
      channel_id: "telegram",
      account_id: "acc-1",
      conversation_id: "conv-99",
    });
    expect(getRows("hook_message_received")[0].metadata).toContain('"lang":"zh"');
  });

  it("message_sending delivers to hook_message_sending", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    handlers.message_sending(
      { to: "user-1", content: "Processing your request", metadata: { priority: "high" } },
      { channelId: "slack", accountId: "acc-2", conversationId: "conv-5" },
    );

    await vi.waitFor(() => {
      expect(getRows("hook_message_sending")).toHaveLength(1);
    }, { timeout: 3000 });

    expect(getRows("hook_message_sending")[0]).toMatchObject({
      to_id: "user-1",
      content: "Processing your request",
      channel_id: "slack",
      account_id: "acc-2",
      conversation_id: "conv-5",
    });
  });

  it("message_sent delivers to hook_message_sent", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    handlers.message_sent(
      { to: "user-1", content: "Done", success: true },
      { channelId: "discord", conversationId: "conv-7" },
    );

    await vi.waitFor(() => {
      expect(getRows("hook_message_sent")).toHaveLength(1);
    }, { timeout: 3000 });

    expect(getRows("hook_message_sent")[0]).toMatchObject({
      to_id: "user-1",
      content: "Done",
      success: true,
      error: "",
      channel_id: "discord",
    });
  });

  it("message_sent delivers failure with error", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    handlers.message_sent(
      { to: "user-2", content: "Failed", success: false, error: "rate limited" },
      { channelId: "whatsapp" },
    );

    await vi.waitFor(() => {
      expect(getRows("hook_message_sent")).toHaveLength(1);
    }, { timeout: 3000 });

    expect(getRows("hook_message_sent")[0]).toMatchObject({
      success: false,
      error: "rate limited",
    });
  });

  it("before_tool_call delivers to hook_before_tool_call with correct fields", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    handlers.before_tool_call(
      { toolName: "web_search", params: { query: "fluss docs" } },
      { agentId: "main", sessionKey: "s1", toolName: "web_search" },
    );

    await vi.waitFor(() => {
      expect(getRows("hook_before_tool_call")).toHaveLength(1);
    }, { timeout: 3000 });

    const row = getRows("hook_before_tool_call")[0];
    expect(row).toMatchObject({
      tool_name: "web_search",
      agent_id: "main",
      context_tool_name: "web_search",
    });
    expect(row.params).toContain('"query":"fluss docs"');
  });

  it("after_tool_call delivers to hook_after_tool_call", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    handlers.after_tool_call(
      { toolName: "read_file", params: { path: "/tmp/a.txt" }, result: { content: "hello" }, durationMs: 42 },
      { agentId: "main", sessionKey: "s1", toolName: "read_file" },
    );

    await vi.waitFor(() => {
      expect(getRows("hook_after_tool_call")).toHaveLength(1);
    }, { timeout: 3000 });

    const row = getRows("hook_after_tool_call")[0];
    expect(row).toMatchObject({
      tool_name: "read_file",
      duration_ms: 42,
      error: "",
      agent_id: "main",
    });
    expect(row.result).toContain('"content":"hello"');
  });

  it("after_tool_call delivers error case", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    handlers.after_tool_call(
      { toolName: "exec", params: { cmd: "ls" }, error: "permission denied", durationMs: 5 },
      { agentId: "main", sessionKey: "s1", toolName: "exec" },
    );

    await vi.waitFor(() => {
      expect(getRows("hook_after_tool_call")).toHaveLength(1);
    }, { timeout: 3000 });

    expect(getRows("hook_after_tool_call")[0]).toMatchObject({
      tool_name: "exec",
      error: "permission denied",
      duration_ms: 5,
    });
  });

  it("tool_result_persist delivers to hook_tool_result_persist", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    handlers.tool_result_persist(
      { toolName: "read_file", toolCallId: "tc-123", message: { text: "file content" }, isSynthetic: false },
      { agentId: "main", sessionKey: "s1", toolName: "read_file", toolCallId: "tc-123" },
    );

    await vi.waitFor(() => {
      expect(getRows("hook_tool_result_persist")).toHaveLength(1);
    }, { timeout: 3000 });

    expect(getRows("hook_tool_result_persist")[0]).toMatchObject({
      tool_name: "read_file",
      tool_call_id: "tc-123",
      is_synthetic: false,
      ctx_tool_name: "read_file",
      ctx_tool_call_id: "tc-123",
    });
  });

  it("session_start delivers to hook_session_start", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    handlers.session_start(
      { sessionId: "sess-abc", resumedFrom: "sess-old" },
      { agentId: "main", sessionId: "sess-abc" },
    );

    await vi.waitFor(() => {
      expect(getRows("hook_session_start")).toHaveLength(1);
    }, { timeout: 3000 });

    expect(getRows("hook_session_start")[0]).toMatchObject({
      session_id: "sess-abc",
      resumed_from: "sess-old",
      agent_id: "main",
      context_session_id: "sess-abc",
    });
  });

  it("session_end delivers to hook_session_end", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    handlers.session_end(
      { sessionId: "sess-abc", messageCount: 42, durationMs: 300000 },
      { agentId: "main", sessionId: "sess-abc" },
    );

    await vi.waitFor(() => {
      expect(getRows("hook_session_end")).toHaveLength(1);
    }, { timeout: 3000 });

    expect(getRows("hook_session_end")[0]).toMatchObject({
      session_id: "sess-abc",
      message_count: 42,
      duration_ms: 300000,
      agent_id: "main",
      context_session_id: "sess-abc",
    });
  });

  it("gateway_start delivers to hook_gateway_start", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    handlers.gateway_start(
      { port: 18789 },
      { port: 18789 },
    );

    await vi.waitFor(() => {
      expect(getRows("hook_gateway_start")).toHaveLength(1);
    }, { timeout: 3000 });

    expect(getRows("hook_gateway_start")[0]).toMatchObject({
      port: 18789,
      context_port: 18789,
    });
  });

  it("gateway_stop delivers to hook_gateway_stop", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    handlers.gateway_stop(
      { reason: "SIGTERM" },
      { port: 18789 },
    );

    await vi.waitFor(() => {
      expect(getRows("hook_gateway_stop")).toHaveLength(1);
    }, { timeout: 3000 });

    expect(getRows("hook_gateway_stop")[0]).toMatchObject({
      reason: "SIGTERM",
      context_port: 18789,
    });
  });

  // ===========================================================================
  // Full coverage: fire all 14 hooks in one test, verify all tables have data
  // ===========================================================================

  it("all 14 hook types deliver to their respective tables", async () => {
    services[0].start({ config: {}, stateDir: "/tmp", logger });

    // Agent hooks
    handlers.before_agent_start(
      { prompt: "test prompt" },
      { agentId: "a1" },
    );
    handlers.agent_end(
      { messages: [], success: true, durationMs: 100 },
      { agentId: "a1" },
    );
    handlers.before_compaction(
      { messageCount: 10 },
      { agentId: "a1" },
    );
    handlers.after_compaction(
      { messageCount: 10, compactedCount: 3 },
      { agentId: "a1" },
    );

    // Message hooks
    handlers.message_received(
      { from: "u1", content: "hi" },
      { channelId: "webchat" },
    );
    handlers.message_sending(
      { to: "u1", content: "reply" },
      { channelId: "webchat" },
    );
    handlers.message_sent(
      { to: "u1", content: "reply", success: true },
      { channelId: "webchat" },
    );

    // Tool hooks
    handlers.before_tool_call(
      { toolName: "search", params: {} },
      { toolName: "search" },
    );
    handlers.after_tool_call(
      { toolName: "search", params: {}, result: "ok" },
      { toolName: "search" },
    );
    handlers.tool_result_persist(
      { message: "result" },
      {},
    );

    // Session hooks
    handlers.session_start(
      { sessionId: "s1" },
      { sessionId: "s1" },
    );
    handlers.session_end(
      { sessionId: "s1", messageCount: 5 },
      { sessionId: "s1" },
    );

    // Gateway hooks
    handlers.gateway_start(
      { port: 3000 },
      {},
    );
    handlers.gateway_stop(
      { reason: "shutdown" },
      {},
    );

    // Wait for all periodic flushes
    await vi.waitFor(() => {
      expect(flussOps.flushed).toBeGreaterThanOrEqual(14);
    }, { timeout: 5000 });

    // Verify every table has exactly 1 row
    const expectedTables = [
      "hook_before_agent_start",
      "hook_agent_end",
      "hook_before_compaction",
      "hook_after_compaction",
      "hook_message_received",
      "hook_message_sending",
      "hook_message_sent",
      "hook_before_tool_call",
      "hook_after_tool_call",
      "hook_tool_result_persist",
      "hook_session_start",
      "hook_session_end",
      "hook_gateway_start",
      "hook_gateway_stop",
    ];

    for (const table of expectedTables) {
      const rows = getRows(table);
      expect(rows, `Expected ${table} to have 1 row, got ${rows.length}`).toHaveLength(1);
    }

    // Verify each row has a timestamp
    for (const table of expectedTables) {
      const row = getRows(table)[0];
      expect(row.timestamp, `Expected ${table} row to have timestamp`).toBeGreaterThan(0);
    }
  });
});
