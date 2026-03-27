import { describe, it, expect } from "vitest";
import { mapMessageReceived, mapMessageSent, mapAgentEnd } from "../src/message-mapper.js";
import type {
  PluginHookMessageReceivedEvent,
  PluginHookMessageSentEvent,
  PluginHookMessageContext,
  PluginHookAgentEndEvent,
  PluginHookAgentContext,
} from "../src/types.js";

describe("mapMessageReceived", () => {
  const baseCtx: PluginHookMessageContext = {
    channelId: "telegram",
    accountId: "acc-123",
    conversationId: "conv-456",
  };

  it("maps all fields correctly", () => {
    const event: PluginHookMessageReceivedEvent = {
      from: "user-789",
      content: "Hello world",
      timestamp: 1700000000000,
      metadata: { lang: "en" },
    };

    const row = mapMessageReceived(event, baseCtx);

    expect(row).toEqual({
      direction: "inbound",
      channel_id: "telegram",
      conversation_id: "conv-456",
      account_id: "acc-123",
      from_id: "user-789",
      to_id: "",
      content: "Hello world",
      success: true,
      error_message: "",
      metadata: '{"lang":"en"}',
      timestamp: 1700000000000,
    });
  });

  it("handles missing optional fields", () => {
    const event: PluginHookMessageReceivedEvent = {
      from: "user-1",
      content: "test",
    };
    const ctx: PluginHookMessageContext = {
      channelId: "whatsapp",
    };

    const row = mapMessageReceived(event, ctx);

    expect(row.conversation_id).toBe("");
    expect(row.account_id).toBe("");
    expect(row.metadata).toBe("{}");
    expect(row.timestamp).toBeGreaterThan(0);
  });

  it("uses event timestamp when provided", () => {
    const event: PluginHookMessageReceivedEvent = {
      from: "u1",
      content: "msg",
      timestamp: 1234567890,
    };

    const row = mapMessageReceived(event, baseCtx);
    expect(row.timestamp).toBe(1234567890);
  });

  it("falls back to Date.now() when timestamp missing", () => {
    const before = Date.now();
    const event: PluginHookMessageReceivedEvent = {
      from: "u1",
      content: "msg",
    };

    const row = mapMessageReceived(event, baseCtx);
    const after = Date.now();

    expect(row.timestamp).toBeGreaterThanOrEqual(before);
    expect(row.timestamp).toBeLessThanOrEqual(after);
  });
});

describe("mapMessageSent", () => {
  const baseCtx: PluginHookMessageContext = {
    channelId: "discord",
    accountId: "acc-001",
    conversationId: "conv-002",
  };

  it("maps successful outbound message", () => {
    const event: PluginHookMessageSentEvent = {
      to: "user-100",
      content: "Reply text",
      success: true,
    };

    const row = mapMessageSent(event, baseCtx);

    expect(row.direction).toBe("outbound");
    expect(row.channel_id).toBe("discord");
    expect(row.conversation_id).toBe("conv-002");
    expect(row.account_id).toBe("acc-001");
    expect(row.from_id).toBe("");
    expect(row.to_id).toBe("user-100");
    expect(row.content).toBe("Reply text");
    expect(row.success).toBe(true);
    expect(row.error_message).toBe("");
    expect(row.metadata).toBe("{}");
    expect(row.timestamp).toBeGreaterThan(0);
  });

  it("maps failed outbound message with error", () => {
    const event: PluginHookMessageSentEvent = {
      to: "user-200",
      content: "Failed msg",
      success: false,
      error: "Network timeout",
    };

    const row = mapMessageSent(event, baseCtx);

    expect(row.success).toBe(false);
    expect(row.error_message).toBe("Network timeout");
  });

  it("handles missing optional context fields", () => {
    const event: PluginHookMessageSentEvent = {
      to: "u1",
      content: "hi",
      success: true,
    };
    const ctx: PluginHookMessageContext = {
      channelId: "slack",
    };

    const row = mapMessageSent(event, ctx);

    expect(row.conversation_id).toBe("");
    expect(row.account_id).toBe("");
  });
});

