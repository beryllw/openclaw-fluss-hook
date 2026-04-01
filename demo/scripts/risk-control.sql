-- ============================================================
-- Fluss Hook: Risk Control Flink SQL Queries
-- ============================================================
-- AI Agent 实时风控 SQL 规则集
--
-- 运行方式:
--   docker compose exec jobmanager ./bin/sql-client.sh
--   然后逐条复制执行以下 SQL
--
-- 前置条件:
--   1. 已通过 OpenClaw WebChat 发送消息触发表自动创建
--   2. 已执行 demo.sql 中的 Catalog 初始化部分
-- ============================================================

-- 0. 初始化 (如尚未执行)
CREATE CATALOG fluss_catalog WITH (
  'type' = 'fluss',
  'bootstrap.servers' = 'coordinator-server:9123'
);
USE CATALOG fluss_catalog;
USE openclaw;

SET 'execution.runtime-mode' = 'streaming';
SET 'sql-client.execution.result-mode' = 'changelog';
SET 'sql-client.display.max-column-width' = '200';

-- ============================================================
-- 1. 危险工具调用检测
-- ============================================================
-- 数据源: hook_before_tool_call
-- 字段: tool_name STRING, params STRING (JSON), agent_id STRING,
--       session_key STRING, context_tool_name STRING, timestamp BIGINT

-- ── 1a. 实时监控所有命令执行 ──────────────────────────────
-- 从 params JSON 中提取 command 字段
-- OpenClaw 命令执行工具名为 "exec", params 结构: {"command":"ls -la"}

SELECT tool_name,
       JSON_VALUE(params, '$.command') AS command,
       agent_id,
       session_key,
       `timestamp`
FROM hook_before_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */
WHERE tool_name = 'exec';

-- ── 1b. 危险命令模式匹配与风险分级 ─────────────────────────
-- 将命令与预定义危险模式匹配，输出风险等级和类型
-- 风险等级:
--   HIGH   - 文件系统破坏、权限提升、磁盘破坏
--   MEDIUM - 远程下载执行、敏感文件访问、环境变量泄露

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
           -- 高危: 文件系统破坏
           WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%rm -rf%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%rm -r /%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%rmdir /%'
             THEN 'HIGH'
           -- 高危: 权限提升
           WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%sudo %'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%chmod 777%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%chown root%'
             THEN 'HIGH'
           -- 高危: 磁盘/系统破坏
           WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%mkfs%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%dd if=%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%> /dev/sd%'
             THEN 'HIGH'
           -- 中危: 远程下载执行
           WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%curl%|%sh%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%curl%|%bash%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%wget%|%sh%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%wget%|%bash%'
             THEN 'MEDIUM'
           -- 中危: 敏感文件访问
           WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%/etc/passwd%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%/etc/shadow%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%.ssh/id_rsa%'
             OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%.ssh/authorized_keys%'
             THEN 'MEDIUM'
           -- 中危: 环境变量泄露
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

-- ── 1c. 全量工具调用审计视图 ────────────────────────────────
-- 除 exec 外, write/read 等工具也可能存在风险

SELECT tool_name,
       SUBSTRING(params, 1, 120) AS params_preview,
       agent_id,
       session_key,
       `timestamp`
FROM hook_before_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- ============================================================
-- 2. 异常行为频率告警
-- ============================================================
-- 数据源: hook_before_tool_call + hook_after_tool_call + hook_agent_end

-- ── 2a. 工具调用频率统计 ────────────────────────────────────
-- 按 agent_id 统计, 识别异常高频 Agent

SELECT agent_id,
       COUNT(*) AS call_count,
       COUNT(DISTINCT tool_name) AS tool_variety
FROM hook_before_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */
GROUP BY agent_id
HAVING COUNT(*) > 50;

-- ── 2b. 按工具类型的调用频率分析 ─────────────────────────────

SELECT agent_id,
       tool_name,
       COUNT(*) AS call_count
FROM hook_before_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */
GROUP BY agent_id, tool_name
HAVING COUNT(*) > 20;

