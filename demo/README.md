# OpenClaw + Fluss + Flink SQL Demo

End-to-end demonstration: user chats with OpenClaw AI, all hook events are synced to Apache Fluss in real-time via `fluss-hook` plugin, and Flink SQL queries the event streams across 14 dedicated tables.

## Architecture

```
User --> OpenClaw Gateway --> fluss-hook --> Fluss Gateway --> Fluss Cluster <-- Flink SQL
              :18789          (14 hooks)     REST API :8080   coordinator:9123    :8083
```

Each hook event type is written to its own Fluss table (e.g. `hook_agent_end`, `hook_before_tool_call`). Tables are lazily created on first event arrival.

## Prerequisites

- **Docker** (Docker Desktop, Docker Engine, or Podman)

## Quick Start

### 1. Download Flink Connector JAR

```bash
./scripts/setup.sh
```

### 2. Configure LLM API Key

Edit `.env` and set at least one LLM provider key:

```env
BAILIAN_API_KEY=sk-...
```

The default model configuration uses `qwen3.5-plus` and `qwen3-coder-plus`. To use other providers, modify `config/openclaw.json`.

### 3. Build & Start

```bash
# Build the image (pulls official OpenClaw image, layers plugin on top — fast)
./scripts/build.sh

# Start all services (ZooKeeper + Fluss + Gateway + Flink + OpenClaw)
docker compose up -d
```

### 4. Verify Services

```bash
docker compose ps

# Check fluss-hook plugin loaded
docker compose logs openclaw | grep fluss-hook
# Expected: "[fluss-hook] Plugin registered (14 hooks)"
```

## Demo Walkthrough

### Step 1: Chat with OpenClaw

Open http://localhost:18789 and send a few messages. Each interaction triggers multiple hook events (agent start/end, tool calls, session start, etc.) which are captured and written to Fluss.

### Step 2: Query Events with Flink SQL

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
hook_before_agent_start, hook_agent_end, hook_before_tool_call,
hook_after_tool_call, hook_tool_result_persist, hook_message_received,
hook_session_start, hook_gateway_start, ...
```

### Step 3: Query Individual Tables

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

See `scripts/demo.sql` for the full set of queries covering all 14 tables.

### Step 4: Observe Real-Time Sync

Keep a Flink SQL streaming query running, then send new messages in the OpenClaw UI. New rows appear within seconds.

## Expected Tables

Tables are lazily created when the first event of each type arrives. In a typical webchat session:

| Always created (8) | Conditionally created (6) |
|-------------------|--------------------------|
| `hook_before_agent_start` | `hook_before_compaction` (long conversations) |
| `hook_agent_end` | `hook_after_compaction` (long conversations) |
| `hook_before_tool_call` | `hook_message_sending` (external channels) |
| `hook_after_tool_call` | `hook_message_sent` (external channels) |
| `hook_tool_result_persist` | `hook_session_end` (explicit session end) |
| `hook_message_received` | `hook_gateway_stop` (gateway shutdown) |
| `hook_session_start` | |
| `hook_gateway_start` | |

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
