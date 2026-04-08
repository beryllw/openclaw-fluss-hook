import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import plugin from "../index.js";
import type {
  OpenClawPluginApi,
  PluginLogger,
  PluginService,
  PluginHookName,
} from "../src/types.js";

/**
 * Real plugin + RecordingSink integration test.
 *
 * Verifies the full OpenClaw plugin lifecycle:
 *   1. plugin.register(api) with outputMode: "memory"
 *   2. Hook handlers registered and callable
 *   3. Firing hooks through registered handlers collects events
 *   4. Event fields and types are correct in the captured output
 *   5. Buffer flush delivers all events to the sink
 *
 * Unlike plugin-e2e.test.ts (mock fetch) and plugin-e2e-memory.test.ts
 * (direct buffer), this test goes through the actual plugin.register()
 * entry point — exactly how OpenClaw would use it.
 */

// =============================================================================
// Test infrastructure
// =============================================================================

const TEST_CONFIG = {
  gatewayUrl: "http://localhost:8080",
  databaseName: "test",
  tablePrefix: "hook_",
  batchSize: 1,
  flushIntervalMs: 100,
  autoCreateTable: false,
  bucketCount: 1,
  maxRetries: 1,
  retryBackoffMs: 100,
  outputMode: "memory" as const,
};

function createLogger(): PluginLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

// =============================================================================
// Plugin lifecycle + MemorySink access
// =============================================================================

