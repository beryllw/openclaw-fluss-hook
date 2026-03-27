-- ============================================================
-- Fluss Hook Demo: Flink SQL Queries
-- ============================================================
-- Run inside Flink SQL Client:
--   docker compose exec jobmanager ./bin/sql-client.sh
-- ============================================================

-- 1. Create Fluss Catalog
CREATE CATALOG fluss_catalog WITH (
  'type' = 'fluss',
  'bootstrap.servers' = 'coordinator-server:9123'
);
USE CATALOG fluss_catalog;

-- 2. Explore databases and tables
--    (Send at least one message via OpenClaw first to trigger auto-creation)
SHOW DATABASES;
USE openclaw;
SHOW TABLES;

-- 3. Real-time message stream (streaming mode)
SET 'execution.runtime-mode' = 'streaming';
SET 'sql-client.execution.result-mode' = 'changelog';

SELECT direction,
       channel_id,
       from_id,
       to_id,
       SUBSTRING(content, 1, 80) AS content_preview,
       `timestamp`
FROM message_logs
  /*+ OPTIONS('scan.startup.mode'='earliest') */;

-- 4. Message count by direction
SELECT direction, COUNT(*) AS msg_count
FROM message_logs
  /*+ OPTIONS('scan.startup.mode'='earliest') */
GROUP BY direction;

-- 5. Message count by conversation
SELECT conversation_id,
       direction,
       COUNT(*) AS msg_count
FROM message_logs
  /*+ OPTIONS('scan.startup.mode'='earliest') */
GROUP BY conversation_id, direction;
