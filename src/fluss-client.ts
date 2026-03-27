import {
  Config,
  FlussConnection,
  DatabaseDescriptor,
  TablePath,
} from "fluss-node";
import type { FlussHookConfig, FlussMessageRow, PluginLogger } from "./types.js";
import { buildMessageLogTableDescriptor, buildTablePath } from "./schema.js";

/**
 * Manages the Fluss connection lifecycle with lazy initialization,
 * auto table creation, and writer caching.
 */
export class FlussClientManager {
  private config: FlussHookConfig;
  private logger: PluginLogger;
  private connection: FlussConnection | null = null;
  private writer: ReturnType<
    ReturnType<Awaited<ReturnType<FlussConnection["getTable"]>>["newAppend"]>["createWriter"]
  > | null = null;
  private initializing: Promise<void> | null = null;
  private ready = false;

  constructor(config: FlussHookConfig, logger: PluginLogger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Ensure the client is connected, database/table exist, and writer is ready.
   * Uses a shared promise to prevent concurrent initialization.
   */
  async ensureReady(): Promise<boolean> {
    if (this.ready && this.writer) {
      return true;
    }

    if (this.initializing) {
      await this.initializing;
      return this.ready;
    }

    this.initializing = this.initialize();
    try {
      await this.initializing;
    } finally {
      this.initializing = null;
    }
    return this.ready;
  }

  private async initialize(): Promise<void> {
    try {
      // 1. Connect
      const flussConfig = new Config({
        "bootstrap.servers": this.config.bootstrapServers,
      });
      this.connection = await FlussConnection.create(flussConfig);
      this.logger.info(
        `[fluss-hook] Connected to Fluss at ${this.config.bootstrapServers}`,
      );

      const tablePath = buildTablePath(this.config);

      // 2. Auto-create database and table
      if (this.config.autoCreateTable) {
        const admin = this.connection.getAdmin();

        const dbExists = await admin.databaseExists(this.config.databaseName);
        if (!dbExists) {
          await admin.createDatabase(
            this.config.databaseName,
            new DatabaseDescriptor("OpenClaw message logs"),
            true,
          );
          this.logger.info(
            `[fluss-hook] Created database: ${this.config.databaseName}`,
          );
        }

        const tableExists = await admin.tableExists(tablePath);
        if (!tableExists) {
          const descriptor = buildMessageLogTableDescriptor(this.config);
          await admin.createTable(tablePath, descriptor, true);
          this.logger.info(
            `[fluss-hook] Created table: ${this.config.databaseName}.${this.config.tableName}`,
          );
        }
      }

      // 3. Get table and create writer
      const table = await this.connection.getTable(tablePath);
      this.writer = table.newAppend().createWriter();
      this.ready = true;

      this.logger.info("[fluss-hook] Writer ready");
    } catch (err) {
      this.logger.error(
        `[fluss-hook] Initialization failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.ready = false;
      this.cleanup();
    }
  }

  /**
   * Append a batch of rows and flush to Fluss.
   */
  async appendBatch(rows: FlussMessageRow[]): Promise<void> {
    const isReady = await this.ensureReady();
    if (!isReady || !this.writer) {
      throw new Error("Fluss client not ready");
    }

    for (const row of rows) {
      this.writer.append(row);
    }
    await this.writer.flush();
  }

  /**
   * Close the connection and reset state.
   */
  close(): void {
    this.cleanup();
    this.logger.info("[fluss-hook] Connection closed");
  }

  private cleanup(): void {
    this.writer = null;
    this.ready = false;
    try {
      this.connection?.close();
    } catch {
      // ignore close errors
    }
    this.connection = null;
  }
}
