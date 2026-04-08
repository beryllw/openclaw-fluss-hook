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
      gatewayUrl: "http://localhost:8080",
      gatewayUsername: undefined,
      gatewayPassword: undefined,
      databaseName: "openclaw",
      tablePrefix: "hook_",
      batchSize: 10,
      flushIntervalMs: 5000,
      autoCreateTable: true,
      bucketCount: 4,
      maxRetries: 3,
      retryBackoffMs: 500,
    });
  });

  it("uses env vars over defaults", () => {
    process.env.FLUSS_GATEWAY_URL = "http://fluss-host:8080";
    process.env.FLUSS_DATABASE = "mydb";
    process.env.FLUSS_TABLE_PREFIX = "evt_";
    process.env.FLUSS_BATCH_SIZE = "200";
    process.env.FLUSS_FLUSH_INTERVAL_MS = "10000";
    process.env.FLUSS_AUTO_CREATE_TABLE = "false";
    process.env.FLUSS_BUCKET_COUNT = "8";

    const config = resolveConfig();

    expect(config.gatewayUrl).toBe("http://fluss-host:8080");
    expect(config.databaseName).toBe("mydb");
    expect(config.tablePrefix).toBe("evt_");
    expect(config.batchSize).toBe(200);
    expect(config.flushIntervalMs).toBe(10000);
    expect(config.autoCreateTable).toBe(false);
    expect(config.bucketCount).toBe(8);
  });

  it("uses pluginConfig over env vars", () => {
    process.env.FLUSS_GATEWAY_URL = "http://env-host:8080";
    process.env.FLUSS_DATABASE = "env-db";

    const config = resolveConfig({
      gatewayUrl: "http://plugin-host:8080",
      databaseName: "plugin-db",
    });

    expect(config.gatewayUrl).toBe("http://plugin-host:8080");
    expect(config.databaseName).toBe("plugin-db");
  });

  it("ignores invalid env var values", () => {
    process.env.FLUSS_BATCH_SIZE = "not-a-number";
    process.env.FLUSS_AUTO_CREATE_TABLE = "maybe";
    process.env.FLUSS_GATEWAY_URL = "   ";

    const config = resolveConfig();

    expect(config.batchSize).toBe(10);
    expect(config.autoCreateTable).toBe(true);
    expect(config.gatewayUrl).toBe("http://localhost:8080");
  });

  it("ignores invalid pluginConfig types", () => {
    const config = resolveConfig({
      gatewayUrl: 123,
      batchSize: "not-a-number",
      autoCreateTable: "yes",
    });

    expect(config.gatewayUrl).toBe("http://localhost:8080");
    expect(config.batchSize).toBe(10);
    expect(config.autoCreateTable).toBe(true);
  });

  it("partial pluginConfig fills remaining from env/defaults", () => {
    process.env.FLUSS_DATABASE = "env-db";

    const config = resolveConfig({
      gatewayUrl: "http://custom-host:8080",
    });

    expect(config.gatewayUrl).toBe("http://custom-host:8080");
    expect(config.databaseName).toBe("env-db");
    expect(config.tablePrefix).toBe("hook_");
  });

  it("uses gatewayUsername/gatewayPassword from pluginConfig", () => {
    const config = resolveConfig({
      gatewayUrl: "http://sasl-host:8080",
      gatewayUsername: "admin",
      gatewayPassword: "secret",
    });

    expect(config.gatewayUsername).toBe("admin");
    expect(config.gatewayPassword).toBe("secret");
  });

  it("uses gatewayUsername/gatewayPassword from pluginConfig over env vars", () => {
    process.env.FLUSS_GATEWAY_USERNAME = "env-user";
    process.env.FLUSS_GATEWAY_PASSWORD = "env-pass";

    const config = resolveConfig({
      gatewayUsername: "plugin-user",
      gatewayPassword: "plugin-pass",
    });

    expect(config.gatewayUsername).toBe("plugin-user");
    expect(config.gatewayPassword).toBe("plugin-pass");
  });

  it("ignores invalid gatewayUsername/gatewayPassword types", () => {
    const config = resolveConfig({
      gatewayUsername: 123,
      gatewayPassword: null,
    });

    expect(config.gatewayUsername).toBeUndefined();
    expect(config.gatewayPassword).toBeUndefined();
  });
});
