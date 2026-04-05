import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";

const COMPOSE_FILE = "docker-compose.integration.yml";
const GATEWAY_URL = "http://localhost:8080";
const TIMEOUT_MS = 120_000;

// Detect available compose command
function detectComposeCommand(): string | null {
  try {
    execSync("podman compose version", { stdio: "ignore", timeout: 5000 });
    return "podman compose";
  } catch {
    try {
      execSync("docker compose version", { stdio: "ignore", timeout: 5000 });
      return "docker compose";
    } catch {
      return null;
    }
  }
}

const COMPOSE_CMD = detectComposeCommand();
const SKIP = process.env.FLUSS_TEST_SKIP === "true" || !COMPOSE_CMD;

async function httpGet(path: string): Promise<unknown> {
  const res = await fetch(`${GATEWAY_URL}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function httpPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

describe.skipIf(SKIP)("Fluss Gateway Integration Tests", () => {
  beforeAll(async () => {
    console.log(`[setup] Starting Fluss cluster + gateway via ${COMPOSE_CMD}...`);
    execSync(`${COMPOSE_CMD} -f ${COMPOSE_FILE} up -d --force-recreate --renew-anon-volumes`, {
      stdio: "inherit",
    });
    await waitForGateway();
  }, TIMEOUT_MS);

  afterAll(() => {
    console.log("[cleanup] Stopping Fluss cluster + gateway...");
    execSync(`${COMPOSE_CMD} -f ${COMPOSE_FILE} down -v`, { stdio: "inherit" });
  });

  describe("health check", () => {
    it("should return healthy", async () => {
      const result = await httpGet("/health");
      expect(result).toEqual({ status: "ok" });
    }, 10_000);
  });

  describe("database operations", () => {
    it("should create a database", async () => {
      await httpPost("/v1/_databases", {
        database_name: "integration_test",
        comment: "integration test database",
        ignore_if_exists: true,
      });

      const dbs = await httpGet("/v1/_databases");
      expect((dbs as string[]).includes("integration_test")).toBe(true);
    }, 10_000);
  });

  describe("table and write operations", () => {
    it("should create a table and write data", async () => {
      // Create a log table (no PK)
      await httpPost("/v1/integration_test/_tables", {
        table_name: "test_log",
        schema: [
          { name: "message", data_type: "string" },
          { name: "ts", data_type: "bigint" },
        ],
        bucket_count: 2,
        bucket_keys: ["message"],
        ignore_if_exists: true,
      });

      // Wait for Fluss metadata to propagate across cluster
      await new Promise((r) => setTimeout(r, 5000));

      // Verify table is visible before writing
      const tables = await httpGet("/v1/integration_test/_tables");
      expect((tables as string[]).includes("test_log")).toBe(true);

      // Write rows
      const result = await httpPost("/v1/integration_test/test_log/rows", {
        rows: [
          { values: ["hello world", Date.now()] },
          { values: ["second message", Date.now()] },
        ],
      });

      expect((result as { row_count: number }).row_count).toBe(2);
    }, 15_000);

    it("should list tables", async () => {
      const tables = await httpGet("/v1/integration_test/_tables");
      expect((tables as string[]).includes("test_log")).toBe(true);
    }, 10_000);
  });
});

async function waitForGateway(): Promise<void> {
  const maxRetries = 120;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${GATEWAY_URL}/health`);
      if (res.ok) {
        console.log("[setup] Gateway is ready!");
        return;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("Gateway did not become ready within timeout");
}
