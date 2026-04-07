import type { FlussHookConfig, PluginHookName } from "./types.js";

// =============================================================================
// Schema Definitions for all 14 hook tables
// =============================================================================

/** REST API column type strings */
type RestDataType = "string" | "int" | "bigint" | "boolean" | "json_string";

type SchemaDefinition = {
  columns: Array<{ name: string; type: RestDataType }>;
  distributionKey: string[];
};

const SCHEMAS: Record<PluginHookName, SchemaDefinition> = {
  before_agent_start: {
    columns: [
      { name: "prompt", type: "string" },
      { name: "messages", type: "string" },
      { name: "agent_id", type: "string" },
      { name: "session_key", type: "string" },
      { name: "workspace_dir", type: "string" },
      { name: "message_provider", type: "string" },
      { name: "session_id", type: "string" },
      { name: "trigger", type: "string" },
      { name: "channel_id", type: "string" },
      { name: "timestamp", type: "bigint" },
    ],
    distributionKey: ["agent_id"],
  },

  agent_end: {
    columns: [
      { name: "messages", type: "string" },
      { name: "success", type: "boolean" },
      { name: "error", type: "string" },
      { name: "duration_ms", type: "bigint" },
      { name: "agent_id", type: "string" },
      { name: "session_key", type: "string" },
      { name: "workspace_dir", type: "string" },
      { name: "message_provider", type: "string" },
      { name: "session_id", type: "string" },
      { name: "trigger", type: "string" },
      { name: "channel_id", type: "string" },
      { name: "timestamp", type: "bigint" },
    ],
    distributionKey: ["agent_id"],
  },

  before_compaction: {
    columns: [
      { name: "message_count", type: "int" },
      { name: "token_count", type: "int" },
      { name: "compacting_count", type: "int" },
      { name: "agent_id", type: "string" },
      { name: "session_key", type: "string" },
      { name: "workspace_dir", type: "string" },
      { name: "message_provider", type: "string" },
      { name: "session_id", type: "string" },
      { name: "trigger", type: "string" },
      { name: "channel_id", type: "string" },
      { name: "timestamp", type: "bigint" },
    ],
    distributionKey: ["agent_id"],
  },

  after_compaction: {
    columns: [
      { name: "message_count", type: "int" },
      { name: "token_count", type: "int" },
      { name: "compacted_count", type: "int" },
      { name: "agent_id", type: "string" },
      { name: "session_key", type: "string" },
      { name: "workspace_dir", type: "string" },
      { name: "message_provider", type: "string" },
      { name: "session_id", type: "string" },
      { name: "trigger", type: "string" },
      { name: "channel_id", type: "string" },
      { name: "timestamp", type: "bigint" },
    ],
    distributionKey: ["agent_id"],
  },

  message_received: {
    columns: [
      { name: "from_id", type: "string" },
      { name: "content", type: "string" },
      { name: "event_timestamp", type: "bigint" },
      { name: "metadata", type: "string" },
      { name: "channel_id", type: "string" },
      { name: "account_id", type: "string" },
      { name: "conversation_id", type: "string" },
      { name: "message_id", type: "string" },
      { name: "is_group", type: "boolean" },
      { name: "group_id", type: "string" },
      { name: "timestamp", type: "bigint" },
    ],
    distributionKey: ["channel_id"],
  },

  message_sending: {
    columns: [
      { name: "to_id", type: "string" },
      { name: "content", type: "string" },
      { name: "metadata", type: "string" },
      { name: "channel_id", type: "string" },
      { name: "account_id", type: "string" },
      { name: "conversation_id", type: "string" },
      { name: "message_id", type: "string" },
      { name: "is_group", type: "boolean" },
      { name: "group_id", type: "string" },
      { name: "timestamp", type: "bigint" },
    ],
    distributionKey: ["channel_id"],
  },

  message_sent: {
    columns: [
      { name: "to_id", type: "string" },
      { name: "content", type: "string" },
      { name: "success", type: "boolean" },
      { name: "error", type: "string" },
      { name: "channel_id", type: "string" },
      { name: "account_id", type: "string" },
      { name: "conversation_id", type: "string" },
      { name: "message_id", type: "string" },
      { name: "is_group", type: "boolean" },
      { name: "group_id", type: "string" },
      { name: "timestamp", type: "bigint" },
    ],
    distributionKey: ["channel_id"],
  },

  before_tool_call: {
    columns: [
      { name: "tool_name", type: "string" },
      { name: "params", type: "string" },
      { name: "run_id", type: "string" },
      { name: "tool_call_id", type: "string" },
      { name: "agent_id", type: "string" },
      { name: "session_key", type: "string" },
      { name: "context_tool_name", type: "string" },
      { name: "context_run_id", type: "string" },
      { name: "context_tool_call_id", type: "string" },
      { name: "context_session_id", type: "string" },
      { name: "timestamp", type: "bigint" },
    ],
    distributionKey: ["tool_name"],
  },

  after_tool_call: {
    columns: [
      { name: "tool_name", type: "string" },
      { name: "params", type: "string" },
      { name: "result", type: "string" },
      { name: "error", type: "string" },
      { name: "duration_ms", type: "bigint" },
      { name: "run_id", type: "string" },
      { name: "tool_call_id", type: "string" },
      { name: "agent_id", type: "string" },
      { name: "session_key", type: "string" },
      { name: "context_tool_name", type: "string" },
      { name: "context_run_id", type: "string" },
      { name: "context_tool_call_id", type: "string" },
      { name: "context_session_id", type: "string" },
      { name: "timestamp", type: "bigint" },
    ],
    distributionKey: ["tool_name"],
  },

  tool_result_persist: {
    columns: [
      { name: "tool_name", type: "string" },
      { name: "tool_call_id", type: "string" },
      { name: "message", type: "string" },
      { name: "is_synthetic", type: "boolean" },
      { name: "agent_id", type: "string" },
      { name: "session_key", type: "string" },
      { name: "ctx_tool_name", type: "string" },
      { name: "ctx_tool_call_id", type: "string" },
      { name: "timestamp", type: "bigint" },
    ],
    distributionKey: ["tool_name"],
  },

  session_start: {
    columns: [
      { name: "session_id", type: "string" },
      { name: "resumed_from", type: "string" },
      { name: "session_key", type: "string" },
      { name: "agent_id", type: "string" },
      { name: "context_session_id", type: "string" },
      { name: "timestamp", type: "bigint" },
    ],
    distributionKey: ["session_id"],
  },

  session_end: {
    columns: [
      { name: "session_id", type: "string" },
      { name: "message_count", type: "int" },
      { name: "duration_ms", type: "bigint" },
      { name: "session_key", type: "string" },
      { name: "agent_id", type: "string" },
      { name: "context_session_id", type: "string" },
      { name: "timestamp", type: "bigint" },
    ],
    distributionKey: ["session_id"],
  },

  gateway_start: {
    columns: [
      { name: "port", type: "int" },
      { name: "context_port", type: "int" },
      { name: "timestamp", type: "bigint" },
    ],
    distributionKey: ["port"],
  },

  gateway_stop: {
    columns: [
      { name: "reason", type: "string" },
      { name: "context_port", type: "int" },
      { name: "timestamp", type: "bigint" },
    ],
    distributionKey: ["reason"],
  },
};

