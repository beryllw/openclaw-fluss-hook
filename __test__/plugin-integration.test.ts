import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import plugin from "../index.js";
import { RecordingSink, type EventSink } from "../src/sink.js";
import { MultiTableBuffer } from "../src/message-buffer.js";
import type {
  OpenClawPluginApi,
  PluginLogger,
  PluginService,
  PluginHookName,
  FlussHookConfig,
} from "../src/types.js";
import {
  mapBeforeModelResolve,
  mapBeforePromptBuild,
  mapBeforeAgentStart,
  mapAgentEnd,
  mapBeforeCompaction,
  mapAfterCompaction,
  mapBeforeReset,
  mapLlmInput,
  mapLlmOutput,
  mapInboundClaim,
  mapBeforeDispatch,
  mapMessageReceived,
  mapMessageSending,
  mapMessageSent,
  mapBeforeMessageWrite,
  mapBeforeToolCall,
  mapAfterToolCall,
  mapToolResultPersist,
  mapSessionStart,
  mapSessionEnd,
  mapSubagentSpawning,
  mapSubagentDeliveryTarget,
  mapSubagentSpawned,
  mapSubagentEnded,
  mapGatewayStart,
  mapGatewayStop,
} from "../src/event-mappers.js";

/**
 * Plugin + RecordingSink integration test.
 *
 * Verifies the full OpenClaw plugin lifecycle:
 *   1. plugin.register(api) with outputMode: "memory"
 *   2. 26 hooks registered and callable
 *   3. Events collected by RecordingSink with correct fields
 *   4. Buffer flush delivers all events to the sink
 *
 * No network, no mock fetch, no Docker. All verification via RecordingSink.
 */

// =============================================================================
// Test infrastructure
// =============================================================================

