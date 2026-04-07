import type {
  PluginHookBeforeAgentStartEvent,
  PluginHookAgentEndEvent,
  PluginHookBeforeCompactionEvent,
  PluginHookAfterCompactionEvent,
  PluginHookAgentContext,
  PluginHookMessageReceivedEvent,
  PluginHookMessageSendingEvent,
  PluginHookMessageSentEvent,
  PluginHookMessageContext,
  PluginHookBeforeToolCallEvent,
  PluginHookAfterToolCallEvent,
  PluginHookToolResultPersistEvent,
  PluginHookToolContext,
  PluginHookToolResultPersistContext,
  PluginHookSessionStartEvent,
  PluginHookSessionEndEvent,
  PluginHookSessionContext,
  PluginHookGatewayStartEvent,
  PluginHookGatewayStopEvent,
  PluginHookGatewayContext,
} from "./types.js";

function safeJson(val: unknown): string {
  try {
    return JSON.stringify(val ?? null);
  } catch {
    return "null";
  }
}

// =============================================================================
// Agent Hooks
// =============================================================================

export function mapBeforeAgentStart(
  event: PluginHookBeforeAgentStartEvent,
  ctx: PluginHookAgentContext,
): Record<string, unknown> {
  return {
    prompt: event.prompt,
    messages: safeJson(event.messages),
    agent_id: ctx.agentId ?? "",
    session_key: ctx.sessionKey ?? "",
    workspace_dir: ctx.workspaceDir ?? "",
    message_provider: ctx.messageProvider ?? "",
    session_id: ctx.sessionId ?? "",
    trigger: ctx.trigger ?? "",
    channel_id: ctx.channelId ?? "",
    timestamp: Date.now(),
  };
}

export function mapAgentEnd(
  event: PluginHookAgentEndEvent,
  ctx: PluginHookAgentContext,
): Record<string, unknown> {
  return {
    messages: safeJson(event.messages),
    success: event.success,
    error: event.error ?? "",
    duration_ms: event.durationMs ?? 0,
    agent_id: ctx.agentId ?? "",
    session_key: ctx.sessionKey ?? "",
    workspace_dir: ctx.workspaceDir ?? "",
    message_provider: ctx.messageProvider ?? "",
    session_id: ctx.sessionId ?? "",
    trigger: ctx.trigger ?? "",
    channel_id: ctx.channelId ?? "",
    timestamp: Date.now(),
  };
}

export function mapBeforeCompaction(
  event: PluginHookBeforeCompactionEvent,
  ctx: PluginHookAgentContext,
): Record<string, unknown> {
  return {
    message_count: event.messageCount,
    token_count: event.tokenCount ?? 0,
    compacting_count: event.compactingCount ?? 0,
    agent_id: ctx.agentId ?? "",
    session_key: ctx.sessionKey ?? "",
    workspace_dir: ctx.workspaceDir ?? "",
    message_provider: ctx.messageProvider ?? "",
    session_id: ctx.sessionId ?? "",
    trigger: ctx.trigger ?? "",
    channel_id: ctx.channelId ?? "",
    timestamp: Date.now(),
  };
}

export function mapAfterCompaction(
  event: PluginHookAfterCompactionEvent,
  ctx: PluginHookAgentContext,
): Record<string, unknown> {
  return {
    message_count: event.messageCount,
    token_count: event.tokenCount ?? 0,
    compacted_count: event.compactedCount,
    agent_id: ctx.agentId ?? "",
    session_key: ctx.sessionKey ?? "",
    workspace_dir: ctx.workspaceDir ?? "",
    message_provider: ctx.messageProvider ?? "",
    session_id: ctx.sessionId ?? "",
    trigger: ctx.trigger ?? "",
    channel_id: ctx.channelId ?? "",
    timestamp: Date.now(),
  };
}

// =============================================================================
// Message Hooks
// =============================================================================

export function mapMessageReceived(
  event: PluginHookMessageReceivedEvent,
  ctx: PluginHookMessageContext,
): Record<string, unknown> {
  return {
    from_id: event.from,
    content: event.content,
    event_timestamp: event.timestamp ?? 0,
    metadata: safeJson(event.metadata),
    channel_id: ctx.channelId,
    account_id: ctx.accountId ?? "",
    conversation_id: ctx.conversationId ?? "",
    message_id: ctx.messageId ?? "",
    is_group: ctx.isGroup ?? false,
    group_id: ctx.groupId ?? "",
    timestamp: Date.now(),
  };
}

