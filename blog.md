# 基于 OpenClaw + Fluss + Flink 构建 AI Agent 实时风控系统

> 当 AI Agent 拥有执行命令、读写文件、访问网络的能力后，如何在不影响用户体验的前提下，对 Agent 的每一次操作进行实时审计和风险识别？本文介绍一种基于 OpenClaw Hook 机制 + Apache Fluss 流式存储 + Flink SQL 实时分析的 AI Agent 风控实践方案。

## 背景：AI Agent 时代的安全挑战

随着 AI Agent 从"对话助手"演变为"自主执行者"，安全风险也在急剧升级。一个典型的 AI Coding Agent 会话中可能包含以下操作：

- **执行 shell 命令**：`rm -rf /`, `curl` 下载恶意脚本, `chmod 777` 修改关键文件权限
- **读写敏感文件**：访问 `.env`、`credentials.json`、SSH 密钥等
- **发起网络请求**：连接未知外部服务，上传代码到第三方
- **长时间高频操作**：在短时间内发起大量工具调用，可能是 Agent "失控"循环

传统的安全措施（如防火墙、RBAC）难以应对这种场景，因为：

1. **操作是动态生成的** -- Agent 的行为由 LLM 推理驱动，无法预先枚举
2. **上下文至关重要** -- 同一条命令在不同场景下的风险等级完全不同
3. **需要实时响应** -- 等事后审计已经来不及，危险操作可能在毫秒内完成

我们需要的是一个**实时、流式、可编程**的风控系统。

## 整体架构

```
                          实时数据流
                    ┌─────────────────────┐
                    │                     ▼
┌──────────┐    ┌───────────┐    ┌──────────────┐    ┌──────────────┐
│   User   │◄──►│  OpenClaw  │───►│ Apache Fluss │◄───│  Flink SQL   │
│          │    │  Gateway   │    │  (流式存储)   │    │  (实时分析)   │
└──────────┘    └───────────┘    └──────────────┘    └──────────────┘
                    │                                       │
                    │  fluss-hook                           │
                    │  插件 (14 hooks)                       ▼
                    │                               ┌──────────────┐
                    └───────────────────────────────│   告警/打断   │
                          风控信号回传                │   风控系统    │
                                                    └──────────────┘
```

核心链路只有三步：

1. **OpenClaw** 通过 hook 机制，将用户与 AI Agent 的每一次交互实时写入 Fluss
2. **Fluss** 作为流式存储层，按事件类型分表存储 14 种 hook 事件
3. **Flink SQL** 订阅 Fluss 中的事件流，执行风控规则，识别并告警危险操作

## OpenClaw Hook 机制：全方位的 Agent 审计

OpenClaw 是一个 AI Agent 网关框架，其插件系统提供了 **14 种 hook 事件**，覆盖 Agent 交互的完整生命周期：

| 类别 | Hook 事件 | 风控价值 |
|------|----------|---------|
| **Agent** | `before_agent_start` | 审计系统提示词，识别 prompt 注入 |
| | `agent_end` | 监控执行时长异常、失败率飙升 |
| | `before_compaction` / `after_compaction` | 检测异常长对话（可能的资源耗尽攻击） |
| **消息** | `message_received` | 检测恶意用户输入、敏感信息泄露 |
| | `message_sending` / `message_sent` | 审计 Agent 回复内容是否包含敏感信息 |
| **工具** | `before_tool_call` | **核心风控点**：拦截危险命令和文件操作 |
| | `after_tool_call` | 审计工具执行结果，检测执行失败模式 |
| | `tool_result_persist` | 追踪工具结果是否被正确记录 |
| **会话** | `session_start` / `session_end` | 监控异常会话模式（高频创建、超长会话） |
| **网关** | `gateway_start` / `gateway_stop` | 网关可用性监控 |

其中，**工具调用相关的 hook 是风控的核心**。AI Agent 的每一次文件读写、命令执行、网络请求都会经过 `before_tool_call` 和 `after_tool_call`，提供了完整的审计链。

