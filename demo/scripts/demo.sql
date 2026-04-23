-- ============================================================
-- Fluss Hook Demo: Flink SQL Queries (Multi-Table)
-- ============================================================
-- Run inside Flink SQL Client:
--   docker compose exec jobmanager ./bin/sql-client.sh
--
-- Before running, send at least one message via OpenClaw webchat
-- to trigger auto-creation of hook tables.
-- ============================================================

-- 1. Create Fluss Catalog & switch to openclaw database
CREATE CATALOG fluss_catalog WITH (
  'type' = 'fluss',
  'bootstrap.servers' = 'coordinator-server:9123'
);
USE CATALOG fluss_catalog;
USE openclaw;

-- 2. List all auto-created hook tables
SHOW TABLES;

-- ============================================================
-- Set streaming mode for real-time queries
-- ============================================================
SET 'execution.runtime-mode' = 'streaming';
SET 'sql-client.execution.result-mode' = 'changelog';
-- Increase column width so JSON fields are not truncated (default 30)
SET 'sql-client.display.max-column-width' = '200';

-- ============================================================
-- 3. Agent Hooks
-- ============================================================

-- ── hook_before_agent_start ──────────────────────────────────
-- Event: before_agent_start — Agent 开始执行前触发
-- Trigger: 每次 Agent 收到任务准备开始推理时
--
-- | Column           | Type   | Source  | Description                  |
-- |------------------|--------|---------|------------------------------|
-- | prompt           | STRING | event   | Agent 的系统提示词             |
-- | messages         | STRING | event   | JSON: 输入消息数组             |
-- | agent_id         | STRING | context | Agent 唯一标识                |
-- | session_key      | STRING | context | 会话密钥                      |
-- | workspace_dir    | STRING | context | 工作空间目录路径               |
-- | message_provider | STRING | context | 模型提供商 (如 openai)         |
-- | timestamp        | BIGINT | system  | 记录时间戳 (epoch ms)         |
--
-- Sample row:
--   prompt           = "You are a helpful coding assistant. Answer concisely."
--   messages         = [{"role":"user","content":"帮我写一个快速排序算法"}]
--   agent_id         = "agent-main-001"
--   session_key      = "sess-a1b2c3d4"
--   workspace_dir    = "/home/user/my-project"
--   message_provider = "openai"
--   timestamp        = 1711900000000

-- 3a. Agent start events: what prompts are being sent
SELECT agent_id,
       session_key,
       SUBSTRING(prompt, 1, 80) AS prompt_preview,
       message_provider,
       `timestamp`
FROM hook_before_agent_start
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- ── hook_agent_end ───────────────────────────────────────────
-- Event: agent_end — Agent 执行结束后触发
-- Trigger: Agent 完成一次推理 (无论成功或失败)
--
-- | Column           | Type    | Source  | Description                |
-- |------------------|---------|---------|----------------------------|
-- | messages         | STRING  | event   | JSON: 完整对话消息数组       |
-- | success          | BOOLEAN | event   | 执行是否成功                |
-- | error            | STRING  | event   | 错误信息 (失败时)           |
-- | duration_ms      | BIGINT  | event   | 执行耗时 (毫秒)             |
-- | agent_id         | STRING  | context | Agent 唯一标识              |
-- | session_key      | STRING  | context | 会话密钥                    |
-- | workspace_dir    | STRING  | context | 工作空间目录路径             |
-- | message_provider | STRING  | context | 模型提供商                  |
-- | timestamp        | BIGINT  | system  | 记录时间戳 (epoch ms)       |
--
-- Sample row:
--   messages         = [{"role":"user","content":"帮我写一个快速排序"},{"role":"assistant","content":"def quicksort(arr): ..."}]
--   success          = true
--   error            = ""
--   duration_ms      = 3200
--   agent_id         = "agent-main-001"
--   session_key      = "sess-a1b2c3d4"
--   workspace_dir    = "/home/user/my-project"
--   message_provider = "openai"
--   timestamp        = 1711900003200

-- 3b. Agent end events: success/failure and duration
SELECT agent_id,
       session_key,
       success,
       error,
       duration_ms,
       message_provider,
       `timestamp`
FROM hook_agent_end
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- 3c. Agent success rate
SELECT agent_id,
       COUNT(*) AS total,
       SUM(CASE WHEN success THEN 1 ELSE 0 END) AS succeeded,
       SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) AS failed
FROM hook_agent_end
  /*+ OPTIONS('scan.startup.mode'='earliest') */
GROUP BY agent_id;

-- ── hook_before_compaction ────────────────────────────────────
-- Event: before_compaction — 消息压缩前触发
-- Trigger: 对话消息过多, Agent 准备压缩历史消息时
--
-- | Column           | Type   | Source  | Description                |
-- |------------------|--------|---------|----------------------------|
-- | message_count    | INT    | event   | 压缩前的消息数量             |
-- | token_count      | INT    | event   | 压缩前的 Token 数量          |
-- | agent_id         | STRING | context | Agent 唯一标识              |
-- | session_key      | STRING | context | 会话密钥                    |
-- | workspace_dir    | STRING | context | 工作空间目录路径             |
-- | message_provider | STRING | context | 模型提供商                  |
-- | timestamp        | BIGINT | system  | 记录时间戳 (epoch ms)       |
--
-- Sample row:
--   message_count    = 150
--   token_count      = 45000
--   agent_id         = "agent-main-001"
--   session_key      = "sess-a1b2c3d4"
--   workspace_dir    = "/home/user/my-project"
--   message_provider = "openai"
--   timestamp        = 1711900010000

