CREATE CATALOG IF NOT EXISTS fluss_catalog WITH ('type' = 'fluss', 'bootstrap.servers' = 'coordinator-server:9123');
USE CATALOG fluss_catalog;
USE openclaw;
SET 'execution.runtime-mode' = 'streaming';

-- Job 1: Dangerous command detection
INSERT INTO risk_dangerous_commands
SELECT agent_id, session_key,
       JSON_VALUE(params, '$.command') AS command,
       CASE
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%rm -rf%' OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%rm -r /%' THEN 'HIGH'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%sudo %' OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%chmod 777%' THEN 'HIGH'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%mkfs%' OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%dd if=%' THEN 'HIGH'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%curl%|%sh%' OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%wget%|%sh%' THEN 'MEDIUM'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%/etc/passwd%' OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%/etc/shadow%' THEN 'MEDIUM'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%.ssh/id_rsa%' OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%.ssh/authorized_keys%' THEN 'MEDIUM'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%printenv%' OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%env | grep%' THEN 'MEDIUM'
         ELSE 'SKIP'
       END AS risk_level,
       CASE
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%rm -rf%' OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%rm -r /%' THEN 'file_destruction'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%sudo %' OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%chmod 777%' THEN 'privilege_escalation'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%mkfs%' OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%dd if=%' THEN 'system_destruction'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%curl%|%sh%' OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%wget%|%sh%' THEN 'remote_code_execution'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%/etc/passwd%' OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%/etc/shadow%' THEN 'sensitive_file_access'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%.ssh/id_rsa%' THEN 'sensitive_file_access'
         WHEN LOWER(JSON_VALUE(params, '$.command')) LIKE '%printenv%' OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%env | grep%' THEN 'env_leak'
         ELSE 'unknown'
       END AS risk_type,
       `timestamp`
FROM hook_before_tool_call /*+ OPTIONS('scan.startup.mode'='earliest') */
WHERE tool_name = 'exec'
  AND (LOWER(JSON_VALUE(params, '$.command')) LIKE '%rm -rf%' OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%rm -r /%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%sudo %' OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%chmod 777%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%mkfs%' OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%dd if=%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%curl%|%sh%' OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%wget%|%sh%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%/etc/passwd%' OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%/etc/shadow%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%.ssh/id_rsa%' OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%.ssh/authorized_keys%'
    OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%printenv%' OR LOWER(JSON_VALUE(params, '$.command')) LIKE '%env | grep%');