## fluss-hook 插件：零侵入的数据采集

`fluss-hook` 是一个 OpenClaw 插件，以零侵入的方式捕获所有 14 种 hook 事件，实时写入 Apache Fluss。

### 插件注册

```typescript
// index.ts -- 插件入口
const plugin = {
  id: "fluss-hook",
  register(api: OpenClawPluginApi) {
    const config = resolveConfig(api.pluginConfig);
    const flussClient = new FlussClientManager(config, api.logger);
    const buffer = new MultiTableBuffer(flussClient, config, api.logger);

    // 注册 14 个 hook 处理器
    api.on("before_tool_call", (event, ctx) => {
      buffer.push("before_tool_call", mapBeforeToolCall(event, ctx));
    });
    api.on("after_tool_call", (event, ctx) => {
      buffer.push("after_tool_call", mapAfterToolCall(event, ctx));
    });
    // ... 其余 12 个 hook
    
    api.registerService({
      id: "fluss-hook",
      start: () => buffer.start(),
      stop: async () => await buffer.stop(),
    });
  },
};
```

### 事件映射

每个 hook 事件通过专门的 mapper 函数转换为 Fluss 表行。以工具调用事件为例：

```typescript
// src/event-mappers.ts
export function mapBeforeToolCall(
  event: PluginHookBeforeToolCallEvent,
  ctx: PluginHookToolContext,
): Record<string, unknown> {
  return {
    tool_name: event.toolName,        // 工具名：execute_command, read_file, ...
    params: safeJson(event.params),   // JSON：工具参数（命令、文件路径等）
    agent_id: ctx.agentId ?? "",      // Agent 标识
    session_key: ctx.sessionKey ?? "",// 会话标识
    context_tool_name: ctx.toolName,
    timestamp: Date.now(),            // 精确到毫秒的时间戳
  };
}
```

`params` 字段是风控的关键数据源 -- 它完整记录了 Agent 要执行的操作参数，例如：
```json
{"command": "rm -rf /tmp/important-data", "cwd": "/home/user/project"}
{"file_path": "/etc/passwd", "content": "..."}
{"url": "https://suspicious-site.com/upload", "method": "POST"}
```

### 高性能写入：缓冲 + 批量刷写

为了不影响 Agent 的正常执行流程，插件采用了**异步缓冲 + 双重刷写策略**：

```typescript
// src/message-buffer.ts
export class MultiTableBuffer {
  // 每种 hook 类型有独立的缓冲区
  private buffers: Map<PluginHookName, Record<string, unknown>[]> = new Map();

  push(hookName: PluginHookName, row: Record<string, unknown>): void {
    let buffer = this.buffers.get(hookName);
    if (!buffer) {
      buffer = [];
      this.buffers.set(hookName, buffer);
    }
    buffer.push(row);

    // 策略1：达到批大小立即异步刷写
    if (buffer.length >= this.config.batchSize) {
      void this.flushTable(hookName);
    }
  }

  start(): void {
    // 策略2：定期刷写（兜底机制）
    this.timer = setInterval(() => {
      void this.flushAll();
    }, this.config.flushIntervalMs);
  }
}
```

- **阈值刷写**：单表缓冲行数达到 `batchSize`（默认 50）时立即触发异步刷写
- **定期刷写**：每 `flushIntervalMs`（默认 5000ms）刷写一次所有表
- **防溢出保护**：每表最多缓存 10000 行，超出后丢弃最旧数据

这种设计确保了 **hook 事件的处理不阻塞 Agent 主流程**，同时保证数据在秒级内到达 Fluss。

### N-API 原生绑定：高性能 Node.js ↔ Fluss 通信

Apache Fluss 不提供 REST API 或 Kafka 兼容协议，只能通过原生 RPC 访问。插件通过 **N-API 原生绑定**（基于 `fluss-node`，底层是 Rust 实现的 `fluss-rust`）直接在 Node.js 进程内调用 Fluss 客户端：

