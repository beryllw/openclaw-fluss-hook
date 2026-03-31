import { describe, it, expect, vi, beforeEach } from "vitest";
import plugin from "../index.js";
import type {
  OpenClawPluginApi,
  PluginLogger,
  PluginService,
  PluginHookName,
} from "../src/types.js";

// Mock fluss-node to avoid native binary dependency in tests
vi.mock("fluss-node", () => ({
  Config: vi.fn(),
  FlussConnection: { create: vi.fn() },
  DatabaseDescriptor: vi.fn(),
  TablePath: vi.fn(),
  Schema: {
    builder: () => {
      const b: Record<string, Function> = {
        column: () => b,
        build: () => ({}),
      };
      return b;
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
}));

const ALL_HOOK_NAMES: PluginHookName[] = [
  "before_agent_start",
  "agent_end",
  "before_compaction",
  "after_compaction",
  "message_received",
  "message_sending",
  "message_sent",
  "before_tool_call",
  "after_tool_call",
  "tool_result_persist",
  "session_start",
  "session_end",
  "gateway_start",
  "gateway_stop",
];

describe("plugin register & hook registration", () => {
  let handlers: Record<string, Function>;
  let services: PluginService[];
  let logger: PluginLogger;
  let api: OpenClawPluginApi;

  beforeEach(() => {
    handlers = {};
    services = [];
    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    api = {
      pluginConfig: {
        bootstrapServers: "localhost:9123",
        databaseName: "test_db",
        tablePrefix: "hook_",
        autoCreateTable: true,
        batchSize: 10,
        flushIntervalMs: 3000,
      },
      logger,
      on: vi.fn((hookName: string, handler: Function) => {
        handlers[hookName] = handler;
      }),
      registerService: vi.fn((service: PluginService) => {
        services.push(service);
      }),
    };
  });

  it("registers all 14 hooks", () => {
    plugin.register(api);

    expect(api.on).toHaveBeenCalledTimes(14);
    for (const hookName of ALL_HOOK_NAMES) {
      expect(api.on).toHaveBeenCalledWith(hookName, expect.any(Function));
      expect(handlers).toHaveProperty(hookName);
    }
  });

  it("registers a service with start/stop", () => {
    plugin.register(api);

    expect(api.registerService).toHaveBeenCalledTimes(1);
    expect(services).toHaveLength(1);
    expect(services[0].id).toBe("fluss-hook");
    expect(typeof services[0].start).toBe("function");
    expect(typeof services[0].stop).toBe("function");
  });

  it("all hook handlers do not throw", () => {
    plugin.register(api);

    // Agent hooks
    expect(() => handlers.before_agent_start({ prompt: "test" }, {})).not.toThrow();
    expect(() => handlers.agent_end({ messages: [], success: true }, {})).not.toThrow();
    expect(() => handlers.before_compaction({ messageCount: 1 }, {})).not.toThrow();
    expect(() => handlers.after_compaction({ messageCount: 1, compactedCount: 0 }, {})).not.toThrow();

    // Message hooks
    expect(() => handlers.message_received({ from: "u1", content: "hi" }, { channelId: "c1" })).not.toThrow();
    expect(() => handlers.message_sending({ to: "u1", content: "hi" }, { channelId: "c1" })).not.toThrow();
    expect(() => handlers.message_sent({ to: "u1", content: "hi", success: true }, { channelId: "c1" })).not.toThrow();

    // Tool hooks
    expect(() => handlers.before_tool_call({ toolName: "t", params: {} }, { toolName: "t" })).not.toThrow();
    expect(() => handlers.after_tool_call({ toolName: "t", params: {} }, { toolName: "t" })).not.toThrow();
    expect(() => handlers.tool_result_persist({ message: "m" }, {})).not.toThrow();

    // Session hooks
    expect(() => handlers.session_start({ sessionId: "s1" }, { sessionId: "s1" })).not.toThrow();
    expect(() => handlers.session_end({ sessionId: "s1", messageCount: 1 }, { sessionId: "s1" })).not.toThrow();

    // Gateway hooks
    expect(() => handlers.gateway_start({ port: 3000 }, {})).not.toThrow();
    expect(() => handlers.gateway_stop({}, {})).not.toThrow();
  });

  it("logs plugin registered message", () => {
    plugin.register(api);

    expect(logger.info).toHaveBeenCalledWith("[fluss-hook] Plugin registered (14 hooks)");
  });
});
