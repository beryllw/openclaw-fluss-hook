import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveConfig } from "../src/config.js";

describe("resolveConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns defaults when no config or env vars", () => {
    const config = resolveConfig();

    expect(config).toEqual({
      bootstrapServers: "localhost:9223",
      databaseName: "openclaw",
      tableName: "message_logs",
      batchSize: 50,
      flushIntervalMs: 5000,
      autoCreateTable: true,
      bucketCount: 4,
    });
  });

  it("uses env vars over defaults", () => {
    process.env.FLUSS_BOOTSTRAP_SERVERS = "fluss-host:9999";
    process.env.FLUSS_DATABASE = "mydb";
    process.env.FLUSS_TABLE = "mytable";
    process.env.FLUSS_BATCH_SIZE = "200";
    process.env.FLUSS_FLUSH_INTERVAL_MS = "10000";
    process.env.FLUSS_AUTO_CREATE_TABLE = "false";
    process.env.FLUSS_BUCKET_COUNT = "8";

    const config = resolveConfig();

    expect(config.bootstrapServers).toBe("fluss-host:9999");
    expect(config.databaseName).toBe("mydb");
    expect(config.tableName).toBe("mytable");
    expect(config.batchSize).toBe(200);
    expect(config.flushIntervalMs).toBe(10000);
    expect(config.autoCreateTable).toBe(false);
    expect(config.bucketCount).toBe(8);
  });

  it("uses pluginConfig over env vars", () => {
    process.env.FLUSS_BOOTSTRAP_SERVERS = "env-host:1111";
    process.env.FLUSS_DATABASE = "env-db";

    const config = resolveConfig({
      bootstrapServers: "plugin-host:2222",
      databaseName: "plugin-db",
    });

    expect(config.bootstrapServers).toBe("plugin-host:2222");
    expect(config.databaseName).toBe("plugin-db");
  });

  it("ignores invalid env var values", () => {
    process.env.FLUSS_BATCH_SIZE = "not-a-number";
    process.env.FLUSS_AUTO_CREATE_TABLE = "maybe";
    process.env.FLUSS_BOOTSTRAP_SERVERS = "   ";

    const config = resolveConfig();

    expect(config.batchSize).toBe(50); // default
    expect(config.autoCreateTable).toBe(true); // default
    expect(config.bootstrapServers).toBe("localhost:9223"); // default
  });

  it("ignores invalid pluginConfig types", () => {
    const config = resolveConfig({
      bootstrapServers: 123, // wrong type
      batchSize: "not-a-number", // wrong type
      autoCreateTable: "yes", // wrong type
    });

    expect(config.bootstrapServers).toBe("localhost:9223"); // falls through to default
    expect(config.batchSize).toBe(50);
    expect(config.autoCreateTable).toBe(true);
  });

  it("partial pluginConfig fills remaining from env/defaults", () => {
    process.env.FLUSS_DATABASE = "env-db";

    const config = resolveConfig({
      bootstrapServers: "custom-host:9223",
    });

    expect(config.bootstrapServers).toBe("custom-host:9223"); // from pluginConfig
    expect(config.databaseName).toBe("env-db"); // from env
    expect(config.tableName).toBe("message_logs"); // from default
  });
});
