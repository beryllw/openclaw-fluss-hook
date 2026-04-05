import { Schema, DataType, DataTypes, TableDescriptor, TablePath } from "fluss-node";
import type { FlussHookConfig, PluginHookName } from "./types.js";

// =============================================================================
// Schema Definitions for all 14 hook tables
// =============================================================================

type SchemaDefinition = {
  columns: Array<{ name: string; type: () => DataType }>;
  distributionKey: string[];
};

const SCHEMAS: Record<PluginHookName, SchemaDefinition> = {
  before_agent_start: {
    columns: [
      { name: "prompt", type: DataTypes.string },
      { name: "messages", type: DataTypes.string },
      { name: "agent_id", type: DataTypes.string },
      { name: "session_key", type: DataTypes.string },
      { name: "workspace_dir", type: DataTypes.string },
      { name: "message_provider", type: DataTypes.string },
      { name: "session_id", type: DataTypes.string },
      { name: "trigger", type: DataTypes.string },
      { name: "channel_id", type: DataTypes.string },
      { name: "timestamp", type: DataTypes.bigint },
    ],
    distributionKey: ["agent_id"],
  },

  agent_end: {
    columns: [
      { name: "messages", type: DataTypes.string },
      { name: "success", type: DataTypes.boolean },
      { name: "error", type: DataTypes.string },
      { name: "duration_ms", type: DataTypes.bigint },
      { name: "agent_id", type: DataTypes.string },
      { name: "session_key", type: DataTypes.string },
      { name: "workspace_dir", type: DataTypes.string },
      { name: "message_provider", type: DataTypes.string },
      { name: "session_id", type: DataTypes.string },
      { name: "trigger", type: DataTypes.string },
      { name: "channel_id", type: DataTypes.string },
      { name: "timestamp", type: DataTypes.bigint },
    ],
    distributionKey: ["agent_id"],
  },

  before_compaction: {
    columns: [
      { name: "message_count", type: DataTypes.int },
      { name: "token_count", type: DataTypes.int },
      { name: "compacting_count", type: DataTypes.int },
      { name: "agent_id", type: DataTypes.string },
      { name: "session_key", type: DataTypes.string },
      { name: "workspace_dir", type: DataTypes.string },
      { name: "message_provider", type: DataTypes.string },
      { name: "session_id", type: DataTypes.string },
      { name: "trigger", type: DataTypes.string },
      { name: "channel_id", type: DataTypes.string },
      { name: "timestamp", type: DataTypes.bigint },
    ],
    distributionKey: ["agent_id"],
  },

  after_compaction: {
    columns: [
      { name: "message_count", type: DataTypes.int },
      { name: "token_count", type: DataTypes.int },
      { name: "compacted_count", type: DataTypes.int },
      { name: "agent_id", type: DataTypes.string },
      { name: "session_key", type: DataTypes.string },
      { name: "workspace_dir", type: DataTypes.string },
      { name: "message_provider", type: DataTypes.string },
      { name: "session_id", type: DataTypes.string },
      { name: "trigger", type: DataTypes.string },
      { name: "channel_id", type: DataTypes.string },
      { name: "timestamp", type: DataTypes.bigint },
    ],
    distributionKey: ["agent_id"],
  },

  message_received: {
    columns: [
      { name: "from_id", type: DataTypes.string },
      { name: "content", type: DataTypes.string },
      { name: "event_timestamp", type: DataTypes.bigint },
      { name: "metadata", type: DataTypes.string },
      { name: "channel_id", type: DataTypes.string },
      { name: "account_id", type: DataTypes.string },
      { name: "conversation_id", type: DataTypes.string },
      { name: "message_id", type: DataTypes.string },
      { name: "is_group", type: DataTypes.boolean },
      { name: "group_id", type: DataTypes.string },
      { name: "timestamp", type: DataTypes.bigint },
    ],
    distributionKey: ["channel_id"],
  },

  message_sending: {
    columns: [
      { name: "to_id", type: DataTypes.string },
      { name: "content", type: DataTypes.string },
      { name: "metadata", type: DataTypes.string },
      { name: "channel_id", type: DataTypes.string },
      { name: "account_id", type: DataTypes.string },
      { name: "conversation_id", type: DataTypes.string },
      { name: "message_id", type: DataTypes.string },
      { name: "is_group", type: DataTypes.boolean },
      { name: "group_id", type: DataTypes.string },
      { name: "timestamp", type: DataTypes.bigint },
    ],
    distributionKey: ["channel_id"],
  },

  message_sent: {
    columns: [
      { name: "to_id", type: DataTypes.string },
      { name: "content", type: DataTypes.string },
      { name: "success", type: DataTypes.boolean },
      { name: "error", type: DataTypes.string },
      { name: "channel_id", type: DataTypes.string },
      { name: "account_id", type: DataTypes.string },
      { name: "conversation_id", type: DataTypes.string },
      { name: "message_id", type: DataTypes.string },
      { name: "is_group", type: DataTypes.boolean },
      { name: "group_id", type: DataTypes.string },
      { name: "timestamp", type: DataTypes.bigint },
    ],
    distributionKey: ["channel_id"],
  },

  before_tool_call: {
    columns: [
      { name: "tool_name", type: DataTypes.string },
      { name: "params", type: DataTypes.string },
      { name: "run_id", type: DataTypes.string },
      { name: "tool_call_id", type: DataTypes.string },
      { name: "agent_id", type: DataTypes.string },
      { name: "session_key", type: DataTypes.string },
      { name: "context_tool_name", type: DataTypes.string },
      { name: "context_run_id", type: DataTypes.string },
      { name: "context_tool_call_id", type: DataTypes.string },
      { name: "context_session_id", type: DataTypes.string },
      { name: "timestamp", type: DataTypes.bigint },
    ],
    distributionKey: ["tool_name"],
  },

  after_tool_call: {
    columns: [
      { name: "tool_name", type: DataTypes.string },
      { name: "params", type: DataTypes.string },
      { name: "result", type: DataTypes.string },
      { name: "error", type: DataTypes.string },
      { name: "duration_ms", type: DataTypes.bigint },
      { name: "run_id", type: DataTypes.string },
      { name: "tool_call_id", type: DataTypes.string },
      { name: "agent_id", type: DataTypes.string },
      { name: "session_key", type: DataTypes.string },
      { name: "context_tool_name", type: DataTypes.string },
      { name: "context_run_id", type: DataTypes.string },
      { name: "context_tool_call_id", type: DataTypes.string },
      { name: "context_session_id", type: DataTypes.string },
      { name: "timestamp", type: DataTypes.bigint },
    ],
    distributionKey: ["tool_name"],
  },

  tool_result_persist: {
    columns: [
      { name: "tool_name", type: DataTypes.string },
      { name: "tool_call_id", type: DataTypes.string },
      { name: "message", type: DataTypes.string },
      { name: "is_synthetic", type: DataTypes.boolean },
      { name: "agent_id", type: DataTypes.string },
      { name: "session_key", type: DataTypes.string },
      { name: "ctx_tool_name", type: DataTypes.string },
      { name: "ctx_tool_call_id", type: DataTypes.string },
      { name: "timestamp", type: DataTypes.bigint },
    ],
    distributionKey: ["tool_name"],
  },

  session_start: {
    columns: [
      { name: "session_id", type: DataTypes.string },
      { name: "resumed_from", type: DataTypes.string },
      { name: "session_key", type: DataTypes.string },
      { name: "agent_id", type: DataTypes.string },
      { name: "context_session_id", type: DataTypes.string },
      { name: "timestamp", type: DataTypes.bigint },
    ],
    distributionKey: ["session_id"],
  },

  session_end: {
    columns: [
      { name: "session_id", type: DataTypes.string },
      { name: "message_count", type: DataTypes.int },
      { name: "duration_ms", type: DataTypes.bigint },
      { name: "session_key", type: DataTypes.string },
      { name: "agent_id", type: DataTypes.string },
      { name: "context_session_id", type: DataTypes.string },
      { name: "timestamp", type: DataTypes.bigint },
    ],
    distributionKey: ["session_id"],
  },

  gateway_start: {
    columns: [
      { name: "port", type: DataTypes.int },
      { name: "context_port", type: DataTypes.int },
      { name: "timestamp", type: DataTypes.bigint },
    ],
    distributionKey: ["port"],
  },

  gateway_stop: {
    columns: [
      { name: "reason", type: DataTypes.string },
      { name: "context_port", type: DataTypes.int },
      { name: "timestamp", type: DataTypes.bigint },
    ],
    distributionKey: ["reason"],
  },
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
 * Build a TablePath for a specific hook table.
 */
export function buildTablePath(
  config: FlussHookConfig,
  hookName: PluginHookName,
): TablePath {
  return new TablePath(config.databaseName, buildFullTableName(config, hookName));
}

/**
 * Build a Fluss Schema for a given hook.
 */
export function buildSchema(hookName: PluginHookName): Schema {
  const def = SCHEMAS[hookName];
  let builder = Schema.builder();
  for (const col of def.columns) {
    builder = builder.column(col.name, col.type());
  }
  return builder.build();
}

/**
 * Build a Fluss TableDescriptor for a given hook table.
 */
export function buildTableDescriptor(
  config: FlussHookConfig,
  hookName: PluginHookName,
): TableDescriptor {
  const def = SCHEMAS[hookName];
  return TableDescriptor.builder()
    .schema(buildSchema(hookName))
    .distributedBy(config.bucketCount, def.distributionKey)
    .property("table.replication.factor", "1")
    .build();
}