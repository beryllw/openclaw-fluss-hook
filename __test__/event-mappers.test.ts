import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

// Fix Date.now for deterministic tests
const NOW = 1700000000000;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

// =============================================================================
// Agent Hooks
// =============================================================================

describe("mapBeforeModelResolve", () => {
  it("maps all fields", () => {
    const row = mapBeforeModelResolve(
      { prompt: "resolve-model" },
      { agentId: "main", sessionKey: "s1", sessionId: "sess-1", trigger: "api", channelId: "ch-1", runId: "run-1" },
    );
    expect(row.prompt).toBe("resolve-model");
    expect(row.agent_id).toBe("main");
    expect(row.run_id).toBe("run-1");
    expect(row.timestamp).toBe(NOW);
  });
});

describe("mapBeforePromptBuild", () => {
  it("maps all fields", () => {
    const row = mapBeforePromptBuild(
      { prompt: "build", messages: [{ role: "user", content: "hi" }] },
      { agentId: "main", sessionKey: "s1", sessionId: "sess-1", trigger: "api", channelId: "ch-1" },
    );
    expect(row.prompt).toBe("build");
    expect(row.messages).toBe(JSON.stringify([{ role: "user", content: "hi" }]));
    expect(row.timestamp).toBe(NOW);
  });
});

describe("mapBeforeAgentStart", () => {
  it("maps all fields", () => {
    const row = mapBeforeAgentStart(
      { prompt: "Hello", messages: [{ role: "system", content: "sys" }] },
      { agentId: "main", sessionKey: "s1", workspaceDir: "/tmp", messageProvider: "bailian", sessionId: "sess-1", trigger: "api", channelId: "ch-1" },
    );
    expect(row).toEqual({
      prompt: "Hello",
      messages: JSON.stringify([{ role: "system", content: "sys" }]),
      agent_id: "main",
      session_key: "s1",
      workspace_dir: "/tmp",
      message_provider: "bailian",
      session_id: "sess-1",
      trigger: "api",
      channel_id: "ch-1",
      run_id: "",
      timestamp: NOW,
    });
  });

  it("handles missing optional fields", () => {
    const row = mapBeforeAgentStart({ prompt: "test" }, {});
    expect(row.agent_id).toBe("");
    expect(row.session_key).toBe("");
    expect(row.workspace_dir).toBe("");
    expect(row.message_provider).toBe("");
    expect(row.messages).toBe("null");
    expect(row.session_id).toBe("");
    expect(row.trigger).toBe("");
    expect(row.channel_id).toBe("");
    expect(row.run_id).toBe("");
  });
});

describe("mapAgentEnd", () => {
  it("maps all fields", () => {
    const msgs = [{ role: "user", content: "hi" }];
    const row = mapAgentEnd(
      { messages: msgs, success: true, error: "none", durationMs: 500 },
      { agentId: "main", sessionKey: "s1", workspaceDir: "/w", messageProvider: "p", sessionId: "sess-1", trigger: "cli", channelId: "ch-2" },
    );
    expect(row).toEqual({
      messages: JSON.stringify(msgs),
      success: true,
      error: "none",
      duration_ms: 500,
      agent_id: "main",
      session_key: "s1",
      workspace_dir: "/w",
      message_provider: "p",
      session_id: "sess-1",
      trigger: "cli",
      channel_id: "ch-2",
      run_id: "",
      timestamp: NOW,
    });
  });

  it("handles missing optional fields", () => {
    const row = mapAgentEnd({ messages: [], success: false }, {});
    expect(row.error).toBe("");
    expect(row.duration_ms).toBe(0);
    expect(row.agent_id).toBe("");
    expect(row.session_id).toBe("");
    expect(row.trigger).toBe("");
    expect(row.channel_id).toBe("");
    expect(row.run_id).toBe("");
  });
});