const testConfig = {
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
// Plugin registration & lifecycle
// =============================================================================

describe("plugin registration", () => {
  let handlers: Record<string, Function>;
  let services: PluginService[];
  let logger: PluginLogger;
  let api: OpenClawPluginApi;

  beforeEach(() => {
    handlers = {};
    services = [];
    logger = createLogger();
    api = {
      pluginConfig: testConfig,
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
});

// =============================================================================
// Hook event capture through plugin.register() entry point
// =============================================================================

describe("hook event capture through plugin", () => {
  let handlers: Record<string, Function>;
  let services: PluginService[];
  let logger: PluginLogger;
  let api: OpenClawPluginApi;

  beforeEach(() => {
    handlers = {};
    services = [];
    logger = createLogger();
    api = {
      pluginConfig: testConfig,
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

  async function startService() {
    await services[0].start({ config: {}, stateDir: "/tmp", logger });
  }

  async function stopAndFlush() {
    await plugin.__testBuffer!.flushAll();
    await services[0].stop!({ config: {}, stateDir: "/tmp", logger });
  }

  // ===========================================================================
  // Agent hooks
  // ===========================================================================

  describe("agent hooks", () => {
    beforeEach(async () => { await startService(); });
    afterEach(async () => { await stopAndFlush(); });

    it("captures before_model_resolve", async () => {
      handlers.before_model_resolve(
        { prompt: "resolve this model" },
        { agentId: "main", sessionKey: "sk-1", sessionId: "sess-1", trigger: "api", channelId: "web", runId: "run-1" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("before_model_resolve")[0];
      expect(e.prompt).toBe("resolve this model");
      expect(e.agent_id).toBe("main");
      expect(e.session_key).toBe("sk-1");
      expect(e.session_id).toBe("sess-1");
      expect(e.trigger).toBe("api");
      expect(e.channel_id).toBe("web");
      expect(e.run_id).toBe("run-1");
      expect(e.timestamp).toBeGreaterThan(0);
    });

    it("captures before_prompt_build", async () => {
      handlers.before_prompt_build(
        { prompt: "build context", messages: [{ role: "system", content: "sys" }] },
        { agentId: "main", sessionKey: "sk-1", sessionId: "sess-1", trigger: "user" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("before_prompt_build")[0];
      expect(e.prompt).toBe("build context");
      expect(e.agent_id).toBe("main");
      expect(e.session_key).toBe("sk-1");
      expect(e.trigger).toBe("user");
      expect(e.messages).toContain('"sys"');
    });

    it("captures before_agent_start", async () => {
      handlers.before_agent_start(
        { prompt: "You are helpful", messages: [{ role: "system", content: "sys" }] },
        { agentId: "main", sessionKey: "sk-1", workspaceDir: "/ws", messageProvider: "bailian", sessionId: "sess-1", trigger: "api", channelId: "web" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("before_agent_start")[0];
      expect(e.prompt).toBe("You are helpful");
      expect(e.agent_id).toBe("main");
      expect(e.session_key).toBe("sk-1");
      expect(e.workspace_dir).toBe("/ws");
      expect(e.message_provider).toBe("bailian");
    });

    it("captures agent_end with success", async () => {
      handlers.agent_end(
        { messages: [{ role: "user", content: "hi" }], success: true, durationMs: 500 },
        { agentId: "main", sessionKey: "sk-1", messageProvider: "openai", sessionId: "sess-1", trigger: "cli", channelId: "cli" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("agent_end")[0];
      expect(e.success).toBe(true);
      expect(e.duration_ms).toBe(500);
      expect(e.agent_id).toBe("main");
      expect(e.message_provider).toBe("openai");
      expect(e.messages).toContain('"hi"');
    });

    it("captures agent_end with error", async () => {
      handlers.agent_end(
        { messages: [], success: false, error: "timeout", durationMs: 5000 },
        { agentId: "main" },
      );
      await stopAndFlush();
      const events = plugin.__recordingSink!.getEvents("agent_end");
      const e = events[events.length - 1];
      expect(e.success).toBe(false);
      expect(e.error).toBe("timeout");
      expect(e.duration_ms).toBe(5000);
    });

    it("captures before_compaction", async () => {
      handlers.before_compaction(
        { messageCount: 50, tokenCount: 12000, compactingCount: 20, sessionFile: "/tmp/sess.jsonl" },
        { agentId: "main", sessionKey: "sk-1", sessionId: "sess-1" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("before_compaction")[0];
      expect(e.message_count).toBe(50);
      expect(e.token_count).toBe(12000);
      expect(e.compacting_count).toBe(20);
      expect(e.session_file).toBe("/tmp/sess.jsonl");
      expect(e.agent_id).toBe("main");
    });

    it("captures after_compaction", async () => {
      handlers.after_compaction(
        { messageCount: 50, tokenCount: 12000, compactedCount: 15, sessionFile: "/tmp/sess.jsonl" },
        { agentId: "main", sessionKey: "sk-1", sessionId: "sess-1" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("after_compaction")[0];
      expect(e.message_count).toBe(50);
      expect(e.compacted_count).toBe(15);
      expect(e.session_file).toBe("/tmp/sess.jsonl");
      expect(e.agent_id).toBe("main");
    });

    it("captures before_reset", async () => {
      handlers.before_reset(
        { sessionFile: "/tmp/s.jsonl", reason: "user", messages: [{ role: "user", content: "/new" }] },
        { agentId: "main", sessionKey: "sk-1", sessionId: "sess-1", trigger: "user" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("before_reset")[0];
      expect(e.session_file).toBe("/tmp/s.jsonl");
      expect(e.reason).toBe("user");
      expect(e.agent_id).toBe("main");
      expect(e.trigger).toBe("user");
      expect(e.messages).toContain('"/new"');
    });

    it("captures llm_input", async () => {
      handlers.llm_input(
        { runId: "run-1", sessionId: "sess-1", provider: "openai", model: "gpt-4o", prompt: "hello", historyMessages: [{ role: "system", content: "sys" }], imagesCount: 2 },
        { agentId: "main", sessionKey: "sk-1", trigger: "api", channelId: "web" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("llm_input")[0];
      expect(e.run_id).toBe("run-1");
      expect(e.session_id).toBe("sess-1");
      expect(e.provider).toBe("openai");
      expect(e.model).toBe("gpt-4o");
      expect(e.images_count).toBe(2);
      expect(e.agent_id).toBe("main");
      expect(e.history_messages).toContain('"sys"');
    });

    it("captures llm_output", async () => {
      handlers.llm_output(
        { runId: "run-1", sessionId: "sess-1", provider: "anthropic", model: "claude-4", assistantTexts: ["Hello!", "Sure"], usage: { input: 100, output: 50, cacheRead: 20 } },
        { agentId: "main", sessionKey: "sk-1", trigger: "api" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("llm_output")[0];
      expect(e.run_id).toBe("run-1");
      expect(e.provider).toBe("anthropic");
      expect(e.model).toBe("claude-4");
      expect(e.agent_id).toBe("main");
      expect(e.assistant_texts).toBe(JSON.stringify(["Hello!", "Sure"]));
      expect(e.usage).toContain('"input":100');
    });
  });

  // ===========================================================================
  // Message hooks
  // ===========================================================================

  describe("message hooks", () => {
    beforeEach(async () => { await startService(); });
    afterEach(async () => { await stopAndFlush(); });

    it("captures inbound_claim", async () => {
      handlers.inbound_claim(
        { content: "@bot help", body: "help", bodyForAgent: "help me", channel: "telegram", isGroup: false, senderName: "Alice", senderUsername: "@alice", threadId: 42, wasMentioned: true, commandAuthorized: true },
        { channelId: "telegram", accountId: "acc-1", conversationId: "conv-1", senderId: "user-123", messageId: "msg-456" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("inbound_claim")[0];
      expect(e.content).toBe("@bot help");
      expect(e.body).toBe("help");
      expect(e.channel).toBe("telegram");
      expect(e.sender_name).toBe("Alice");
      expect(e.sender_username).toBe("@alice");
      expect(e.channel_id).toBe("telegram");
      expect(e.account_id).toBe("acc-1");
      expect(e.conversation_id).toBe("conv-1");
      expect(e.sender_id).toBe("user-123");
      expect(e.message_id).toBe("msg-456");
      expect(e.is_group).toBe(false);
      expect(e.was_mentioned).toBe(true);
      expect(e.command_authorized).toBe(true);
    });

    it("captures before_dispatch", async () => {
      handlers.before_dispatch(
        { content: "hello bot", body: "hello bot", channel: "discord", sessionKey: "sk-1", senderId: "user-1", isGroup: true, timestamp: 1234567890 },
        { channelId: "discord", accountId: "acc-2", conversationId: "conv-2" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("before_dispatch")[0];
      expect(e.content).toBe("hello bot");
      expect(e.body).toBe("hello bot");
      expect(e.channel).toBe("discord");
      expect(e.session_key).toBe("sk-1");
      expect(e.sender_id).toBe("user-1");
      expect(e.is_group).toBe(true);
      expect(e.event_timestamp).toBe(1234567890);
      expect(e.channel_id).toBe("discord");
      expect(e.account_id).toBe("acc-2");
      expect(e.conversation_id).toBe("conv-2");
    });

    it("captures message_received", async () => {
      handlers.message_received(
        { from: "user-42", content: "Hello world", timestamp: 9876, metadata: { lang: "zh" } },
        { channelId: "telegram", accountId: "acc-1", conversationId: "conv-99" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("message_received")[0];
      expect(e.from_id).toBe("user-42");
      expect(e.content).toBe("Hello world");
      expect(e.event_timestamp).toBe(9876);
      expect(e.channel_id).toBe("telegram");
      expect(e.metadata).toContain('"lang":"zh"');
    });

    it("captures message_sending", async () => {
      handlers.message_sending(
        { to: "user-1", content: "Processing...", metadata: { priority: "high" } },
        { channelId: "slack", accountId: "acc-2", conversationId: "conv-5" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("message_sending")[0];
      expect(e.to_id).toBe("user-1");
      expect(e.content).toBe("Processing...");
      expect(e.channel_id).toBe("slack");
      expect(e.account_id).toBe("acc-2");
      expect(e.conversation_id).toBe("conv-5");
    });

    it("captures message_sent with error", async () => {
      handlers.message_sent(
        { to: "user-1", content: "Done", success: false, error: "rate limited" },
        { channelId: "whatsapp" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("message_sent")[0];
      expect(e.to_id).toBe("user-1");
      expect(e.success).toBe(false);
      expect(e.error).toBe("rate limited");
      expect(e.channel_id).toBe("whatsapp");
    });

    it("captures before_message_write", async () => {
      handlers.before_message_write(
        { message: { role: "assistant", content: "ok" }, sessionKey: "sk-1", agentId: "main" },
        { sessionKey: "ctx-sk" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("before_message_write")[0];
      expect(e.session_key).toBe("sk-1");
      expect(e.agent_id).toBe("main");
      expect(e.ctx_session_key).toBe("ctx-sk");
      expect(e.message).toContain('"role":"assistant"');
    });
  });

  // ===========================================================================
  // Tool hooks
  // ===========================================================================

  describe("tool hooks", () => {
    beforeEach(async () => { await startService(); });
    afterEach(async () => { await stopAndFlush(); });

    it("captures before_tool_call", async () => {
      handlers.before_tool_call(
        { toolName: "web_search", params: { query: "fluss docs" }, runId: "run-1", toolCallId: "tc-1" },
        { agentId: "main", sessionKey: "sk-1", toolName: "web_search", runId: "run-1", toolCallId: "tc-1", sessionId: "sess-1" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("before_tool_call")[0];
      expect(e.tool_name).toBe("web_search");
      expect(e.run_id).toBe("run-1");
      expect(e.tool_call_id).toBe("tc-1");
      expect(e.agent_id).toBe("main");
      expect(e.context_tool_name).toBe("web_search");
      expect(e.context_run_id).toBe("run-1");
      expect(e.params).toContain('"query":"fluss docs"');
    });

    it("captures after_tool_call with result", async () => {
      handlers.after_tool_call(
        { toolName: "read_file", params: { path: "/tmp/a.txt" }, result: { content: "hello" }, durationMs: 42, runId: "run-1", toolCallId: "tc-2" },
        { agentId: "main", sessionKey: "sk-1", toolName: "read_file", runId: "run-1", toolCallId: "tc-2", sessionId: "sess-1" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("after_tool_call")[0];
      expect(e.tool_name).toBe("read_file");
      expect(e.duration_ms).toBe(42);
      expect(e.run_id).toBe("run-1");
      expect(e.tool_call_id).toBe("tc-2");
      expect(e.result).toContain('"content":"hello"');
    });

    it("captures after_tool_call with error", async () => {
      handlers.after_tool_call(
        { toolName: "exec", params: { cmd: "ls" }, error: "permission denied", durationMs: 5 },
        { agentId: "main", sessionKey: "sk-1", toolName: "exec", sessionId: "sess-1" },
      );
      await stopAndFlush();
      const events = plugin.__recordingSink!.getEvents("after_tool_call");
      const e = events[events.length - 1];
      expect(e.tool_name).toBe("exec");
      expect(e.error).toBe("permission denied");
      expect(e.duration_ms).toBe(5);
    });

    it("captures tool_result_persist", async () => {
      handlers.tool_result_persist(
        { toolName: "read_file", toolCallId: "tc-123", message: { text: "file content" }, isSynthetic: true },
        { agentId: "main", sessionKey: "sk-1", toolName: "read_file", toolCallId: "tc-123" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("tool_result_persist")[0];
      expect(e.tool_name).toBe("read_file");
      expect(e.tool_call_id).toBe("tc-123");
      expect(e.is_synthetic).toBe(true);
      expect(e.ctx_tool_name).toBe("read_file");
      expect(e.ctx_tool_call_id).toBe("tc-123");
      expect(e.agent_id).toBe("main");
    });
  });

  // ===========================================================================
  // Session hooks
  // ===========================================================================

  describe("session hooks", () => {
    beforeEach(async () => { await startService(); });
    afterEach(async () => { await stopAndFlush(); });

    it("captures session_start", async () => {
      handlers.session_start(
        { sessionId: "sess-abc", resumedFrom: "sess-old", sessionKey: "sk-1" },
        { agentId: "main", sessionId: "sess-abc" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("session_start")[0];
      expect(e.session_id).toBe("sess-abc");
      expect(e.resumed_from).toBe("sess-old");
      expect(e.session_key).toBe("sk-1");
      expect(e.agent_id).toBe("main");
      expect(e.context_session_id).toBe("sess-abc");
    });

    it("captures session_end", async () => {
      handlers.session_end(
        { sessionId: "sess-abc", messageCount: 42, durationMs: 300000, sessionKey: "sk-1" },
        { agentId: "main", sessionId: "sess-abc" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("session_end")[0];
      expect(e.session_id).toBe("sess-abc");
      expect(e.message_count).toBe(42);
      expect(e.duration_ms).toBe(300000);
      expect(e.session_key).toBe("sk-1");
      expect(e.agent_id).toBe("main");
      expect(e.context_session_id).toBe("sess-abc");
    });
  });

  // ===========================================================================
  // Subagent hooks
  // ===========================================================================

  describe("subagent hooks", () => {
    beforeEach(async () => { await startService(); });
    afterEach(async () => { await stopAndFlush(); });

    it("captures subagent_spawning", async () => {
      handlers.subagent_spawning(
        { childSessionKey: "child-sk-1", agentId: "researcher", label: "web-search", mode: "session", threadRequested: true, requester: { channel: "telegram", accountId: "acc-1", to: "bot-1", threadId: 42 } },
        { runId: "run-1", childSessionKey: "ctx-child", requesterSessionKey: "req-sk" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("subagent_spawning")[0];
      expect(e.child_session_key).toBe("child-sk-1");
      expect(e.agent_id).toBe("researcher");
      expect(e.label).toBe("web-search");
      expect(e.mode).toBe("session");
      expect(e.thread_requested).toBe(true);
      expect(e.run_id).toBe("run-1");
      expect(e.child_session_key_ctx).toBe("ctx-child");
      expect(e.requester_session_key).toBe("req-sk");
      expect(e.requester).toContain('"channel":"telegram"');
    });

    it("captures subagent_delivery_target", async () => {
      handlers.subagent_delivery_target(
        { childSessionKey: "child-sk-1", requesterSessionKey: "req-sk-1", expectsCompletionMessage: true, spawnMode: "run", childRunId: "cr-1", requesterOrigin: { channel: "discord", accountId: "acc-2" } },
        { runId: "run-1", childSessionKey: "ctx-child", requesterSessionKey: "ctx-req" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("subagent_delivery_target")[0];
      expect(e.child_session_key).toBe("child-sk-1");
      expect(e.requester_session_key).toBe("req-sk-1");
      expect(e.expects_completion_message).toBe(true);
      expect(e.spawn_mode).toBe("run");
      expect(e.child_run_id).toBe("cr-1");
      expect(e.run_id).toBe("run-1");
      expect(e.requester_origin).toContain('"channel":"discord"');
    });

    it("captures subagent_spawned", async () => {
      handlers.subagent_spawned(
        { childSessionKey: "child-sk-2", agentId: "coder", label: "code-review", mode: "run", threadRequested: false, runId: "spawn-r-1" },
        { runId: "ctx-r", childSessionKey: "ctx-sk", requesterSessionKey: "ctx-req" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("subagent_spawned")[0];
      expect(e.child_session_key).toBe("child-sk-2");
      expect(e.agent_id).toBe("coder");
      expect(e.label).toBe("code-review");
      expect(e.mode).toBe("run");
      expect(e.thread_requested).toBe(false);
      expect(e.run_id).toBe("spawn-r-1");
      expect(e.run_id_ctx).toBe("ctx-r");
    });

    it("captures subagent_ended with success outcome", async () => {
      handlers.subagent_ended(
        { targetSessionKey: "child-sk-2", targetKind: "subagent", reason: "completed", sendFarewell: true, accountId: "acc-1", runId: "run-1", endedAt: 1700000001000, outcome: "ok" },
        { runId: "ctx-r", childSessionKey: "ctx-sk", requesterSessionKey: "ctx-req" },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("subagent_ended")[0];
      expect(e.target_session_key).toBe("child-sk-2");
      expect(e.target_kind).toBe("subagent");
      expect(e.reason).toBe("completed");
      expect(e.send_farewell).toBe(true);
      expect(e.account_id).toBe("acc-1");
      expect(e.run_id).toBe("run-1");
      expect(e.ended_at).toBe(1700000001000);
      expect(e.outcome).toBe("ok");
      expect(e.run_id_ctx).toBe("ctx-r");
    });

    it("captures subagent_ended with error outcome", async () => {
      handlers.subagent_ended(
        { targetSessionKey: "child-sk-3", targetKind: "subagent", reason: "crash", outcome: "error", error: "OOM killed", endedAt: 1700000002000 },
        {},
      );
      await stopAndFlush();
      const events = plugin.__recordingSink!.getEvents("subagent_ended");
      const e = events[events.length - 1];
      expect(e.outcome).toBe("error");
      expect(e.error).toBe("OOM killed");
      expect(e.reason).toBe("crash");
    });
  });

  // ===========================================================================
  // Gateway hooks
  // ===========================================================================

  describe("gateway hooks", () => {
    beforeEach(async () => { await startService(); });
    afterEach(async () => { await stopAndFlush(); });

    it("captures gateway_start", async () => {
      handlers.gateway_start(
        { port: 18789 },
        { port: 18789 },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("gateway_start")[0];
      expect(e.port).toBe(18789);
      expect(e.context_port).toBe(18789);
    });

    it("captures gateway_stop", async () => {
      handlers.gateway_stop(
        { reason: "SIGTERM" },
        { port: 18789 },
      );
      await stopAndFlush();
      const e = plugin.__recordingSink!.getEvents("gateway_stop")[0];
      expect(e.reason).toBe("SIGTERM");
      expect(e.context_port).toBe(18789);
    });
  });
});

// =============================================================================
// Full sweep: all 26 hooks through plugin lifecycle
// =============================================================================

describe("all 26 hooks through plugin lifecycle", () => {
  let handlers: Record<string, Function>;
  let services: PluginService[];
  let logger: PluginLogger;
  let api: OpenClawPluginApi;

  beforeEach(() => {
    handlers = {};
    services = [];
    logger = createLogger();
    api = {
      pluginConfig: testConfig,
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

  it("all 26 hooks captured in one sweep", async () => {
    await services[0].start({ config: {}, stateDir: "/tmp", logger });

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

  it("all 26 hook handlers are safe (do not throw)", () => {
    const api2 = {
      pluginConfig: testConfig,
      logger: createLogger(),
      on: vi.fn(),
      registerService: vi.fn(),
    };
    plugin.register(api2);
    const h = (api2.on as ReturnType<typeof vi.fn>).mock.calls.reduce(
      (acc: Record<string, Function>, [name, handler]: [string, Function]) => { acc[name] = handler; return acc; }, {}
    );

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

// =============================================================================
// Full sweep: direct buffer + RecordingSink with table separation
// =============================================================================

describe("recording sink — all 26 hooks with table separation", () => {
  let sink: RecordingSink;
  let buffer: MultiTableBuffer;
  let logger: PluginLogger;

  beforeEach(() => {
    sink = new RecordingSink({ appendBatch: () => Promise.resolve(), close: () => {} });
    logger = createLogger();
    buffer = new MultiTableBuffer(sink, { ...testConfig, batchSize: 1 }, logger);
    buffer.start();
  });

  afterEach(async () => { await buffer.stop(); });

  it("captures all 26 hooks with correct table separation and timestamps", async () => {
    const mappers: Array<[string, Record<string, unknown>]> = [
      ["before_model_resolve", mapBeforeModelResolve({ prompt: "p" }, { agentId: "a1" })],
      ["before_prompt_build", mapBeforePromptBuild({ prompt: "p" }, { agentId: "a1" })],
      ["before_agent_start", mapBeforeAgentStart({ prompt: "p" }, { agentId: "a1" })],
      ["agent_end", mapAgentEnd({ messages: [], success: true }, { agentId: "a1" })],
      ["before_compaction", mapBeforeCompaction({ messageCount: 1 }, { agentId: "a1" })],
      ["after_compaction", mapAfterCompaction({ messageCount: 1, compactedCount: 0 }, { agentId: "a1" })],
      ["before_reset", mapBeforeReset({ reason: "user" }, { agentId: "a1" })],
      ["llm_input", mapLlmInput({ runId: "r", sessionId: "s", provider: "openai", model: "gpt-4", prompt: "p", historyMessages: [], imagesCount: 0 }, { agentId: "a1" })],
      ["llm_output", mapLlmOutput({ runId: "r", sessionId: "s", provider: "openai", model: "gpt-4", assistantTexts: [] }, { agentId: "a1" })],
      ["inbound_claim", mapInboundClaim({ content: "hi", channel: "web", isGroup: false }, { channelId: "web" })],
      ["before_dispatch", mapBeforeDispatch({ content: "hi" }, { channelId: "web" })],
      ["message_received", mapMessageReceived({ from: "u", content: "hi" }, { channelId: "web" })],
      ["message_sending", mapMessageSending({ to: "u", content: "hi" }, { channelId: "web" })],
      ["message_sent", mapMessageSent({ to: "u", content: "hi", success: true }, { channelId: "web" })],
      ["before_message_write", mapBeforeMessageWrite({ message: "m" }, {})],
      ["before_tool_call", mapBeforeToolCall({ toolName: "t", params: {} }, { toolName: "t" })],
      ["after_tool_call", mapAfterToolCall({ toolName: "t", params: {} }, { toolName: "t" })],
      ["tool_result_persist", mapToolResultPersist({ message: "m" }, {})],
      ["session_start", mapSessionStart({ sessionId: "s1" }, { sessionId: "s1" })],
      ["session_end", mapSessionEnd({ sessionId: "s1", messageCount: 1 }, { sessionId: "s1" })],
      ["subagent_spawning", mapSubagentSpawning({ childSessionKey: "sk", agentId: "a", mode: "run", threadRequested: false }, {})],
      ["subagent_delivery_target", mapSubagentDeliveryTarget({ childSessionKey: "sk", requesterSessionKey: "r", expectsCompletionMessage: false }, {})],
      ["subagent_spawned", mapSubagentSpawned({ childSessionKey: "sk", agentId: "a", mode: "run", threadRequested: false, runId: "r" }, {})],
      ["subagent_ended", mapSubagentEnded({ targetSessionKey: "t", targetKind: "subagent", reason: "done" }, {})],
      ["gateway_start", mapGatewayStart({ port: 3000 }, {})],
      ["gateway_stop", mapGatewayStop({ reason: "stop" }, {})],
    ];

    for (const [hookName, row] of mappers) {
      buffer.push(hookName as any, row);
    }

    await buffer.flushAll();

    expect(sink.getEventCount()).toBe(26);

    const hookNames = [
      "before_model_resolve", "before_prompt_build", "before_agent_start", "agent_end",
      "before_compaction", "after_compaction", "before_reset", "llm_input", "llm_output",
      "inbound_claim", "before_dispatch", "message_received", "message_sending", "message_sent",
      "before_message_write", "before_tool_call", "after_tool_call", "tool_result_persist",
      "session_start", "session_end",
      "subagent_spawning", "subagent_delivery_target", "subagent_spawned", "subagent_ended",
      "gateway_start", "gateway_stop",
    ] as const;

    for (const hookName of hookNames) {
      const events = sink.getEvents(hookName);
      expect(events, `${hookName} should have 1 event`).toHaveLength(1);
      expect(events[0].timestamp, `${hookName} should have timestamp`).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// RecordingSink unit tests
// =============================================================================

describe("RecordingSink", () => {
  const noOpSink: EventSink = { appendBatch: () => Promise.resolve(), close: () => {} };

  it("collects events by hook name", async () => {
    const sink = new RecordingSink(noOpSink);
    await sink.appendBatch("agent_end", [{ success: true }]);
    await sink.appendBatch("agent_end", [{ success: false }]);
    await sink.appendBatch("session_start", [{ session_id: "s1" }]);

    expect(sink.getEventCount()).toBe(3);
    expect(sink.getEvents("agent_end")).toHaveLength(2);
    expect(sink.getEvents("session_start")).toHaveLength(1);
    expect(sink.getEvents("nonexistent")).toHaveLength(0);
  });

  it("getEvents without hookName returns all events", async () => {
    const sink = new RecordingSink(noOpSink);
    await sink.appendBatch("a", [{ x: 1 }]);
    await sink.appendBatch("b", [{ y: 2 }]);

    const all = sink.getEvents();
    expect(all).toHaveLength(2);
  });

  it("clear removes all events", async () => {
    const sink = new RecordingSink(noOpSink);
    await sink.appendBatch("a", [{ x: 1 }]);
    sink.clear();
    expect(sink.getEventCount()).toBe(0);
    expect(sink.getEvents()).toHaveLength(0);
  });

  it("getCalls returns structured call history", async () => {
    const sink = new RecordingSink(noOpSink);
    await sink.appendBatch("agent_end", [{ success: true }, { success: false }]);
    await sink.appendBatch("session_start", [{ session_id: "s1" }]);

    const calls = sink.getCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0].hookName).toBe("agent_end");
    expect(calls[0].rows).toHaveLength(2);
    expect(calls[1].hookName).toBe("session_start");
    expect(calls[1].rows).toHaveLength(1);
  });

  it("forwards appendBatch to delegate", async () => {
    const delegateCalls: { hookName: string; rows: unknown[] }[] = [];
    const delegate: EventSink = {
      appendBatch: (hookName, rows) => {
        delegateCalls.push({ hookName, rows: [...rows] });
        return Promise.resolve();
      },
      close: () => {},
    };
    const sink = new RecordingSink(delegate);
    await sink.appendBatch("test", [{ a: 1 }]);

    expect(delegateCalls).toHaveLength(1);
    expect(delegateCalls[0].hookName).toBe("test");
    expect(delegateCalls[0].rows).toEqual([{ a: 1 }]);
    expect(sink.getEventCount()).toBe(1);
  });

  it("close calls delegate close", async () => {
    let closed = false;
    const delegate: EventSink = {
      appendBatch: () => Promise.resolve(),
      close: () => { closed = true; },
    };
    const sink = new RecordingSink(delegate);
    sink.close();
    expect(closed).toBe(true);
  });
});
