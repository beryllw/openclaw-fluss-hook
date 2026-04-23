# 项目手册

## 项目结构

```
openclaw-fluss-hook/
├── src/                          # 核心源码
│   ├── config.ts                 # 配置解析
│   ├── event-mappers.ts          # Hook 事件 → Fluss 表字段映射
│   ├── fluss-client.ts           # Fluss Gateway REST API 客户端
│   ├── message-buffer.ts         # 多表批量缓冲写入
│   ├── schema.ts                 # 14 张表 schema 定义
│   ├── sink.ts                   # Sink 编排
│   └── types.ts                  # 类型定义（对齐 openclaw）
├── __test__/                     # 测试
│   ├── config.test.ts
│   ├── event-mappers.test.ts     # 含 schema-mapper 对齐检查
│   ├── message-buffer.test.ts
│   ├── plugin-e2e.test.ts
│   ├── plugin-register.test.ts
│   └── integration.test.ts       # 需要 Docker + podman compose
├── demo/                         # 全栈演示（Fluss + Flink + OpenClaw Docker Compose）
│   ├── docker-compose.yml
│   ├── Dockerfile.openclaw
│   ├── config/openclaw.json
│   └── scripts/                  # SQL 示例和构建脚本
├── docs/                         # 文档
│   └── plugin-hook-events.md     # 14 种 Hook 事件详解
├── scripts/
│   ├── install.sh                # 安装脚本
│   └── package-release.sh        # 发布打包脚本
├── index.ts                      # 插件入口
├── openclaw.plugin.json          # OpenClaw 插件清单
├── docker-compose.integration.yml # 集成测试基础设施
└── .github/workflows/
    ├── ci.yml                    # CI
    └── release.yml               # Release 打包上传
```

---

## 开发指南

### 环境要求

- Node.js 22+
- pnpm 10+

### 安装依赖

```bash
pnpm install
```

### 测试

```bash
# TypeScript 类型检查
pnpm typecheck

# 单元测试（86 个测试，无需 Docker）
pnpm vitest run --exclude '__test__/integration.test.ts'

# 监听模式
pnpm vitest

# 集成测试（需要 Docker + podman compose，会启动 Fluss 集群）
pnpm vitest run __test__/integration.test.ts
```

### 提交代码

```bash
pnpm typecheck
pnpm vitest run --exclude '__test__/integration.test.ts'
git add -A
git commit -m "type: description"
```

---

## CI/CD 流程

### Pull Request / Push to main

GitHub Actions 自动执行：
1. checkout
2. setup Node.js 22 + pnpm 10
3. `pnpm install --frozen-lockfile`
4. `pnpm typecheck`
5. `pnpm vitest run`（排除集成测试）

### 发布 Release

在 GitHub 上创建 Release 后，自动打包并上传 tarball 附件：

```bash
# 方法一：GitHub CLI
gh release create v0.2.0 --generate-notes

# 方法二：GitHub 网页操作
# 1. 打开仓库 → Releases → Draft a new release
# 2. 填 tag（如 v0.2.0）、标题
# 3. 点击 Publish release
```

发布后 Actions 自动：
1. 等待 test job 通过
2. 运行 `scripts/package-release.sh` 打包
3. 用 `softprops/action-gh-release` 上传 tarball 到 Release 附件

---

## 安装指南

### 前置条件

1. **OpenClaw** 已安装并运行
2. **Apache Fluss 集群** 已部署（Gateway REST API 可访问）

### 方式一：从 GitHub Release 安装

```bash
# 1. 下载 release 包（替换版本号）
VERSION=v0.2.0
curl -LO "https://github.com/yourname/openclaw-fluss-hook/releases/download/${VERSION}/fluss-hook-${VERSION}.tar.gz"

# 2. 解压
tar xzf fluss-hook-${VERSION}.tar.gz
cd fluss-hook-${VERSION}

# 3. 安装到 OpenClaw（替换你的 OpenClaw 数据目录）
./install.sh ~/.openclaw --gateway-url http://localhost:8080

# 4. 配置 openclaw.json 添加插件条目：
#    "plugins": {
#      "entries": {
#        "fluss-hook": {
#          "enabled": true,
#          "config": {
#            "gatewayUrl": "http://localhost:8080"
#          }
#        }
#      }
#    }

# 5. 重启 OpenClaw
```

### 方式二：从源码安装（开发者）