describe("mapBeforeCompaction", () => {
  it("maps all fields", () => {
    const row = mapBeforeCompaction(
      { messageCount: 10, tokenCount: 500, compactingCount: 7 },
      { agentId: "a1", sessionId: "sess-1", trigger: "auto", channelId: "ch-1" },
    );
    expect(row.message_count).toBe(10);
    expect(row.token_count).toBe(500);
    expect(row.compacting_count).toBe(7);
    expect(row.agent_id).toBe("a1");
    expect(row.session_id).toBe("sess-1");
    expect(row.trigger).toBe("auto");
    expect(row.channel_id).toBe("ch-1");
    expect(row.session_file).toBe("");
  });

  it("defaults tokenCount and compactingCount to 0", () => {
    const row = mapBeforeCompaction({ messageCount: 5 }, {});
    expect(row.token_count).toBe(0);
    expect(row.compacting_count).toBe(0);
    expect(row.session_id).toBe("");
    expect(row.trigger).toBe("");
    expect(row.channel_id).toBe("");
  });
});

describe("mapAfterCompaction", () => {
  it("maps all fields including compacted_count", () => {
    const row = mapAfterCompaction(
      { messageCount: 10, tokenCount: 500, compactedCount: 3 },
      { agentId: "a1", sessionId: "sess-1", trigger: "auto", channelId: "ch-1" },
    );
    expect(row.compacted_count).toBe(3);
    expect(row.message_count).toBe(10);
    expect(row.session_id).toBe("sess-1");
    expect(row.trigger).toBe("auto");
    expect(row.channel_id).toBe("ch-1");
    expect(row.session_file).toBe("");
  });
});

describe("mapBeforeReset", () => {
  it("maps all fields", () => {
    const row = mapBeforeReset(
      { sessionFile: "/tmp/sess.json", reason: "user" },
      { agentId: "a1", sessionId: "sess-1", trigger: "user", channelId: "ch-1" },
    );
    expect(row.session_file).toBe("/tmp/sess.json");
    expect(row.reason).toBe("user");
    expect(row.agent_id).toBe("a1");
    expect(row.timestamp).toBe(NOW);
  });
});

describe("mapLlmInput", () => {
  it("maps all fields", () => {
    const row = mapLlmInput(
      { runId: "r1", sessionId: "s1", provider: "openai", model: "gpt-4", prompt: "hello", historyMessages: [], imagesCount: 1 },
      { agentId: "main", sessionKey: "sk1", trigger: "api", channelId: "ch-1" },
    );
    expect(row.run_id).toBe("r1");
    expect(row.provider).toBe("openai");
    expect(row.model).toBe("gpt-4");
    expect(row.images_count).toBe(1);
    expect(row.history_messages).toBe("[]");
    expect(row.timestamp).toBe(NOW);
  });
});

describe("mapLlmOutput", () => {
  it("maps all fields", () => {
    const row = mapLlmOutput(
      { runId: "r1", sessionId: "s1", provider: "anthropic", model: "claude-4", assistantTexts: ["hello"], usage: { input: 100, output: 50 } },
      { agentId: "main", sessionKey: "sk1", trigger: "api", channelId: "ch-1" },
    );
    expect(row.run_id).toBe("r1");
    expect(row.provider).toBe("anthropic");
    expect(row.assistant_texts).toBe(JSON.stringify(["hello"]));
    expect(row.usage).toBe(JSON.stringify({ input: 100, output: 50 }));
    expect(row.timestamp).toBe(NOW);
  });
});

// =============================================================================
// Message Hooks
// =============================================================================

describe("mapInboundClaim", () => {
  it("maps all fields", () => {
    const row = mapInboundClaim(
      { content: "hi", body: "hi body", channel: "telegram", isGroup: true, wasMentioned: true, senderName: "Alice", senderUsername: "@alice", threadId: 42 },
      { channelId: "telegram", accountId: "acc-1", conversationId: "conv-1", parentConversationId: "parent-1", senderId: "user-1", messageId: "msg-1" },
    );
    expect(row.content).toBe("hi");
    expect(row.channel).toBe("telegram");
    expect(row.is_group).toBe(true);
    expect(row.was_mentioned).toBe(true);
    expect(row.sender_name).toBe("Alice");
    expect(row.sender_id).toBe("user-1");
    expect(row.channel_id).toBe("telegram");
    expect(row.timestamp).toBe(NOW);
  });
});

