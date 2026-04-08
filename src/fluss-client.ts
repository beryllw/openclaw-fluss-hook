import type { FlussHookConfig, PluginHookName, PluginLogger } from "./types.js";
import { buildFullTableName, buildCreateTableBody, getColumnNames } from "./schema.js";

const REQUEST_TIMEOUT_MS = 10_000;

// =============================================================================
// Gateway REST API types
// =============================================================================

interface GatewayErrorResponse {
  error_code: number;
  message: string;
}

interface CreateDatabaseBody {
  database_name: string;
  comment: string;
  ignore_if_exists: boolean;
}

interface AppendRow {
  values: unknown[];
}

interface AppendBody {
  rows: AppendRow[];
}

interface AppendResponse {
  row_count: number;
}

// =============================================================================
// Gateway Client
// =============================================================================

/**
 * HTTP client for the fluss-gateway REST API.
 * Replaces the FlussClientManager that used the fluss-node NAPI binary.
 */
export class GatewayClient {
  private config: FlussHookConfig;
  private logger: PluginLogger;
  private baseUrl: string;
  private authHeader: string | undefined;
  private tablesCreated: Set<PluginHookName> = new Set();
  private tableInitializing: Map<PluginHookName, Promise<boolean>> = new Map();

  constructor(config: FlussHookConfig, logger: PluginLogger) {
    this.config = config;
    this.logger = logger;
    this.baseUrl = config.gatewayUrl.replace(/\/+$/, "");

    if (config.gatewayUsername && config.gatewayPassword) {
      const encoded = Buffer.from(
        `${config.gatewayUsername}:${config.gatewayPassword}`,
      ).toString("base64");
      this.authHeader = `Basic ${encoded}`;
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Append a batch of rows to a specific hook table via POST /v1/{db}/{table}/rows.
   * Retries on transient failures (network errors, 5xx, timeouts) with exponential backoff.
   * Non-retryable errors (4xx) are thrown immediately.
   */
  async appendBatch(
    hookName: PluginHookName,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    // Auto-create table if configured (done on first append per table)
    if (this.config.autoCreateTable) {
      await this.ensureTableExists(hookName);
    }

    const tableName = buildFullTableName(this.config, hookName);
    const columnNames = getColumnNames(hookName);

    // Convert row objects to ordered values arrays
    const gatewayRows: AppendRow[] = rows.map((row) => ({
      values: columnNames.map((col) => row[col] ?? null),
    }));

    const body: AppendBody = { rows: gatewayRows };
    const path = `/v1/${encodeURIComponent(this.config.databaseName)}/${encodeURIComponent(tableName)}/rows`;

    await this.withRetry(
      async () => {
        const response = await this.fetchJson<AppendResponse>(path, {
          method: "POST",
          body: JSON.stringify(body),
        });
        this.logger.debug?.(
          `[fluss-hook] Appended ${response?.row_count ?? rows.length} rows to ${tableName}`,
        );
      },
      `append to ${tableName}`,
    );
  }

  /**
   * Close resources (no-op for HTTP client, kept for API compatibility).
   */
  close(): void {
    this.logger.info("[fluss-hook] GatewayClient closed");
  }

  // ---------------------------------------------------------------------------
  // Admin operations (database/table creation)
  // ---------------------------------------------------------------------------

  /**
   * Create the database if autoCreateTable is enabled.
   */
  async ensureDatabase(): Promise<void> {
    if (!this.config.autoCreateTable) return;

    await this.withRetry(
      async () => {
        await this.fetchJson(
          "/v1/_databases",
          {
            method: "POST",
            body: JSON.stringify({
              database_name: this.config.databaseName,
              comment: "OpenClaw hook event logs",
              ignore_if_exists: true,
            } satisfies CreateDatabaseBody),
          },
        );
        this.logger.debug?.(
          `[fluss-hook] Database ready: ${this.config.databaseName}`,
        );
      },
      "database setup",
    );
  }

  /**
   * Ensure a table exists, creating it if needed (lazy, per-hook).
   */
  private async ensureTableExists(hookName: PluginHookName): Promise<boolean> {
    if (this.tablesCreated.has(hookName)) return true;

    const existing = this.tableInitializing.get(hookName);
    if (existing) return existing;

    const init = this.initTable(hookName);
    this.tableInitializing.set(hookName, init);
    try {
      const result = await init;
      if (result) {
        this.tablesCreated.add(hookName);
      }
      return result;
    } finally {
      this.tableInitializing.delete(hookName);
    }
  }

  private async initTable(hookName: PluginHookName): Promise<boolean> {
    const tableName = buildFullTableName(this.config, hookName);

    try {
      const body = buildCreateTableBody(this.config, hookName);
      // Use ignore_if_exists to avoid race conditions with concurrent plugin instances
      await this.withRetry(
        async () => {
          await this.fetchJson(
            `/v1/${encodeURIComponent(this.config.databaseName)}/_tables`,
            {
              method: "POST",
              body: JSON.stringify({ ...body, ignore_if_exists: true }),
            },
          );
          this.logger.debug?.(
            `[fluss-hook] Table ready: ${this.config.databaseName}.${tableName}`,
          );
        },
        `table init for ${tableName}`,
      );
      return true;
    } catch (err) {
      this.logger.error(
        `[fluss-hook] Table init failed for ${tableName}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // HTTP helpers
  // ---------------------------------------------------------------------------

  /**
   * Wrap a gateway operation with exponential backoff retry.
   * Retries on transient failures (network errors, 5xx, timeouts).
   * Non-retryable errors (4xx) are thrown immediately.
   */
  private async withRetry(
    fn: () => Promise<void>,
    label: string,
  ): Promise<void> {
    let lastErr: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = this.config.retryBackoffMs * Math.pow(2, attempt - 1);
        this.logger.warn(
          `[fluss-hook] Retry attempt ${attempt}/${this.config.maxRetries} for ${label} in ${backoff}ms`,
        );
        await sleep(backoff);
      }

      try {
        await fn();
        return; // success
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));

        if (!isRetryableError(lastErr)) {
          this.logger.error(
            `[fluss-hook] Non-retryable error for ${label}: ${lastErr.message}`,
          );
          throw lastErr;
        }
      }
    }

    // All retries exhausted
    this.logger.error(
      `[fluss-hook] Operation exhausted for ${label} after ${this.config.maxRetries + 1} attempts: ${lastErr?.message}`,
    );
    throw lastErr!;
  }

  private async fetchJson<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T | null> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    };
    if (this.authHeader) {
      headers["Authorization"] = this.authHeader;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorDetail = `HTTP ${response.status}`;
        try {
          const errorBody = (await response.json()) as GatewayErrorResponse;
          errorDetail = `HTTP ${response.status}: ${errorBody.message} (code: ${errorBody.error_code})`;
        } catch {
          // ignore JSON parse error
        }
        throw new Error(`Gateway error: ${errorDetail}`);
      }

      // 201 Created or 204 No Content may have no body
      if (response.status === 204) return null;

      const text = await response.text();
      if (!text) return null;

      return JSON.parse(text) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Determine whether an error is retryable.
 * - Network failures, timeouts, fetch aborts: retryable
 * - 4xx client errors: NOT retryable (bad data, auth, etc.)
 * - 5xx server errors: retryable
 */
function isRetryableError(err: Error): boolean {
  const message = err.message;

  // AbortError from AbortController (timeout)
  if (err.name === "AbortError") return true;

  // Network-level failures (no connection, DNS failure, etc.)
  if (err.name === "TypeError" || message.includes("fetch")) return true;

  // Gateway HTTP errors — check status code in the message
  const match = message.match(/Gateway error: HTTP (\d+)/);
  if (match) {
    const status = parseInt(match[1], 10);
    return status >= 500;
  }

  // Unknown errors: be conservative and retry
  return true;
}

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