describe("plugin + MemorySink integration", () => {
  let handlers: Record<string, Function>;
  let services: PluginService[];
  let logger: PluginLogger;
  let api: OpenClawPluginApi;

  beforeEach(() => {
    handlers = {};
    services = [];
    logger = createLogger();

    api = {
      pluginConfig: TEST_CONFIG,
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
    plugin.__recordingSink?.clear();
  });

  it("registers 26 hooks", () => {
    expect(api.on).toHaveBeenCalledTimes(26);
  });

  it("registers a service with start/stop", () => {
    expect(services).toHaveLength(1);
    expect(services[0].id).toBe("fluss-hook");
    expect(typeof services[0].start).toBe("function");
    expect(typeof services[0].stop).toBe("function");
  });

  it("exposes __recordingSink when outputMode is memory", () => {
    expect(plugin.__recordingSink).toBeDefined();
    expect(plugin.__recordingSink?.getEventCount()).toBe(0);
  });

  it("logs correct registration message", () => {
    expect(logger.info).toHaveBeenCalledWith(
      "[fluss-hook] Plugin registered (26 hooks, output=memory)",
    );
  });

  // =============================================================================
  // Start service, fire hooks, verify events
  // =============================================================================

  describe("hook event capture through plugin", () => {
    beforeEach(async () => {
      await services[0].start({ config: {}, stateDir: "/tmp", logger });
    });

    afterEach(async () => {
      if (services[0].stop) {
        await services[0].stop({ config: {}, stateDir: "/tmp", logger });
      }
    });

    // -- Agent Hooks --

    it("captures before_model_resolve", async () => {
      handlers.before_model_resolve(
        { prompt: "resolve model X" },
        { agentId: "main", sessionId: "s1", trigger: "api", channelId: "web" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      expect(plugin.__recordingSink!.getEvents("before_model_resolve")).toHaveLength(1);
      const e = plugin.__recordingSink!.getEvents("before_model_resolve")[0];
      expect(e.prompt).toBe("resolve model X");
      expect(e.agent_id).toBe("main");
      expect(e.timestamp).toBeGreaterThan(0);
    });

    it("captures before_prompt_build", async () => {
      handlers.before_prompt_build(
        { prompt: "build context", messages: [{ role: "system", content: "sys" }] },
        { agentId: "main", sessionId: "s1", trigger: "user" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const events = plugin.__recordingSink!.getEvents("before_prompt_build");
      expect(events).toHaveLength(1);
      expect(events[0].prompt).toBe("build context");
      expect(events[0].messages).toContain('"sys"');
    });

    it("captures before_agent_start", async () => {
      handlers.before_agent_start(
        { prompt: "You are helpful" },
        { agentId: "main", sessionKey: "sk-1", workspaceDir: "/ws", messageProvider: "bailian" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("before_agent_start")[0];
      expect(e.prompt).toBe("You are helpful");
      expect(e.agent_id).toBe("main");
      expect(e.session_key).toBe("sk-1");
      expect(e.workspace_dir).toBe("/ws");
    });

    it("captures agent_end with success", async () => {
      handlers.agent_end(
        { messages: [{ role: "user", content: "hi" }], success: true, durationMs: 500 },
        { agentId: "main", sessionKey: "sk-1", messageProvider: "openai" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("agent_end")[0];
      expect(e.success).toBe(true);
      expect(e.duration_ms).toBe(500);
      expect(e.agent_id).toBe("main");
      expect(e.messages).toContain('"hi"');
    });

    it("captures agent_end with error", async () => {
      handlers.agent_end(
        { messages: [], success: false, error: "timeout", durationMs: 5000 },
        { agentId: "main" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const events = plugin.__recordingSink!.getEvents("agent_end");
      const e = events[events.length - 1];
      expect(e.success).toBe(false);
      expect(e.error).toBe("timeout");
    });

    it("captures before_compaction", async () => {
      handlers.before_compaction(
        { messageCount: 50, tokenCount: 12000, compactingCount: 20, sessionFile: "/tmp/sess.jsonl" },
        { agentId: "main", sessionId: "s1" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("before_compaction")[0];
      expect(e.message_count).toBe(50);
      expect(e.token_count).toBe(12000);
      expect(e.session_file).toBe("/tmp/sess.jsonl");
    });

    it("captures after_compaction", async () => {
      handlers.after_compaction(
        { messageCount: 50, compactedCount: 15, sessionFile: "/tmp/sess.jsonl" },
        { agentId: "main" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("after_compaction")[0];
      expect(e.message_count).toBe(50);
      expect(e.compacted_count).toBe(15);
    });

    it("captures before_reset", async () => {
      handlers.before_reset(
        { sessionFile: "/tmp/s.jsonl", reason: "user", messages: [{ role: "user", content: "/new" }] },
        { agentId: "main", trigger: "user" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("before_reset")[0];
      expect(e.session_file).toBe("/tmp/s.jsonl");
      expect(e.reason).toBe("user");
      expect(e.messages).toContain('"/new"');
    });

    it("captures llm_input", async () => {
      handlers.llm_input(
        { runId: "run-1", sessionId: "s1", provider: "openai", model: "gpt-4o", prompt: "hello", historyMessages: [{ role: "user", content: "hi" }], imagesCount: 2 },
        { agentId: "main", trigger: "api" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("llm_input")[0];
      expect(e.provider).toBe("openai");
      expect(e.model).toBe("gpt-4o");
      expect(e.run_id).toBe("run-1");
      expect(e.images_count).toBe(2);
      expect(e.history_messages).toContain('"hi"');
    });

    it("captures llm_output", async () => {
      handlers.llm_output(
        { runId: "run-1", sessionId: "s1", provider: "anthropic", model: "claude-4", assistantTexts: ["Hello", "Sure"], usage: { input: 100, output: 50 } },
        { agentId: "main" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("llm_output")[0];
      expect(e.provider).toBe("anthropic");
      expect(e.assistant_texts).toBe(JSON.stringify(["Hello", "Sure"]));
      expect(e.usage).toContain('"input":100');
    });

    // -- Message Hooks --

    it("captures inbound_claim", async () => {
      handlers.inbound_claim(
        { content: "@bot help", body: "help", channel: "telegram", isGroup: false, senderName: "Alice", senderUsername: "@alice", wasMentioned: true, commandAuthorized: true },
        { channelId: "telegram", accountId: "acc-1", senderId: "user-123", messageId: "msg-1" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("inbound_claim")[0];
      expect(e.content).toBe("@bot help");
      expect(e.channel).toBe("telegram");
      expect(e.sender_name).toBe("Alice");
      expect(e.was_mentioned).toBe(true);
    });

    it("captures before_dispatch", async () => {
      handlers.before_dispatch(
        { content: "hello bot", body: "hello bot", channel: "discord", sessionKey: "sk-1", senderId: "u1", isGroup: true, timestamp: 12345 },
        { channelId: "discord", accountId: "acc-2", conversationId: "c2" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("before_dispatch")[0];
      expect(e.content).toBe("hello bot");
      expect(e.channel_id).toBe("discord");
      expect(e.is_group).toBe(true);
    });

    it("captures message_received", async () => {
      handlers.message_received(
        { from: "user-42", content: "Hello world", timestamp: 9876, metadata: { lang: "zh" } },
        { channelId: "telegram", accountId: "acc-1", conversationId: "conv-99" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("message_received")[0];
      expect(e.from_id).toBe("user-42");
      expect(e.content).toBe("Hello world");
      expect(e.metadata).toContain('"lang":"zh"');
    });

    it("captures message_sending", async () => {
      handlers.message_sending(
        { to: "user-1", content: "Processing...", metadata: { priority: "high" } },
        { channelId: "slack", conversationId: "c5" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("message_sending")[0];
      expect(e.to_id).toBe("user-1");
      expect(e.content).toBe("Processing...");
    });

    it("captures message_sent", async () => {
      handlers.message_sent(
        { to: "user-1", content: "Done", success: false, error: "rate limited" },
        { channelId: "whatsapp" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("message_sent")[0];
      expect(e.success).toBe(false);
      expect(e.error).toBe("rate limited");
    });

    it("captures before_message_write", async () => {
      handlers.before_message_write(
        { message: { role: "assistant", content: "ok" }, sessionKey: "sk-1", agentId: "main" },
        { sessionKey: "ctx-sk" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("before_message_write")[0];
      expect(e.session_key).toBe("sk-1");
      expect(e.agent_id).toBe("main");
      expect(e.message).toContain('"role":"assistant"');
    });

    // -- Tool Hooks --

    it("captures before_tool_call", async () => {
      handlers.before_tool_call(
        { toolName: "web_search", params: { query: "fluss docs" }, runId: "run-1", toolCallId: "tc-1" },
        { agentId: "main", sessionKey: "sk-1", toolName: "web_search", runId: "run-1", toolCallId: "tc-1", sessionId: "sess-1" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("before_tool_call")[0];
      expect(e.tool_name).toBe("web_search");
      expect(e.params).toContain('"query":"fluss docs"');
      expect(e.context_tool_name).toBe("web_search");
    });

    it("captures after_tool_call", async () => {
      handlers.after_tool_call(
        { toolName: "read_file", params: { path: "/tmp/a.txt" }, result: { content: "hello" }, durationMs: 42 },
        { agentId: "main", toolName: "read_file", sessionId: "sess-1" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("after_tool_call")[0];
      expect(e.tool_name).toBe("read_file");
      expect(e.duration_ms).toBe(42);
      expect(e.result).toContain('"content":"hello"');
    });

    it("captures tool_result_persist", async () => {
      handlers.tool_result_persist(
        { toolName: "read_file", toolCallId: "tc-123", message: { text: "content" }, isSynthetic: true },
        { agentId: "main", toolName: "read_file", toolCallId: "tc-123" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("tool_result_persist")[0];
      expect(e.tool_name).toBe("read_file");
      expect(e.is_synthetic).toBe(true);
    });

    // -- Session Hooks --

    it("captures session_start", async () => {
      handlers.session_start(
        { sessionId: "sess-abc", resumedFrom: "sess-old", sessionKey: "sk-1" },
        { agentId: "main", sessionId: "sess-abc" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("session_start")[0];
      expect(e.session_id).toBe("sess-abc");
      expect(e.resumed_from).toBe("sess-old");
    });

    it("captures session_end", async () => {
      handlers.session_end(
        { sessionId: "sess-abc", messageCount: 42, durationMs: 300000, sessionKey: "sk-1" },
        { agentId: "main", sessionId: "sess-abc" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("session_end")[0];
      expect(e.session_id).toBe("sess-abc");
      expect(e.message_count).toBe(42);
      expect(e.duration_ms).toBe(300000);
    });

    // -- Subagent Hooks --

    it("captures subagent_spawning", async () => {
      handlers.subagent_spawning(
        { childSessionKey: "child-sk", agentId: "researcher", label: "search", mode: "session", threadRequested: true, requester: { channel: "telegram" } },
        { runId: "run-1", childSessionKey: "ctx-sk", requesterSessionKey: "req-sk" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("subagent_spawning")[0];
      expect(e.child_session_key).toBe("child-sk");
      expect(e.agent_id).toBe("researcher");
      expect(e.label).toBe("search");
      expect(e.thread_requested).toBe(true);
      expect(e.requester).toContain('"channel":"telegram"');
    });

    it("captures subagent_delivery_target", async () => {
      handlers.subagent_delivery_target(
        { childSessionKey: "child-sk", requesterSessionKey: "req-sk", expectsCompletionMessage: true, spawnMode: "run", childRunId: "cr-1" },
        { runId: "run-1" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("subagent_delivery_target")[0];
      expect(e.child_session_key).toBe("child-sk");
      expect(e.expects_completion_message).toBe(true);
      expect(e.spawn_mode).toBe("run");
    });

    it("captures subagent_spawned", async () => {
      handlers.subagent_spawned(
        { childSessionKey: "child-sk", agentId: "coder", mode: "run", threadRequested: false, runId: "spawn-r-1" },
        { runId: "ctx-r", childSessionKey: "ctx-sk", requesterSessionKey: "ctx-req" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("subagent_spawned")[0];
      expect(e.child_session_key).toBe("child-sk");
      expect(e.run_id).toBe("spawn-r-1");
      expect(e.thread_requested).toBe(false);
    });

    it("captures subagent_ended", async () => {
      handlers.subagent_ended(
        { targetSessionKey: "child-sk", targetKind: "subagent", reason: "completed", outcome: "ok", endedAt: 1700000001000 },
        { runId: "ctx-r" },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("subagent_ended")[0];
      expect(e.target_session_key).toBe("child-sk");
      expect(e.outcome).toBe("ok");
      expect(e.ended_at).toBe(1700000001000);
    });

    // -- Gateway Hooks --

    it("captures gateway_start", async () => {
      handlers.gateway_start(
        { port: 18789 },
        { port: 18789 },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("gateway_start")[0];
      expect(e.port).toBe(18789);
      expect(e.context_port).toBe(18789);
    });

    it("captures gateway_stop", async () => {
      handlers.gateway_stop(
        { reason: "SIGTERM" },
        { port: 18789 },
      );
      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const e = plugin.__recordingSink!.getEvents("gateway_stop")[0];
      expect(e.reason).toBe("SIGTERM");
    });
  });

  // =============================================================================
  // Full sweep: all 26 hooks through plugin.register()
  // =============================================================================

  describe("all 26 hooks through plugin lifecycle", () => {
    beforeEach(async () => {
      await services[0].start({ config: {}, stateDir: "/tmp", logger });
    });

    it("all 26 hooks captured in one sweep", async () => {
      // Fire each hook once
      handlers.before_model_resolve({ prompt: "p" }, { agentId: "a1" });
      handlers.before_prompt_build({ prompt: "p" }, { agentId: "a1" });
      handlers.before_agent_start({ prompt: "p" }, { agentId: "a1" });
      handlers.agent_end({ messages: [], success: true }, { agentId: "a1" });
      handlers.before_compaction({ messageCount: 10 }, { agentId: "a1" });
      handlers.after_compaction({ messageCount: 10, compactedCount: 3 }, { agentId: "a1" });
      handlers.before_reset({ reason: "user" }, { agentId: "a1" });
      handlers.llm_input({ runId: "r", sessionId: "s", provider: "openai", model: "gpt-4", prompt: "p", historyMessages: [], imagesCount: 0 }, { agentId: "a1" });
      handlers.llm_output({ runId: "r", sessionId: "s", provider: "openai", model: "gpt-4", assistantTexts: [] }, { agentId: "a1" });
      handlers.inbound_claim({ content: "hi", channel: "web", isGroup: false }, { channelId: "web" });
      handlers.before_dispatch({ content: "dispatch" }, { channelId: "web" });
      handlers.message_received({ from: "u", content: "hello" }, { channelId: "web" });
      handlers.message_sending({ to: "u", content: "bye" }, { channelId: "web" });
      handlers.message_sent({ to: "u", content: "bye", success: true }, { channelId: "web" });
      handlers.before_message_write({ message: "m" }, {});
      handlers.before_tool_call({ toolName: "t", params: {} }, { toolName: "t" });
      handlers.after_tool_call({ toolName: "t", params: {}, result: "ok" }, { toolName: "t" });
      handlers.tool_result_persist({ message: "result" }, {});
      handlers.session_start({ sessionId: "s1" }, { sessionId: "s1" });
      handlers.session_end({ sessionId: "s1", messageCount: 5 }, { sessionId: "s1" });
      handlers.subagent_spawning({ childSessionKey: "csk", agentId: "a", mode: "run", threadRequested: false }, {});
      handlers.subagent_delivery_target({ childSessionKey: "csk", requesterSessionKey: "rsk", expectsCompletionMessage: false }, {});
      handlers.subagent_spawned({ childSessionKey: "csk", agentId: "a", mode: "run", threadRequested: false, runId: "r" }, {});
      handlers.subagent_ended({ targetSessionKey: "tsk", targetKind: "subagent", reason: "done" }, {});
      handlers.gateway_start({ port: 3000 }, {});
      handlers.gateway_stop({ reason: "stop" }, {});

      await plugin.__testBuffer!.flushAll();
      await services[0].stop!({ config: {}, stateDir: "/tmp", logger });

      const hookNames: PluginHookName[] = [
        "before_model_resolve", "before_prompt_build", "before_agent_start", "agent_end",
        "before_compaction", "after_compaction", "before_reset", "llm_input", "llm_output",
        "inbound_claim", "before_dispatch", "message_received", "message_sending", "message_sent",
        "before_message_write", "before_tool_call", "after_tool_call", "tool_result_persist",
        "session_start", "session_end",
        "subagent_spawning", "subagent_delivery_target", "subagent_spawned", "subagent_ended",
        "gateway_start", "gateway_stop",
      ];

      expect(plugin.__recordingSink!.getEventCount()).toBe(26);

      for (const hookName of hookNames) {
        const events = plugin.__recordingSink!.getEvents(hookName);
        expect(events, `${hookName} should have 1 event`).toHaveLength(1);
        expect(events[0].timestamp, `${hookName} should have timestamp`).toBeGreaterThan(0);
      }
    });
  });

  // =============================================================================
  // Handlers do not throw with realistic events
  // =============================================================================

  it("all 26 hook handlers are safe (do not throw)", () => {
    // Re-register on a fresh api
    const api2 = {
      pluginConfig: TEST_CONFIG,
      logger: createLogger(),
      on: vi.fn(),
      registerService: vi.fn(),
    };
    plugin.register(api2);
    const h = (api2.on as ReturnType<typeof vi.fn>).mock.calls.reduce(
      (acc: Record<string, Function>, [name, handler]: [string, Function]) => { acc[name] = handler; return acc; }, {}
    );

    const ctx = (extras: Record<string, unknown>) => ({ agentId: "a1", sessionKey: "sk1", ...extras });
    expect(() => h.before_model_resolve({ prompt: "p" }, {})).not.toThrow();
    expect(() => h.before_prompt_build({ prompt: "p" }, {})).not.toThrow();
    expect(() => h.before_agent_start({ prompt: "p" }, {})).not.toThrow();
    expect(() => h.agent_end({ messages: [], success: true }, {})).not.toThrow();
    expect(() => h.before_compaction({ messageCount: 1 }, {})).not.toThrow();
    expect(() => h.after_compaction({ messageCount: 1, compactedCount: 0 }, {})).not.toThrow();
    expect(() => h.before_reset({}, {})).not.toThrow();
    expect(() => h.llm_input({ runId: "", sessionId: "", provider: "", model: "", prompt: "", historyMessages: [], imagesCount: 0 }, {})).not.toThrow();
    expect(() => h.llm_output({ runId: "", sessionId: "", provider: "", model: "", assistantTexts: [] }, {})).not.toThrow();
    expect(() => h.inbound_claim({ content: "", channel: "web", isGroup: false }, {})).not.toThrow();
    expect(() => h.before_dispatch({ content: "" }, {})).not.toThrow();
    expect(() => h.message_received({ from: "", content: "" }, {})).not.toThrow();
    expect(() => h.message_sending({ to: "", content: "" }, {})).not.toThrow();
    expect(() => h.message_sent({ to: "", content: "", success: true }, {})).not.toThrow();
    expect(() => h.before_message_write({ message: "" }, {})).not.toThrow();
    expect(() => h.before_tool_call({ toolName: "", params: {} }, {})).not.toThrow();
    expect(() => h.after_tool_call({ toolName: "", params: {} }, {})).not.toThrow();
    expect(() => h.tool_result_persist({ message: "" }, {})).not.toThrow();
    expect(() => h.session_start({ sessionId: "" }, {})).not.toThrow();
    expect(() => h.session_end({ sessionId: "", messageCount: 0 }, {})).not.toThrow();
    expect(() => h.subagent_spawning({ childSessionKey: "", agentId: "", mode: "run", threadRequested: false }, {})).not.toThrow();
    expect(() => h.subagent_delivery_target({ childSessionKey: "", requesterSessionKey: "", expectsCompletionMessage: false }, {})).not.toThrow();
    expect(() => h.subagent_spawned({ childSessionKey: "", agentId: "", mode: "run", threadRequested: false, runId: "" }, {})).not.toThrow();
    expect(() => h.subagent_ended({ targetSessionKey: "", targetKind: "", reason: "" }, {})).not.toThrow();
    expect(() => h.gateway_start({ port: 0 }, {})).not.toThrow();
    expect(() => h.gateway_stop({}, {})).not.toThrow();
  });
});
