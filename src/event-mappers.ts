import type {
  PluginHookBeforeModelResolveEvent,
  PluginHookBeforePromptBuildEvent,
  PluginHookBeforeAgentStartEvent,
  PluginHookAgentEndEvent,
  PluginHookBeforeCompactionEvent,
  PluginHookAfterCompactionEvent,
  PluginHookBeforeResetEvent,
  PluginHookLlmInputEvent,
  PluginHookLlmOutputEvent,
  PluginHookAgentContext,
  PluginHookInboundClaimEvent,
  PluginHookInboundClaimContext,
  PluginHookBeforeDispatchEvent,
  PluginHookBeforeDispatchContext,
  PluginHookBeforeMessageWriteEvent,
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
  PluginHookSubagentSpawningEvent,
  PluginHookSubagentDeliveryTargetEvent,
  PluginHookSubagentSpawnedEvent,
  PluginHookSubagentEndedEvent,
  PluginHookSubagentContext,
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

export function mapBeforeModelResolve(
  event: PluginHookBeforeModelResolveEvent,
  ctx: PluginHookAgentContext,
): Record<string, unknown> {
  return {
    prompt: event.prompt,
    agent_id: ctx.agentId ?? "",
    session_key: ctx.sessionKey ?? "",
    workspace_dir: ctx.workspaceDir ?? "",
    message_provider: ctx.messageProvider ?? "",
    session_id: ctx.sessionId ?? "",
    trigger: ctx.trigger ?? "",
    channel_id: ctx.channelId ?? "",
    run_id: ctx.runId ?? "",
    timestamp: Date.now(),
  };
}

export function mapBeforePromptBuild(
  event: PluginHookBeforePromptBuildEvent,
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
    run_id: ctx.runId ?? "",
    timestamp: Date.now(),
  };
}

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
    run_id: ctx.runId ?? "",
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
    run_id: ctx.runId ?? "",
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
    session_file: event.sessionFile ?? "",
    messages: safeJson(event.messages),
    agent_id: ctx.agentId ?? "",
    session_key: ctx.sessionKey ?? "",
    workspace_dir: ctx.workspaceDir ?? "",
    message_provider: ctx.messageProvider ?? "",
    session_id: ctx.sessionId ?? "",
    trigger: ctx.trigger ?? "",
    channel_id: ctx.channelId ?? "",
    run_id: ctx.runId ?? "",
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
    session_file: event.sessionFile ?? "",
    agent_id: ctx.agentId ?? "",
    session_key: ctx.sessionKey ?? "",
    workspace_dir: ctx.workspaceDir ?? "",
    message_provider: ctx.messageProvider ?? "",
    session_id: ctx.sessionId ?? "",
    trigger: ctx.trigger ?? "",
    channel_id: ctx.channelId ?? "",
    run_id: ctx.runId ?? "",
    timestamp: Date.now(),
  };
}

export function mapBeforeReset(
  event: PluginHookBeforeResetEvent,
  ctx: PluginHookAgentContext,
): Record<string, unknown> {
  return {
    session_file: event.sessionFile ?? "",
    messages: safeJson(event.messages),
    reason: event.reason ?? "",
    agent_id: ctx.agentId ?? "",
    session_key: ctx.sessionKey ?? "",
    workspace_dir: ctx.workspaceDir ?? "",
    message_provider: ctx.messageProvider ?? "",
    session_id: ctx.sessionId ?? "",
    trigger: ctx.trigger ?? "",
    channel_id: ctx.channelId ?? "",
    run_id: ctx.runId ?? "",
    timestamp: Date.now(),
  };
}

export function mapLlmInput(
  event: PluginHookLlmInputEvent,
  ctx: PluginHookAgentContext,
): Record<string, unknown> {
  return {
    run_id: event.runId,
    session_id: event.sessionId,
    provider: event.provider,
    model: event.model,
    system_prompt: event.systemPrompt ?? "",
    prompt: event.prompt,
    history_messages: safeJson(event.historyMessages),
    images_count: event.imagesCount,
    agent_id: ctx.agentId ?? "",
    session_key: ctx.sessionKey ?? "",
    workspace_dir: ctx.workspaceDir ?? "",
    message_provider: ctx.messageProvider ?? "",
    trigger: ctx.trigger ?? "",
    channel_id: ctx.channelId ?? "",
    timestamp: Date.now(),
  };
}

export function mapLlmOutput(
  event: PluginHookLlmOutputEvent,
  ctx: PluginHookAgentContext,
): Record<string, unknown> {
  return {
    run_id: event.runId,
    session_id: event.sessionId,
    provider: event.provider,
    model: event.model,
    assistant_texts: safeJson(event.assistantTexts),
    last_assistant: safeJson(event.lastAssistant),
    usage: safeJson(event.usage),
    agent_id: ctx.agentId ?? "",
    session_key: ctx.sessionKey ?? "",
    workspace_dir: ctx.workspaceDir ?? "",
    message_provider: ctx.messageProvider ?? "",
    trigger: ctx.trigger ?? "",
    channel_id: ctx.channelId ?? "",
    timestamp: Date.now(),
  };
}

