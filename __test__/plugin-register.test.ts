import { describe, it, expect, vi, beforeEach } from "vitest";
import plugin, { __testResetSingleton } from "../index.js";
import type {
  OpenClawPluginApi,
  PluginLogger,
  PluginService,
  PluginHookName,
} from "../src/types.js";

const ALL_HOOK_NAMES: PluginHookName[] = [
  "before_model_resolve",
  "before_prompt_build",
  "before_agent_start",
  "agent_end",
  "before_compaction",
  "after_compaction",
  "before_reset",
  "llm_input",
  "llm_output",
  "inbound_claim",
  "before_dispatch",
  "message_received",
  "message_sending",
  "message_sent",
  "before_message_write",
  "before_tool_call",
  "after_tool_call",
  "tool_result_persist",
  "session_start",
  "session_end",
  "subagent_spawning",
  "subagent_delivery_target",
  "subagent_spawned",
  "subagent_ended",
  "gateway_start",
  "gateway_stop",
];

describe("plugin register & hook registration", () => {
  let handlers: Record<string, Function>;
  let services: PluginService[];
  let logger: PluginLogger;
  let api: OpenClawPluginApi;

  beforeEach(() => {
    __testResetSingleton();
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
        gatewayUrl: "http://localhost:8080",
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

  it("registers all 26 hooks", () => {
    plugin.register(api);

    expect(api.on).toHaveBeenCalledTimes(26);
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

    // New agent hooks
    expect(() => handlers.before_model_resolve({ prompt: "test" }, {})).not.toThrow();
    expect(() => handlers.before_prompt_build({ prompt: "test" }, {})).not.toThrow();
    expect(() => handlers.before_reset({}, {})).not.toThrow();
    expect(() => handlers.llm_input({ runId: "", sessionId: "", provider: "", model: "", prompt: "", historyMessages: [], imagesCount: 0 }, {})).not.toThrow();
    expect(() => handlers.llm_output({ runId: "", sessionId: "", provider: "", model: "", assistantTexts: [] }, {})).not.toThrow();

    // Agent hooks
    expect(() => handlers.before_agent_start({ prompt: "test" }, {})).not.toThrow();
    expect(() => handlers.agent_end({ messages: [], success: true }, {})).not.toThrow();
    expect(() => handlers.before_compaction({ messageCount: 1 }, {})).not.toThrow();
    expect(() => handlers.after_compaction({ messageCount: 1, compactedCount: 0 }, {})).not.toThrow();

    // Message hooks
    expect(() => handlers.inbound_claim({ content: "hi", channel: "web", isGroup: false }, { channelId: "c1" })).not.toThrow();
    expect(() => handlers.before_dispatch({ content: "hi" }, { channelId: "c1" })).not.toThrow();
    expect(() => handlers.message_received({ from: "u1", content: "hi" }, { channelId: "c1" })).not.toThrow();
    expect(() => handlers.message_sending({ to: "u1", content: "hi" }, { channelId: "c1" })).not.toThrow();
    expect(() => handlers.message_sent({ to: "u1", content: "hi", success: true }, { channelId: "c1" })).not.toThrow();
    expect(() => handlers.before_message_write({ message: "m" }, {})).not.toThrow();

    // Tool hooks
    expect(() => handlers.before_tool_call({ toolName: "t", params: {} }, { toolName: "t" })).not.toThrow();
    expect(() => handlers.after_tool_call({ toolName: "t", params: {} }, { toolName: "t" })).not.toThrow();
    expect(() => handlers.tool_result_persist({ message: "m" }, {})).not.toThrow();

    // Session hooks
    expect(() => handlers.session_start({ sessionId: "s1" }, { sessionId: "s1" })).not.toThrow();
    expect(() => handlers.session_end({ sessionId: "s1", messageCount: 1 }, { sessionId: "s1" })).not.toThrow();

    // Subagent hooks
    expect(() => handlers.subagent_spawning({ childSessionKey: "sk", agentId: "a", mode: "run", threadRequested: false }, {})).not.toThrow();
    expect(() => handlers.subagent_delivery_target({ childSessionKey: "sk", requesterSessionKey: "r", expectsCompletionMessage: false }, {})).not.toThrow();
    expect(() => handlers.subagent_spawned({ childSessionKey: "sk", agentId: "a", mode: "run", threadRequested: false, runId: "r" }, {})).not.toThrow();
    expect(() => handlers.subagent_ended({ targetSessionKey: "t", targetKind: "subagent", reason: "done" }, {})).not.toThrow();

    // Gateway hooks
    expect(() => handlers.gateway_start({ port: 3000 }, {})).not.toThrow();
    expect(() => handlers.gateway_stop({}, {})).not.toThrow();
  });

  it("logs plugin registered message", () => {
    plugin.register(api);

    expect(logger.info).toHaveBeenCalledWith("[fluss-hook] Plugin registered (26 hooks, output=fluss)");
  });
});
