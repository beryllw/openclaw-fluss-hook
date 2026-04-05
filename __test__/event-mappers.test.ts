import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mapBeforeAgentStart,
  mapAgentEnd,
  mapBeforeCompaction,
  mapAfterCompaction,
  mapMessageReceived,
  mapMessageSending,
  mapMessageSent,
  mapBeforeToolCall,
  mapAfterToolCall,
  mapToolResultPersist,
  mapSessionStart,
  mapSessionEnd,
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
  });
});

// =============================================================================
// Message Hooks
// =============================================================================

describe("mapMessageReceived", () => {
  it("maps all fields", () => {
    const row = mapMessageReceived(
      { from: "user-1", content: "Hello", timestamp: 9999, metadata: { lang: "en" } },
      { channelId: "telegram", accountId: "acc-1", conversationId: "conv-1", messageId: "msg-1", isGroup: true, groupId: "grp-1" },
    );
    expect(row).toEqual({
      from_id: "user-1",
      content: "Hello",
      event_timestamp: 9999,
      metadata: JSON.stringify({ lang: "en" }),
      channel_id: "telegram",
      account_id: "acc-1",
      conversation_id: "conv-1",
      message_id: "msg-1",
      is_group: true,
      group_id: "grp-1",
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
    expect(row.message_id).toBe("");
    expect(row.is_group).toBe(false);
    expect(row.group_id).toBe("");
  });
});

describe("mapMessageSending", () => {
  it("maps all fields", () => {
    const row = mapMessageSending(
      { to: "user-1", content: "Reply", metadata: { key: "val" } },
      { channelId: "slack", accountId: "acc-1", conversationId: "conv-1", messageId: "msg-2", isGroup: false, groupId: "" },
    );
    expect(row.to_id).toBe("user-1");
    expect(row.content).toBe("Reply");
    expect(row.metadata).toBe(JSON.stringify({ key: "val" }));
    expect(row.channel_id).toBe("slack");
    expect(row.message_id).toBe("msg-2");
    expect(row.is_group).toBe(false);
    expect(row.group_id).toBe("");
  });
});

describe("mapMessageSent", () => {
  it("maps successful message", () => {
    const row = mapMessageSent(
      { to: "user-1", content: "Done", success: true },
      { channelId: "discord", messageId: "msg-3", isGroup: true, groupId: "grp-2" },
    );
    expect(row.success).toBe(true);
    expect(row.error).toBe("");
    expect(row.message_id).toBe("msg-3");
    expect(row.is_group).toBe(true);
    expect(row.group_id).toBe("grp-2");
  });

  it("maps failed message with error", () => {
    const row = mapMessageSent(
      { to: "user-1", content: "Fail", success: false, error: "timeout" },
      { channelId: "discord" },
    );
    expect(row.success).toBe(false);
    expect(row.error).toBe("timeout");
    expect(row.message_id).toBe("");
    expect(row.is_group).toBe(false);
    expect(row.group_id).toBe("");
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
  before_agent_start: mapBeforeAgentStart,
  agent_end: mapAgentEnd,
  before_compaction: mapBeforeCompaction,
  after_compaction: mapAfterCompaction,
  message_received: mapMessageReceived,
  message_sending: mapMessageSending,
  message_sent: mapMessageSent,
  before_tool_call: mapBeforeToolCall,
  after_tool_call: mapAfterToolCall,
  tool_result_persist: mapToolResultPersist,
  session_start: mapSessionStart,
  session_end: mapSessionEnd,
  gateway_start: mapGatewayStart,
  gateway_stop: mapGatewayStop,
};

const minimalEvent: Record<PluginHookName, [any, any]> = {
  before_agent_start: [{ prompt: "" }, {}],
  agent_end: [{ messages: [], success: true }, {}],
  before_compaction: [{ messageCount: 0 }, {}],
  after_compaction: [{ messageCount: 0, compactedCount: 0 }, {}],
  message_received: [{ from: "", content: "" }, { channelId: "" }],
  message_sending: [{ to: "", content: "" }, { channelId: "" }],
  message_sent: [{ to: "", content: "", success: true }, { channelId: "" }],
  before_tool_call: [{ toolName: "", params: {} }, { toolName: "" }],
  after_tool_call: [{ toolName: "", params: {} }, { toolName: "" }],
  tool_result_persist: [{ message: "" }, {}],
  session_start: [{ sessionId: "" }, { sessionId: "" }],
  session_end: [{ sessionId: "", messageCount: 0 }, { sessionId: "" }],
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
