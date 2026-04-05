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
      username: undefined,
      password: undefined,
      databaseName: "openclaw",
      tablePrefix: "hook_",
      batchSize: 50,
      flushIntervalMs: 5000,
      autoCreateTable: true,
      bucketCount: 4,
    });
  });

  it("uses env vars over defaults", () => {
    process.env.FLUSS_BOOTSTRAP_SERVERS = "fluss-host:9999";
    process.env.FLUSS_DATABASE = "mydb";
    process.env.FLUSS_TABLE_PREFIX = "evt_";
    process.env.FLUSS_BATCH_SIZE = "200";
    process.env.FLUSS_FLUSH_INTERVAL_MS = "10000";
    process.env.FLUSS_AUTO_CREATE_TABLE = "false";
    process.env.FLUSS_BUCKET_COUNT = "8";

    const config = resolveConfig();

    expect(config.bootstrapServers).toBe("fluss-host:9999");
    expect(config.databaseName).toBe("mydb");
    expect(config.tablePrefix).toBe("evt_");
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

    expect(config.batchSize).toBe(50);
    expect(config.autoCreateTable).toBe(true);
    expect(config.bootstrapServers).toBe("localhost:9223");
  });

  it("ignores invalid pluginConfig types", () => {
    const config = resolveConfig({
      bootstrapServers: 123,
      batchSize: "not-a-number",
      autoCreateTable: "yes",
    });

    expect(config.bootstrapServers).toBe("localhost:9223");
    expect(config.batchSize).toBe(50);
    expect(config.autoCreateTable).toBe(true);
  });

  it("partial pluginConfig fills remaining from env/defaults", () => {
    process.env.FLUSS_DATABASE = "env-db";

    const config = resolveConfig({
      bootstrapServers: "custom-host:9223",
    });

    expect(config.bootstrapServers).toBe("custom-host:9223");
    expect(config.databaseName).toBe("env-db");
    expect(config.tablePrefix).toBe("hook_");
  });

  it("uses username/password from pluginConfig", () => {
    const config = resolveConfig({
      bootstrapServers: "sasl-host:9223",
      username: "admin",
      password: "secret",
    });

    expect(config.username).toBe("admin");
    expect(config.password).toBe("secret");
  });

  it("uses username/password from pluginConfig over env vars", () => {
    process.env.FLUSS_USERNAME = "env-user";
    process.env.FLUSS_PASSWORD = "env-pass";

    const config = resolveConfig({
      username: "plugin-user",
      password: "plugin-pass",
    });

    expect(config.username).toBe("plugin-user");
    expect(config.password).toBe("plugin-pass");
  });

  it("ignores invalid username/password types", () => {
    const config = resolveConfig({
      username: 123,
      password: null,
    });

    expect(config.username).toBeUndefined();
    expect(config.password).toBeUndefined();
  });
});
