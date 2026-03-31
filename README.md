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
| `before_agent_start` | `hook_before_agent_start` | Agent starts processing | `prompt`, `messages`, `agent_id`, `session_key`, `message_provider` |
| `agent_end` | `hook_agent_end` | Agent finishes processing | `messages`, `success`, `error`, `duration_ms`, `agent_id` |
| `before_compaction` | `hook_before_compaction` | Before history compaction | `message_count`, `token_count`, `agent_id` |
| `after_compaction` | `hook_after_compaction` | After history compaction | `message_count`, `token_count`, `compacted_count`, `agent_id` |

### Message Hooks

| Hook | Table | Fires When | Key Fields |
|------|-------|-----------|------------|
| `message_received` | `hook_message_received` | User sends message (external channels) | `from_id`, `content`, `event_timestamp`, `metadata`, `channel_id` |
| `message_sending` | `hook_message_sending` | Reply about to be sent | `to_id`, `content`, `metadata`, `channel_id` |
| `message_sent` | `hook_message_sent` | Reply delivery completed | `to_id`, `content`, `success`, `error`, `channel_id` |

> **Note:** `message_sending` and `message_sent` are [not triggered by current OpenClaw](./ISSUE-message-hooks-never-called.md). They remain registered for forward compatibility.

### Tool Hooks

| Hook | Table | Fires When | Key Fields |
|------|-------|-----------|------------|
| `before_tool_call` | `hook_before_tool_call` | Before tool invocation | `tool_name`, `params`, `agent_id`, `context_tool_name` |
| `after_tool_call` | `hook_after_tool_call` | After tool invocation | `tool_name`, `params`, `result`, `error`, `duration_ms` |
| `tool_result_persist` | `hook_tool_result_persist` | Tool result persisted | `tool_name`, `tool_call_id`, `message`, `is_synthetic` |

### Session Hooks

| Hook | Table | Fires When | Key Fields |
|------|-------|-----------|------------|
| `session_start` | `hook_session_start` | Session begins | `session_id`, `resumed_from`, `agent_id` |
| `session_end` | `hook_session_end` | Session ends | `session_id`, `message_count`, `duration_ms` |

### Gateway Hooks

| Hook | Table | Fires When | Key Fields |
|------|-------|-----------|------------|
| `gateway_start` | `hook_gateway_start` | Gateway starts | `port` |
| `gateway_stop` | `hook_gateway_stop` | Gateway stops | `reason` |

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
| `timestamp` | BIGINT | Event time (unix ms) |

### hook_before_compaction

| Column | Type | Description |
|--------|------|-------------|
| `message_count` | INT | Number of messages before compaction |
| `token_count` | INT | Token count before compaction |
| `agent_id` | STRING | Agent identifier |
| `session_key` | STRING | Session key |
| `workspace_dir` | STRING | Agent workspace directory |
| `message_provider` | STRING | LLM provider name |
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
| `timestamp` | BIGINT | Event time (unix ms) |

### hook_before_tool_call

| Column | Type | Description |
|--------|------|-------------|
| `tool_name` | STRING | Name of the tool being called |
| `params` | STRING | JSON serialized tool parameters |
| `agent_id` | STRING | Agent identifier |
| `session_key` | STRING | Session key |
| `context_tool_name` | STRING | Tool name from hook context |
| `timestamp` | BIGINT | Event time (unix ms) |

### hook_after_tool_call

| Column | Type | Description |
|--------|------|-------------|
| `tool_name` | STRING | Name of the tool called |
| `params` | STRING | JSON serialized tool parameters |
| `result` | STRING | JSON serialized tool result |
| `error` | STRING | Error message (empty on success) |
| `duration_ms` | BIGINT | Tool execution time in milliseconds |
| `agent_id` | STRING | Agent identifier |
| `session_key` | STRING | Session key |
| `context_tool_name` | STRING | Tool name from hook context |
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
| `agent_id` | STRING | Agent identifier |
| `context_session_id` | STRING | Session ID from context |
| `timestamp` | BIGINT | Event time (unix ms) |

### hook_session_end

| Column | Type | Description |
|--------|------|-------------|
| `session_id` | STRING | Session identifier |
| `message_count` | INT | Total messages in the session |
| `duration_ms` | BIGINT | Session duration in milliseconds |
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

### Quick Install (Recommended)

```bash
git clone <this-repo>
cd openclaw-fluss-hook
./scripts/install.sh ~/.openclaw       # Replace with your OpenClaw data directory
```

The install script will:
1. Auto-detect your platform (macOS / Linux, x64 / arm64)
2. Download the pre-compiled `fluss-node` native addon
3. Copy plugin files into the OpenClaw plugins directory
4. Print the config snippet to add to `openclaw.json`

Then add the printed config to your `openclaw.json` and restart OpenClaw.

#### Install script options

```bash
# Use a local fluss-node build (skip download)
./scripts/install.sh --fluss-node-dir /path/to/fluss-node-lib ~/.openclaw

# Specify Fluss server address (for config snippet output)
./scripts/install.sh --bootstrap-servers fluss.prod:9223 ~/.openclaw

# Overwrite existing installation
./scripts/install.sh --force ~/.openclaw

# Download fluss-node only (without installing the plugin)
./scripts/download-fluss-node.sh ./fluss-node-lib
```

### Configure the plugin

Add the plugin configuration to your `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "fluss-hook": {
        "enabled": true,
        "config": {
          "bootstrapServers": "localhost:9223"
        }
      }
    }
  }
}
```

Only `bootstrapServers` is required. All other options have sensible defaults (see [Configuration](#configuration) below).

### Start OpenClaw

Start or restart the OpenClaw gateway. You should see in the logs:

```
[fluss-hook] Plugin registered (14 hooks)
[fluss-hook] Connected to Fluss at localhost:9123
```

## Configuration

All options can be set via the plugin config in `openclaw.json`, environment variables, or both (plugin config takes priority).

| Config Key | Env Variable | Default | Description |
|------------|-------------|---------|-------------|
| `bootstrapServers` | `FLUSS_BOOTSTRAP_SERVERS` | `localhost:9223` | Fluss coordinator address |
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

## Docker Demo

A complete Docker Compose demo is available in [`demo/`](demo/). It starts a full environment with ZooKeeper, Fluss, Flink, and OpenClaw with the plugin pre-installed. See [demo/README.md](demo/README.md) for instructions.

```bash
cd demo
./scripts/build-fluss-node.sh   # one-time: compile fluss-node for Linux
./scripts/build.sh              # build the OpenClaw + plugin image
docker compose up -d            # start all services
```

## Development

```bash
# Install dev dependencies
npm install

# Run tests (68 tests)
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
│   ├── fluss-client.ts       # FlussClientManager — multi-writer with lazy initialization
│   ├── message-buffer.ts     # MultiTableBuffer — per-table batch + periodic flush
│   ├── schema.ts             # 14 table schemas + registry
│   └── types.ts              # Type definitions (14 hook event types, config)
├── scripts/
│   ├── install.sh            # One-command plugin installer
│   └── download-fluss-node.sh # Download pre-compiled fluss-node binary
├── __test__/                 # Vitest test suite (68 tests)
│   ├── config.test.ts
│   ├── event-mappers.test.ts
│   ├── message-buffer.test.ts
│   ├── plugin-register.test.ts
│   └── plugin-e2e.test.ts
├── demo/                     # Docker Compose demo environment
├── openclaw.plugin.json      # Plugin manifest with config schema
├── package.json
└── tsconfig.json
```

## License

MIT
