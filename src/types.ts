// =============================================================================
// Plugin Logger
// =============================================================================

export type PluginLogger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

// =============================================================================
// Plugin Service
// =============================================================================

export type PluginService = {
  id: string;
  start: (ctx: { config: Record<string, unknown>; stateDir: string; logger: PluginLogger }) => void | Promise<void>;
  stop?: (ctx: { config: Record<string, unknown>; stateDir: string; logger: PluginLogger }) => void | Promise<void>;
};

// =============================================================================
// Hook Event Types
// Aligned with openclaw/src/plugins/types.ts
// =============================================================================

// -- Agent Hooks --

export type PluginHookBeforeModelResolveEvent = {
  prompt: string;
};

export type PluginHookBeforePromptBuildEvent = {
  prompt: string;
  messages?: unknown[];
};

export type PluginHookBeforeAgentStartEvent = {
  prompt: string;
  messages?: unknown[];
};

export type PluginHookAgentEndEvent = {
  messages: unknown[];
  success: boolean;
  error?: string;
  durationMs?: number;
};

export type PluginHookBeforeCompactionEvent = {
  messageCount: number;
  tokenCount?: number;
  compactingCount?: number;
  messages?: unknown[];
  sessionFile?: string;
};

export type PluginHookAfterCompactionEvent = {
  messageCount: number;
  tokenCount?: number;
  compactedCount: number;
  sessionFile?: string;
};

export type PluginHookBeforeResetEvent = {
  sessionFile?: string;
  messages?: unknown[];
  reason?: string;
};

export type PluginHookLlmInputEvent = {
  runId: string;
  sessionId: string;
  provider: string;
  model: string;
  systemPrompt?: string;
  prompt: string;
  historyMessages: unknown[];
  imagesCount: number;
};

export type PluginHookLlmOutputEvent = {
  runId: string;
  sessionId: string;
  provider: string;
  model: string;
  assistantTexts: string[];
  lastAssistant?: unknown;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
};

export type PluginHookAgentContext = {
  agentId?: string;
  sessionKey?: string;
  workspaceDir?: string;
  messageProvider?: string;
  sessionId?: string;
  trigger?: string;
  channelId?: string;
  runId?: string;
};

// -- Message Hooks --

export type PluginHookMessageReceivedEvent = {
  from: string;
  content: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
};

export type PluginHookMessageSendingEvent = {
  to: string;
  content: string;
  metadata?: Record<string, unknown>;
};

export type PluginHookMessageSentEvent = {
  to: string;
  content: string;
  success: boolean;
  error?: string;
};

export type PluginHookMessageContext = {
  channelId: string;
  accountId?: string;
  conversationId?: string;
};

export type PluginHookInboundClaimContext = PluginHookMessageContext & {
  parentConversationId?: string;
  senderId?: string;
  messageId?: string;
};

export type PluginHookInboundClaimEvent = {
  content: string;
  body?: string;
  bodyForAgent?: string;
  transcript?: string;
  timestamp?: number;
  channel: string;
  accountId?: string;
  conversationId?: string;
  parentConversationId?: string;
  senderId?: string;
  senderName?: string;
  senderUsername?: string;
  threadId?: string | number;
  messageId?: string;
  isGroup: boolean;
  commandAuthorized?: boolean;
  wasMentioned?: boolean;
  metadata?: Record<string, unknown>;
};

export type PluginHookBeforeDispatchEvent = {
  content: string;
  body?: string;
  channel?: string;
  sessionKey?: string;
  senderId?: string;
  isGroup?: boolean;
  timestamp?: number;
};

export type PluginHookBeforeDispatchContext = {
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  sessionKey?: string;
  senderId?: string;
};

export type PluginHookBeforeMessageWriteEvent = {
  message: unknown;
  sessionKey?: string;
  agentId?: string;
};

// -- Tool Hooks --

export type PluginHookBeforeToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
  runId?: string;
  toolCallId?: string;
};

