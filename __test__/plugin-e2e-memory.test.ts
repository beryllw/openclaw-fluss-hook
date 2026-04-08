import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RecordingSink, type EventSink } from "../src/sink.js";
import { MultiTableBuffer } from "../src/message-buffer.js";
import type { FlussHookConfig, PluginLogger } from "../src/types.js";
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
 * End-to-end memory test for all 26 hooks.
 *
 * Uses RecordingSink with a no-op delegate to collect events in memory.
 * No Docker, no mock fetch, no network. Fast and deterministic.
 *
 * Verifies that every hook:
 * 1. Is captured by the plugin
 * 2. Produces correct field types
 * 3. Has a valid timestamp
 * 4. Context fields (agent_id, session_key, etc.) are propagated
 */

// =============================================================================
// Test infrastructure
// =============================================================================

const testConfig: FlussHookConfig = {
  gatewayUrl: "http://localhost:8080",
  databaseName: "test",
  tablePrefix: "hook_",
  batchSize: 1, // flush every single row
  flushIntervalMs: 100,
  autoCreateTable: false,
  bucketCount: 1,
  maxRetries: 1,
  retryBackoffMs: 100,
  outputMode: "memory",
};

function createLogger(): PluginLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

// No-op EventSink for testing — RecordingSink wraps it to capture data
const noOpSink: EventSink = {
  appendBatch: () => Promise.resolve(),
  close: () => {},
};