-- ── hook_after_compaction ─────────────────────────────────────
-- Event: after_compaction — 消息压缩完成后触发
-- Trigger: Agent 完成历史消息压缩后
--
-- | Column           | Type   | Source  | Description                |
-- |------------------|--------|---------|----------------------------|
-- | message_count    | INT    | event   | 压缩后的消息数量             |
-- | token_count      | INT    | event   | 压缩后的 Token 数量          |
-- | compacted_count  | INT    | event   | 被压缩 (移除) 的消息数       |
-- | agent_id         | STRING | context | Agent 唯一标识              |
-- | session_key      | STRING | context | 会话密钥                    |
-- | workspace_dir    | STRING | context | 工作空间目录路径             |
-- | message_provider | STRING | context | 模型提供商                  |
-- | timestamp        | BIGINT | system  | 记录时间戳 (epoch ms)       |
--
-- Sample row:
--   message_count    = 50
--   token_count      = 15000
--   compacted_count  = 100
--   agent_id         = "agent-main-001"
--   session_key      = "sess-a1b2c3d4"
--   workspace_dir    = "/home/user/my-project"
--   message_provider = "openai"
--   timestamp        = 1711900010500

-- 3d. Compaction events
SELECT message_count, token_count, agent_id, `timestamp`
FROM hook_before_compaction
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

SELECT message_count, token_count, compacted_count, agent_id, `timestamp`
FROM hook_after_compaction
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- ============================================================
-- 4. Message Hooks
-- ============================================================

-- ── hook_message_received ─────────────────────────────────────
-- Event: message_received — 收到用户消息时触发
-- Trigger: 用户通过 webchat 或其他渠道发送消息到 Agent
--
-- | Column           | Type   | Source  | Description                |
-- |------------------|--------|---------|----------------------------|
-- | from_id          | STRING | event   | 消息发送者标识              |
-- | content          | STRING | event   | 消息文本内容                |
-- | event_timestamp  | BIGINT | event   | 事件原始时间戳              |
-- | metadata         | STRING | event   | JSON: 额外元数据            |
-- | channel_id       | STRING | context | 频道/渠道 ID               |
-- | account_id       | STRING | context | 账户 ID                    |
-- | conversation_id  | STRING | context | 对话 ID                    |
-- | timestamp        | BIGINT | system  | 记录时间戳 (epoch ms)       |
--
-- Sample row:
--   from_id          = "user-zhang-san"
--   content          = "请帮我分析一下这段代码的性能瓶颈"
--   event_timestamp  = 1711900020000
--   metadata         = {"lang":"zh","source":"webchat","browser":"Chrome"}
--   channel_id       = "web-channel-001"
--   account_id       = "account-456"
--   conversation_id  = "conv-111-222"
--   timestamp        = 1711900020100

-- 4a. Inbound messages received
SELECT from_id,
       channel_id,
       conversation_id,
       SUBSTRING(content, 1, 80) AS content_preview,
       `timestamp`
FROM hook_message_received
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- ── hook_message_sending ──────────────────────────────────────
-- Event: message_sending — 即将发送消息给用户时触发
-- Trigger: Agent 准备向用户回复消息 (发送前)
--
-- | Column           | Type   | Source  | Description                |
-- |------------------|--------|---------|----------------------------|
-- | to_id            | STRING | event   | 消息接收者标识              |
-- | content          | STRING | event   | 消息文本内容                |
-- | metadata         | STRING | event   | JSON: 额外元数据            |
-- | channel_id       | STRING | context | 频道/渠道 ID               |
-- | account_id       | STRING | context | 账户 ID                    |
-- | conversation_id  | STRING | context | 对话 ID                    |
-- | timestamp        | BIGINT | system  | 记录时间戳 (epoch ms)       |
--
-- Sample row:
--   to_id            = "user-zhang-san"
--   content          = "经过分析，主要瓶颈在第 42 行的嵌套循环..."
--   metadata         = {"model":"qwen-max","tokens_used":580}
--   channel_id       = "web-channel-001"
--   account_id       = "account-456"
--   conversation_id  = "conv-111-222"
--   timestamp        = 1711900025000

-- 4b. Outbound messages being sent
SELECT to_id,
       channel_id,
       SUBSTRING(content, 1, 80) AS content_preview,
       `timestamp`
FROM hook_message_sending
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- ── hook_message_sent ─────────────────────────────────────────
-- Event: message_sent — 消息发送完成后触发
-- Trigger: Agent 回复消息发送结束 (无论成功或失败)
--
-- | Column           | Type    | Source  | Description                |
-- |------------------|---------|---------|----------------------------|
-- | to_id            | STRING  | event   | 消息接收者标识              |
-- | content          | STRING  | event   | 消息文本内容                |
-- | success          | BOOLEAN | event   | 发送是否成功                |
-- | error            | STRING  | event   | 发送错误信息 (失败时)        |
-- | channel_id       | STRING  | context | 频道/渠道 ID               |
-- | account_id       | STRING  | context | 账户 ID                    |
-- | conversation_id  | STRING  | context | 对话 ID                    |
-- | timestamp        | BIGINT  | system  | 记录时间戳 (epoch ms)       |
--
-- Sample row:
--   to_id            = "user-zhang-san"
--   content          = "经过分析，主要瓶颈在第 42 行的嵌套循环..."
--   success          = true
--   error            = ""
--   channel_id       = "web-channel-001"
--   account_id       = "account-456"
--   conversation_id  = "conv-111-222"
--   timestamp        = 1711900025500

-- 4c. Message delivery results
SELECT to_id,
       channel_id,
       success,
       error,
       SUBSTRING(content, 1, 80) AS content_preview,
       `timestamp`
FROM hook_message_sent
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- 4d. Message count by channel
SELECT channel_id, COUNT(*) AS msg_count
FROM hook_message_received
  /*+ OPTIONS('scan.startup.mode'='earliest') */
GROUP BY channel_id;

-- ============================================================
-- 5. Tool Hooks
-- ============================================================

