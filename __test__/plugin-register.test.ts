import { describe, it, expect, vi, beforeEach } from "vitest";
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

// Mock fluss-node to avoid native binary dependency in tests
vi.mock("fluss-node", () => ({
  Config: vi.fn(),
  FlussConnection: { create: vi.fn() },
  DatabaseDescriptor: vi.fn(),
  TablePath: vi.fn(),
}));

describe("plugin register & event capture", () => {
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
      id: "fluss-hook",
      name: "Fluss Message Logger",
      pluginConfig: {
        bootstrapServers: "localhost:9123",
        databaseName: "test_db",
        tableName: "test_table",
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

  it("registers message_received, message_sent, and agent_end hooks", () => {
    plugin.register(api);

    expect(api.on).toHaveBeenCalledWith("message_received", expect.any(Function));
    expect(api.on).toHaveBeenCalledWith("message_sent", expect.any(Function));
    expect(api.on).toHaveBeenCalledWith("agent_end", expect.any(Function));
    expect(handlers).toHaveProperty("message_received");
    expect(handlers).toHaveProperty("message_sent");
    expect(handlers).toHaveProperty("agent_end");
  });

  it("registers a service with start/stop", () => {
    plugin.register(api);

    expect(api.registerService).toHaveBeenCalledTimes(1);
    expect(services).toHaveLength(1);
    expect(services[0].id).toBe("fluss-hook");
    expect(typeof services[0].start).toBe("function");
    expect(typeof services[0].stop).toBe("function");
  });

  it("message_received handler does not throw", () => {
    plugin.register(api);

    const event: PluginHookMessageReceivedEvent = {
      from: "user-1",
      content: "Hello from test",
      timestamp: Date.now(),
    };
    const ctx: PluginHookMessageContext = {
      channelId: "test-channel",
      conversationId: "conv-1",
      accountId: "acc-1",
    };

    // Should not throw — the handler pushes to buffer
    expect(() => handlers.message_received(event, ctx)).not.toThrow();
  });

  it("message_sent handler does not throw", () => {
    plugin.register(api);

    const event: PluginHookMessageSentEvent = {
      to: "user-1",
      content: "Response from AI",
      success: true,
    };
    const ctx: PluginHookMessageContext = {
      channelId: "test-channel",
      conversationId: "conv-1",
    };

    expect(() => handlers.message_sent(event, ctx)).not.toThrow();
  });

  it("agent_end handler does not throw", () => {
    plugin.register(api);

    const event: PluginHookAgentEndEvent = {
      messages: [
        { role: "assistant", content: [{ type: "text", text: "Hello" }], timestamp: 1000 },
      ],
      success: true,
      durationMs: 200,
    };
    const ctx: PluginHookAgentContext = {
      agentId: "main",
      sessionKey: "main:test",
    };

    expect(() => handlers.agent_end(event, ctx)).not.toThrow();
  });

  it("logs plugin registered message", () => {
    plugin.register(api);

    expect(logger.info).toHaveBeenCalledWith("[fluss-hook] Plugin registered");
  });
});