describe("mapBeforeDispatch", () => {
  it("maps all fields", () => {
    const row = mapBeforeDispatch(
      { content: "dispatch me", body: "body", channel: "discord", isGroup: false, timestamp: 12345 },
      { channelId: "discord", accountId: "acc-1", conversationId: "conv-1" },
    );
    expect(row.content).toBe("dispatch me");
    expect(row.channel).toBe("discord");
    expect(row.channel_id).toBe("discord");
    expect(row.event_timestamp).toBe(12345);
    expect(row.timestamp).toBe(NOW);
  });
});

describe("mapMessageReceived", () => {
  it("maps all fields", () => {
    const row = mapMessageReceived(
      { from: "user-1", content: "Hello", timestamp: 9999, metadata: { lang: "en" } },
      { channelId: "telegram", accountId: "acc-1", conversationId: "conv-1" },
    );
    expect(row).toEqual({
      from_id: "user-1",
      content: "Hello",
      event_timestamp: 9999,
      metadata: JSON.stringify({ lang: "en" }),
      channel_id: "telegram",
      account_id: "acc-1",
      conversation_id: "conv-1",
      timestamp: NOW,
    });
  });

  it("handles missing optional fields", () => {
    const row = mapMessageReceived(
      { from: "u1", content: "test" },
      { channelId: "webchat" },
    );
    expect(row.event_timestamp).toBe(0);
    expect(row.metadata).toBe("null");
    expect(row.account_id).toBe("");
    expect(row.conversation_id).toBe("");
  });
});

describe("mapMessageSending", () => {
  it("maps all fields", () => {
    const row = mapMessageSending(
      { to: "user-1", content: "Reply", metadata: { key: "val" } },
      { channelId: "slack", accountId: "acc-1", conversationId: "conv-1" },
    );
    expect(row.to_id).toBe("user-1");
    expect(row.content).toBe("Reply");
    expect(row.metadata).toBe(JSON.stringify({ key: "val" }));
    expect(row.channel_id).toBe("slack");
    expect(row.timestamp).toBe(NOW);
  });
});

describe("mapMessageSent", () => {
  it("maps successful message", () => {
    const row = mapMessageSent(
      { to: "user-1", content: "Done", success: true },
      { channelId: "discord", accountId: "acc-1", conversationId: "conv-1" },
    );
    expect(row.success).toBe(true);
    expect(row.error).toBe("");
    expect(row.channel_id).toBe("discord");
    expect(row.timestamp).toBe(NOW);
  });

  it("maps failed message with error", () => {
    const row = mapMessageSent(
      { to: "user-1", content: "Fail", success: false, error: "timeout" },
      { channelId: "discord" },
    );
    expect(row.success).toBe(false);
    expect(row.error).toBe("timeout");
  });
});

describe("mapBeforeMessageWrite", () => {
  it("maps all fields", () => {
    const row = mapBeforeMessageWrite(
      { message: { role: "assistant", content: "ok" }, sessionKey: "sk-1", agentId: "a1" },
      { sessionKey: "ctx-sk" },
    );
    expect(row.message).toBe(JSON.stringify({ role: "assistant", content: "ok" }));
    expect(row.session_key).toBe("sk-1");
    expect(row.agent_id).toBe("a1");
    expect(row.ctx_session_key).toBe("ctx-sk");
    expect(row.timestamp).toBe(NOW);
  });
});

// =============================================================================
// Tool Hooks
// =============================================================================

describe("mapBeforeToolCall", () => {
  it("maps all fields", () => {
    const row = mapBeforeToolCall(
      { toolName: "search", params: { q: "test" }, runId: "run-1", toolCallId: "tc-1" },
      { agentId: "a1", sessionKey: "s1", toolName: "search", runId: "run-1", toolCallId: "tc-1", sessionId: "sess-1" },
    );
    expect(row.tool_name).toBe("search");
    expect(row.params).toBe(JSON.stringify({ q: "test" }));
    expect(row.run_id).toBe("run-1");
    expect(row.tool_call_id).toBe("tc-1");
    expect(row.context_tool_name).toBe("search");
    expect(row.context_run_id).toBe("run-1");
    expect(row.context_tool_call_id).toBe("tc-1");
    expect(row.context_session_id).toBe("sess-1");
  });

  it("handles missing optional fields", () => {
    const row = mapBeforeToolCall(
      { toolName: "t", params: {} },
      { toolName: "t" },
    );
    expect(row.run_id).toBe("");
    expect(row.tool_call_id).toBe("");
    expect(row.context_run_id).toBe("");
    expect(row.context_tool_call_id).toBe("");
    expect(row.context_session_id).toBe("");
  });
});