```
Node.js (OpenClaw)
    ↓ N-API 调用（进程内，零序列化开销）
fluss-node (Rust → N-API addon)
    ↓ Fluss RPC
Fluss Cluster (Coordinator + Tablet Servers)
```

相比 REST Proxy 或 Sidecar 方案，这种方式具有**最低延迟和最小部署复杂度**。

## Apache Fluss：为流式分析优化的实时存储

选择 Apache Fluss 而非 Kafka 作为中间存储层，原因在于：

1. **原生 Flink 集成**：Fluss 与 Flink 深度集成，Flink SQL 可以直接创建 Catalog 访问 Fluss 表，无需额外的 Connector 配置
2. **Log 表模型**：每种 hook 事件对应一张 Log 表，天然适合追加写入的事件流
3. **分布式分桶**：每张表按关键字段（如 `agent_id`、`tool_name`、`channel_id`）分桶，保证同一 Agent 或同一工具的事件在同一分区，便于聚合分析

### 14 张事件表

fluss-hook 为每种 hook 类型创建独立的 Fluss 表，以 `hook_` 为前缀。表的创建是**延迟的** -- 只在第一条事件到达时自动创建：

```
openclaw 数据库
├── hook_before_agent_start    (Agent 启动事件)
├── hook_agent_end             (Agent 完成事件)
├── hook_before_tool_call      (工具调用请求 -- 风控核心)
├── hook_after_tool_call       (工具调用结果)
├── hook_tool_result_persist   (工具结果持久化)
├── hook_message_received      (用户消息)
├── hook_session_start         (会话开始)
├── hook_gateway_start         (网关启动)
└── ...                        (共 14 张表)
```

以风控最核心的 `hook_before_tool_call` 表为例：

| 列名 | 类型 | 说明 |
|------|------|------|
| `tool_name` | STRING | 工具名称（execute_command, read_file, write_file, ...） |
| `params` | STRING | JSON 格式的工具调用参数 |
| `agent_id` | STRING | Agent 标识 |
| `session_key` | STRING | 会话标识 |
| `context_tool_name` | STRING | 上下文工具名 |
| `timestamp` | BIGINT | 事件时间戳（unix 毫秒） |

## Flink SQL 实时风控规则

这是整个架构中最具灵活性的部分。风控人员可以用标准 SQL 编写风控规则，通过 Flink 的流式执行引擎对 Agent 行为进行实时监控。

### 连接 Fluss

```sql
-- 创建 Fluss Catalog
CREATE CATALOG fluss_catalog WITH (
  'type' = 'fluss',
  'bootstrap.servers' = 'coordinator-server:9123'
);
USE CATALOG fluss_catalog;
USE openclaw;

-- 设置流式模式
SET 'execution.runtime-mode' = 'streaming';
SET 'sql-client.execution.result-mode' = 'changelog';
```

### 风控场景 1：危险命令实时检测

检测 Agent 执行的 shell 命令中是否包含高危操作：

```sql
-- 实时检测危险命令
SELECT tool_name,
       JSON_VALUE(params, '$.command') AS command,
       agent_id,
       session_key,
       `timestamp`
FROM hook_before_tool_call
  /*+ OPTIONS('scan.startup.mode'='latest') */
WHERE tool_name = 'execute_command'
  AND (
    JSON_VALUE(params, '$.command') LIKE '%rm -rf%'
    OR JSON_VALUE(params, '$.command') LIKE '%chmod 777%'
    OR JSON_VALUE(params, '$.command') LIKE '%curl%|%sh%'
    OR JSON_VALUE(params, '$.command') LIKE '%wget%|%bash%'
    OR JSON_VALUE(params, '$.command') LIKE '%>/dev/sd%'
    OR JSON_VALUE(params, '$.command') LIKE '%mkfs%'
    OR JSON_VALUE(params, '$.command') LIKE '%dd if=%'
  );
```