describe("recording sink — single hook verification", () => {
  let sink: RecordingSink;
  let buffer: MultiTableBuffer;
  let logger: PluginLogger;

  beforeEach(() => {
    sink = new RecordingSink(noOpSink);
    logger = createLogger();
    buffer = new MultiTableBuffer(sink, testConfig, logger);
    buffer.start();
  });

  afterEach(async () => {
    await buffer.stop();
  });

  // ===========================================================================
  // Agent hooks
  // ===========================================================================

  describe("agent hooks", () => {
    it("before_model_resolve captures all fields", async () => {
      const row = mapBeforeModelResolve(
        { prompt: "resolve this model" },
        { agentId: "main", sessionKey: "sk-1", sessionId: "sess-1", trigger: "api", channelId: "web", runId: "run-1" },
      );
      buffer.push("before_model_resolve", row);
      await buffer.flushAll();

      const events = sink.getEvents("before_model_resolve");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        prompt: "resolve this model",
        agent_id: "main",
        session_key: "sk-1",
        session_id: "sess-1",
        trigger: "api",
        channel_id: "web",
        run_id: "run-1",
      });
      expect(events[0].timestamp).toBeGreaterThan(0);
    });

    it("before_prompt_build captures all fields", async () => {
      const row = mapBeforePromptBuild(
        { prompt: "build prompt", messages: [{ role: "user", content: "hi" }] },
        { agentId: "main", sessionKey: "sk-1", sessionId: "sess-1", trigger: "user", channelId: "telegram" },
      );
      buffer.push("before_prompt_build", row);
      await buffer.flushAll();

      const events = sink.getEvents("before_prompt_build");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        prompt: "build prompt",
        agent_id: "main",
        session_key: "sk-1",
        session_id: "sess-1",
        trigger: "user",
        channel_id: "telegram",
      });
      expect(events[0].messages).toBe(JSON.stringify([{ role: "user", content: "hi" }]));
    });

    it("before_agent_start captures all fields", async () => {
      const row = mapBeforeAgentStart(
        { prompt: "You are a helpful assistant", messages: [{ role: "system", content: "sys" }] },
        { agentId: "main", sessionKey: "sk-1", workspaceDir: "/ws", messageProvider: "bailian", sessionId: "sess-1", trigger: "api", channelId: "web" },
      );
      buffer.push("before_agent_start", row);
      await buffer.flushAll();

      const events = sink.getEvents("before_agent_start");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        prompt: "You are a helpful assistant",
        agent_id: "main",
        session_key: "sk-1",
        workspace_dir: "/ws",
        message_provider: "bailian",
      });
    });

    it("agent_end captures success and duration", async () => {
      const row = mapAgentEnd(
        { messages: [{ role: "user", content: "hi" }], success: true, durationMs: 1234 },
        { agentId: "main", sessionKey: "sk-1", messageProvider: "openai", sessionId: "sess-1", trigger: "cli", channelId: "cli" },
      );
      buffer.push("agent_end", row);
      await buffer.flushAll();

      const events = sink.getEvents("agent_end");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        success: true,
        duration_ms: 1234,
        agent_id: "main",
        message_provider: "openai",
      });
      expect(events[0].messages).toContain('"role":"user"');
    });

    it("agent_end captures error case", async () => {
      const row = mapAgentEnd(
        { messages: [], success: false, error: "timeout", durationMs: 5000 },
        { agentId: "main" },
      );
      buffer.push("agent_end", row);
      await buffer.flushAll();

      const events = sink.getEvents("agent_end");
      expect(events[events.length - 1]).toMatchObject({
        success: false,
        error: "timeout",
        duration_ms: 5000,
      });
    });

    it("before_compaction captures message and token counts", async () => {
      const row = mapBeforeCompaction(
        { messageCount: 50, tokenCount: 12000, compactingCount: 20, sessionFile: "/tmp/sess.jsonl" },
        { agentId: "main", sessionKey: "sk-1", sessionId: "sess-1" },
      );
      buffer.push("before_compaction", row);
      await buffer.flushAll();

      const events = sink.getEvents("before_compaction");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        message_count: 50,
        token_count: 12000,
        compacting_count: 20,
        session_file: "/tmp/sess.jsonl",
        agent_id: "main",
      });
    });

    it("after_compaction captures compacted count", async () => {
      const row = mapAfterCompaction(
        { messageCount: 50, tokenCount: 12000, compactedCount: 15, sessionFile: "/tmp/sess.jsonl" },
        { agentId: "main", sessionKey: "sk-1", sessionId: "sess-1" },
      );
      buffer.push("after_compaction", row);
      await buffer.flushAll();

      const events = sink.getEvents("after_compaction");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        message_count: 50,
        compacted_count: 15,
        session_file: "/tmp/sess.jsonl",
        agent_id: "main",
      });
    });

    it("before_reset captures reason", async () => {
      const row = mapBeforeReset(
        { sessionFile: "/tmp/sess.jsonl", reason: "user", messages: [{ role: "user", content: "/new" }] },
        { agentId: "main", sessionKey: "sk-1", sessionId: "sess-1", trigger: "user" },
      );
      buffer.push("before_reset", row);
      await buffer.flushAll();

      const events = sink.getEvents("before_reset");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        session_file: "/tmp/sess.jsonl",
        reason: "user",
        agent_id: "main",
        trigger: "user",
      });
      expect(events[0].messages).toContain('"/new"');
    });

    it("llm_input captures provider and model", async () => {
      const row = mapLlmInput(
        { runId: "run-1", sessionId: "sess-1", provider: "openai", model: "gpt-4o", prompt: "hello", historyMessages: [{ role: "system", content: "sys" }], imagesCount: 2 },
        { agentId: "main", sessionKey: "sk-1", trigger: "api", channelId: "web" },
      );
      buffer.push("llm_input", row);
      await buffer.flushAll();

      const events = sink.getEvents("llm_input");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        run_id: "run-1",
        session_id: "sess-1",
        provider: "openai",
        model: "gpt-4o",
        images_count: 2,
        agent_id: "main",
      });
      expect(events[0].history_messages).toContain('"role":"system"');
    });

    it("llm_output captures assistant texts and usage", async () => {
      const row = mapLlmOutput(
        { runId: "run-1", sessionId: "sess-1", provider: "anthropic", model: "claude-4", assistantTexts: ["Hello!", "Sure"], usage: { input: 100, output: 50, cacheRead: 20 } },
        { agentId: "main", sessionKey: "sk-1", trigger: "api" },
      );
      buffer.push("llm_output", row);
      await buffer.flushAll();

      const events = sink.getEvents("llm_output");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        run_id: "run-1",
        provider: "anthropic",
        model: "claude-4",
        agent_id: "main",
      });
      expect(events[0].assistant_texts).toBe(JSON.stringify(["Hello!", "Sure"]));
      expect(events[0].usage).toContain('"input":100');
    });
  });

  // ===========================================================================
  // Message hooks
  // ===========================================================================

  describe("message hooks", () => {
    it("inbound_claim captures sender and conversation context", async () => {
      const row = mapInboundClaim(
        { content: "@bot help me", body: "help me", bodyForAgent: "help me", channel: "telegram", isGroup: false, senderName: "Alice", senderUsername: "@alice", threadId: 42, wasMentioned: true, commandAuthorized: true },
        { channelId: "telegram", accountId: "acc-1", conversationId: "conv-1", senderId: "user-123", messageId: "msg-456" },
      );
      buffer.push("inbound_claim", row);
      await buffer.flushAll();

      const events = sink.getEvents("inbound_claim");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        content: "@bot help me",
        body: "help me",
        channel: "telegram",
        sender_id: "user-123",
        sender_name: "Alice",
        sender_username: "@alice",
        channel_id: "telegram",
        account_id: "acc-1",
        conversation_id: "conv-1",
        message_id: "msg-456",
        is_group: false,
        was_mentioned: true,
        command_authorized: true,
      });
    });

    it("before_dispatch captures message routing info", async () => {
      const row = mapBeforeDispatch(
        { content: "hello bot", body: "hello bot", channel: "discord", sessionKey: "sk-1", senderId: "user-1", isGroup: true, timestamp: 1234567890 },
        { channelId: "discord", accountId: "acc-2", conversationId: "conv-2" },
      );
      buffer.push("before_dispatch", row);
      await buffer.flushAll();

      const events = sink.getEvents("before_dispatch");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        content: "hello bot",
        body: "hello bot",
        channel: "discord",
        session_key: "sk-1",
        sender_id: "user-1",
        is_group: true,
        event_timestamp: 1234567890,
        channel_id: "discord",
        account_id: "acc-2",
        conversation_id: "conv-2",
      });
    });

    it("message_received captures sender and content", async () => {
      const row = mapMessageReceived(
        { from: "user-42", content: "Hello world", timestamp: 9876, metadata: { lang: "zh" } },
        { channelId: "telegram", accountId: "acc-1", conversationId: "conv-99" },
      );
      buffer.push("message_received", row);
      await buffer.flushAll();

      const events = sink.getEvents("message_received");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        from_id: "user-42",
        content: "Hello world",
        event_timestamp: 9876,
        channel_id: "telegram",
        account_id: "acc-1",
        conversation_id: "conv-99",
      });
      expect(events[0].metadata).toContain('"lang":"zh"');
    });

    it("message_sending captures outgoing content", async () => {
      const row = mapMessageSending(
        { to: "user-1", content: "Processing...", metadata: { priority: "high" } },
        { channelId: "slack", accountId: "acc-2", conversationId: "conv-5" },
      );
      buffer.push("message_sending", row);
      await buffer.flushAll();

      const events = sink.getEvents("message_sending");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        to_id: "user-1",
        content: "Processing...",
        channel_id: "slack",
        account_id: "acc-2",
        conversation_id: "conv-5",
      });
    });

    it("message_sent captures success and error states", async () => {
      const row = mapMessageSent(
        { to: "user-1", content: "Done", success: false, error: "rate limited" },
        { channelId: "whatsapp" },
      );
      buffer.push("message_sent", row);
      await buffer.flushAll();

      const events = sink.getEvents("message_sent");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        to_id: "user-1",
        success: false,
        error: "rate limited",
        channel_id: "whatsapp",
      });
    });

    it("before_message_write captures message payload", async () => {
      const row = mapBeforeMessageWrite(
        { message: { role: "assistant", content: "ok" }, sessionKey: "sk-1", agentId: "main" },
        { sessionKey: "ctx-sk" },
      );
      buffer.push("before_message_write", row);
      await buffer.flushAll();

      const events = sink.getEvents("before_message_write");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        session_key: "sk-1",
        agent_id: "main",
        ctx_session_key: "ctx-sk",
      });
      expect(events[0].message).toContain('"role":"assistant"');
    });
  });

  // ===========================================================================
  // Tool hooks
  // ===========================================================================

  describe("tool hooks", () => {
    it("before_tool_call captures tool name and params", async () => {
      const row = mapBeforeToolCall(
        { toolName: "web_search", params: { query: "fluss docs" }, runId: "run-1", toolCallId: "tc-1" },
        { agentId: "main", sessionKey: "sk-1", toolName: "web_search", runId: "run-1", toolCallId: "tc-1", sessionId: "sess-1" },
      );
      buffer.push("before_tool_call", row);
      await buffer.flushAll();

      const events = sink.getEvents("before_tool_call");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        tool_name: "web_search",
        run_id: "run-1",
        tool_call_id: "tc-1",
        agent_id: "main",
        context_tool_name: "web_search",
        context_run_id: "run-1",
        context_session_id: "sess-1",
      });
      expect(events[0].params).toContain('"query":"fluss docs"');
    });

    it("after_tool_call captures result and duration", async () => {
      const row = mapAfterToolCall(
        { toolName: "read_file", params: { path: "/tmp/a.txt" }, result: { content: "hello" }, durationMs: 42, runId: "run-1", toolCallId: "tc-2" },
        { agentId: "main", sessionKey: "sk-1", toolName: "read_file", runId: "run-1", toolCallId: "tc-2", sessionId: "sess-1" },
      );
      buffer.push("after_tool_call", row);
      await buffer.flushAll();

      const events = sink.getEvents("after_tool_call");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        tool_name: "read_file",
        duration_ms: 42,
        run_id: "run-1",
        tool_call_id: "tc-2",
        agent_id: "main",
      });
      expect(events[0].result).toContain('"content":"hello"');
    });

    it("after_tool_call captures error case", async () => {
      const row = mapAfterToolCall(
        { toolName: "exec", params: { cmd: "ls" }, error: "permission denied", durationMs: 5 },
        { agentId: "main", sessionKey: "sk-1", toolName: "exec", sessionId: "sess-1" },
      );
      buffer.push("after_tool_call", row);
      await buffer.flushAll();

      const events = sink.getEvents("after_tool_call");
      expect(events[events.length - 1]).toMatchObject({
        tool_name: "exec",
        error: "permission denied",
        duration_ms: 5,
      });
    });

    it("tool_result_persist captures message and synthetic flag", async () => {
      const row = mapToolResultPersist(
        { toolName: "read_file", toolCallId: "tc-123", message: { text: "file content" }, isSynthetic: false },
        { agentId: "main", sessionKey: "sk-1", toolName: "read_file", toolCallId: "tc-123" },
      );
      buffer.push("tool_result_persist", row);
      await buffer.flushAll();

      const events = sink.getEvents("tool_result_persist");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        tool_name: "read_file",
        tool_call_id: "tc-123",
        is_synthetic: false,
        ctx_tool_name: "read_file",
        ctx_tool_call_id: "tc-123",
        agent_id: "main",
      });
    });
  });

  // ===========================================================================
  // Session hooks
  // ===========================================================================

  describe("session hooks", () => {
    it("session_start captures session id and resume info", async () => {
      const row = mapSessionStart(
        { sessionId: "sess-abc", resumedFrom: "sess-old", sessionKey: "sk-1" },
        { agentId: "main", sessionId: "sess-abc" },
      );
      buffer.push("session_start", row);
      await buffer.flushAll();

      const events = sink.getEvents("session_start");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        session_id: "sess-abc",
        resumed_from: "sess-old",
        session_key: "sk-1",
        agent_id: "main",
        context_session_id: "sess-abc",
      });
    });

    it("session_end captures message count and duration", async () => {
      const row = mapSessionEnd(
        { sessionId: "sess-abc", messageCount: 42, durationMs: 300000, sessionKey: "sk-1" },
        { agentId: "main", sessionId: "sess-abc" },
      );
      buffer.push("session_end", row);
      await buffer.flushAll();

      const events = sink.getEvents("session_end");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        session_id: "sess-abc",
        message_count: 42,
        duration_ms: 300000,
        session_key: "sk-1",
        agent_id: "main",
        context_session_id: "sess-abc",
      });
    });
  });

  // ===========================================================================
  // Subagent hooks
  // ===========================================================================

  describe("subagent hooks", () => {
    it("subagent_spawning captures child session and requester info", async () => {
      const row = mapSubagentSpawning(
        { childSessionKey: "child-sk-1", agentId: "researcher", label: "web-search", mode: "session", threadRequested: true, requester: { channel: "telegram", accountId: "acc-1", to: "bot-1", threadId: 42 } },
        { runId: "run-1", childSessionKey: "ctx-child", requesterSessionKey: "req-sk" },
      );
      buffer.push("subagent_spawning", row);
      await buffer.flushAll();

      const events = sink.getEvents("subagent_spawning");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        child_session_key: "child-sk-1",
        agent_id: "researcher",
        label: "web-search",
        mode: "session",
        thread_requested: true,
        run_id: "run-1",
        child_session_key_ctx: "ctx-child",
        requester_session_key: "req-sk",
      });
      expect(events[0].requester).toContain('"channel":"telegram"');
    });

    it("subagent_delivery_target captures routing context", async () => {
      const row = mapSubagentDeliveryTarget(
        { childSessionKey: "child-sk-1", requesterSessionKey: "req-sk-1", expectsCompletionMessage: true, spawnMode: "run", childRunId: "cr-1", requesterOrigin: { channel: "discord", accountId: "acc-2" } },
        { runId: "run-1", childSessionKey: "ctx-child", requesterSessionKey: "ctx-req" },
      );
      buffer.push("subagent_delivery_target", row);
      await buffer.flushAll();

      const events = sink.getEvents("subagent_delivery_target");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        child_session_key: "child-sk-1",
        requester_session_key: "req-sk-1",
        expects_completion_message: true,
        spawn_mode: "run",
        child_run_id: "cr-1",
        run_id: "run-1",
      });
      expect(events[0].requester_origin).toContain('"channel":"discord"');
    });

    it("subagent_spawned captures run id and child info", async () => {
      const row = mapSubagentSpawned(
        { childSessionKey: "child-sk-2", agentId: "coder", label: "code-review", mode: "run", threadRequested: false, runId: "spawn-r-1" },
        { runId: "ctx-r", childSessionKey: "ctx-sk", requesterSessionKey: "ctx-req" },
      );
      buffer.push("subagent_spawned", row);
      await buffer.flushAll();

      const events = sink.getEvents("subagent_spawned");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        child_session_key: "child-sk-2",
        agent_id: "coder",
        label: "code-review",
        mode: "run",
        thread_requested: false,
        run_id: "spawn-r-1",
        run_id_ctx: "ctx-r",
      });
    });

    it("subagent_ended captures outcome and error", async () => {
      const row = mapSubagentEnded(
        { targetSessionKey: "child-sk-2", targetKind: "subagent", reason: "completed", sendFarewell: true, accountId: "acc-1", runId: "run-1", endedAt: 1700000001000, outcome: "ok" },
        { runId: "ctx-r", childSessionKey: "ctx-sk", requesterSessionKey: "ctx-req" },
      );
      buffer.push("subagent_ended", row);
      await buffer.flushAll();

      const events = sink.getEvents("subagent_ended");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        target_session_key: "child-sk-2",
        target_kind: "subagent",
        reason: "completed",
        send_farewell: true,
        account_id: "acc-1",
        run_id: "run-1",
        ended_at: 1700000001000,
        outcome: "ok",
        run_id_ctx: "ctx-r",
      });
    });

    it("subagent_ended captures error outcome", async () => {
      const row = mapSubagentEnded(
        { targetSessionKey: "child-sk-3", targetKind: "subagent", reason: "crash", outcome: "error", error: "OOM killed", endedAt: 1700000002000 },
        {},
      );
      buffer.push("subagent_ended", row);
      await buffer.flushAll();

      const events = sink.getEvents("subagent_ended");
      expect(events[events.length - 1]).toMatchObject({
        outcome: "error",
        error: "OOM killed",
        reason: "crash",
      });
    });
  });

  // ===========================================================================
  // Gateway hooks
  // ===========================================================================

  describe("gateway hooks", () => {
    it("gateway_start captures port", async () => {
      const row = mapGatewayStart(
        { port: 18789 },
        { port: 18789 },
      );
      buffer.push("gateway_start", row);
      await buffer.flushAll();

      const events = sink.getEvents("gateway_start");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        port: 18789,
        context_port: 18789,
      });
    });

    it("gateway_stop captures reason", async () => {
      const row = mapGatewayStop(
        { reason: "SIGTERM" },
        { port: 18789 },
      );
      buffer.push("gateway_stop", row);
      await buffer.flushAll();

      const events = sink.getEvents("gateway_stop");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        reason: "SIGTERM",
        context_port: 18789,
      });
    });
  });
});

// =============================================================================
// Full sweep: all 26 hooks in one test
// =============================================================================

describe("recording sink — all 26 hooks in one sweep", () => {
  let sink: RecordingSink;
  let buffer: MultiTableBuffer;
  let logger: PluginLogger;

  beforeEach(() => {
    sink = new RecordingSink(noOpSink);
    logger = createLogger();
    buffer = new MultiTableBuffer(sink, { ...testConfig, batchSize: 1 }, logger);
    buffer.start();
  });

  afterEach(async () => {
    await buffer.stop();
  });

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
    // RecordingSink also recorded it
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