-- ── hook_before_tool_call ─────────────────────────────────────
-- Event: before_tool_call — 工具调用前触发
-- Trigger: Agent 决定调用一个工具 (如执行命令、读取文件等)
--
-- | Column             | Type   | Source  | Description              |
-- |--------------------|--------|---------|--------------------------|
-- | tool_name          | STRING | event   | 被调用的工具名称           |
-- | params             | STRING | event   | JSON: 工具调用参数         |
-- | agent_id           | STRING | context | Agent 唯一标识            |
-- | session_key        | STRING | context | 会话密钥                  |
-- | context_tool_name  | STRING | context | 上下文中的工具名           |
-- | timestamp          | BIGINT | system  | 记录时间戳 (epoch ms)     |
--
-- Sample row:
--   tool_name          = "execute_command"
--   params             = {"command":"npm test","cwd":"/home/user/my-project"}
--   agent_id           = "agent-main-001"
--   session_key        = "sess-a1b2c3d4"
--   context_tool_name  = "execute_command"
--   timestamp          = 1711900030000

-- 5a. Tool calls — full params JSON (use max-column-width above to avoid truncation)
SELECT tool_name,
       params,
       agent_id,
       `timestamp`
FROM hook_before_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- ── hook_after_tool_call ──────────────────────────────────────
-- Event: after_tool_call — 工具调用结束后触发
-- Trigger: 工具执行完成返回结果
--
-- | Column             | Type   | Source  | Description              |
-- |--------------------|--------|---------|--------------------------|
-- | tool_name          | STRING | event   | 工具名称                  |
-- | params             | STRING | event   | JSON: 调用参数            |
-- | result             | STRING | event   | JSON: 执行结果            |
-- | error              | STRING | event   | 执行错误信息 (失败时)       |
-- | duration_ms        | BIGINT | event   | 工具执行耗时 (毫秒)        |
-- | agent_id           | STRING | context | Agent 唯一标识            |
-- | session_key        | STRING | context | 会话密钥                  |
-- | context_tool_name  | STRING | context | 上下文中的工具名           |
-- | timestamp          | BIGINT | system  | 记录时间戳 (epoch ms)     |
--
-- Sample row:
--   tool_name          = "execute_command"
--   params             = {"command":"npm test","cwd":"/home/user/my-project"}
--   result             = {"output":"Tests: 68 passed, 0 failed","exitCode":0}
--   error              = ""
--   duration_ms        = 4500
--   agent_id           = "agent-main-001"
--   session_key        = "sess-a1b2c3d4"
--   context_tool_name  = "execute_command"
--   timestamp          = 1711900034500

-- 5b. Tool call results — full result JSON with duration
SELECT tool_name,
       duration_ms,
       error,
       result,
       agent_id,
       `timestamp`
FROM hook_after_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- 5c. Tool usage frequency
SELECT tool_name, COUNT(*) AS call_count
FROM hook_before_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */
GROUP BY tool_name;

-- ── hook_tool_result_persist ──────────────────────────────────
-- Event: tool_result_persist — 工具结果持久化时触发
-- Trigger: 工具执行结果被写入消息历史记录
--
-- | Column             | Type    | Source  | Description              |
-- |--------------------|---------|---------|--------------------------|
-- | tool_name          | STRING  | event   | 工具名称                  |
-- | tool_call_id       | STRING  | event   | 工具调用唯一 ID            |
-- | message            | STRING  | event   | JSON: 持久化的消息对象      |
-- | is_synthetic       | BOOLEAN | event   | 是否为系统合成消息          |
-- | agent_id           | STRING  | context | Agent 唯一标识            |
-- | session_key        | STRING  | context | 会话密钥                  |
-- | ctx_tool_name      | STRING  | context | 上下文中的工具名           |
-- | ctx_tool_call_id   | STRING  | context | 上下文中的调用 ID          |
-- | timestamp          | BIGINT  | system  | 记录时间戳 (epoch ms)     |
--
-- Sample row:
--   tool_name          = "read_file"
--   tool_call_id       = "call-f7e8d9c0"
--   message            = {"role":"tool","content":"文件内容: const app = express()...","tool_call_id":"call-f7e8d9c0"}
--   is_synthetic       = false
--   agent_id           = "agent-main-001"
--   session_key        = "sess-a1b2c3d4"
--   ctx_tool_name      = "read_file"
--   ctx_tool_call_id   = "call-f7e8d9c0"
--   timestamp          = 1711900035000

-- 5d. Tool result persistence
SELECT tool_name,
       tool_call_id,
       is_synthetic,
       message,
       `timestamp`
FROM hook_tool_result_persist
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- ============================================================
-- 6. Session Hooks
-- ============================================================

-- ── hook_session_start ────────────────────────────────────────
-- Event: session_start — 会话开始时触发
-- Trigger: 用户开始新对话, 或从历史会话恢复
--
-- | Column             | Type   | Source  | Description              |
-- |--------------------|--------|---------|--------------------------|
-- | session_id         | STRING | event   | 新会话唯一 ID             |
-- | resumed_from       | STRING | event   | 恢复来源会话 ID (新建为空)  |
-- | agent_id           | STRING | context | Agent 唯一标识            |
-- | context_session_id | STRING | context | 上下文中的会话 ID          |
-- | timestamp          | BIGINT | system  | 记录时间戳 (epoch ms)     |
--
-- Sample row:
--   session_id         = "sess-new-x1y2z3"
--   resumed_from       = ""
--   agent_id           = "agent-main-001"
--   context_session_id = "sess-new-x1y2z3"
--   timestamp          = 1711900000000

-- 6a. Session starts (including resumed sessions)
SELECT session_id,
       resumed_from,
       agent_id,
       `timestamp`
