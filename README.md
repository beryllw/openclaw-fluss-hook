# fluss-hook

OpenClaw plugin that captures all hook events and writes them to [Apache Fluss](https://fluss.apache.org/) in real time. Each event type is stored in its own dedicated table, enabling fine-grained streaming analytics via Flink SQL.

## How It Works

```
User <---> OpenClaw Gateway <--- fluss-hook plugin ---> Apache Fluss ---> Flink SQL
```

The plugin registers all 14 OpenClaw hook events. Each hook type maps to a separate Fluss table (prefix `hook_` by default). Tables are lazily created on first event arrival.

## Hook Events & Tables

### Agent Hooks

| Hook | Table | Fires When | Key Fields |
|------|-------|-----------|------------|
| `before_agent_start` | `hook_before_agent_start` | Agent starts processing | `prompt`, `messages`, `agent_id`, `session_key`, `message_provider`, `session_id`, `trigger`, `channel_id` |
| `agent_end` | `hook_agent_end` | Agent finishes processing | `messages`, `success`, `error`, `duration_ms`, `agent_id`, `session_key`, `message_provider`, `session_id`, `trigger`, `channel_id` |
| `before_compaction` | `hook_before_compaction` | Before history compaction | `message_count`, `token_count`, `compacting_count`, `agent_id`, `session_key`, `session_id`, `trigger`, `channel_id` |
| `after_compaction` | `hook_after_compaction` | After history compaction | `message_count`, `token_count`, `compacted_count`, `agent_id`, `session_key`, `session_id`, `trigger`, `channel_id` |

### Message Hooks

| Hook | Table | Fires When | Key Fields |
|------|-------|-----------|------------|
| `message_received` | `hook_message_received` | User sends message | `from_id`, `content`, `event_timestamp`, `metadata`, `channel_id`, `message_id`, `is_group`, `group_id` |
| `message_sending` | `hook_message_sending` | Reply about to be sent | `to_id`, `content`, `metadata`, `channel_id`, `message_id`, `is_group`, `group_id` |
| `message_sent` | `hook_message_sent` | Reply delivery completed | `to_id`, `content`, `success`, `error`, `channel_id`, `message_id`, `is_group`, `group_id` |

> **Note:** `message_sending` and `message_sent` are only triggered via external channels (Telegram, WhatsApp, etc.). Local gateway (webchat) replies are streamed via WebSocket and do not pass through the outbound delivery pipeline.

### Tool Hooks

| Hook | Table | Fires When | Key Fields |
|------|-------|-----------|------------|
| `before_tool_call` | `hook_before_tool_call` | Before tool invocation | `tool_name`, `params`, `run_id`, `tool_call_id`, `agent_id`, `context_tool_name`, `context_run_id`, `context_tool_call_id`, `context_session_id` |
| `after_tool_call` | `hook_after_tool_call` | After tool invocation | `tool_name`, `params`, `result`, `error`, `duration_ms`, `run_id`, `tool_call_id`, `context_run_id`, `context_tool_call_id`, `context_session_id` |
| `tool_result_persist` | `hook_tool_result_persist` | Tool result persisted | `tool_name`, `tool_call_id`, `message`, `is_synthetic` |

### Session Hooks

| Hook | Table | Fires When | Key Fields |
|------|-------|-----------|------------|
| `session_start` | `hook_session_start` | Session begins | `session_id`, `resumed_from`, `session_key`, `agent_id` |
| `session_end` | `hook_session_end` | Session ends | `session_id`, `message_count`, `duration_ms`, `session_key` |

### Gateway Hooks

| Hook | Table | Fires When | Key Fields |
|------|-------|-----------|------------|
| `gateway_start` | `hook_gateway_start` | Gateway starts | `port`, `context_port` |
| `gateway_stop` | `hook_gateway_stop` | Gateway stops | `reason`, `context_port` |

All tables include a `timestamp` (BIGINT, unix ms) column.

## Table Schemas

<details>
<summary>Complete column definitions for all 14 tables</summary>

### hook_before_agent_start

| Column | Type | Description |
|--------|------|-------------|
| `prompt` | STRING | System prompt sent to the agent |
| `messages` | STRING | JSON array of conversation messages |
| `agent_id` | STRING | Agent identifier |
| `session_key` | STRING | Session key (agent:session format) |
| `workspace_dir` | STRING | Agent workspace directory |
| `message_provider` | STRING | LLM provider name |
| `session_id` | STRING | Session identifier |
| `trigger` | STRING | What triggered the agent (api, cli, etc.) |
| `channel_id` | STRING | Channel identifier |
| `timestamp` | BIGINT | Event time (unix ms) |

### hook_agent_end

| Column | Type | Description |
|--------|------|-------------|
| `messages` | STRING | JSON array of all conversation messages |
| `success` | BOOLEAN | Whether the agent run succeeded |
| `error` | STRING | Error message (empty on success) |
| `duration_ms` | BIGINT | Agent run duration in milliseconds |
| `agent_id` | STRING | Agent identifier |
| `session_key` | STRING | Session key |
| `workspace_dir` | STRING | Agent workspace directory |
| `message_provider` | STRING | LLM provider name |
| `session_id` | STRING | Session identifier |
| `trigger` | STRING | What triggered the agent |
| `channel_id` | STRING | Channel identifier |
| `timestamp` | BIGINT | Event time (unix ms) |

### hook_before_compaction

| Column | Type | Description |
|--------|------|-------------|
| `message_count` | INT | Number of messages before compaction |
| `token_count` | INT | Token count before compaction |
| `compacting_count` | INT | Number of messages being compacted |
| `agent_id` | STRING | Agent identifier |
| `session_key` | STRING | Session key |
| `workspace_dir` | STRING | Agent workspace directory |
| `message_provider` | STRING | LLM provider name |
| `session_id` | STRING | Session identifier |
| `trigger` | STRING | What triggered the agent |
| `channel_id` | STRING | Channel identifier |
| `timestamp` | BIGINT | Event time (unix ms) |

### hook_after_compaction

| Column | Type | Description |
|--------|------|-------------|
| `message_count` | INT | Number of messages after compaction |
| `token_count` | INT | Token count after compaction |
| `compacted_count` | INT | Number of messages removed |
| `agent_id` | STRING | Agent identifier |
| `session_key` | STRING | Session key |
| `workspace_dir` | STRING | Agent workspace directory |
| `message_provider` | STRING | LLM provider name |
| `session_id` | STRING | Session identifier |
| `trigger` | STRING | What triggered the agent |
| `channel_id` | STRING | Channel identifier |
| `timestamp` | BIGINT | Event time (unix ms) |

### hook_message_received

| Column | Type | Description |
|--------|------|-------------|
| `from_id` | STRING | Sender identifier |
| `content` | STRING | Message text content |
| `event_timestamp` | BIGINT | Original event timestamp |
| `metadata` | STRING | JSON metadata from the event |
| `channel_id` | STRING | Channel identifier (telegram, slack, etc.) |
| `account_id` | STRING | Channel account identifier |
| `conversation_id` | STRING | Conversation identifier |
| `message_id` | STRING | Message identifier |
| `is_group` | BOOLEAN | Whether the message is from a group chat |
| `group_id` | STRING | Group identifier (if group message) |
| `timestamp` | BIGINT | Event time (unix ms) |

### hook_message_sending

| Column | Type | Description |
|--------|------|-------------|
| `to_id` | STRING | Recipient identifier |
| `content` | STRING | Message text content |
| `metadata` | STRING | JSON metadata |
| `channel_id` | STRING | Channel identifier |
| `account_id` | STRING | Channel account identifier |
| `conversation_id` | STRING | Conversation identifier |
| `message_id` | STRING | Message identifier |
| `is_group` | BOOLEAN | Whether sending to a group chat |
| `group_id` | STRING | Group identifier (if group message) |
| `timestamp` | BIGINT | Event time (unix ms) |

### hook_message_sent

| Column | Type | Description |
|--------|------|-------------|
| `to_id` | STRING | Recipient identifier |
| `content` | STRING | Message text content |
| `success` | BOOLEAN | Whether delivery succeeded |
| `error` | STRING | Error detail (empty on success) |
| `channel_id` | STRING | Channel identifier |
| `account_id` | STRING | Channel account identifier |
| `conversation_id` | STRING | Conversation identifier |
| `message_id` | STRING | Message identifier |
| `is_group` | BOOLEAN | Whether sent to a group chat |
| `group_id` | STRING | Group identifier (if group message) |
| `timestamp` | BIGINT | Event time (unix ms) |

### hook_before_tool_call

| Column | Type | Description |
|--------|------|-------------|
| `tool_name` | STRING | Name of the tool being called |
| `params` | STRING | JSON serialized tool parameters |
| `run_id` | STRING | Tool run identifier |
| `tool_call_id` | STRING | Tool call identifier |
| `agent_id` | STRING | Agent identifier |
| `session_key` | STRING | Session key |
| `context_tool_name` | STRING | Tool name from hook context |
| `context_run_id` | STRING | Run ID from hook context |
| `context_tool_call_id` | STRING | Tool call ID from hook context |
| `context_session_id` | STRING | Session ID from hook context |
| `timestamp` | BIGINT | Event time (unix ms) |

### hook_after_tool_call

| Column | Type | Description |
|--------|------|-------------|
| `tool_name` | STRING | Name of the tool called |
| `params` | STRING | JSON serialized tool parameters |
| `result` | STRING | JSON serialized tool result |
| `error` | STRING | Error message (empty on success) |
| `duration_ms` | BIGINT | Tool execution time in milliseconds |
| `run_id` | STRING | Tool run identifier |
| `tool_call_id` | STRING | Tool call identifier |
| `agent_id` | STRING | Agent identifier |
| `session_key` | STRING | Session key |
| `context_tool_name` | STRING | Tool name from hook context |
| `context_run_id` | STRING | Run ID from hook context |
| `context_tool_call_id` | STRING | Tool call ID from hook context |
| `context_session_id` | STRING | Session ID from hook context |
| `timestamp` | BIGINT | Event time (unix ms) |

### hook_tool_result_persist

| Column | Type | Description |
|--------|------|-------------|
| `tool_name` | STRING | Tool name |
| `tool_call_id` | STRING | Tool call identifier |
| `message` | STRING | JSON serialized result message |
| `is_synthetic` | BOOLEAN | Whether the result is synthetic |
| `agent_id` | STRING | Agent identifier |
| `session_key` | STRING | Session key |
| `ctx_tool_name` | STRING | Tool name from context |
| `ctx_tool_call_id` | STRING | Tool call ID from context |
| `timestamp` | BIGINT | Event time (unix ms) |

### hook_session_start

| Column | Type | Description |
|--------|------|-------------|
| `session_id` | STRING | Session identifier |
| `resumed_from` | STRING | Previous session ID if resumed |
| `session_key` | STRING | Session key |
| `agent_id` | STRING | Agent identifier |
| `context_session_id` | STRING | Session ID from context |
| `timestamp` | BIGINT | Event time (unix ms) |

### hook_session_end

| Column | Type | Description |
|--------|------|-------------|
| `session_id` | STRING | Session identifier |
| `message_count` | INT | Total messages in the session |
| `duration_ms` | BIGINT | Session duration in milliseconds |
| `session_key` | STRING | Session key |
| `agent_id` | STRING | Agent identifier |
| `context_session_id` | STRING | Session ID from context |
| `timestamp` | BIGINT | Event time (unix ms) |

### hook_gateway_start

| Column | Type | Description |
|--------|------|-------------|
| `port` | INT | Gateway listening port |
| `context_port` | INT | Port from hook context |
| `timestamp` | BIGINT | Event time (unix ms) |

### hook_gateway_stop

| Column | Type | Description |
|--------|------|-------------|
| `reason` | STRING | Shutdown reason (e.g. SIGTERM) |
| `context_port` | INT | Port from hook context |
| `timestamp` | BIGINT | Event time (unix ms) |

</details>

## Lazy Table Creation

Tables are only created when the first event of that type arrives. In a typical webchat session, you will see approximately 8 tables created:

| Always created | Conditionally created |
|---------------|----------------------|
| `hook_before_agent_start` | `hook_before_compaction` (long conversations) |
| `hook_agent_end` | `hook_after_compaction` (long conversations) |
| `hook_before_tool_call` | `hook_message_sending` (external channels only) |
| `hook_after_tool_call` | `hook_message_sent` (external channels only) |
| `hook_tool_result_persist` | `hook_session_end` (explicit session end) |
| `hook_message_received` | `hook_gateway_stop` (gateway shutdown) |
| `hook_session_start` | |
| `hook_gateway_start` | |

## Installation

### Prerequisites

- An [OpenClaw](https://github.com/OpenClaw/OpenClaw) instance
- A running [Apache Fluss](https://fluss.apache.org/) cluster

### Download & Install (Recommended)

Download the latest release package for your platform:

| Platform | File |
|----------|------|
| macOS Apple Silicon | `fluss-hook-vX.Y.Z-darwin-arm64.tar.gz` |
| Linux x86_64 | `fluss-hook-vX.Y.Z-linux-x64-gnu.tar.gz` |

```bash
tar xzf fluss-hook-v*.tar.gz
cd fluss-hook
./install.sh ~/.openclaw --gateway-url http://your-fluss-gateway:8080
```

The install script copies the plugin into the OpenClaw plugins directory and prints the config snippet to add to `openclaw.json`.

Options:

```bash
./install.sh --force ~/.openclaw                                        # overwrite existing
./install.sh --gateway-url http://192.168.1.100:8080 ~/.openclaw        # specify Gateway address
```

### Install from Source (Alternative)

```bash
git clone <this-repo>
cd openclaw-fluss-hook
./scripts/install.sh ~/.openclaw       # Replace with your OpenClaw data directory
```

This will copy plugin files. See `./scripts/install.sh --help` for options.

### Configure the plugin

Add the plugin configuration to your `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "fluss-hook": {
        "enabled": true,
        "config": {
          "gatewayUrl": "http://localhost:8080"
        }
      }
    }
  }
}
```

Only `gatewayUrl` is required. All other options have sensible defaults (see [Configuration](#configuration) below).

### Start OpenClaw

Start or restart the OpenClaw gateway. You should see in the logs:

```
[fluss-hook] Plugin registered (14 hooks)
[fluss-hook] Connected to Fluss Gateway at http://localhost:8080
```

## Configuration

All options can be set via the plugin config in `openclaw.json`, environment variables, or both (plugin config takes priority).

| Config Key | Env Variable | Default | Description |
|------------|-------------|---------|-------------|
| `gatewayUrl` | `FLUSS_GATEWAY_URL` | `http://localhost:8080` | Fluss Gateway REST API URL |
| `gatewayUsername` | `FLUSS_GATEWAY_USERNAME` | _(empty)_ | Gateway basic auth username (optional) |
| `gatewayPassword` | `FLUSS_GATEWAY_PASSWORD` | _(empty)_ | Gateway basic auth password (optional) |
| `databaseName` | `FLUSS_DATABASE` | `openclaw` | Fluss database name |
| `tablePrefix` | `FLUSS_TABLE_PREFIX` | `hook_` | Table name prefix (e.g. `hook_` creates `hook_agent_end`) |
| `batchSize` | `FLUSS_BATCH_SIZE` | `50` | Rows buffered per table before flush |
| `flushIntervalMs` | `FLUSS_FLUSH_INTERVAL_MS` | `5000` | Periodic flush interval (ms) |
| `autoCreateTable` | `FLUSS_AUTO_CREATE_TABLE` | `true` | Auto-create database and tables |
| `bucketCount` | `FLUSS_BUCKET_COUNT` | `4` | Table distribution bucket count |

## Querying with Flink SQL

Connect Flink to the same Fluss cluster and create a catalog:

```sql
CREATE CATALOG fluss_catalog WITH (
  'type' = 'fluss',
  'bootstrap.servers' = 'coordinator-server:9123'
);
USE CATALOG fluss_catalog;
USE openclaw;
SHOW TABLES;
```

Example queries:

```sql
SET 'execution.runtime-mode' = 'streaming';
SET 'sql-client.execution.result-mode' = 'changelog';

-- Stream agent completions in real time
SELECT agent_id, success, duration_ms, message_provider, `timestamp`
FROM hook_agent_end
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- Tool usage frequency
SELECT tool_name, COUNT(*) AS call_count
FROM hook_before_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */
GROUP BY tool_name;

-- Inbound messages by channel
SELECT channel_id, from_id,
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
```

See [demo/scripts/demo.sql](demo/scripts/demo.sql) for the full set of queries covering all 14 tables.

## Demo

Full Docker Compose stack with ZooKeeper + Fluss + Flink + OpenClaw all-in-one. See [`demo/`](demo/) for details.

### Quick Start

```bash
cd demo
./scripts/build.sh                # build the OpenClaw + plugin image
docker compose up -d              # start all services
```

See [demo/README.md](demo/README.md) for the full walkthrough.

### Integration Testing

```bash
# Build the gateway image first (from fluss-gateway project)
# Then run integration tests:
npm run test:integration

# Or skip integration tests:
FLUSS_TEST_SKIP=true npm test
```

## Development

```bash
# Install dev dependencies
npm install

# Run tests (83 tests)
npm test

# Type check
npm run typecheck

# Watch mode
npm run test:watch
```

### Project Structure

```
.
├── index.ts                  # Plugin entry point — registers 14 hooks
├── src/
│   ├── config.ts             # Configuration resolution (pluginConfig > env > defaults)
│   ├── event-mappers.ts      # 14 event-to-row mapper functions
│   ├── fluss-client.ts       # GatewayClient — REST API client for Fluss Gateway
│   ├── message-buffer.ts     # MultiTableBuffer — per-table batch + periodic flush
│   ├── schema.ts             # 14 table schemas + registry
│   ├── sink.ts               # Sink orchestration
│   └── types.ts              # Type definitions (14 hook event types, config)
├── scripts/
│   ├── install.sh            # Plugin installer
│   └── package-release.sh    # Release packaging script
├── __test__/                 # Vitest test suite
├── demo/                     # Full Docker Compose demo (Fluss + Flink + OpenClaw)
├── docker-compose.integration.yml  # Integration test infrastructure
├── openclaw.plugin.json      # Plugin manifest with config schema
├── package.json
└── tsconfig.json
```

## License

MIT