-- ── 2c. 错误率异常检测 ──────────────────────────────────────
-- error <> '' 表示工具执行失败
-- 当错误率 > 50% 且总调用数 > 5 时触发告警

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

-- ── 2d. 慢调用告警 ──────────────────────────────────────────
-- 工具执行时间超过 30 秒

SELECT tool_name,
       duration_ms,
       JSON_VALUE(params, '$.command') AS command,
       error,
       agent_id,
       `timestamp`
FROM hook_after_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */
WHERE duration_ms > 30000;

-- ── 2e. Agent 健康度综合看板 ─────────────────────────────────
-- 综合调用数、错误数、耗时给出健康状态

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

-- ── 2f. Agent 执行成功率 ─────────────────────────────────────

SELECT agent_id,
       message_provider,
       COUNT(*) AS total_runs,
       SUM(CASE WHEN success THEN 1 ELSE 0 END) AS succeeded,
       SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) AS failed,
       CAST(AVG(duration_ms) AS BIGINT) AS avg_duration_ms
FROM hook_agent_end
  /*+ OPTIONS('scan.startup.mode'='earliest') */
GROUP BY agent_id, message_provider;

-- ============================================================
-- 3. 敏感信息泄露防护
-- ============================================================
-- 数据源: hook_message_received + hook_before_agent_start
--       + hook_before_tool_call

-- ── 3a. 用户消息敏感信息扫描 ─────────────────────────────────
-- 匹配常见的密钥、密码、连接串、私钥模式

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
           -- AWS Access Key (固定前缀 AKIA)
           WHEN content LIKE '%AKIA%'
             THEN 'aws_access_key'
           -- OpenAI API Key
           WHEN content LIKE '%sk-proj-%'
             OR content LIKE '%sk-live-%'
             THEN 'openai_api_key'
           -- 阿里云 AccessKey
           WHEN content LIKE '%LTAI%'
             THEN 'alicloud_access_key'
           -- 数据库连接串
           WHEN LOWER(content) LIKE '%mysql://%'
             OR LOWER(content) LIKE '%postgres://%'
             OR LOWER(content) LIKE '%mongodb://%'
             OR LOWER(content) LIKE '%redis://%'
             THEN 'database_credential'
           -- 私钥
           WHEN content LIKE '%BEGIN RSA PRIVATE KEY%'
             OR content LIKE '%BEGIN OPENSSH PRIVATE KEY%'
             OR content LIKE '%BEGIN EC PRIVATE KEY%'
             THEN 'private_key'
           -- 通用密码/密钥模式
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

-- ── 3b. Prompt 注入检测 ──────────────────────────────────────
-- 检查 messages JSON 中是否包含注入模式
-- 注意: messages 中 content 是嵌套数组 [{"type":"text","text":"..."}]
-- 无法用 JSON_VALUE 按固定索引提取最新消息, 改为搜索原始 JSON 字符串

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
           -- 英文注入: 忽略之前的指令
           WHEN LOWER(messages) LIKE '%ignore previous instructions%'
             THEN 'instruction_override_en'
           -- 中文注入: 忽略之前的指令
           WHEN messages LIKE '%忽略之前的指令%'
             THEN 'instruction_override_zh'
           -- 角色扮演注入
           WHEN LOWER(messages) LIKE '%you are now%'
             THEN 'role_hijack'
           -- System Prompt 提取尝试
           WHEN LOWER(messages) LIKE '%system prompt%'
             OR messages LIKE '%系统提示词%'
             THEN 'prompt_extraction'
           ELSE 'none'
         END AS injection_type
  FROM hook_before_agent_start
    /*+ OPTIONS('scan.startup.mode'='earliest') */
) WHERE injection_type <> 'none';

-- ── 3c. 工具参数敏感信息检测 ───────────────────────────────
-- 检测 write/read/exec 工具参数中是否包含敏感信息

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

-- ── 3d. 统一告警视图 ────────────────────────────────────────
-- 合并三类敏感信息检测为统一的告警流

-- 来源 1: 用户消息
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

-- 来源 2: Prompt 注入 (搜索原始 messages JSON 字符串)
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

-- 来源 3: 工具参数泄露
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