export function mapMessageSending(
  event: PluginHookMessageSendingEvent,
  ctx: PluginHookMessageContext,
): Record<string, unknown> {
  return {
    to_id: event.to,
    content: event.content,
    metadata: safeJson(event.metadata),
    channel_id: ctx.channelId,
    account_id: ctx.accountId ?? "",
    conversation_id: ctx.conversationId ?? "",
    message_id: ctx.messageId ?? "",
    is_group: ctx.isGroup ?? false,
    group_id: ctx.groupId ?? "",
    timestamp: Date.now(),
  };
}

export function mapMessageSent(
  event: PluginHookMessageSentEvent,
  ctx: PluginHookMessageContext,
): Record<string, unknown> {
  return {
    to_id: event.to,
    content: event.content,
    success: event.success,
    error: event.error ?? "",
    channel_id: ctx.channelId,
    account_id: ctx.accountId ?? "",
    conversation_id: ctx.conversationId ?? "",
    message_id: ctx.messageId ?? "",
    is_group: ctx.isGroup ?? false,
    group_id: ctx.groupId ?? "",
    timestamp: Date.now(),
  };
}

// =============================================================================
// Tool Hooks
// =============================================================================

export function mapBeforeToolCall(
  event: PluginHookBeforeToolCallEvent,
  ctx: PluginHookToolContext,
): Record<string, unknown> {
  return {
    tool_name: event.toolName,
    params: safeJson(event.params),
    run_id: event.runId ?? "",
    tool_call_id: event.toolCallId ?? "",
    agent_id: ctx.agentId ?? "",
    session_key: ctx.sessionKey ?? "",
    context_tool_name: ctx.toolName,
    context_run_id: ctx.runId ?? "",
    context_tool_call_id: ctx.toolCallId ?? "",
    context_session_id: ctx.sessionId ?? "",
    timestamp: Date.now(),
  };
}

export function mapAfterToolCall(
  event: PluginHookAfterToolCallEvent,
  ctx: PluginHookToolContext,
): Record<string, unknown> {
  return {
    tool_name: event.toolName,
    params: safeJson(event.params),
    result: safeJson(event.result),
    error: event.error ?? "",
    duration_ms: event.durationMs ?? 0,
    run_id: event.runId ?? "",
    tool_call_id: event.toolCallId ?? "",
    agent_id: ctx.agentId ?? "",
    session_key: ctx.sessionKey ?? "",
    context_tool_name: ctx.toolName,
    context_run_id: ctx.runId ?? "",
    context_tool_call_id: ctx.toolCallId ?? "",
    context_session_id: ctx.sessionId ?? "",
    timestamp: Date.now(),
  };
}

export function mapToolResultPersist(
  event: PluginHookToolResultPersistEvent,
  ctx: PluginHookToolResultPersistContext,
): Record<string, unknown> {
  return {
    tool_name: event.toolName ?? "",
    tool_call_id: event.toolCallId ?? "",
    message: safeJson(event.message),
    is_synthetic: event.isSynthetic ?? false,
    agent_id: ctx.agentId ?? "",
    session_key: ctx.sessionKey ?? "",
    ctx_tool_name: ctx.toolName ?? "",
    ctx_tool_call_id: ctx.toolCallId ?? "",
    timestamp: Date.now(),
  };
}

// =============================================================================
// Session Hooks
// =============================================================================

export function mapSessionStart(
  event: PluginHookSessionStartEvent,
  ctx: PluginHookSessionContext,
): Record<string, unknown> {
  return {
    session_id: event.sessionId,
    resumed_from: event.resumedFrom ?? "",
    session_key: event.sessionKey ?? "",
    agent_id: ctx.agentId ?? "",
    context_session_id: ctx.sessionId,
    timestamp: Date.now(),
  };
}

export function mapSessionEnd(
  event: PluginHookSessionEndEvent,
  ctx: PluginHookSessionContext,
): Record<string, unknown> {
  return {
    session_id: event.sessionId,
    message_count: event.messageCount,
    duration_ms: event.durationMs ?? 0,
    session_key: event.sessionKey ?? "",
    agent_id: ctx.agentId ?? "",
    context_session_id: ctx.sessionId,
    timestamp: Date.now(),
  };
}

// =============================================================================
// Gateway Hooks
// =============================================================================

export function mapGatewayStart(
  event: PluginHookGatewayStartEvent,
  ctx: PluginHookGatewayContext,
): Record<string, unknown> {
  return {
    port: event.port,
    context_port: ctx.port ?? 0,
    timestamp: Date.now(),
  };
}

export function mapGatewayStop(
  event: PluginHookGatewayStopEvent,
  ctx: PluginHookGatewayContext,
): Record<string, unknown> {
  return {
    reason: event.reason ?? "",
    context_port: ctx.port ?? 0,
    timestamp: Date.now(),
  };
}
