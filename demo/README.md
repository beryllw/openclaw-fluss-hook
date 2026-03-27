# OpenClaw + Fluss + Flink SQL Demo

End-to-end demonstration: user chats with OpenClaw AI, messages are synced to Apache Fluss in real-time via `fluss-hook` plugin, and Flink SQL queries the message stream.

## Architecture

```
User --> OpenClaw Gateway --> fluss-hook --> Fluss Cluster <-- Flink SQL
              :18789           (plugin)     coordinator:9123    :8083
```

## Prerequisites

- **Docker** (Docker Desktop, Docker Engine, or Podman)
- **fluss-rust source** at `../../fluss-rust` — needed only once to compile fluss-node for Linux

Expected directory layout:
```
VscodeProjects/
├── fluss-rust/                 # Apache Fluss Rust client (for fluss-node compilation)
└── openclaw-fluss-hook/        # This project
    ├── src/                    # fluss-hook plugin source
    └── demo/                   # <-- You are here
```

## Quick Start

### 1. Build fluss-node for Linux (one-time)

Compiles the fluss-node native addon from Rust source inside a container:

```bash
./scripts/build-fluss-node.sh
```

This produces `demo/fluss-node-lib/` with the Linux `.node` binary. Only needs to re-run when fluss-rust source changes.

### 2. Download Flink Connector JAR

```bash
./scripts/setup.sh
```

### 3. Configure LLM API Key

Edit `.env` and set at least one LLM provider key:

```env
ANTHROPIC_API_KEY=sk-ant-...
# or
OPENAI_API_KEY=sk-...
```

### 4. Build & Start

```bash
# Build the image (pulls official OpenClaw image, layers plugin on top — fast)
./scripts/build.sh

# Start all 6 services
docker compose up -d
```

### 5. Verify Services

```bash
docker compose ps

# Check fluss-hook plugin loaded
docker compose logs openclaw | grep fluss-hook
# Expected: "[fluss-hook] Plugin registered"
```

## Demo Walkthrough

### Step 1: Chat with OpenClaw

Open http://localhost:18789 and send a few messages. Each message (input + AI response) is captured by `fluss-hook` and written to Fluss.

### Step 2: Query Messages with Flink SQL

```bash
docker compose exec jobmanager ./bin/sql-client.sh
```

Run the demo queries (or paste from `scripts/demo.sql`):

```sql
CREATE CATALOG fluss_catalog WITH (
  'type' = 'fluss',
  'bootstrap.servers' = 'coordinator-server:9123'
);
USE CATALOG fluss_catalog;
USE openclaw;

SET 'execution.runtime-mode' = 'streaming';
SET 'sql-client.execution.result-mode' = 'changelog';

SELECT direction, from_id, to_id,
       SUBSTRING(content, 1, 80) AS content_preview,
       `timestamp`
FROM message_logs
  /*+ OPTIONS('scan.startup.mode'='earliest') */;
```

### Step 3: Observe Real-Time Sync

Keep the Flink SQL streaming query running, then send new messages in the OpenClaw UI. New rows appear within seconds.

## Services

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `zookeeper` | `zookeeper:3.9.2` | - | Fluss coordination |
| `coordinator-server` | `apache/fluss:0.9.0-incubating-rc2` | 9123 | Fluss metadata |
| `tablet-server` | `apache/fluss:0.9.0-incubating-rc2` | - | Fluss data storage |
| `jobmanager` | `flink:1.20-scala_2.12-java17` | 8083 | Flink Web UI & SQL |
| `taskmanager` | `flink:1.20-scala_2.12-java17` | - | Flink task execution |
| `openclaw` | `ghcr.io/openclaw/openclaw` + plugin | 18789 | AI gateway + fluss-hook |

## Web UIs

- **OpenClaw**: http://localhost:18789
- **Flink Dashboard**: http://localhost:8083

## Troubleshooting

### Build fails at fluss-node compilation

The Rust compilation requires significant memory. Ensure Docker/Podman has at least 4GB RAM allocated.

```bash
./scripts/build-fluss-node.sh
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

The `message_logs` table is auto-created when the first message is sent. Send at least one message via the OpenClaw UI before querying.

### Connection refused to coordinator-server

Wait for the Fluss cluster to fully start:

```bash
docker compose logs coordinator-server | tail -20
```

## Cleanup

```bash
docker compose down -v
```
