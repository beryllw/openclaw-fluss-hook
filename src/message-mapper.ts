import type {
  FlussMessageRow,
  PluginHookMessageReceivedEvent,
  PluginHookMessageSentEvent,
  PluginHookMessageContext,
  PluginHookAgentEndEvent,
  PluginHookAgentContext,
} from "./types.js";

/**
 * Map a message_received event to a Fluss row.
 */
export function mapMessageReceived(
  event: PluginHookMessageReceivedEvent,
  ctx: PluginHookMessageContext,
): FlussMessageRow {
  return {
    direction: "inbound",
    channel_id: ctx.channelId,
    conversation_id: ctx.conversationId ?? "",
    account_id: ctx.accountId ?? "",
    from_id: event.from,
    to_id: "",
    content: event.content,
    success: true,
    error_message: "",
    metadata: JSON.stringify(event.metadata ?? {}),
    timestamp: event.timestamp ?? Date.now(),
  };
}

/**
 * Map a message_sent event to a Fluss row.
 */
export function mapMessageSent(
  event: PluginHookMessageSentEvent,
  ctx: PluginHookMessageContext,
): FlussMessageRow {
  return {
    direction: "outbound",
    channel_id: ctx.channelId,
    conversation_id: ctx.conversationId ?? "",
    account_id: ctx.accountId ?? "",
    from_id: "",
    to_id: event.to,
    content: event.content,
    success: event.success,
    error_message: event.error ?? "",
    metadata: "{}",
    timestamp: Date.now(),
  };
}

/**
 * Extract text content from an agent message's content field.
 * Handles both string content and the array format [{ type: "text", text: "..." }].
 */
function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(
        (item): item is { type: string; text: string } =>
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "text" &&
          "text" in item &&
          typeof item.text === "string",
      )
      .map((item) => item.text)
      .join("\n");
  }
  return "";
}

/**
 * Map an agent_end event to Fluss rows.
 * Extracts both user (inbound) and assistant (outbound) messages
 * to ensure complete capture regardless of which hooks fire.
 */
export function mapAgentEnd(
  event: PluginHookAgentEndEvent,
  ctx: PluginHookAgentContext,
): FlussMessageRow[] {
  const rows: FlussMessageRow[] = [];
  const metadataObj: Record<string, unknown> = { source: "agent_end" };
  if (event.durationMs != null) metadataObj.durationMs = event.durationMs;
  if (ctx.messageProvider) metadataObj.messageProvider = ctx.messageProvider;
  if (ctx.agentId) metadataObj.agentId = ctx.agentId;
  const metadata = JSON.stringify(metadataObj);

  for (const msg of event.messages) {
    if (typeof msg !== "object" || msg === null) continue;
    const m = msg as Record<string, unknown>;

    const role = m.role;
    if (role !== "user" && role !== "assistant") continue;

    const text = extractTextFromContent(m.content);
    if (!text.trim()) continue;

    const isOutbound = role === "assistant";

    rows.push({
      direction: isOutbound ? "outbound" : "inbound",
      channel_id: "",
      conversation_id: ctx.sessionKey ?? "",
      account_id: "",
      from_id: isOutbound ? (ctx.agentId ?? "agent") : "user",
      to_id: isOutbound ? "user" : (ctx.agentId ?? "agent"),
      content: text,
      success: event.success,
      error_message: event.error ?? "",
      metadata,
      timestamp: typeof m.timestamp === "number" ? m.timestamp : Date.now(),
    });
  }

  return rows;
}