describe("mapAfterToolCall", () => {
  it("maps all fields", () => {
    const row = mapAfterToolCall(
      { toolName: "search", params: { q: "t" }, result: { data: 1 }, error: "err", durationMs: 100, runId: "run-1", toolCallId: "tc-1" },
      { agentId: "a1", sessionKey: "s1", toolName: "search", runId: "run-1", toolCallId: "tc-1", sessionId: "sess-1" },
    );
    expect(row.result).toBe(JSON.stringify({ data: 1 }));
    expect(row.error).toBe("err");
    expect(row.duration_ms).toBe(100);
    expect(row.run_id).toBe("run-1");
    expect(row.tool_call_id).toBe("tc-1");
    expect(row.context_run_id).toBe("run-1");
    expect(row.context_tool_call_id).toBe("tc-1");
    expect(row.context_session_id).toBe("sess-1");
  });

  it("handles missing optional fields", () => {
    const row = mapAfterToolCall(
      { toolName: "t", params: {} },
      { toolName: "t" },
    );
    expect(row.result).toBe("null");
    expect(row.error).toBe("");
    expect(row.duration_ms).toBe(0);
    expect(row.run_id).toBe("");
    expect(row.tool_call_id).toBe("");
    expect(row.context_run_id).toBe("");
    expect(row.context_tool_call_id).toBe("");
    expect(row.context_session_id).toBe("");
  });
});

describe("mapToolResultPersist", () => {
  it("maps all fields", () => {
    const row = mapToolResultPersist(
      { toolName: "read", toolCallId: "tc-1", message: { text: "ok" }, isSynthetic: true },
      { agentId: "a1", sessionKey: "s1", toolName: "read", toolCallId: "tc-1" },
    );
    expect(row.tool_name).toBe("read");
    expect(row.tool_call_id).toBe("tc-1");
    expect(row.message).toBe(JSON.stringify({ text: "ok" }));
    expect(row.is_synthetic).toBe(true);
    expect(row.ctx_tool_name).toBe("read");
    expect(row.ctx_tool_call_id).toBe("tc-1");
  });

  it("handles missing optional fields", () => {
    const row = mapToolResultPersist({ message: "simple" }, {});
    expect(row.tool_name).toBe("");
    expect(row.tool_call_id).toBe("");
    expect(row.is_synthetic).toBe(false);
    expect(row.ctx_tool_name).toBe("");
    expect(row.ctx_tool_call_id).toBe("");
  });
});

// =============================================================================
// Session Hooks
// =============================================================================

describe("mapSessionStart", () => {
  it("maps all fields", () => {
    const row = mapSessionStart(
      { sessionId: "sess-1", resumedFrom: "sess-0", sessionKey: "sk-1" },
      { agentId: "a1", sessionId: "sess-1" },
    );
    expect(row.session_id).toBe("sess-1");
    expect(row.resumed_from).toBe("sess-0");
    expect(row.session_key).toBe("sk-1");
    expect(row.agent_id).toBe("a1");
    expect(row.context_session_id).toBe("sess-1");
  });

  it("handles missing optional fields", () => {
    const row = mapSessionStart(
      { sessionId: "s1" },
      { sessionId: "s1" },
    );
    expect(row.resumed_from).toBe("");
    expect(row.session_key).toBe("");
    expect(row.agent_id).toBe("");
  });
});

describe("mapSessionEnd", () => {
  it("maps all fields", () => {
    const row = mapSessionEnd(
      { sessionId: "sess-1", messageCount: 20, durationMs: 60000, sessionKey: "sk-1" },
      { agentId: "a1", sessionId: "sess-1" },
    );
    expect(row.session_id).toBe("sess-1");
    expect(row.message_count).toBe(20);
    expect(row.duration_ms).toBe(60000);
    expect(row.session_key).toBe("sk-1");
    expect(row.context_session_id).toBe("sess-1");
  });

  it("defaults durationMs and sessionKey", () => {
    const row = mapSessionEnd(
      { sessionId: "s1", messageCount: 5 },
      { sessionId: "s1" },
    );
    expect(row.duration_ms).toBe(0);
    expect(row.session_key).toBe("");
  });
});