FROM hook_session_start
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- ── hook_session_end ──────────────────────────────────────────
-- Event: session_end — 会话结束时触发
-- Trigger: 对话会话正常关闭或超时结束
--
-- | Column             | Type   | Source  | Description              |
-- |--------------------|--------|---------|--------------------------|
-- | session_id         | STRING | event   | 结束的会话 ID             |
-- | message_count      | INT    | event   | 会话中的总消息数           |
-- | duration_ms        | BIGINT | event   | 会话持续时长 (毫秒)        |
-- | agent_id           | STRING | context | Agent 唯一标识            |
-- | context_session_id | STRING | context | 上下文中的会话 ID          |
-- | timestamp          | BIGINT | system  | 记录时间戳 (epoch ms)     |
--
-- Sample row:
--   session_id         = "sess-new-x1y2z3"
--   message_count      = 24
--   duration_ms        = 180000
--   agent_id           = "agent-main-001"
--   context_session_id = "sess-new-x1y2z3"
--   timestamp          = 1711900180000

-- 6b. Session ends with stats
SELECT session_id,
       message_count,
       duration_ms,
       agent_id,
       `timestamp`
FROM hook_session_end
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- ============================================================
-- 7. Gateway Hooks
-- ============================================================

-- ── hook_gateway_start ────────────────────────────────────────
-- Event: gateway_start — 网关服务启动时触发
-- Trigger: OpenClaw Gateway HTTP 服务成功启动
--
-- | Column       | Type   | Source  | Description                    |
-- |--------------|--------|---------|--------------------------------|
-- | port         | INT    | event   | 网关监听端口号                  |
-- | context_port | INT    | context | 上下文中的端口号                |
-- | timestamp    | BIGINT | system  | 记录时间戳 (epoch ms)           |
--
-- Sample row:
--   port         = 3000
--   context_port = 3000
--   timestamp    = 1711899000000

-- 7a. Gateway start events
SELECT port, context_port, `timestamp`
FROM hook_gateway_start
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- ── hook_gateway_stop ─────────────────────────────────────────
-- Event: gateway_stop — 网关服务停止时触发
-- Trigger: OpenClaw Gateway HTTP 服务关闭
--
-- | Column       | Type   | Source  | Description                    |
-- |--------------|--------|---------|--------------------------------|
-- | reason       | STRING | event   | 停止原因                       |
-- | context_port | INT    | context | 网关端口号                     |
-- | timestamp    | BIGINT | system  | 记录时间戳 (epoch ms)           |
--
-- Sample row:
--   reason       = "Server shutdown requested"
--   context_port = 3000
--   timestamp    = 1711999000000

-- 7b. Gateway stop events
SELECT reason, context_port, `timestamp`
FROM hook_gateway_stop
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- ============================================================
-- 8. Cross-table analytics
-- ============================================================

-- 8a. Total event counts per hook table (run each separately)
SELECT 'before_agent_start' AS hook, COUNT(*) AS cnt FROM hook_before_agent_start /*+ OPTIONS('scan.startup.mode'='earliest') */;
SELECT 'agent_end' AS hook, COUNT(*) AS cnt FROM hook_agent_end /*+ OPTIONS('scan.startup.mode'='earliest') */;
SELECT 'before_compaction' AS hook, COUNT(*) AS cnt FROM hook_before_compaction /*+ OPTIONS('scan.startup.mode'='earliest') */;
SELECT 'after_compaction' AS hook, COUNT(*) AS cnt FROM hook_after_compaction /*+ OPTIONS('scan.startup.mode'='earliest') */;
SELECT 'message_received' AS hook, COUNT(*) AS cnt FROM hook_message_received /*+ OPTIONS('scan.startup.mode'='earliest') */;
SELECT 'message_sending' AS hook, COUNT(*) AS cnt FROM hook_message_sending /*+ OPTIONS('scan.startup.mode'='earliest') */;
SELECT 'message_sent' AS hook, COUNT(*) AS cnt FROM hook_message_sent /*+ OPTIONS('scan.startup.mode'='earliest') */;
SELECT 'before_tool_call' AS hook, COUNT(*) AS cnt FROM hook_before_tool_call /*+ OPTIONS('scan.startup.mode'='earliest') */;
SELECT 'after_tool_call' AS hook, COUNT(*) AS cnt FROM hook_after_tool_call /*+ OPTIONS('scan.startup.mode'='earliest') */;
SELECT 'tool_result_persist' AS hook, COUNT(*) AS cnt FROM hook_tool_result_persist /*+ OPTIONS('scan.startup.mode'='earliest') */;
SELECT 'session_start' AS hook, COUNT(*) AS cnt FROM hook_session_start /*+ OPTIONS('scan.startup.mode'='earliest') */;
SELECT 'session_end' AS hook, COUNT(*) AS cnt FROM hook_session_end /*+ OPTIONS('scan.startup.mode'='earliest') */;
SELECT 'gateway_start' AS hook, COUNT(*) AS cnt FROM hook_gateway_start /*+ OPTIONS('scan.startup.mode'='earliest') */;
SELECT 'gateway_stop' AS hook, COUNT(*) AS cnt FROM hook_gateway_stop /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- ============================================================
-- 9. JSON Field Extraction & Array Expansion
-- ============================================================
-- Fields like params, result, messages, metadata store JSON strings.
--
-- JSON_VALUE(json, '$.key')  — extract a scalar value (returns VARCHAR)
-- JSON_QUERY(json, '$.key')  — extract an object/array as JSON string
--
-- NOTE: JSON_VALUE path must be a string literal (e.g. '$[0].role').
--       Dynamic paths via CONCAT() are NOT reliably supported in Flink SQL.
--       To inspect JSON arrays, use fixed-index extraction (see 9c/9d below).
--
-- Tip: SET 'sql-client.display.max-column-width' = '500';
--      for even wider display when inspecting large JSON.

-- 9a. Extract specific fields from tool call params
SELECT tool_name,
       JSON_VALUE(params, '$.command') AS command,
       JSON_VALUE(params, '$.input') AS input,
       params,
       `timestamp`