describe("mapAgentEnd", () => {
  const baseCtx: PluginHookAgentContext = {
    agentId: "main",
    sessionKey: "main:session-1",
    messageProvider: "bailian",
  };

  it("extracts both user and assistant messages", () => {
    const event: PluginHookAgentEndEvent = {
      messages: [
        { role: "user", content: [{ type: "text", text: "Hello" }], timestamp: 900 },
        { role: "assistant", content: [{ type: "text", text: "Hi there!" }], timestamp: 1000 },
      ],
      success: true,
      durationMs: 500,
    };

    const rows = mapAgentEnd(event, baseCtx);

    expect(rows).toHaveLength(2);
    // Inbound user message
    expect(rows[0]).toMatchObject({
      direction: "inbound",
      conversation_id: "main:session-1",
      from_id: "user",
      to_id: "main",
      content: "Hello",
      timestamp: 900,
    });
    // Outbound assistant message
    expect(rows[1]).toMatchObject({
      direction: "outbound",
      conversation_id: "main:session-1",
      from_id: "main",
      to_id: "user",
      content: "Hi there!",
      success: true,
      error_message: "",
      timestamp: 1000,
    });
    const meta = JSON.parse(rows[1].metadata);
    expect(meta.durationMs).toBe(500);
    expect(meta.messageProvider).toBe("bailian");
    expect(meta.agentId).toBe("main");
    expect(meta.source).toBe("agent_end");
  });

  it("handles multiple rounds of conversation", () => {
    const event: PluginHookAgentEndEvent = {
      messages: [
        { role: "user", content: [{ type: "text", text: "Q1" }], timestamp: 100 },
        { role: "assistant", content: [{ type: "text", text: "A1" }], timestamp: 150 },
        { role: "user", content: [{ type: "text", text: "Q2" }], timestamp: 200 },
        { role: "assistant", content: [{ type: "text", text: "A2" }], timestamp: 250 },
      ],
      success: true,
    };

    const rows = mapAgentEnd(event, baseCtx);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ direction: "inbound", content: "Q1" });
    expect(rows[1]).toMatchObject({ direction: "outbound", content: "A1" });
    expect(rows[2]).toMatchObject({ direction: "inbound", content: "Q2" });
    expect(rows[3]).toMatchObject({ direction: "outbound", content: "A2" });
  });

  it("returns empty array when no user or assistant messages", () => {
    const event: PluginHookAgentEndEvent = {
      messages: [
        { role: "system", content: [{ type: "text", text: "System prompt" }] },
        { role: "tool", content: [{ type: "text", text: "tool result" }] },
      ],
      success: true,
    };

    const rows = mapAgentEnd(event, baseCtx);
    expect(rows).toHaveLength(0);
  });

  it("returns empty array for empty messages", () => {
    const event: PluginHookAgentEndEvent = {
      messages: [],
      success: true,
    };

    const rows = mapAgentEnd(event, baseCtx);
    expect(rows).toHaveLength(0);
  });

  it("skips messages with empty content", () => {
    const event: PluginHookAgentEndEvent = {
      messages: [
        { role: "user", content: [{ type: "text", text: "" }] },
        { role: "assistant", content: [{ type: "text", text: "   " }] },
        { role: "assistant", content: [{ type: "text", text: "Valid" }], timestamp: 300 },
      ],
      success: true,
    };

    const rows = mapAgentEnd(event, baseCtx);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("Valid");
  });

  it("handles string content format", () => {
    const event: PluginHookAgentEndEvent = {
      messages: [
        { role: "assistant", content: "Plain string response", timestamp: 400 },
      ],
      success: true,
    };

    const rows = mapAgentEnd(event, baseCtx);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("Plain string response");
  });

  it("handles failed agent runs", () => {
    const event: PluginHookAgentEndEvent = {
      messages: [
        { role: "assistant", content: [{ type: "text", text: "Partial" }], timestamp: 500 },
      ],
      success: false,
      error: "model timeout",
    };

    const rows = mapAgentEnd(event, baseCtx);
    expect(rows).toHaveLength(1);
    expect(rows[0].success).toBe(false);
    expect(rows[0].error_message).toBe("model timeout");
  });

  it("uses Date.now() when message has no timestamp", () => {
    const before = Date.now();
    const event: PluginHookAgentEndEvent = {
      messages: [
        { role: "assistant", content: [{ type: "text", text: "No ts" }] },
      ],
      success: true,
    };

    const rows = mapAgentEnd(event, baseCtx);
    const after = Date.now();

    expect(rows[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(rows[0].timestamp).toBeLessThanOrEqual(after);
  });

  it("handles missing optional context fields", () => {
    const event: PluginHookAgentEndEvent = {
      messages: [
        { role: "assistant", content: "Test", timestamp: 600 },
      ],
      success: true,
    };
    const ctx: PluginHookAgentContext = {};

    const rows = mapAgentEnd(event, ctx);
    expect(rows[0].conversation_id).toBe("");
    expect(rows[0].from_id).toBe("agent");
    const meta = JSON.parse(rows[0].metadata);
    expect(meta).toEqual({ source: "agent_end" });
  });

  it("skips non-object messages", () => {
    const event: PluginHookAgentEndEvent = {
      messages: [null, undefined, 42, "string", { role: "assistant", content: "OK", timestamp: 700 }] as unknown[],
      success: true,
    };

    const rows = mapAgentEnd(event, baseCtx);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("OK");
  });
});
