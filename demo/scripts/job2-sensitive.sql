CREATE CATALOG IF NOT EXISTS fluss_catalog WITH ('type' = 'fluss', 'bootstrap.servers' = 'coordinator-server:9123');
USE CATALOG fluss_catalog;
USE openclaw;
SET 'execution.runtime-mode' = 'streaming';

-- Job 2: Sensitive leaks + Prompt injection unified detection
INSERT INTO risk_sensitive_leaks

SELECT 'user_message' AS alert_source, leak_type AS alert_type, from_id AS entity_id,
       SUBSTRING(content, 1, 80) AS content_preview, `timestamp`
FROM (
  SELECT from_id, content, `timestamp`,
         CASE
           WHEN content LIKE '%AKIA%' THEN 'aws_key'
           WHEN content LIKE '%sk-proj-%' OR content LIKE '%sk-live-%' THEN 'openai_key'
           WHEN content LIKE '%LTAI%' THEN 'alicloud_key'
           WHEN content LIKE '%BEGIN RSA PRIVATE KEY%' OR content LIKE '%BEGIN OPENSSH PRIVATE KEY%' THEN 'private_key'
           WHEN LOWER(content) LIKE '%mysql://%' OR LOWER(content) LIKE '%postgres://%' THEN 'db_credential'
           ELSE 'none'
         END AS leak_type
  FROM hook_message_received /*+ OPTIONS('scan.startup.mode'='earliest') */
) WHERE leak_type <> 'none'

UNION ALL

SELECT 'prompt_injection' AS alert_source, injection_type AS alert_type, agent_id AS entity_id,
       SUBSTRING(messages, 1, 80) AS content_preview, `timestamp`
FROM (
  SELECT agent_id, messages, `timestamp`,
         CASE
           WHEN LOWER(messages) LIKE '%ignore previous instructions%' THEN 'instruction_override'
           WHEN messages LIKE '%忽略之前的指令%' THEN 'instruction_override_zh'
           WHEN LOWER(messages) LIKE '%system prompt%' OR messages LIKE '%系统提示词%' THEN 'prompt_extraction'
           WHEN LOWER(messages) LIKE '%you are now%' THEN 'role_hijack'
           ELSE 'none'
         END AS injection_type
  FROM hook_before_agent_start /*+ OPTIONS('scan.startup.mode'='earliest') */
  WHERE messages IS NOT NULL AND messages <> '' AND messages <> '[]'
) WHERE injection_type <> 'none'

UNION ALL

SELECT 'tool_params' AS alert_source, leak_type AS alert_type, agent_id AS entity_id,
       SUBSTRING(params, 1, 80) AS content_preview, `timestamp`
FROM (
  SELECT agent_id, params, `timestamp`,
         CASE
           WHEN params LIKE '%AKIA%' THEN 'aws_key'
           WHEN params LIKE '%sk-proj-%' OR params LIKE '%sk-live-%' THEN 'openai_key'
           WHEN params LIKE '%BEGIN RSA PRIVATE KEY%' THEN 'private_key'
           ELSE 'none'
         END AS leak_type
  FROM hook_before_tool_call /*+ OPTIONS('scan.startup.mode'='earliest') */
  WHERE tool_name IN ('write', 'read')
) WHERE leak_type <> 'none';