FROM hook_before_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- 9b. Extract tool result details
SELECT tool_name,
       duration_ms,
       JSON_VALUE(result, '$.output') AS output,
       JSON_VALUE(result, '$.exitCode') AS exit_code,
       `timestamp`
FROM hook_after_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- 9c. Extract individual messages from agent_end messages array
--     messages is a JSON array: [{"role":"user","content":"hi"}, {"role":"assistant","content":"hello"}, ...]
--     Use fixed literal paths to extract the first few messages.
SELECT agent_id,
       success,
       duration_ms,
       JSON_VALUE(messages, '$[0].role')    AS msg_0_role,
       JSON_VALUE(messages, '$[0].content') AS msg_0_content,
       JSON_VALUE(messages, '$[1].role')    AS msg_1_role,
       JSON_VALUE(messages, '$[1].content') AS msg_1_content,
       JSON_VALUE(messages, '$[2].role')    AS msg_2_role,
       JSON_VALUE(messages, '$[2].content') AS msg_2_content,
       JSON_VALUE(messages, '$[3].role')    AS msg_3_role,
       JSON_VALUE(messages, '$[3].content') AS msg_3_content,
       JSON_VALUE(messages, '$[4].role')    AS msg_4_role,
       JSON_VALUE(messages, '$[4].content') AS msg_4_content,
       `timestamp`
FROM hook_agent_end
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- 9d. Extract individual messages from before_agent_start
SELECT agent_id,
       session_key,
       JSON_VALUE(messages, '$[0].role')    AS msg_0_role,
       JSON_VALUE(messages, '$[0].content') AS msg_0_content,
       JSON_VALUE(messages, '$[1].role')    AS msg_1_role,
       JSON_VALUE(messages, '$[1].content') AS msg_1_content,
       JSON_VALUE(messages, '$[2].role')    AS msg_2_role,
       JSON_VALUE(messages, '$[2].content') AS msg_2_content,
       JSON_VALUE(messages, '$[3].role')    AS msg_3_role,
       JSON_VALUE(messages, '$[3].content') AS msg_3_content,
       JSON_VALUE(messages, '$[4].role')    AS msg_4_role,
       JSON_VALUE(messages, '$[4].content') AS msg_4_content,
       `timestamp`
FROM hook_before_agent_start
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- 9e. View a single message as a complete JSON object
--     Use JSON_QUERY to get a full array element (object, not scalar).
SELECT agent_id,
       JSON_QUERY(messages, '$[0]') AS first_message,
       JSON_QUERY(messages, '$[1]') AS second_message,
       JSON_QUERY(messages, '$[2]') AS third_message,
       `timestamp`
FROM hook_agent_end
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- 9f. Extract metadata from received messages
SELECT from_id,
       content,
       JSON_VALUE(metadata, '$.lang') AS lang,
       JSON_VALUE(metadata, '$.source') AS source,
       metadata,
       `timestamp`
FROM hook_message_received
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- 9g. Inspect tool_result_persist message content
SELECT tool_name,
       tool_call_id,
       is_synthetic,
       JSON_VALUE(message, '$.role') AS role,
       JSON_VALUE(message, '$.content') AS content,
       `timestamp`
FROM hook_tool_result_persist
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- 9h. Full-width single row inspection (for large JSON fields)
--     Increase max-column-width to see full messages array without truncation.
-- SET 'sql-client.display.max-column-width' = '2000';
-- SELECT * FROM hook_agent_end /*+ OPTIONS('scan.startup.mode'='earliest') */ LIMIT 1;

-- ============================================================
-- 10. Risk Control: Interactive Queries
-- ============================================================
-- AI Agent real-time risk control SQL rules.
-- Prerequisites:
--   1. Send messages via OpenClaw WebChat to trigger table auto-creation
--   2. Catalog initialization from Section 1 above is already done

-- ── 10a. Monitor all command executions ──────────────────────
-- Extract command field from params JSON
-- OpenClaw exec tool: params structure {"command":"ls -la"}

SELECT tool_name,
       JSON_VALUE(params, '$.command') AS command,
       agent_id,
       session_key,
       `timestamp`
FROM hook_before_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */
WHERE tool_name = 'exec';

-- ── 10b. Dangerous command pattern matching with risk levels ─
-- Match commands against predefined danger patterns.
-- Risk levels:
--   HIGH   - filesystem destruction, privilege escalation, disk destruction
--   MEDIUM - remote download-execute, sensitive file access, env leak

SELECT agent_id,
       session_key,
       command,
       risk_level,
       risk_type,
       `timestamp`
FROM (
  SELECT agent_id,
         session_key,
         JSON_VALUE(params, '$.command') AS command,
         `timestamp`,
         CASE
           -- HIGH: filesystem destruction
           WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%rm -rf%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%rm -r /%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%rmdir /%'
             THEN 'HIGH'
           -- HIGH: privilege escalation
           WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%sudo %'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%chmod 777%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%chown root%'
             THEN 'HIGH'
           -- HIGH: disk/system destruction
           WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%mkfs%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%dd if=%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%> /dev/sd%'
             THEN 'HIGH'
           -- MEDIUM: remote download-execute
           WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%curl%|%sh%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%curl%|%bash%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%wget%|%sh%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%wget%|%bash%'
             THEN 'MEDIUM'
           -- MEDIUM: sensitive file access
           WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%/etc/passwd%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%/etc/shadow%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%.ssh/id_rsa%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%.ssh/authorized_keys%'
             THEN 'MEDIUM'
           -- MEDIUM: env leak
           WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%printenv%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%env | grep%'
             THEN 'MEDIUM'
           ELSE 'LOW'
         END AS risk_level,
         CASE
           WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%rm -rf%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%rm -r /%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%rmdir /%'
             THEN 'file_destruction'
           WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%sudo %'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%chmod 777%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%chown root%'
             THEN 'privilege_escalation'
           WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%mkfs%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%dd if=%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%> /dev/sd%'
             THEN 'system_destruction'
           WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%curl%|%sh%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%curl%|%bash%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%wget%|%sh%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%wget%|%bash%'
             THEN 'remote_code_execution'
           WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%/etc/passwd%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%/etc/shadow%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%.ssh/id_rsa%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%.ssh/authorized_keys%'
             THEN 'sensitive_file_access'
           WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%printenv%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%env | grep%'
             THEN 'env_leak'
           ELSE 'normal'
         END AS risk_type
  FROM hook_before_tool_call
    /*+ OPTIONS('scan.startup.mode'='earliest') */
  WHERE tool_name = 'exec'
) WHERE risk_level <> 'LOW';