```bash
git clone https://github.com/yourname/openclaw-fluss-hook.git
cd openclaw-fluss-hook

# 安装到 OpenClaw
./scripts/install.sh ~/.openclaw --gateway-url http://localhost:8080
```

---

## Demo 快速开始

### 本地开发环境（Docker Compose）

包含 6 个服务：ZooKeeper、Fluss Coordinator、Fluss Tablet Server、Flink JobManager、Flink TaskManager、OpenClaw

```bash
cd demo

# 1. 准备 Flink connector JAR
./scripts/setup.sh

# 2. 启动全部服务
docker compose up -d

# 3. 访问 Flink SQL UI
open http://localhost:8083

# 4. 停止
docker compose down
```

详见 [demo/README.md](demo/README.md)。

---

## 配置参考

### openclaw.json 插件配置

```json
{
  "plugins": {
    "entries": {
      "fluss-hook": {
        "enabled": true,
        "config": {
          "gatewayUrl": "http://localhost:8080",
          "gatewayUsername": "",
          "gatewayPassword": "",
          "databaseName": "openclaw_hooks",
          "tablePrefix": "hook_",
          "batchSize": 100,
          "flushIntervalMs": 1000,
          "autoCreateTable": true,
          "bucketCount": 1
        }
      }
    }
  }
}
```

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `gatewayUrl` | (必填) | Fluss Gateway REST API 地址 |
| `gatewayUsername` | - | Basic Auth 用户名（可选） |
| `gatewayPassword` | - | Basic Auth 密码（可选） |
| `databaseName` | `openclaw_hooks` | Fluss 数据库名 |
| `tablePrefix` | `hook_` | 表名前缀 |
| `batchSize` | `100` | 每表批量刷新阈值（行数） |
| `flushIntervalMs` | `1000` | 批量刷新间隔（毫秒） |
| `autoCreateTable` | `true` | 自动创建数据库和表 |
| `bucketCount` | `1` | 表分桶数 |

---

## Hook 事件说明

插件捕获 14 种 OpenClaw Hook 事件，每种写入独立的 Fluss 表：

| Hook 名称 | 触发时机 | 表名示例 |
|-----------|---------|---------|
| `before_agent_start` | Agent 启动前，prompt 已构建 | `hook_before_agent_start` |
| `agent_end` | Agent 执行完成 | `hook_agent_end` |
| `before_compaction` | 上下文压缩开始前 | `hook_before_compaction` |
| `after_compaction` | 上下文压缩完成后 | `hook_after_compaction` |
| `message_received` | 收到入站消息 | `hook_message_received` |
| `message_sending` | 消息即将发送 | `hook_message_sending` |
| `message_sent` | 消息发送完成 | `hook_message_sent` |
| `before_tool_call` | 工具调用执行前 | `hook_before_tool_call` |
| `after_tool_call` | 工具调用完成后 | `hook_after_tool_call` |
| `tool_result_persist` | 工具结果持久化时 | `hook_tool_result_persist` |
| `session_start` | 会话创建/恢复 | `hook_session_start` |
| `session_end` | 会话结束 | `hook_session_end` |
| `gateway_start` | Gateway 启动 | `hook_gateway_start` |
| `gateway_stop` | Gateway 停止 | `hook_gateway_stop` |

详见 [docs/plugin-hook-events.md](docs/plugin-hook-events.md)。

---

## 架构概览

```
User --> OpenClaw Gateway --> fluss-hook --> Fluss Gateway --> Fluss Cluster <-- Flink SQL
              :18789          (14 hooks)     REST API :8080   coordinator:9123    :8083
```

1. **OpenClaw Gateway** 在 14 个生命周期节点触发 Hook
2. **fluss-hook 插件** 拦截事件，通过 event-mappers 映射为 Fluss 表字段
3. **MessageBuffer** 多表批量缓冲，达到 batchSize 或 flushIntervalMs 时刷新
4. **GatewayClient** 通过 Fluss Gateway REST API 写入数据
5. **Flink SQL** 从 Fluss 表读取数据，执行实时风控分析

---

## 故障排查

### 插件未加载

```bash
# 检查 OpenClaw 日志
openclaw log | grep fluss-hook
# 应看到: [fluss-hook] Plugin registered (14 hooks)
```

### Fluss 连接失败

```bash
# 检查 Gateway 是否可访问
curl -u admin:password http://localhost:8080/v1/

# 检查数据库是否存在
curl -u admin:password http://localhost:8080/v1/_databases
```

### 表未创建

确保 `autoCreateTable: true`，或手动创建数据库和表。