**典型告警场景**：
- Agent 试图执行 `rm -rf /` 删除根目录
- Agent 通过 `curl | sh` 下载并执行远程脚本
- Agent 使用 `chmod 777` 放开关键文件权限

### 风控场景 2：敏感文件访问监控

```sql
-- 监控对敏感路径的文件操作
SELECT tool_name,
       JSON_VALUE(params, '$.file_path') AS file_path,
       agent_id,
       session_key,
       `timestamp`
FROM hook_before_tool_call
  /*+ OPTIONS('scan.startup.mode'='latest') */
WHERE tool_name IN ('read_file', 'write_file', 'delete_file')
  AND (
    JSON_VALUE(params, '$.file_path') LIKE '%/.env%'
    OR JSON_VALUE(params, '$.file_path') LIKE '%/credentials%'
    OR JSON_VALUE(params, '$.file_path') LIKE '%/.ssh/%'
    OR JSON_VALUE(params, '$.file_path') LIKE '%/.aws/%'
    OR JSON_VALUE(params, '$.file_path') LIKE '%/etc/passwd%'
    OR JSON_VALUE(params, '$.file_path') LIKE '%/etc/shadow%'
  );
```

### 风控场景 3：Agent 异常行为检测

```sql
-- 检测短时间内高频工具调用（可能是 Agent 失控循环）
SELECT agent_id,
       session_key,
       COUNT(*) AS call_count,
       MIN(`timestamp`) AS first_call,
       MAX(`timestamp`) AS last_call
FROM hook_before_tool_call
  /*+ OPTIONS('scan.startup.mode'='latest') */
GROUP BY agent_id, session_key
HAVING COUNT(*) > 50;
```

```sql
-- 检测执行耗时异常的工具调用（可能是资源耗尽攻击）
SELECT tool_name,
       duration_ms,
       agent_id,
       JSON_VALUE(params, '$.command') AS command,
       `timestamp`
FROM hook_after_tool_call
  /*+ OPTIONS('scan.startup.mode'='latest') */
WHERE duration_ms > 60000;  -- 超过 60 秒的工具调用
```

### 风控场景 4：Agent 成功率异常监控

```sql
-- 实时聚合 Agent 成功率，识别异常 Agent
SELECT agent_id,
       COUNT(*) AS total,
       SUM(CASE WHEN success THEN 1 ELSE 0 END) AS succeeded,
       SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) AS failed,
       CAST(SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) AS DOUBLE)
         / COUNT(*) AS failure_rate
FROM hook_agent_end
  /*+ OPTIONS('scan.startup.mode'='latest') */
GROUP BY agent_id
HAVING CAST(SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) AS DOUBLE)
         / COUNT(*) > 0.5;  -- 失败率超过 50%
```

### 风控场景 5：用户输入异常检测

```sql
-- 检测可能的 prompt 注入攻击
SELECT from_id,
       content,
       channel_id,
       `timestamp`
FROM hook_message_received
  /*+ OPTIONS('scan.startup.mode'='latest') */
WHERE content LIKE '%ignore previous instructions%'
   OR content LIKE '%忽略之前的指令%'
   OR content LIKE '%system prompt%'
   OR content LIKE '%DAN mode%'
   OR content LIKE '%jailbreak%';
```

### 风控场景 6：会话行为画像

```sql
-- 检测异常会话模式（超长会话 + 大量消息）
SELECT session_id,
       message_count,
       duration_ms,
       duration_ms / 1000 / 60 AS duration_min,
       agent_id,
       `timestamp`
FROM hook_session_end
  /*+ OPTIONS('scan.startup.mode'='latest') */
WHERE message_count > 100        -- 消息数超过 100
   OR duration_ms > 3600000;     -- 会话超过 1 小时
```

### 风控场景 7：工具使用频率异常