-- ── 10c. Full tool call audit view ──────────────────────────
-- Beyond exec, write/read tools may also carry risk

SELECT tool_name,
       SUBSTRING(params, 1, 120) AS params_preview,
       agent_id,
       session_key,
       `timestamp`
FROM hook_before_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- ── 10d. Tool call frequency by agent ───────────────────────
-- Identify abnormally high-frequency agents

SELECT agent_id,
       COUNT(*) AS call_count,
       COUNT(DISTINCT tool_name) AS tool_variety
FROM hook_before_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */
GROUP BY agent_id
HAVING COUNT(*) > 50;

-- ── 10e. Tool frequency by type ─────────────────────────────

SELECT agent_id,
       tool_name,
       COUNT(*) AS call_count
FROM hook_before_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */
GROUP BY agent_id, tool_name
HAVING COUNT(*) > 20;

-- ── 10f. Error rate anomaly detection ───────────────────────
-- Alert when error rate > 50% and total calls > 5

SELECT agent_id,
       COUNT(*) AS total_calls,
       SUM(CASE WHEN error <> '' THEN 1 ELSE 0 END) AS failed_calls,
       SUM(CASE WHEN error = '' THEN 1 ELSE 0 END) AS success_calls,
       CAST(SUM(CASE WHEN error <> '' THEN 1 ELSE 0 END) AS DOUBLE)
         / COUNT(*) * 100 AS error_rate_pct
FROM hook_after_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */
GROUP BY agent_id
HAVING SUM(CASE WHEN error <> '' THEN 1 ELSE 0 END) * 100 / COUNT(*) > 50
   AND COUNT(*) > 5;

-- ── 10g. Slow call alerts ───────────────────────────────────
-- Tool execution time > 30 seconds

SELECT tool_name,
       duration_ms,
       JSON_VALUE(params, '$.command') AS command,
       error,
       agent_id,
       `timestamp`
FROM hook_after_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */
WHERE duration_ms > 30000;

-- ── 10h. Agent health dashboard ─────────────────────────────

SELECT agent_id,
       COUNT(*) AS total_calls,
       SUM(CASE WHEN error <> '' THEN 1 ELSE 0 END) AS error_count,
       CAST(AVG(duration_ms) AS BIGINT) AS avg_duration_ms,
       MAX(duration_ms) AS max_duration_ms,
       MIN(`timestamp`) AS first_call_ts,
       MAX(`timestamp`) AS last_call_ts,
       CASE
         WHEN SUM(CASE WHEN error <> '' THEN 1 ELSE 0 END) * 100 / COUNT(*) > 50
           THEN 'UNHEALTHY'
         WHEN SUM(CASE WHEN error <> '' THEN 1 ELSE 0 END) * 100 / COUNT(*) > 20
           THEN 'WARNING'
         ELSE 'HEALTHY'
       END AS health_status
FROM hook_after_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */
GROUP BY agent_id;

-- ── 10i. Agent success rate by provider ─────────────────────

SELECT agent_id,
       message_provider,
       COUNT(*) AS total_runs,
       SUM(CASE WHEN success THEN 1 ELSE 0 END) AS succeeded,
       SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) AS failed,
       CAST(AVG(duration_ms) AS BIGINT) AS avg_duration_ms
FROM hook_agent_end
  /*+ OPTIONS('scan.startup.mode'='earliest') */
GROUP BY agent_id, message_provider;

-- ── 10j. User message sensitive info scan ───────────────────
-- Match common key/password/connection-string/private-key patterns

SELECT from_id,
       channel_id,
       conversation_id,
       SUBSTRING(content, 1, 80) AS content_preview,
       leak_type,
       `timestamp`
FROM (
  SELECT from_id,
         channel_id,
         conversation_id,
         content,
         `timestamp`,
         CASE
           WHEN content LIKE '%AKIA%'
             THEN 'aws_access_key'
           WHEN content LIKE '%sk-proj-%'
             OR content LIKE '%sk-live-%'
             THEN 'openai_api_key'
           WHEN content LIKE '%LTAI%'
             THEN 'alicloud_access_key'
           WHEN LOWER(content) LIKE '%mysql://%'
             OR LOWER(content) LIKE '%postgres://%'
             OR LOWER(content) LIKE '%mongodb://%'
             OR LOWER(content) LIKE '%redis://%'
             THEN 'database_credential'
           WHEN content LIKE '%BEGIN RSA PRIVATE KEY%'
             OR content LIKE '%BEGIN OPENSSH PRIVATE KEY%'
             OR content LIKE '%BEGIN EC PRIVATE KEY%'
             THEN 'private_key'
           WHEN LOWER(content) LIKE '%password%=%'
             OR LOWER(content) LIKE '%password%:%'
             OR LOWER(content) LIKE '%api_key%=%'
             OR LOWER(content) LIKE '%apikey%=%'
             OR LOWER(content) LIKE '%secret_key%=%'
             OR LOWER(content) LIKE '%access_token%=%'
             THEN 'generic_credential'
           ELSE 'none'
         END AS leak_type
  FROM hook_message_received
    /*+ OPTIONS('scan.startup.mode'='earliest') */
) WHERE leak_type <> 'none';

