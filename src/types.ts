/**
 * Minimal type definitions for OpenClaw Plugin API.
 * Inlined to avoid depending on the openclaw package.
 */

// -- Plugin Hook Event/Context Types --

export type PluginHookMessageReceivedEvent = {
  from: string;
  content: string;
  timestamp?: number;
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

// -- Agent Hook Event/Context Types --

export type PluginHookAgentEndEvent = {
  messages: unknown[];
  success: boolean;
  error?: string;
  durationMs?: number;
};

export type PluginHookAgentContext = {
  agentId?: string;
  sessionKey?: string;
  workspaceDir?: string;
  messageProvider?: string;
};

// -- Plugin Service Types --

export type PluginServiceContext = {
  config: Record<string, unknown>;
  workspaceDir?: string;
  stateDir: string;
  logger: PluginLogger;
};

export type PluginService = {
  id: string;
  start: (ctx: PluginServiceContext) => void | Promise<void>;
  stop?: (ctx: PluginServiceContext) => void | Promise<void>;
};

// -- Plugin Logger --

export type PluginLogger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

// -- Plugin API (minimal subset) --

type PluginHookHandlerMap = {
  message_received: (
    event: PluginHookMessageReceivedEvent,
    ctx: PluginHookMessageContext,
  ) => Promise<void> | void;
  message_sent: (
    event: PluginHookMessageSentEvent,
    ctx: PluginHookMessageContext,
  ) => Promise<void> | void;
  agent_end: (
    event: PluginHookAgentEndEvent,
    ctx: PluginHookAgentContext,
  ) => Promise<void> | void;
};

export type OpenClawPluginApi = {
  id: string;
  name: string;
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;
  on: <K extends keyof PluginHookHandlerMap>(
    hookName: K,
    handler: PluginHookHandlerMap[K],
    opts?: { priority?: number },
  ) => void;
  registerService: (service: PluginService) => void;
};

// -- Fluss Message Row --

export type FlussMessageRow = {
  direction: string;
  channel_id: string;
  conversation_id: string;
  account_id: string;
  from_id: string;
  to_id: string;
  content: string;
  success: boolean;
  error_message: string;
  metadata: string;
  timestamp: number;
};

// -- Plugin Config --

export type FlussHookConfig = {
  bootstrapServers: string;
  databaseName: string;
  tableName: string;
  batchSize: number;
  flushIntervalMs: number;
  autoCreateTable: boolean;
  bucketCount: number;
};
