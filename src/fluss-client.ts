import {
  Config,
  FlussConnection,
  DatabaseDescriptor,
} from "fluss-node";
import type { FlussHookConfig, PluginHookName, PluginLogger } from "./types.js";
import { buildTablePath, buildTableDescriptor, buildFullTableName } from "./schema.js";

type AppendWriter = ReturnType<
  ReturnType<Awaited<ReturnType<FlussConnection["getTable"]>>["newAppend"]>["createWriter"]
>;

/**
 * Manages the Fluss connection lifecycle with lazy initialization,
 * auto table creation, and per-table writer caching.
 */
export class FlussClientManager {
  private config: FlussHookConfig;
  private logger: PluginLogger;
  private connection: FlussConnection | null = null;
  private writers: Map<string, AppendWriter> = new Map();
  private connecting: Promise<void> | null = null;
  private connected = false;
  private writerInitializing: Map<string, Promise<void>> = new Map();

  constructor(config: FlussHookConfig, logger: PluginLogger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Ensure the connection is established.
   */
  async ensureConnected(): Promise<boolean> {
    if (this.connected && this.connection) {
      return true;
    }

    if (this.connecting) {
      await this.connecting;
      return this.connected;
    }

    this.connecting = this.connect();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
    return this.connected;
  }

  private async connect(): Promise<void> {
    try {
      const flussConfig = new Config({
        "bootstrap.servers": this.config.bootstrapServers,
      });
      this.connection = await FlussConnection.create(flussConfig);
      this.connected = true;
      this.logger.info(
        `[fluss-hook] Connected to Fluss at ${this.config.bootstrapServers}`,
      );

      // Auto-create database if needed
      if (this.config.autoCreateTable) {
        const admin = this.connection.getAdmin();
        const dbExists = await admin.databaseExists(this.config.databaseName);
        if (!dbExists) {
          await admin.createDatabase(
            this.config.databaseName,
            new DatabaseDescriptor("OpenClaw hook event logs"),
            true,
          );
          this.logger.info(
            `[fluss-hook] Created database: ${this.config.databaseName}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `[fluss-hook] Connection failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.connected = false;
      this.cleanup();
    }
  }

  /**
   * Get or create a writer for the specified hook table.
   * Writers are lazily initialized on first use.
   */
  private async ensureWriter(hookName: PluginHookName): Promise<AppendWriter | null> {
    const tableName = buildFullTableName(this.config, hookName);

    const existing = this.writers.get(tableName);
    if (existing) return existing;

    // Check if another call is already initializing this writer
    const pending = this.writerInitializing.get(tableName);
    if (pending) {
      await pending;
      return this.writers.get(tableName) ?? null;
    }

    const init = this.initWriter(hookName, tableName);
    this.writerInitializing.set(tableName, init);
    try {
      await init;
    } finally {
      this.writerInitializing.delete(tableName);
    }
    return this.writers.get(tableName) ?? null;
  }

  private async initWriter(hookName: PluginHookName, tableName: string): Promise<void> {
    if (!this.connection) return;

    try {
      const tablePath = buildTablePath(this.config, hookName);

      if (this.config.autoCreateTable) {
        const admin = this.connection.getAdmin();
        const tableExists = await admin.tableExists(tablePath);
        if (!tableExists) {
          const descriptor = buildTableDescriptor(this.config, hookName);
          await admin.createTable(tablePath, descriptor, true);
          this.logger.info(
            `[fluss-hook] Created table: ${this.config.databaseName}.${tableName}`,
          );
        }
      }

      const table = await this.connection.getTable(tablePath);
      const writer = table.newAppend().createWriter();
      this.writers.set(tableName, writer);
      this.logger.debug?.(
        `[fluss-hook] Writer ready for table: ${tableName}`,
      );
    } catch (err) {
      this.logger.error(
        `[fluss-hook] Writer init failed for ${tableName}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Append a batch of rows to a specific hook table and flush.
   */
  async appendBatch(
    hookName: PluginHookName,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    const isConnected = await this.ensureConnected();
    if (!isConnected) {
      throw new Error("Fluss client not connected");
    }

    const writer = await this.ensureWriter(hookName);
    if (!writer) {
      throw new Error(`Writer not available for ${hookName}`);
    }

    for (const row of rows) {
      writer.append(row);
    }
    await writer.flush();
  }

  /**
   * Close the connection and all writers.
   */
  close(): void {
    this.cleanup();
    this.logger.info("[fluss-hook] Connection closed");
  }

  private cleanup(): void {
    this.writers.clear();
    this.writerInitializing.clear();
    this.connected = false;
    try {
      this.connection?.close();
    } catch {
      // ignore close errors
    }
    this.connection = null;
  }
}