-- ── 10k. Prompt injection detection ─────────────────────────
-- Search raw messages JSON string for injection patterns

SELECT agent_id,
       session_key,
       injection_type,
       SUBSTRING(messages, 1, 100) AS msg_content_preview,
       `timestamp`
FROM (
  SELECT agent_id,
         session_key,
         `timestamp`,
         messages,
         CASE
           WHEN LOWER(messages) LIKE '%ignore previous instructions%'
             THEN 'instruction_override_en'
           WHEN messages LIKE '%忽略之前的指令%'
             THEN 'instruction_override_zh'
           WHEN LOWER(messages) LIKE '%you are now%'
             THEN 'role_hijack'
           WHEN LOWER(messages) LIKE '%system prompt%'
             OR messages LIKE '%系统提示词%'
             THEN 'prompt_extraction'
           ELSE 'none'
         END AS injection_type
  FROM hook_before_agent_start
    /*+ OPTIONS('scan.startup.mode'='earliest') */
) WHERE injection_type <> 'none';

-- ── 10l. Tool params sensitive info detection ───────────────

SELECT tool_name,
       agent_id,
       session_key,
       leak_type,
       SUBSTRING(params, 1, 120) AS params_preview,
       `timestamp`
FROM (
  SELECT tool_name,
         agent_id,
         session_key,
         params,
         `timestamp`,
         CASE
           WHEN params LIKE '%AKIA%'
             THEN 'aws_key_in_params'
           WHEN params LIKE '%sk-proj-%'
             OR params LIKE '%sk-live-%'
             THEN 'openai_key_in_params'
           WHEN params LIKE '%BEGIN RSA PRIVATE KEY%'
             OR params LIKE '%BEGIN OPENSSH PRIVATE KEY%'
             THEN 'private_key_in_params'
           WHEN LOWER(params) LIKE '%password%'
             AND (tool_name = 'write' OR tool_name = 'read')
             THEN 'password_in_file_op'
           ELSE 'none'
         END AS leak_type
  FROM hook_before_tool_call
    /*+ OPTIONS('scan.startup.mode'='earliest') */
  WHERE tool_name IN ('write', 'read', 'exec')
) WHERE leak_type <> 'none';

-- ── 10m. Unified alert view ─────────────────────────────────
-- Merge three sensitive info detection sources into unified alert stream

-- Source 1: User messages
SELECT 'user_message' AS alert_source,
       leak_type AS alert_type,
       from_id AS entity_id,
       SUBSTRING(content, 1, 80) AS content_preview,
       `timestamp`
FROM (
  SELECT from_id, content, `timestamp`,
         CASE
           WHEN content LIKE '%AKIA%' THEN 'aws_key'
           WHEN content LIKE '%sk-proj-%' OR content LIKE '%sk-live-%' THEN 'openai_key'
           WHEN content LIKE '%LTAI%' THEN 'alicloud_key'
           WHEN content LIKE '%BEGIN RSA PRIVATE KEY%'
             OR content LIKE '%BEGIN OPENSSH PRIVATE KEY%' THEN 'private_key'
           WHEN LOWER(content) LIKE '%mysql://%'
             OR LOWER(content) LIKE '%postgres://%' THEN 'db_credential'
           ELSE 'none'
         END AS leak_type
  FROM hook_message_received
    /*+ OPTIONS('scan.startup.mode'='earliest') */
) WHERE leak_type <> 'none'

UNION ALL

-- Source 2: Prompt injection
SELECT 'prompt_injection' AS alert_source,
       injection_type AS alert_type,
       agent_id AS entity_id,
       SUBSTRING(messages, 1, 80) AS content_preview,
       `timestamp`
FROM (
  SELECT agent_id, messages, `timestamp`,
         CASE
           WHEN LOWER(messages) LIKE '%ignore previous instructions%'
             THEN 'instruction_override'
           WHEN messages LIKE '%忽略之前的指令%'
             THEN 'instruction_override_zh'
           WHEN LOWER(messages) LIKE '%system prompt%'
             OR messages LIKE '%系统提示词%'
             THEN 'prompt_extraction'
           ELSE 'none'
         END AS injection_type
  FROM hook_before_agent_start
    /*+ OPTIONS('scan.startup.mode'='earliest') */
  WHERE messages IS NOT NULL AND messages <> '' AND messages <> '[]'
) WHERE injection_type <> 'none'

UNION ALL

-- Source 3: Tool params leak
SELECT 'tool_params' AS alert_source,
       leak_type AS alert_type,
       agent_id AS entity_id,
       SUBSTRING(params, 1, 80) AS content_preview,
       `timestamp`
FROM (
  SELECT agent_id, params, `timestamp`,
         CASE
           WHEN params LIKE '%AKIA%' THEN 'aws_key'
           WHEN params LIKE '%sk-proj-%' OR params LIKE '%sk-live-%' THEN 'openai_key'
           WHEN params LIKE '%BEGIN RSA PRIVATE KEY%' THEN 'private_key'
           ELSE 'none'
         END AS leak_type
  FROM hook_before_tool_call
    /*+ OPTIONS('scan.startup.mode'='earliest') */
  WHERE tool_name IN ('write', 'read')
) WHERE leak_type <> 'none';

-- ============================================================
-- 11. Risk Control: Streaming Detection Jobs
-- ============================================================
-- Submit as background Flink jobs that continuously write detection results
-- to Fluss result tables.
--
-- Usage (submit as background job):
--   docker compose cp scripts/demo.sql jobmanager:/tmp/demo.sql
--   docker compose exec -d jobmanager ./bin/sql-client.sh -f /tmp/demo.sql
--
-- Check job status: http://localhost:8083

-- ── 11a. Create result tables ───────────────────────────────

