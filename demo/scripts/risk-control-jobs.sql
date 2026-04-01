-- ============================================================
-- Risk Control Detection Jobs
-- ============================================================
-- 将风控检测结果持续写入 Fluss 结果表
--
-- 运行方式 (提交为后台 Job):
--   docker compose cp scripts/risk-control-jobs.sql jobmanager:/tmp/risk-control-jobs.sql
--   docker compose exec -d jobmanager ./bin/sql-client.sh -f /tmp/risk-control-jobs.sql
--
-- 查看 Job 状态: http://localhost:8083
-- ============================================================

-- 0. 初始化
CREATE CATALOG IF NOT EXISTS fluss_catalog WITH (
  'type' = 'fluss',
  'bootstrap.servers' = 'coordinator-server:9123'
);
USE CATALOG fluss_catalog;
USE openclaw;

SET 'execution.runtime-mode' = 'streaming';

-- ============================================================
-- 1. 创建风控结果表
-- ============================================================

-- 场景一: 危险命令检测结果
CREATE TABLE IF NOT EXISTS risk_dangerous_commands (
  agent_id STRING,
  session_key STRING,
  command STRING,
  risk_level STRING,
  risk_type STRING,
  detected_at BIGINT
);

-- 场景三: 敏感信息泄露 & Prompt 注入统一告警
CREATE TABLE IF NOT EXISTS risk_sensitive_leaks (
  alert_source STRING,
  alert_type STRING,
  entity_id STRING,
  content_preview STRING,
  detected_at BIGINT
);

-- ============================================================
-- 2. 提交检测 Job
-- ============================================================

-- Job 1: 危险命令实时检测
-- 从 hook_before_tool_call 中检测 exec 工具的危险命令模式
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

-- Job 2: 敏感信息泄露 & Prompt 注入统一检测
-- 合并 3 个数据源: 用户消息 + Prompt 注入 + 工具输出
INSERT INTO risk_sensitive_leaks

-- 来源 1: 用户消息中的敏感信息
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

-- 来源 2: Prompt 注入
-- 注意: messages 中 content 是嵌套数组 [{"type":"text","text":"..."}]
-- 无法用 JSON_VALUE 提取固定位置，改为搜索原始 JSON 字符串
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

-- 来源 3: 工具参数中的敏感信息
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