export type PluginHookAfterToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
  runId?: string;
  toolCallId?: string;
};

export type PluginHookToolResultPersistEvent = {
  toolName?: string;
  toolCallId?: string;
  message: unknown;
  isSynthetic?: boolean;
};

export type PluginHookToolContext = {
  agentId?: string;
  sessionKey?: string;
  toolName: string;
  runId?: string;
  toolCallId?: string;
  sessionId?: string;
};

export type PluginHookToolResultPersistContext = {
  agentId?: string;
  sessionKey?: string;
  toolName?: string;
  toolCallId?: string;
};

// -- Session Hooks --

export type PluginHookSessionStartEvent = {
  sessionId: string;
  resumedFrom?: string;
  sessionKey?: string;
};

export type PluginHookSessionEndEvent = {
  sessionId: string;
  messageCount: number;
  durationMs?: number;
  sessionKey?: string;
};

export type PluginHookSessionContext = {
  agentId?: string;
  sessionId: string;
  sessionKey?: string;
};

// -- Subagent Hooks --

export type PluginHookSubagentContext = {
  runId?: string;
  childSessionKey?: string;
  requesterSessionKey?: string;
};

export type PluginHookSubagentSpawningEvent = {
  childSessionKey: string;
  agentId: string;
  label?: string;
  mode: "run" | "session";
  requester?: {
    channel?: string;
    accountId?: string;
    to?: string;
    threadId?: string | number;
  };
  threadRequested: boolean;
};

export type PluginHookSubagentDeliveryTargetEvent = {
  childSessionKey: string;
  requesterSessionKey: string;
  requesterOrigin?: {
    channel?: string;
    accountId?: string;
    to?: string;
    threadId?: string | number;
  };
  childRunId?: string;
  spawnMode?: "run" | "session";
  expectsCompletionMessage: boolean;
};

export type PluginHookSubagentSpawnedEvent = PluginHookSubagentSpawningEvent & {
  runId: string;
};

export type PluginHookSubagentEndedEvent = {
  targetSessionKey: string;
  targetKind: string;
  reason: string;
  sendFarewell?: boolean;
  accountId?: string;
  runId?: string;
  endedAt?: number;
  outcome?: "ok" | "error" | "timeout" | "killed" | "reset" | "deleted";
  error?: string;
};

// -- Gateway Hooks --

export type PluginHookGatewayStartEvent = {
  port: number;
};

export type PluginHookGatewayStopEvent = {
  reason?: string;
};

export type PluginHookGatewayContext = {
  port?: number;
};

// =============================================================================
// Hook Handler Map
// =============================================================================

