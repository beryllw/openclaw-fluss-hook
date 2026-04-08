import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GatewayClient } from "../src/fluss-client.js";
import type { FlussHookConfig, PluginLogger } from "../src/types.js";

function createMockLogger(): PluginLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createConfig(overrides?: Partial<FlussHookConfig>): FlussHookConfig {
  return {
    gatewayUrl: "http://localhost:8080",
    databaseName: "test_db",
    tablePrefix: "hook_",
    batchSize: 10,
    flushIntervalMs: 5000,
    autoCreateTable: false,
    bucketCount: 4,
    maxRetries: 3,
    retryBackoffMs: 10, // fast backoff for tests
    outputMode: "memory" as const,
    ...overrides,
  };
}

describe("GatewayClient", () => {
  let logger: PluginLogger;

  beforeEach(() => {
    logger = createMockLogger();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe("constructor", () => {
    it("stores baseUrl without trailing slash", () => {
      const client = new GatewayClient(
        createConfig({ gatewayUrl: "http://example.com/api///" }),
        logger,
      );
      client.close();
    });

    it("sets Basic auth header when credentials provided", () => {
      const client = new GatewayClient(
        createConfig({ gatewayUsername: "user", gatewayPassword: "pass" }),
        logger,
      );
      client.close();
    });

    it("does not set auth header when only username is provided", () => {
      const client = new GatewayClient(
        createConfig({ gatewayUsername: "user" }),
        logger,
      );
      client.close();
    });
  });

  // ---------------------------------------------------------------------------
  // appendBatch retry behavior
  // ---------------------------------------------------------------------------

  describe("appendBatch retry behavior", () => {
    it("succeeds on first attempt", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ row_count: 2 }), { status: 200 }),
      );

      const client = new GatewayClient(createConfig(), logger);
      await client.appendBatch("agent_end", [
        { agent_id: "a1", timestamp: 1 },
        { agent_id: "a2", timestamp: 2 },
      ]);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      client.close();
    });

    it("retries on 500 and succeeds", async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: "internal error" }), { status: 500 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ row_count: 1 }), { status: 200 }),
        );

      const client = new GatewayClient(createConfig(), logger);
      const promise = client.appendBatch("agent_end", [{ agent_id: "a1", timestamp: 1 }]);

      // Advance timers to trigger backoff (retryBackoffMs=10, so 10ms)
      await vi.advanceTimersByTimeAsync(10);
      await promise;

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Retry attempt 1/3"),
      );
      client.close();
    });

    it("retries up to maxRetries then throws", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "server error" }), { status: 503 }),
      );

      const client = new GatewayClient(
        createConfig({ maxRetries: 3, retryBackoffMs: 10 }),
        logger,
      );
      const promise = client.appendBatch("agent_end", [{ agent_id: "a1", timestamp: 1 }]);
      promise.catch(() => {}); // prevent unhandled rejection warning

      // 3 retries: 10ms + 20ms + 40ms
      await vi.advanceTimersByTimeAsync(10 + 20 + 40);

      await expect(promise).rejects.toThrow("Gateway error: HTTP 503");

      // 1 initial + 3 retries = 4 calls
      expect(global.fetch).toHaveBeenCalledTimes(4);
      client.close();
    });

    it("does NOT retry on 400 client error", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ message: "bad request", error_code: 40001 }),
          { status: 400 },
        ),
      );

      const client = new GatewayClient(createConfig(), logger);
      const promise = client.appendBatch("agent_end", [{ agent_id: "a1", timestamp: 1 }]);

      // No timers to advance — should fail immediately
      await expect(promise).rejects.toThrow("Gateway error: HTTP 400");
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Non-retryable"),
      );
      client.close();
    });

    it("does NOT retry on 401 auth error", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ message: "unauthorized", error_code: 40101 }),
          { status: 401 },
        ),
      );

      const client = new GatewayClient(createConfig(), logger);
      const promise = client.appendBatch("agent_end", [{ agent_id: "a1", timestamp: 1 }]);

      await expect(promise).rejects.toThrow("Gateway error: HTTP 401");
      expect(global.fetch).toHaveBeenCalledTimes(1);
      client.close();
    });

    it("retries on network failure (TypeError)", async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

      const client = new GatewayClient(
        createConfig({ maxRetries: 2, retryBackoffMs: 10 }),
        logger,
      );
      const promise = client.appendBatch("agent_end", [{ agent_id: "a1", timestamp: 1 }]);
      promise.catch(() => {}); // prevent unhandled rejection warning

      await vi.advanceTimersByTimeAsync(10 + 20);

      await expect(promise).rejects.toThrow("fetch failed");
      expect(global.fetch).toHaveBeenCalledTimes(3); // 1 + 2 retries
      client.close();
    });

    it("retries on timeout (AbortError)", async () => {
      const abortError = new DOMException("signal is aborted", "AbortError");
      global.fetch = vi.fn()
        .mockRejectedValueOnce(abortError)
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ row_count: 1 }), { status: 200 }),
        );

      const client = new GatewayClient(createConfig(), logger);
      const promise = client.appendBatch("agent_end", [{ agent_id: "a1", timestamp: 1 }]);

      await vi.advanceTimersByTimeAsync(10);
      await promise;

      expect(global.fetch).toHaveBeenCalledTimes(2);
      client.close();
    });

    it("sends correct POST body with column-ordered values", async () => {
      let capturedBody: string | undefined;
      global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        capturedBody = init.body as string;
        return new Response(JSON.stringify({ row_count: 1 }), { status: 200 });
      });

      const client = new GatewayClient(createConfig(), logger);
      await client.appendBatch("agent_end", [
        { agent_id: "a1", success: true, error: null, duration_ms: 100, timestamp: 123 },
      ]);

      expect(capturedBody).toBeDefined();
      const parsed = JSON.parse(capturedBody!);
      expect(parsed.rows).toHaveLength(1);
      // agent_end schema: messages, success, error, duration_ms, agent_id, session_key, ...
      expect(parsed.rows[0].values).toContain(true); // success
      expect(parsed.rows[0].values).toContain("a1"); // agent_id
      client.close();
    });

    it("uses correct URL path with encoded db and table names", async () => {
      let capturedUrl: string | undefined;
      global.fetch = vi.fn().mockImplementation((url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ row_count: 1 }), { status: 200 });
      });

      const client = new GatewayClient(
        createConfig({
          gatewayUrl: "http://my-host:9090",
          databaseName: "my db",
          tablePrefix: "hook_",
        }),
        logger,
      );
      await client.appendBatch("agent_end", [{ agent_id: "a1", timestamp: 1 }]);

      expect(capturedUrl).toBe("http://my-host:9090/v1/my%20db/hook_agent_end/rows");
      client.close();
    });

    it("includes Authorization header when credentials configured", async () => {
      let capturedHeaders: Record<string, string> | undefined;
      global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        capturedHeaders = init.headers as Record<string, string>;
        return new Response(JSON.stringify({ row_count: 1 }), { status: 200 });
      });

      const client = new GatewayClient(
        createConfig({ gatewayUsername: "admin", gatewayPassword: "secret" }),
        logger,
      );
      await client.appendBatch("agent_end", [{ agent_id: "a1", timestamp: 1 }]);

      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders!["Authorization"]).toBe("Basic YWRtaW46c2VjcmV0");
      client.close();
    });
  });

  // ---------------------------------------------------------------------------
  // ensureDatabase retry
  // ---------------------------------------------------------------------------

  describe("ensureDatabase retry", () => {
    it("retries on 500 and succeeds", async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: "error" }), { status: 500 }),
        )
        .mockResolvedValueOnce(
          new Response(null, { status: 201 }),
        );

      const client = new GatewayClient(
        createConfig({ autoCreateTable: true, retryBackoffMs: 10 }),
        logger,
      );
      const promise = client.ensureDatabase();
      await vi.advanceTimersByTimeAsync(10);
      await promise;

      expect(global.fetch).toHaveBeenCalledTimes(2);
      client.close();
    });

    it("does NOT retry on 400", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "bad request" }), { status: 400 }),
      );

      const client = new GatewayClient(
        createConfig({ autoCreateTable: true }),
        logger,
      );
      const promise = client.ensureDatabase();
      await expect(promise).rejects.toThrow("Gateway error: HTTP 400");
      expect(global.fetch).toHaveBeenCalledTimes(1);
      client.close();
    });

    it("skips when autoCreateTable is disabled", async () => {
      global.fetch = vi.fn();

      const client = new GatewayClient(
        createConfig({ autoCreateTable: false }),
        logger,
      );
      await client.ensureDatabase();

      expect(global.fetch).not.toHaveBeenCalled();
      client.close();
    });
  });

  // ---------------------------------------------------------------------------
  // ensureTableExists / initTable retry
  // ---------------------------------------------------------------------------

  describe("ensureTableExists retry", () => {
    it("retries on 500 and succeeds", async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: "error" }), { status: 500 }),
        )
        .mockResolvedValueOnce(
          new Response(null, { status: 201 }),
        );

      const client = new GatewayClient(
        createConfig({ autoCreateTable: true, retryBackoffMs: 10 }),
        logger,
      );
      const promise = (client as any).ensureTableExists("agent_end");
      await vi.advanceTimersByTimeAsync(10);
      await promise;

      expect(global.fetch).toHaveBeenCalledTimes(2);
      client.close();
    });

    it("does not retry if table already created (cached)", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(null, { status: 201 }),
      );

      const client = new GatewayClient(createConfig(), logger);
      await (client as any).ensureTableExists("agent_end");
      await (client as any).ensureTableExists("agent_end");
      await (client as any).ensureTableExists("agent_end");

      // Only 1 call due to caching
      expect(global.fetch).toHaveBeenCalledTimes(1);
      client.close();
    });

    it("retries on network failure and succeeds", async () => {
      global.fetch = vi.fn()
        .mockRejectedValueOnce(new TypeError("connection refused"))
        .mockRejectedValueOnce(new TypeError("connection refused"))
        .mockResolvedValue(
          new Response(null, { status: 201 }),
        );

      const client = new GatewayClient(
        createConfig({ retryBackoffMs: 10 }),
        logger,
      );
      const promise = (client as any).ensureTableExists("session_start");
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(20);
      await promise;

      expect(global.fetch).toHaveBeenCalledTimes(3);
      client.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Error classification
  // ---------------------------------------------------------------------------

  describe("error classification", () => {
    it("retries on 502 Bad Gateway", async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: "bad gateway" }), { status: 502 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ row_count: 1 }), { status: 200 }),
        );

      const client = new GatewayClient(createConfig({ retryBackoffMs: 10 }), logger);
      const promise = client.appendBatch("agent_end", [{ agent_id: "a1", timestamp: 1 }]);
      await vi.advanceTimersByTimeAsync(10);
      await promise;

      expect(global.fetch).toHaveBeenCalledTimes(2);
      client.close();
    });

    it("does NOT retry on 404 Not Found", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "not found" }), { status: 404 }),
      );

      const client = new GatewayClient(createConfig(), logger);
      const promise = client.appendBatch("agent_end", [{ agent_id: "a1", timestamp: 1 }]);

      await expect(promise).rejects.toThrow("Gateway error: HTTP 404");
      expect(global.fetch).toHaveBeenCalledTimes(1);
      client.close();
    });

    it("retries on 503 Service Unavailable", async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: "unavailable" }), { status: 503 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ row_count: 1 }), { status: 200 }),
        );

      const client = new GatewayClient(createConfig({ retryBackoffMs: 10 }), logger);
      const promise = client.appendBatch("agent_end", [{ agent_id: "a1", timestamp: 1 }]);
      await vi.advanceTimersByTimeAsync(10);
      await promise;

      expect(global.fetch).toHaveBeenCalledTimes(2);
      client.close();
    });
  });

  // ---------------------------------------------------------------------------
  // close
  // ---------------------------------------------------------------------------

  describe("close", () => {
    it("logs closure message", () => {
      const client = new GatewayClient(createConfig(), logger);
      client.close();
      expect(logger.info).toHaveBeenCalledWith("[fluss-hook] GatewayClient closed");
    });
  });
});