// =============================================================================
// Subagent Hooks
// =============================================================================

describe("mapSubagentSpawning", () => {
  it("maps all fields", () => {
    const row = mapSubagentSpawning(
      { childSessionKey: "child-sk", agentId: "a1", label: "researcher", mode: "session", threadRequested: true, requester: { channel: "telegram", accountId: "acc-1" } },
      { runId: "r1", childSessionKey: "ctx-child-sk", requesterSessionKey: "req-sk" },
    );
    expect(row.child_session_key).toBe("child-sk");
    expect(row.agent_id).toBe("a1");
    expect(row.label).toBe("researcher");
    expect(row.mode).toBe("session");
    expect(row.thread_requested).toBe(true);
    expect(row.requester).toBe(JSON.stringify({ channel: "telegram", accountId: "acc-1" }));
    expect(row.run_id).toBe("r1");
    expect(row.child_session_key_ctx).toBe("ctx-child-sk");
    expect(row.requester_session_key).toBe("req-sk");
  });
});

describe("mapSubagentDeliveryTarget", () => {
  it("maps all fields", () => {
    const row = mapSubagentDeliveryTarget(
      { childSessionKey: "child-sk", requesterSessionKey: "req-sk", expectsCompletionMessage: true, spawnMode: "run", childRunId: "cr1" },
      { runId: "r1", childSessionKey: "ctx-sk", requesterSessionKey: "ctx-req-sk" },
    );
    expect(row.child_session_key).toBe("child-sk");
    expect(row.requester_session_key).toBe("req-sk");
    expect(row.expects_completion_message).toBe(true);
    expect(row.spawn_mode).toBe("run");
    expect(row.child_run_id).toBe("cr1");
    expect(row.run_id).toBe("r1");
  });
});

describe("mapSubagentSpawned", () => {
  it("maps all fields", () => {
    const row = mapSubagentSpawned(
      { childSessionKey: "child-sk", agentId: "a1", mode: "run", threadRequested: false, runId: "spawn-r1" },
      { runId: "ctx-r1", childSessionKey: "ctx-sk", requesterSessionKey: "ctx-req" },
    );
    expect(row.child_session_key).toBe("child-sk");
    expect(row.run_id).toBe("spawn-r1");
    expect(row.run_id_ctx).toBe("ctx-r1");
    expect(row.thread_requested).toBe(false);
  });
});

describe("mapSubagentEnded", () => {
  it("maps all fields", () => {
    const row = mapSubagentEnded(
      { targetSessionKey: "target-sk", targetKind: "subagent", reason: "done", outcome: "ok", endedAt: 999, sendFarewell: true },
      { runId: "r1", childSessionKey: "ctx-sk", requesterSessionKey: "ctx-req" },
    );
    expect(row.target_session_key).toBe("target-sk");
    expect(row.target_kind).toBe("subagent");
    expect(row.outcome).toBe("ok");
    expect(row.ended_at).toBe(999);
    expect(row.send_farewell).toBe(true);
    expect(row.run_id_ctx).toBe("r1");
  });
});

// =============================================================================
// Gateway Hooks
// =============================================================================

describe("mapGatewayStart", () => {
  it("maps all fields", () => {
    const row = mapGatewayStart({ port: 3000 }, { port: 3000 });
    expect(row.port).toBe(3000);
    expect(row.context_port).toBe(3000);
    expect(row.timestamp).toBe(NOW);
  });

  it("handles missing context port", () => {
    const row = mapGatewayStart({ port: 8080 }, {});
    expect(row.context_port).toBe(0);
  });
});

describe("mapGatewayStop", () => {
  it("maps all fields", () => {
    const row = mapGatewayStop({ reason: "shutdown" }, { port: 3000 });
    expect(row.reason).toBe("shutdown");
    expect(row.context_port).toBe(3000);
  });

  it("handles missing optional fields", () => {
    const row = mapGatewayStop({}, {});
    expect(row.reason).toBe("");
    expect(row.context_port).toBe(0);
  });
});

