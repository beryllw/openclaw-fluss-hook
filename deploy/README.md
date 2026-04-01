# Fluss + Flink Standalone Cluster

独立部署的 Fluss 流式存储 + Flink 流处理集群，供外部 OpenClaw 实例连接使用。

## 架构

```
┌─────────────────────────────────────────────────────┐
│                    Deploy Server                     │
│                                                     │
│   ZooKeeper (:2181)                                 │
│       ↕                                             │
│   Fluss Coordinator (:9123)  ← OpenClaw connects    │
│       ↕                                             │
│   Fluss Tablet Server (:9124)                       │
│       ↕                                             │
│   Flink JobManager (:8081 UI, :6123 RPC)            │
│       ↕                                             │
│   Flink TaskManager                                 │
└─────────────────────────────────────────────────────┘
        ↑
        │ Network
        ↓
┌───────────────────┐
│  OpenClaw Server  │
│  (other machine)  │
│  fluss-hook plugin│
└───────────────────┘
```

## 端口说明

| 服务 | 端口 | 说明 |
|------|------|------|
| ZooKeeper | 2181 | Fluss 集群协调 |
| Fluss Coordinator | 9123 | 客户端连接入口 (OpenClaw 连接此端口) |
| Fluss Tablet Server | 9124 | 数据读写服务 |
| Flink JobManager | 8081 | Flink Web UI |
| Flink JobManager | 6123 | Flink RPC |

## 快速开始

### 1. 下载依赖

```bash
./scripts/setup.sh
```

此脚本会：
- 下载 Flink Fluss Connector JAR
- 从 `.env.example` 创建 `.env` 文件

### 2. 配置 HOST_IP

编辑 `.env` 文件，将 `HOST_IP` 设置为服务器的外部 IP 地址：

```bash
# .env
HOST_IP=192.168.1.100    # 替换为你的服务器 IP
```

> 如果仅本机测试，可以保持默认值 `0.0.0.0`。

### 3. 启动集群

```bash
docker compose up -d
```

### 4. 验证

- Flink Web UI: `http://<HOST_IP>:8081`
- 检查服务状态: `docker compose ps`

## OpenClaw 连接配置

在 OpenClaw 所在机器上安装 `fluss-hook` 插件后，配置 `openclaw.json`：

```json
{
  "hooks": {
    "fluss-hook": {
      "fluss.bootstrapServers": "<HOST_IP>:9123"
    }
  }
}
```

其中 `<HOST_IP>` 替换为部署 Fluss 集群的服务器 IP 地址。

## 通过 Flink SQL 查询数据

### 连接 Flink SQL Client

```bash
docker compose exec jobmanager ./bin/sql-client.sh
```

### 创建 Fluss Catalog

```sql
CREATE CATALOG fluss_catalog WITH (
  'type' = 'fluss',
  'bootstrap.servers' = 'localhost:9123'
);
USE CATALOG fluss_catalog;
```

### 查看已有表

```sql
SHOW DATABASES;
USE fluss_db;
SHOW TABLES;
```

### 查询示例

```sql
-- 查询 hook 事件数据
SET 'sql-client.execution.result-mode' = 'tableau';
SET 'table.display.max-column-width' = '200';

SELECT * FROM hook_message_received LIMIT 10;
```

> 完整的建表语句和查询示例请参考 `demo/scripts/demo.sql`。

## 网络要求

此部署使用 `network_mode: host`（主机网络模式）：

- **适用**: Linux 服务器部署
- **不适用**: macOS / Windows Docker Desktop（host 网络模式在这些平台上行为不同）
- 确保防火墙允许端口 `9123`、`9124`、`8081` 的入站连接

## 常用命令

```bash
# 启动
docker compose up -d

# 查看状态
docker compose ps

# 查看日志
docker compose logs -f coordinator-server
docker compose logs -f tablet-server

# 停止
docker compose down

# 停止并清除数据
docker compose down -v
```
