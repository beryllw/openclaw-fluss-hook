import type { FlussHookConfig } from "./types.js";

const DEFAULTS: FlussHookConfig = {
  bootstrapServers: "localhost:9223",
  databaseName: "openclaw",
  tableName: "message_logs",
  batchSize: 50,
  flushIntervalMs: 5000,
  autoCreateTable: true,
  bucketCount: 4,
};

function envString(key: string): string | undefined {
  const val = process.env[key]?.trim();
  return val || undefined;
}

function envInt(key: string): number | undefined {
  const val = envString(key);
  if (val === undefined) return undefined;
  const num = parseInt(val, 10);
  return Number.isFinite(num) ? num : undefined;
}

function envBool(key: string): boolean | undefined {
  const val = envString(key);
  if (val === undefined) return undefined;
  if (val === "true" || val === "1") return true;
  if (val === "false" || val === "0") return false;
  return undefined;
}

/**
 * Resolve plugin configuration by merging: pluginConfig > env vars > defaults.
 */
export function resolveConfig(
  pluginConfig?: Record<string, unknown>,
): FlussHookConfig {
  const cfg = pluginConfig ?? {};

  return {
    bootstrapServers:
      asString(cfg.bootstrapServers) ??
      envString("FLUSS_BOOTSTRAP_SERVERS") ??
      DEFAULTS.bootstrapServers,

    databaseName:
      asString(cfg.databaseName) ??
      envString("FLUSS_DATABASE") ??
      DEFAULTS.databaseName,

    tableName:
      asString(cfg.tableName) ??
      envString("FLUSS_TABLE") ??
      DEFAULTS.tableName,

    batchSize:
      asInt(cfg.batchSize) ??
      envInt("FLUSS_BATCH_SIZE") ??
      DEFAULTS.batchSize,

    flushIntervalMs:
      asInt(cfg.flushIntervalMs) ??
      envInt("FLUSS_FLUSH_INTERVAL_MS") ??
      DEFAULTS.flushIntervalMs,

    autoCreateTable:
      asBool(cfg.autoCreateTable) ??
      envBool("FLUSS_AUTO_CREATE_TABLE") ??
      DEFAULTS.autoCreateTable,

    bucketCount:
      asInt(cfg.bucketCount) ??
      envInt("FLUSS_BUCKET_COUNT") ??
      DEFAULTS.bucketCount,
  };
}

function asString(val: unknown): string | undefined {
  return typeof val === "string" && val.trim() ? val.trim() : undefined;
}

function asInt(val: unknown): number | undefined {
  if (typeof val === "number" && Number.isFinite(val)) {
    return Math.floor(val);
  }
  return undefined;
}

function asBool(val: unknown): boolean | undefined {
  return typeof val === "boolean" ? val : undefined;
}
