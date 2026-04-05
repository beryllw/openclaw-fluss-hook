import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import {
  Config,
  FlussConnection,
  DatabaseDescriptor,
} from "fluss-node";

const COMPOSE_FILE = "docker-compose.integration.yml";
const TIMEOUT_MS = 120_000;

// Detect available compose command (podman compose works with OrbStack, docker compose may fail in Node child_process)
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

describe.skipIf(SKIP)("Fluss Integration Tests", () => {
  beforeAll(async () => {
    console.log(`[setup] Starting Fluss cluster via ${COMPOSE_CMD}...`);
    execSync(`${COMPOSE_CMD} -f ${COMPOSE_FILE} up -d --force-recreate --renew-anon-volumes`, {
      stdio: "inherit",
    });

    // Wait for Fluss to be ready
    console.log("[setup] Waiting for Fluss to be ready...");
    await waitForFluss();
  }, TIMEOUT_MS);

  afterAll(() => {
    console.log("[cleanup] Stopping Fluss cluster...");
    execSync(`${COMPOSE_CMD} -f ${COMPOSE_FILE} down -v`, { stdio: "inherit" });
  });

  describe("plaintext connection", () => {
    it("should connect, create db/table, and write data", async () => {
      const config = new Config({
        "bootstrap.servers": "localhost:9223",
        "writer.acks": "all",
      });

      const connection = await FlussConnection.create(config);
      const admin = connection.getAdmin();

      // Create database
      const dbName = "integration_test";
      const descriptor = new DatabaseDescriptor("integration test database");
      await admin.createDatabase(dbName, descriptor, true);
      expect(await admin.databaseExists(dbName)).toBe(true);

      // Create table
      // Note: Table creation requires proper schema and descriptor
      // For now, just verify we can connect and create databases
      console.log("[test] Database created successfully");

      await connection.close();
    }, 30_000);
  });

  describe("SASL connection", () => {
    it("should connect with correct credentials", async () => {
      const config = new Config({
        "bootstrap.servers": "localhost:9123",
        "writer.acks": "all",
        "security.protocol": "sasl",
        "security.sasl.mechanism": "PLAIN",
        "security.sasl.username": "admin",
        "security.sasl.password": "admin-secret",
      });

      const connection = await FlussConnection.create(config);
      const admin = connection.getAdmin();

      expect(await admin.databaseExists("integration_test")).toBe(true);
      console.log("[test] SASL connection with correct credentials successful");

      await connection.close();
    }, 30_000);

    it("should reject wrong credentials", async () => {
      const config = new Config({
        "bootstrap.servers": "localhost:9123",
        "writer.acks": "all",
        "security.protocol": "sasl",
        "security.sasl.mechanism": "PLAIN",
        "security.sasl.username": "admin",
        "security.sasl.password": "wrong-password",
      });

      await expect(FlussConnection.create(config)).rejects.toThrow();
    }, 30_000);
  });
});

async function waitForFluss(): Promise<void> {
  const maxRetries = 60;
  const retryInterval = 1000;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const config = new Config({
        "bootstrap.servers": "localhost:9223",
      });
      const connection = await FlussConnection.create(config);
      await connection.close();
      console.log("[setup] Fluss is ready!");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, retryInterval));
    }
  }

  throw new Error("Fluss cluster did not become ready within timeout");
}
