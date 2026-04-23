# OpenClaw + Fluss + Flink SQL Demo

End-to-end demonstration: user chats with OpenClaw AI, all hook events are synced to Apache Fluss in real-time via `fluss-hook` plugin, and Flink SQL queries the event streams across dedicated tables.

## Architecture

```
User --> OpenClaw Gateway --> fluss-hook --> Fluss Gateway --> Fluss Cluster <-- Flink SQL
              :18789          (26 hooks)     REST API :8080   coordinator:9123    :8083
```

Each hook event type is written to its own Fluss table (e.g. `hook_agent_end`, `hook_llm_output`). Tables are lazily created on first event arrival.

## Prerequisites

- **Docker** (Docker Desktop, Docker Engine, or Podman)

## Quick Start

### 1. Download Flink Connector JAR

```bash
./scripts/setup.sh
```

### 2. Build Fluss Gateway Image

Download the pre-built `fluss-gateway` binary for your platform from the [fluss-gateway releases](https://github.com/beryllw/fluss-gateway/releases), then build the Docker image:

```bash
# Example for aarch64-linux (adjust for your platform)
tar xzf fluss-gateway-aarch64-linux.tar.gz
cp fluss-gateway demo/
docker build -t fluss-gateway:latest -f demo/Dockerfile.fluss-gateway demo/
rm demo/fluss-gateway
```

> **Note**: The `fluss-gateway` binary requires GLIBC >= 2.38. The `Dockerfile.fluss-gateway` uses `debian:trixie-slim` (GLIBC 2.41) as the base image. Using `debian:bookworm-slim` (GLIBC 2.36) will cause a startup failure.

### 3. Configure LLM API Key

Edit `.env` and set at least one LLM provider key:

```env
BAILIAN_API_KEY=sk-...
```

The default model configuration uses `qwen3.5-plus` and `qwen3-coder-plus`. To use other providers, modify `config/openclaw.json`.

### 4. Build & Start

```bash
# Build the image (pulls official OpenClaw image, layers plugin on top — fast)
./scripts/build.sh

# Start all services (ZooKeeper + Fluss + Gateway + Flink + OpenClaw)
docker compose up -d
```

### 5. Verify Services

```bash
docker compose ps

# Check fluss-hook plugin loaded
docker compose logs openclaw | grep fluss-hook
# Expected: "[fluss-hook] Plugin registered (26 hooks, output=fluss)"
# Expected: "[fluss-hook] Buffer started (batchSize=10, flushInterval=3000ms)"
```

> **Note**: If the plugin logs show "fetch failed" for database setup, it means the Fluss Gateway was not ready when OpenClaw started. Restart the openclaw container: `docker compose restart openclaw`

## Demo Walkthrough

### Step 1: Chat with OpenClaw

**Option A: Web UI**

Open http://localhost:18789 and send a few messages. Each interaction triggers multiple hook events (agent start/end, LLM input/output, message write, etc.) which are captured and written to Fluss.

**Option B: CLI (headless, for CI/testing)**

```bash
# Send a message through the gateway (triggers all hooks)
docker compose exec openclaw node dist/index.js agent \
  --session-id test-001 \
  --message "Hello, reply briefly" \
  --json --timeout 60
```

> **Important**: Do **not** use the `--local` flag — it runs the embedded agent locally and bypasses the gateway, so no hook events are fired.

### Step 2: Verify Data in Fluss

After sending messages, wait a few seconds for the buffer to flush (default `flushIntervalMs: 3000`), then verify via the Fluss Gateway REST API:

```bash
# List databases
curl -s http://localhost:8080/v1/_databases
# Expected: ["openclaw","fluss"]

# List tables
curl -s http://localhost:8080/v1/openclaw/_tables
# Expected: ["hook_gateway_start","hook_before_agent_start","hook_agent_end",...]

# Scan a table
curl -s -X POST http://localhost:8080/v1/openclaw/hook_agent_end/scan \
  -H "Content-Type: application/json" -d '{"limit": 5}'

# Get table schema
curl -s http://localhost:8080/v1/openclaw/hook_agent_end/_info
```

### Step 3: Query Events with Flink SQL

```bash
docker compose exec jobmanager ./bin/sql-client.sh
```

Set up the catalog and explore tables:

```sql
CREATE CATALOG fluss_catalog WITH (
  'type' = 'fluss',
  'bootstrap.servers' = 'coordinator-server:9123'
);
USE CATALOG fluss_catalog;
USE openclaw;
SHOW TABLES;
```

After sending messages, you should see tables like:

```
hook_gateway_start, hook_before_agent_start, hook_agent_end,
hook_before_model_resolve, hook_before_prompt_build,
hook_before_message_write, hook_llm_input, hook_llm_output, ...
```

### Step 4: Query Individual Tables

```sql
SET 'execution.runtime-mode' = 'streaming';
SET 'sql-client.execution.result-mode' = 'changelog';

-- Agent completions with duration
SELECT agent_id, success, duration_ms, message_provider, `timestamp`
FROM hook_agent_end
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- Tool call history
SELECT tool_name, duration_ms, error, `timestamp`
FROM hook_after_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- Inbound user messages
SELECT from_id, channel_id,
       SUBSTRING(content, 1, 80) AS preview, `timestamp`
FROM hook_message_received
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- Agent success rate
SELECT agent_id,
       COUNT(*) AS total,
       SUM(CASE WHEN success THEN 1 ELSE 0 END) AS ok,
       SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) AS failed
FROM hook_agent_end
  /*+ OPTIONS('scan.startup.mode'='earliest') */
GROUP BY agent_id;

-- Tool usage frequency
SELECT tool_name, COUNT(*) AS call_count
FROM hook_before_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */
GROUP BY tool_name;
```

See `scripts/demo.sql` for the full set of queries.

### Step 5: Observe Real-Time Sync

Keep a Flink SQL streaming query running, then send new messages in the OpenClaw UI. New rows appear within seconds.

## Expected Tables

Tables are lazily created when the first event of each type arrives. In a typical chat session via CLI or Web UI:

| Always created (8) | Conditionally created |
|-------------------|-----------------------|
| `hook_gateway_start` | `hook_before_tool_call` (when agent uses tools) |
| `hook_before_agent_start` | `hook_after_tool_call` (when agent uses tools) |
| `hook_agent_end` | `hook_tool_result_persist` (when agent uses tools) |
| `hook_before_model_resolve` | `hook_before_compaction` (long conversations) |
| `hook_before_prompt_build` | `hook_after_compaction` (long conversations) |
| `hook_before_message_write` | `hook_session_end` (explicit session end) |
| `hook_llm_input` | `hook_gateway_stop` (gateway shutdown) |
| `hook_llm_output` | `hook_message_sending` / `hook_message_sent` (external channels) |

## Services

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `zookeeper` | `zookeeper:3.9.2` | - | Fluss coordination |
| `coordinator-server` | `apache/fluss:0.9.0-incubating-rc2` | 9123 | Fluss metadata |
| `tablet-server` | `apache/fluss:0.9.0-incubating-rc2` | - | Fluss data storage |
| `fluss-gateway` | `fluss-gateway:latest` | 8080 | REST API for Fluss |
| `jobmanager` | `flink:1.20-scala_2.12-java17` | 8083 | Flink Web UI & SQL |
| `taskmanager` | `flink:1.20-scala_2.12-java17` | - | Flink task execution |
| `openclaw` | `alpine/openclaw` + plugin | 18789 | AI gateway + fluss-hook |

## Web UIs

- **OpenClaw**: http://localhost:18789
- **Flink Dashboard**: http://localhost:8083

## Plugin Configuration

The plugin config in `config/openclaw.json`:

```json
{
  "gatewayUrl": "http://fluss-gateway:8080",
  "databaseName": "openclaw",
  "tablePrefix": "hook_",
  "autoCreateTable": true,
  "batchSize": 10,
  "flushIntervalMs": 3000
}
```

| Key | Description |
|-----|-------------|
| `gatewayUrl` | Fluss Gateway REST API URL |
| `tablePrefix` | Prefix for all hook tables (e.g. `hook_` creates `hook_agent_end`) |
| `autoCreateTable` | Auto-create database and tables on first event |
| `batchSize` | Rows buffered per table before flush |
| `flushIntervalMs` | Periodic flush interval in ms |

## Troubleshooting

### Fluss Gateway: "GLIBC_2.38 not found"

The `fluss-gateway` binary (v0.1.4+) requires GLIBC >= 2.38. Ensure the Docker image uses `debian:trixie-slim` (GLIBC 2.41) or newer as the base. Using `debian:bookworm-slim` (GLIBC 2.36) will not work.

### Plugin "fetch failed" / "Operation exhausted for database setup"

The fluss-hook plugin failed to connect to the Fluss Gateway during startup. This happens when the gateway is not yet ready. Fix: restart the openclaw container after all services are healthy:

```bash
docker compose restart openclaw
docker compose logs openclaw | grep fluss-hook
# Verify: "Buffer started (batchSize=10, flushInterval=3000ms)"
```

### "Invalid config: must NOT have additional properties"

The Docker image needs to be rebuilt after plugin config schema changes:

```bash
./scripts/build.sh
docker compose up -d openclaw
```

### "Plugin not found" in OpenClaw logs

Check the config volume mount:

```bash
docker compose exec openclaw cat /home/node/.openclaw/openclaw.json
```

Verify the plugin path exists:

```bash
docker compose exec openclaw ls -la /app/plugins/fluss-hook/
```

### Flink SQL: "Table not found"

Tables are auto-created when the first event arrives. Send at least one message via the OpenClaw UI before querying. Run `SHOW TABLES;` to see which tables exist.

### Connection refused to Fluss Gateway

The Fluss Gateway waits for the coordinator to be healthy. Check:

```bash
docker compose logs fluss-gateway | tail -20
```

### Connection refused to coordinator-server

Wait for the Fluss cluster to fully start:

```bash
docker compose logs coordinator-server | tail -20
```

## Cleanup

```bash
docker compose down -v
```
