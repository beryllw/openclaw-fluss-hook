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