// =============================================================================
// REST API table creation format
// =============================================================================

/** Column definition for the REST API create table endpoint */
export type RestColumnDef = {
  name: string;
  data_type: RestDataType;
};

/** Body for POST /v1/{db}/_tables */
export type CreateTableBody = {
  table_name: string;
  schema: RestColumnDef[];
  bucket_count: number;
  bucket_keys: string[];
  properties: Record<string, string>;
};

// =============================================================================
// Public API
// =============================================================================

/**
 * Get all registered hook names.
 */
export function getAllHookNames(): PluginHookName[] {
  return Object.keys(SCHEMAS) as PluginHookName[];
}

/**
 * Get column names for a given hook table.
 */
export function getColumnNames(hookName: PluginHookName): string[] {
  return SCHEMAS[hookName].columns.map((c) => c.name);
}

/**
 * Build the full table name for a hook: prefix + hookName.
 */
export function buildFullTableName(
  config: FlussHookConfig,
  hookName: PluginHookName,
): string {
  return `${config.tablePrefix}${hookName}`;
}

/**
 * Build a CreateTableBody for a given hook table (for REST API table creation).
 */
export function buildCreateTableBody(
  config: FlussHookConfig,
  hookName: PluginHookName,
): CreateTableBody {
  const def = SCHEMAS[hookName];
  return {
    table_name: buildFullTableName(config, hookName),
    schema: def.columns.map((c) => ({ name: c.name, data_type: c.type })),
    bucket_count: config.bucketCount,
    bucket_keys: def.distributionKey,
    properties: {},
  };
}