// =============================================================================
// Schema-Mapper Alignment: ensure every mapper's output keys match its schema
// =============================================================================

import { getColumnNames, getAllHookNames } from "../src/schema.js";
import type { PluginHookName } from "../src/types.js";

const mapperForHook: Record<PluginHookName, (event: any, ctx: any) => Record<string, unknown>> = {
  before_model_resolve: mapBeforeModelResolve,
  before_prompt_build: mapBeforePromptBuild,
  before_agent_start: mapBeforeAgentStart,
  agent_end: mapAgentEnd,
  before_compaction: mapBeforeCompaction,
  after_compaction: mapAfterCompaction,
  before_reset: mapBeforeReset,
  llm_input: mapLlmInput,
  llm_output: mapLlmOutput,
  inbound_claim: mapInboundClaim,
  before_dispatch: mapBeforeDispatch,
  message_received: mapMessageReceived,
  message_sending: mapMessageSending,
  message_sent: mapMessageSent,
  before_message_write: mapBeforeMessageWrite,
  before_tool_call: mapBeforeToolCall,
  after_tool_call: mapAfterToolCall,
  tool_result_persist: mapToolResultPersist,
  session_start: mapSessionStart,
  session_end: mapSessionEnd,
  subagent_spawning: mapSubagentSpawning,
  subagent_delivery_target: mapSubagentDeliveryTarget,
  subagent_spawned: mapSubagentSpawned,
  subagent_ended: mapSubagentEnded,
  gateway_start: mapGatewayStart,
  gateway_stop: mapGatewayStop,
};

const minimalEvent: Record<PluginHookName, [any, any]> = {
  before_model_resolve: [{ prompt: "" }, {}],
  before_prompt_build: [{ prompt: "" }, {}],
  before_agent_start: [{ prompt: "" }, {}],
  agent_end: [{ messages: [], success: true }, {}],
  before_compaction: [{ messageCount: 0 }, {}],
  after_compaction: [{ messageCount: 0, compactedCount: 0 }, {}],
  before_reset: [{}, {}],
  llm_input: [{ runId: "", sessionId: "", provider: "", model: "", prompt: "", historyMessages: [], imagesCount: 0 }, {}],
  llm_output: [{ runId: "", sessionId: "", provider: "", model: "", assistantTexts: [] }, {}],
  inbound_claim: [{ content: "", channel: "web", isGroup: false }, { channelId: "" }],
  before_dispatch: [{ content: "" }, { channelId: "" }],
  message_received: [{ from: "", content: "" }, { channelId: "" }],
  message_sending: [{ to: "", content: "" }, { channelId: "" }],
  message_sent: [{ to: "", content: "", success: true }, { channelId: "" }],
  before_message_write: [{ message: "" }, {}],
  before_tool_call: [{ toolName: "", params: {} }, { toolName: "" }],
  after_tool_call: [{ toolName: "", params: {} }, { toolName: "" }],
  tool_result_persist: [{ message: "" }, {}],
  session_start: [{ sessionId: "" }, { sessionId: "" }],
  session_end: [{ sessionId: "", messageCount: 0 }, { sessionId: "" }],
  subagent_spawning: [{ childSessionKey: "sk", agentId: "a", mode: "run", threadRequested: false }, {}],
  subagent_delivery_target: [{ childSessionKey: "sk", requesterSessionKey: "rsk", expectsCompletionMessage: false }, {}],
  subagent_spawned: [{ childSessionKey: "sk", agentId: "a", mode: "run", threadRequested: false, runId: "r" }, {}],
  subagent_ended: [{ targetSessionKey: "tsk", targetKind: "subagent", reason: "done" }, {}],
  gateway_start: [{ port: 0 }, {}],
  gateway_stop: [{}, {}],
};

describe("schema-mapper alignment", () => {
  for (const hookName of getAllHookNames()) {
    it(`${hookName}: mapper output keys match schema columns`, () => {
      const [event, ctx] = minimalEvent[hookName];
      const row = mapperForHook[hookName](event, ctx);
      const mapperKeys = Object.keys(row).sort();
      const schemaKeys = getColumnNames(hookName).sort();
      expect(mapperKeys).toEqual(schemaKeys);
    });
  }
});
