import { Schema, DataTypes, TableDescriptor, TablePath } from "fluss-node";
import type { FlussHookConfig } from "./types.js";

/**
 * Build the Fluss Schema for the message log table.
 */
export function buildMessageLogSchema(): Schema {
  return Schema.builder()
    .column("direction", DataTypes.string())
    .column("channel_id", DataTypes.string())
    .column("conversation_id", DataTypes.string())
    .column("account_id", DataTypes.string())
    .column("from_id", DataTypes.string())
    .column("to_id", DataTypes.string())
    .column("content", DataTypes.string())
    .column("success", DataTypes.boolean())
    .column("error_message", DataTypes.string())
    .column("metadata", DataTypes.string())
    .column("timestamp", DataTypes.bigint())
    .build();
}

/**
 * Build the Fluss TableDescriptor for the message log table.
 */
export function buildMessageLogTableDescriptor(
  config: FlussHookConfig,
): TableDescriptor {
  return TableDescriptor.builder()
    .schema(buildMessageLogSchema())
    .distributedBy(config.bucketCount, ["conversation_id"])
    .property("table.replication.factor", "1")
    .build();
}

/**
 * Build a TablePath from config.
 */
export function buildTablePath(config: FlussHookConfig): TablePath {
  return new TablePath(config.databaseName, config.tableName);
}