// =============================================================================
// Message Hooks
// =============================================================================

export function mapInboundClaim(
  event: PluginHookInboundClaimEvent,
  ctx: PluginHookInboundClaimContext,
): Record<string, unknown> {
  return {
    content: event.content,
    body: event.body ?? "",
    body_for_agent: event.bodyForAgent ?? "",
    transcript: event.transcript ?? "",
    event_timestamp: event.timestamp ?? 0,
    channel: event.channel,
    account_id: ctx.accountId ?? "",
    conversation_id: ctx.conversationId ?? "",
    parent_conversation_id: ctx.parentConversationId ?? "",
    sender_id: ctx.senderId ?? "",
    sender_name: event.senderName ?? "",
    sender_username: event.senderUsername ?? "",
    thread_id: event.threadId ?? "",
    message_id: ctx.messageId ?? "",
    is_group: event.isGroup,
    command_authorized: event.commandAuthorized ?? false,
    was_mentioned: event.wasMentioned ?? false,
    metadata: safeJson(event.metadata),
    channel_id: ctx.channelId,
    timestamp: Date.now(),
  };
}

export function mapBeforeDispatch(
  event: PluginHookBeforeDispatchEvent,
  ctx: PluginHookBeforeDispatchContext,
): Record<string, unknown> {
  return {
    content: event.content,
    body: event.body ?? "",
    channel: event.channel ?? "",
    session_key: event.sessionKey ?? "",
    sender_id: event.senderId ?? "",
    is_group: event.isGroup ?? false,
    event_timestamp: event.timestamp ?? 0,
    channel_id: ctx.channelId ?? "",
    account_id: ctx.accountId ?? "",
    conversation_id: ctx.conversationId ?? "",
    timestamp: Date.now(),
  };
}

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
// Subagent Hooks
// =============================================================================

export function mapSubagentSpawning(
  event: PluginHookSubagentSpawningEvent,
  ctx: PluginHookSubagentContext,
): Record<string, unknown> {
  return {
    child_session_key: event.childSessionKey,
    agent_id: event.agentId,
    label: event.label ?? "",
    mode: event.mode,
    requester: safeJson(event.requester),
    thread_requested: event.threadRequested,
    run_id: ctx.runId ?? "",
    child_session_key_ctx: ctx.childSessionKey ?? "",
    requester_session_key: ctx.requesterSessionKey ?? "",
    timestamp: Date.now(),
  };
}

export function mapSubagentDeliveryTarget(
  event: PluginHookSubagentDeliveryTargetEvent,
  ctx: PluginHookSubagentContext,
): Record<string, unknown> {
  return {
    child_session_key: event.childSessionKey,
    requester_session_key: event.requesterSessionKey,
    requester_origin: safeJson(event.requesterOrigin),
    child_run_id: event.childRunId ?? "",
    spawn_mode: event.spawnMode ?? "",
    expects_completion_message: event.expectsCompletionMessage,
    run_id: ctx.runId ?? "",
    child_session_key_ctx: ctx.childSessionKey ?? "",
    requester_session_key_ctx: ctx.requesterSessionKey ?? "",
    timestamp: Date.now(),
  };
}

export function mapSubagentSpawned(
  event: PluginHookSubagentSpawnedEvent,
  ctx: PluginHookSubagentContext,
): Record<string, unknown> {
  return {
    child_session_key: event.childSessionKey,
    agent_id: event.agentId,
    label: event.label ?? "",
    mode: event.mode,
    requester: safeJson(event.requester),
    thread_requested: event.threadRequested,
    run_id: event.runId,
    run_id_ctx: ctx.runId ?? "",
    child_session_key_ctx: ctx.childSessionKey ?? "",
    requester_session_key: ctx.requesterSessionKey ?? "",
    timestamp: Date.now(),
  };
}

export function mapSubagentEnded(
  event: PluginHookSubagentEndedEvent,
  ctx: PluginHookSubagentContext,
): Record<string, unknown> {
  return {
    target_session_key: event.targetSessionKey,
    target_kind: event.targetKind,
    reason: event.reason,
    send_farewell: event.sendFarewell ?? false,
    account_id: event.accountId ?? "",
    run_id: event.runId ?? "",
    ended_at: event.endedAt ?? 0,
    outcome: event.outcome ?? "",
    error: event.error ?? "",
    run_id_ctx: ctx.runId ?? "",
    child_session_key_ctx: ctx.childSessionKey ?? "",
    requester_session_key: ctx.requesterSessionKey ?? "",
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

// =============================================================================
// before_message_write
// =============================================================================

export function mapBeforeMessageWrite(
  event: PluginHookBeforeMessageWriteEvent,
  ctx: { agentId?: string; sessionKey?: string },
): Record<string, unknown> {
  return {
    message: safeJson(event.message),
    session_key: event.sessionKey ?? "",
    agent_id: event.agentId ?? "",
    ctx_session_key: ctx.sessionKey ?? "",
    timestamp: Date.now(),
  };
}