type PluginHookHandlerMap = {
  before_model_resolve: (
    event: PluginHookBeforeModelResolveEvent,
    ctx: PluginHookAgentContext,
  ) => Promise<void> | void;
  before_prompt_build: (
    event: PluginHookBeforePromptBuildEvent,
    ctx: PluginHookAgentContext,
  ) => Promise<void> | void;
  before_agent_start: (
    event: PluginHookBeforeAgentStartEvent,
    ctx: PluginHookAgentContext,
  ) => Promise<void> | void;
  agent_end: (
    event: PluginHookAgentEndEvent,
    ctx: PluginHookAgentContext,
  ) => Promise<void> | void;
  before_compaction: (
    event: PluginHookBeforeCompactionEvent,
    ctx: PluginHookAgentContext,
  ) => Promise<void> | void;
  after_compaction: (
    event: PluginHookAfterCompactionEvent,
    ctx: PluginHookAgentContext,
  ) => Promise<void> | void;
  before_reset: (
    event: PluginHookBeforeResetEvent,
    ctx: PluginHookAgentContext,
  ) => Promise<void> | void;
  llm_input: (
    event: PluginHookLlmInputEvent,
    ctx: PluginHookAgentContext,
  ) => Promise<void> | void;
  llm_output: (
    event: PluginHookLlmOutputEvent,
    ctx: PluginHookAgentContext,
  ) => Promise<void> | void;
  inbound_claim: (
    event: PluginHookInboundClaimEvent,
    ctx: PluginHookInboundClaimContext,
  ) => Promise<void> | void;
  before_dispatch: (
    event: PluginHookBeforeDispatchEvent,
    ctx: PluginHookBeforeDispatchContext,
  ) => Promise<void> | void;
  message_received: (
    event: PluginHookMessageReceivedEvent,
    ctx: PluginHookMessageContext,
  ) => Promise<void> | void;
  message_sending: (
    event: PluginHookMessageSendingEvent,
    ctx: PluginHookMessageContext,
  ) => Promise<void> | void;
  message_sent: (
    event: PluginHookMessageSentEvent,
    ctx: PluginHookMessageContext,
  ) => Promise<void> | void;
  before_message_write: (
    event: PluginHookBeforeMessageWriteEvent,
    ctx: { agentId?: string; sessionKey?: string },
  ) => Promise<void> | void;
  before_tool_call: (
    event: PluginHookBeforeToolCallEvent,
    ctx: PluginHookToolContext,
  ) => Promise<void> | void;
  after_tool_call: (
    event: PluginHookAfterToolCallEvent,
    ctx: PluginHookToolContext,
  ) => Promise<void> | void;
  tool_result_persist: (
    event: PluginHookToolResultPersistEvent,
    ctx: PluginHookToolResultPersistContext,
  ) => Promise<void> | void;
  session_start: (
    event: PluginHookSessionStartEvent,
    ctx: PluginHookSessionContext,
  ) => Promise<void> | void;
  session_end: (
    event: PluginHookSessionEndEvent,
    ctx: PluginHookSessionContext,
  ) => Promise<void> | void;
  subagent_spawning: (
    event: PluginHookSubagentSpawningEvent,
    ctx: PluginHookSubagentContext,
  ) => Promise<void> | void;
  subagent_delivery_target: (
    event: PluginHookSubagentDeliveryTargetEvent,
    ctx: PluginHookSubagentContext,
  ) => Promise<void> | void;
  subagent_spawned: (
    event: PluginHookSubagentSpawnedEvent,
    ctx: PluginHookSubagentContext,
  ) => Promise<void> | void;
  subagent_ended: (
    event: PluginHookSubagentEndedEvent,
    ctx: PluginHookSubagentContext,
  ) => Promise<void> | void;
  gateway_start: (
    event: PluginHookGatewayStartEvent,
    ctx: PluginHookGatewayContext,
  ) => Promise<void> | void;
  gateway_stop: (
    event: PluginHookGatewayStopEvent,
    ctx: PluginHookGatewayContext,
  ) => Promise<void> | void;
};

export type PluginHookName = keyof PluginHookHandlerMap;

// =============================================================================
// Plugin API
// =============================================================================

export type OpenClawPluginApi = {
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;
  on: <K extends PluginHookName>(
    hookName: K,
    handler: PluginHookHandlerMap[K],
  ) => void;
  registerService: (service: PluginService) => void;
};

// =============================================================================
// Config
// =============================================================================

export type FlussHookConfig = {
  gatewayUrl: string;
  gatewayUsername?: string;
  gatewayPassword?: string;
  databaseName: string;
  tablePrefix: string;
  batchSize: number;
  flushIntervalMs: number;
  autoCreateTable: boolean;
  bucketCount: number;
  maxRetries: number;
  retryBackoffMs: number;
  outputMode: "fluss" | "console" | "memory";
};

export type FlussHookPlugin = {
  id: string;
  name: string;
  description: string;
  register: (api: OpenClawPluginApi) => void;
  /** Only present for testing. A RecordingSink that records all writes. */
  __recordingSink?: import("./sink.js").RecordingSink;
  /** Flush helper exposed for testing. */
  __testBuffer?: { flushAll: () => Promise<void> };
};