```sql
-- 实时统计工具使用频率，发现异常工具调用模式
SELECT tool_name,
       COUNT(*) AS call_count
FROM hook_before_tool_call
  /*+ OPTIONS('scan.startup.mode'='latest') */
GROUP BY tool_name
HAVING COUNT(*) > 100;
```

## 快速体验：Docker 一键部署

项目提供了完整的 Docker Compose 演示环境，包含 6 个服务：

```
┌─────────────────────────────────────────────────┐
│                Docker Compose                    │
│                                                  │
│  ┌──────────┐  ┌─────────────┐  ┌────────────┐ │
│  │ZooKeeper │  │ Coordinator │  │   Tablet   │ │
│  │          │──│   Server    │──│   Server   │ │
│  └──────────┘  └─────────────┘  └────────────┘ │
│                                                  │
│  ┌──────────┐  ┌─────────────┐                  │
│  │   Flink  │  │    Flink    │                  │
│  │JobManager│──│ TaskManager │                  │
│  │  :8083   │  │             │                  │
│  └──────────┘  └─────────────┘                  │
│                                                  │
│  ┌──────────────────────────────┐               │
│  │      OpenClaw Gateway        │               │
│  │   + fluss-hook plugin :18789 │               │
│  └──────────────────────────────┘               │
└─────────────────────────────────────────────────┘
```

### 启动步骤

```bash
# 1. 克隆项目
git clone https://github.com/example/openclaw-fluss-hook
cd openclaw-fluss-hook/demo

# 2. 编译 fluss-node（仅首次）
./scripts/build-fluss-node.sh

# 3. 下载 Flink Connector JAR
./scripts/setup.sh

# 4. 配置 LLM API Key
echo "BAILIAN_API_KEY=sk-your-key" > .env

# 5. 构建并启动
./scripts/build.sh
docker compose up -d

# 6. 验证服务
docker compose logs openclaw | grep fluss-hook
# 期望输出: [fluss-hook] Plugin registered (14 hooks)
```

### 体验风控

**Step 1: 与 AI Agent 对话**

打开 http://localhost:18789，发送一些消息，让 Agent 执行一些工具调用。

**Step 2: 打开 Flink SQL Client**

```bash
docker compose exec jobmanager ./bin/sql-client.sh
```

**Step 3: 执行风控查询**

```sql
-- 初始化
CREATE CATALOG fluss_catalog WITH (
  'type' = 'fluss',
  'bootstrap.servers' = 'coordinator-server:9123'
);
USE CATALOG fluss_catalog;
USE openclaw;
SET 'execution.runtime-mode' = 'streaming';
SET 'sql-client.execution.result-mode' = 'changelog';

-- 实时监控所有工具调用
SELECT tool_name,
       JSON_VALUE(params, '$.command') AS command,
       agent_id,
       `timestamp`
FROM hook_before_tool_call
  /*+ OPTIONS('scan.startup.mode'='earliest') */;
```

保持这个查询运行，然后回到 OpenClaw 继续对话。每一次 Agent 的工具调用都会在 Flink SQL Client 中实时显示，延迟通常在秒级以内。

## 关键设计决策

### 为什么选择 Fluss 而不是 Kafka？

| 维度 | Apache Fluss | Apache Kafka |
|------|-------------|-------------|
| Flink 集成 | 原生 Catalog，直接 SQL 查询 | 需要 Connector + Schema Registry |
| 表模型 | Log 表，天然适合事件流 | Topic，需要额外的 Schema 管理 |
| 部署复杂度 | Coordinator + Tablet Server | Broker + ZooKeeper/KRaft |
| 生态成熟度 | 较新（Apache 孵化中） | 非常成熟 |

在 AI Agent 风控这个场景下，Fluss 的**原生 Flink 集成**是决定性优势 -- 风控人员可以直接用 SQL 编写规则，不需要关心底层数据格式转换。

### 为什么选择 N-API 而不是 REST Proxy？