CREATE TABLE IF NOT EXISTS risk_dangerous_commands (
  agent_id STRING,
  session_key STRING,
  command STRING,
  risk_level STRING,
  risk_type STRING,
  detected_at BIGINT
);

CREATE TABLE IF NOT EXISTS risk_sensitive_leaks (
  alert_source STRING,
  alert_type STRING,
  entity_id STRING,
  content_preview STRING,
  detected_at BIGINT
);

-- ── 11b. Job: Dangerous command real-time detection ─────────
-- Detect dangerous command patterns from hook_before_tool_call exec tool

INSERT INTO risk_dangerous_commands
SELECT agent_id,
       session_key,
       JSON_VALUE(params, '$.command') AS command,
       CASE
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%rm -rf%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%rm -r /%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%rmdir /%'
           THEN 'HIGH'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%sudo %'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%chmod 777%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%chown root%'
           THEN 'HIGH'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%mkfs%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%dd if=%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%> /dev/sd%'
           THEN 'HIGH'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%curl%|%sh%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%curl%|%bash%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%wget%|%sh%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%wget%|%bash%'
           THEN 'MEDIUM'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%/etc/passwd%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%/etc/shadow%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%.ssh/id_rsa%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%.ssh/authorized_keys%'
           THEN 'MEDIUM'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%printenv%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%env | grep%'
           THEN 'MEDIUM'
         ELSE 'SKIP'
       END AS risk_level,
       CASE
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%rm -rf%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%rm -r /%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%rmdir /%'
           THEN 'file_destruction'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%sudo %'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%chmod 777%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%chown root%'
           THEN 'privilege_escalation'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%mkfs%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%dd if=%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%> /dev/sd%'
           THEN 'system_destruction'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%curl%|%sh%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%curl%|%bash%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%wget%|%sh%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%wget%|%bash%'
           THEN 'remote_code_execution'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%/etc/passwd%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%/etc/shadow%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%.ssh/id_rsa%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%.ssh/authorized_keys%'
           THEN 'sensitive_file_access'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%printenv%'
           OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%env | grep%'
           THEN 'env_leak'
         ELSE 'unknown'
       END AS risk_type,
       `timestamp`
FROM hook_before_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */
WHERE tool_name = 'exec'
  AND (
    LOWER(JSON_VALUE(params, '$.command')) LIKE '%rm -rf%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%rm -r /%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%rmdir /%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%sudo %'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%chmod 777%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%chown root%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%mkfs%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%dd if=%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%> /dev/sd%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%curl%|%sh%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%curl%|%bash%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%wget%|%sh%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%wget%|%bash%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%/etc/passwd%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%/etc/shadow%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%.ssh/id_rsa%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%.ssh/authorized_keys%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%printenv%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%env | grep%'
  );

-- ── 11c. Job: Sensitive leaks + Prompt injection detection ──
-- Merge 3 sources: user messages + prompt injection + tool params

INSERT INTO risk_sensitive_leaks

-- Source 1: Sensitive info in user messages
SELECT 'user_message' AS alert_source,
       leak_type AS alert_type,
       from_id AS entity_id,
       SUBSTRING(content, 1, 80) AS content_preview,
       `timestamp`
FROM (
  SELECT from_id, content, `timestamp`,
         CASE
           WHEN content LIKE '%AKIA%' THEN 'aws_key'
           WHEN content LIKE '%sk-proj-%' OR content LIKE '%sk-live-%' THEN 'openai_key'
           WHEN content LIKE '%LTAI%' THEN 'alicloud_key'
           WHEN content LIKE '%BEGIN RSA PRIVATE KEY%'
             OR content LIKE '%BEGIN OPENSSH PRIVATE KEY%' THEN 'private_key'
           WHEN LOWER(content) LIKE '%mysql://%'
             OR LOWER(content) LIKE '%postgres://%' THEN 'db_credential'
           ELSE 'none'
         END AS leak_type
  FROM hook_message_received
    /*+ OPTIONS('scan.startup.mode'='earliest') */
) WHERE leak_type <> 'none'

UNION ALL

-- Source 2: Prompt injection
SELECT 'prompt_injection' AS alert_source,
       injection_type AS alert_type,
       agent_id AS entity_id,
       SUBSTRING(messages, 1, 80) AS content_preview,
       `timestamp`
FROM (
  SELECT agent_id, messages, `timestamp`,
         CASE
           WHEN LOWER(messages) LIKE '%ignore previous instructions%'
             THEN 'instruction_override'
           WHEN messages LIKE '%忽略之前的指令%'
             THEN 'instruction_override_zh'
           WHEN LOWER(messages) LIKE '%system prompt%'
             OR messages LIKE '%系统提示词%'
             THEN 'prompt_extraction'
           WHEN LOWER(messages) LIKE '%you are now%'
             THEN 'role_hijack'
           ELSE 'none'
         END AS injection_type
  FROM hook_before_agent_start
    /*+ OPTIONS('scan.startup.mode'='earliest') */
  WHERE messages IS NOT NULL AND messages <> '' AND messages <> '[]'
) WHERE injection_type <> 'none'

UNION ALL

-- Source 3: Sensitive info in tool params
SELECT 'tool_params' AS alert_source,
       leak_type AS alert_type,
       agent_id AS entity_id,
       SUBSTRING(params, 1, 80) AS content_preview,
       `timestamp`
FROM (
  SELECT agent_id, params, `timestamp`,
         CASE
           WHEN params LIKE '%AKIA%' THEN 'aws_key'
           WHEN params LIKE '%sk-proj-%' OR params LIKE '%sk-live-%' THEN 'openai_key'
           WHEN params LIKE '%BEGIN RSA PRIVATE KEY%' THEN 'private_key'
           ELSE 'none'
         END AS leak_type
  FROM hook_before_tool_call
    /*+ OPTIONS('scan.startup.mode'='earliest') */
  WHERE tool_name IN ('write', 'read')
) WHERE leak_type <> 'none';
