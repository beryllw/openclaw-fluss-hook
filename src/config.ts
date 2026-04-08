import type { FlussHookConfig } from "./types.js";

const DEFAULTS: FlussHookConfig = {
  gatewayUrl: "http://localhost:8080",
  databaseName: "openclaw",
  tablePrefix: "hook_",
  batchSize: 10,
  flushIntervalMs: 5000,
  autoCreateTable: true,
  bucketCount: 4,
  maxRetries: 3,
  retryBackoffMs: 500,
  outputMode: "fluss",
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
    gatewayUrl:
      asString(cfg.gatewayUrl) ??
      envString("FLUSS_GATEWAY_URL") ??
      DEFAULTS.gatewayUrl,

    gatewayUsername:
      asString(cfg.gatewayUsername) ??
      envString("FLUSS_GATEWAY_USERNAME") ??
      undefined,

    gatewayPassword:
      asString(cfg.gatewayPassword) ??
      envString("FLUSS_GATEWAY_PASSWORD") ??
      undefined,

    databaseName:
      asString(cfg.databaseName) ??
      envString("FLUSS_DATABASE") ??
      DEFAULTS.databaseName,

    tablePrefix:
      asString(cfg.tablePrefix) ??
      envString("FLUSS_TABLE_PREFIX") ??
      DEFAULTS.tablePrefix,

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

    maxRetries:
      asInt(cfg.maxRetries) ??
      envInt("FLUSS_MAX_RETRIES") ??
      DEFAULTS.maxRetries,

    retryBackoffMs:
      asInt(cfg.retryBackoffMs) ??
      envInt("FLUSS_RETRY_BACKOFF_MS") ??
      DEFAULTS.retryBackoffMs,

    outputMode:
      (asString(cfg.outputMode) as "fluss" | "console" | "memory" | undefined) ??
      (envString("FLUSS_OUTPUT_MODE") as "fluss" | "console" | "memory" | undefined) ??
      DEFAULTS.outputMode,
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