| 方案 | 延迟 | 部署复杂度 | 维护成本 |
|------|------|-----------|---------|
| N-API 原生绑定 | ~1ms（进程内调用） | 低（单进程） | 中（需要跨平台编译） |
| REST Proxy | ~10ms（HTTP 往返） | 高（额外服务） | 低 |
| Sidecar | ~5ms（本地通信） | 高（额外容器） | 中 |

对于风控场景，**低延迟**意味着更快地发现风险。N-API 方案在 Agent 主流程内以微秒级开销完成数据采集，对用户体验几乎零影响。

### 为什么每种 hook 独立一张表？

- **查询效率**：风控规则通常只关心特定类型的事件（如工具调用），独立表避免了全量扫描
- **Schema 清晰**：每张表有明确的字段定义，便于 Flink SQL 解析 JSON 字段
- **弹性伸缩**：高频表（如 `hook_before_tool_call`）和低频表（如 `hook_gateway_start`）可以独立配置分区数

## 生产环境部署建议

### 独立部署架构

在生产环境中，建议将 Fluss + Flink 集群与 OpenClaw 分离部署：

```
┌─────────────────────┐      ┌──────────────────────────┐
│    OpenClaw 集群     │      │    风控分析集群            │
│                     │      │                          │
│  OpenClaw Server 1  │─────►│  Fluss Coordinator       │
│  + fluss-hook       │      │  Fluss Tablet Server x N │
│                     │      │                          │
│  OpenClaw Server 2  │─────►│  Flink JobManager        │
│  + fluss-hook       │      │  Flink TaskManager x M   │
│                     │      │                          │
│  ...                │      │  告警服务                  │
└─────────────────────┘      └──────────────────────────┘
```

### 插件配置

```json
{
  "plugins": {
    "entries": {
      "fluss-hook": {
        "enabled": true,
        "config": {
          "bootstrapServers": "fluss-coordinator.prod:9223",
          "databaseName": "openclaw",
          "tablePrefix": "hook_",
          "batchSize": 100,
          "flushIntervalMs": 3000,
          "autoCreateTable": true,
          "bucketCount": 8
        }
      }
    }
  }
}
```

生产环境建议：
- `batchSize` 调大至 100-200，减少网络往返
- `flushIntervalMs` 根据风控实时性要求调整（3-10 秒）
- `bucketCount` 根据 Tablet Server 数量和吞吐量设置

### 告警集成

Flink SQL 的查询结果可以通过多种方式接入告警系统：

1. **Flink Sink 到外部系统**：将风控规则的输出 Sink 到 Kafka/HTTP/数据库，由下游告警服务消费
2. **Webhook 回调**：Flink UDF 直接调用告警 API（如钉钉、飞书、PagerDuty）
3. **与 OpenClaw 闭环**：将风控信号写回 OpenClaw，实现自动打断危险操作

## 总结

本文介绍了一种基于 **OpenClaw + Apache Fluss + Apache Flink** 的 AI Agent 实时风控方案：

- **OpenClaw 的 14 种 hook 事件**提供了 Agent 行为的全量审计数据
- **fluss-hook 插件**以零侵入方式实时采集数据，不影响 Agent 执行性能
- **Fluss 流式存储**按事件类型分表，与 Flink 原生集成
- **Flink SQL**让风控人员用标准 SQL 编写实时规则，门槛低、灵活性高

这套架构的核心优势在于**关注点分离**：

- **Agent 开发者**只需启用 fluss-hook 插件，无需修改任何业务代码
- **风控人员**只需编写 SQL 规则，无需了解 Agent 内部实现
- **运维人员**管理独立的 Fluss + Flink 集群，不影响 Agent 服务的稳定性

当 AI Agent 从实验室走向生产环境，实时风控不再是可选项，而是必要的安全基础设施。OpenClaw 的 hook 机制为风控数据采集提供了标准化的接口，Fluss + Flink 的组合则为实时分析和规则引擎提供了高性能的基础。
