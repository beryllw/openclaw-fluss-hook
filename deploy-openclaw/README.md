# OpenClaw 独立部署

独立部署 OpenClaw Gateway，预装 fluss-hook 和 DingTalk 插件，连接外部 Fluss + Flink 集群。

## 架构

```
  机器 A (deploy/)                    机器 B (deploy-openclaw/)
┌──────────────────────────┐      ┌──────────────────────────────────┐
│  ZooKeeper               │      │  OpenClaw Gateway :18789         │
│  Fluss Coordinator :9123 │◄────►│    ├─ fluss-hook plugin (预装)    │
│  Fluss Tablet     :9124  │      │    ├─ DingTalk 插件 (预装)        │
│  Flink JobManager :8081  │      │    ├─ Bailian 模型               │
│  Flink TaskManager       │      │    └─ DingTalk 机器人 (可选配置)  │
└──────────────────────────┘      └──────────────────────────────────┘
```

## 前提条件

- Linux 服务器（使用 host 网络模式，不适用 macOS/Windows Docker Desktop）
- Docker 或 Podman
- 已通过 `deploy/` 部署好的 Fluss + Flink 集群

## 快速开始

### 1. 初始化

```bash
./scripts/setup.sh
```

此脚本会：
- 从 `.env.example` 创建 `.env` 文件
- 检查 `fluss-node-lib/linux-x64-gnu/` 是否存在

### 2. 配置环境变量

编辑 `.env` 文件：

```bash
# 必填
BAILIAN_API_KEY=sk-your-api-key          # 百炼 API Key
OPENCLAW_GATEWAY_TOKEN=your-token         # Gateway 认证 Token
FLUSS_BOOTSTRAP_SERVERS=192.168.1.100:9123  # Fluss 集群地址

# 可选 - DingTalk 机器人
DINGTALK_CLIENT_ID=dingxxxxxxxxx          # 钉钉应用 AppKey
DINGTALK_CLIENT_SECRET=your-app-secret    # 钉钉应用 AppSecret
```

### 3. 准备 fluss-node（如首次构建）

```bash
# 从项目根目录执行：从预编译 zip 解压 Linux 二进制
./scripts/prepare-fluss-node.sh
```

### 4. 构建镜像

```bash
./scripts/build.sh
```

> 如果 `fluss-node-lib/linux-x64-gnu/` 不存在，`build.sh` 会自动从预编译 zip 解压或从源码编译。
> 如需手动编译指定版本：`./scripts/build-fluss-node.sh --output-dir fluss-node-lib/linux-x64-gnu --ref v1.1.0`（从项目根目录执行）

### 5. 启动

```bash
docker compose up -d
```

### 5. 验证

```bash
# 查看日志
docker compose logs -f openclaw

# 预期输出:
#   [fluss-hook] Plugin registered (14 hooks)
#   [fluss-hook] Connected to Fluss at <FLUSS_BOOTSTRAP_SERVERS>
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `BAILIAN_API_KEY` | 是 | 阿里云百炼 (DashScope) API Key |
| `OPENCLAW_GATEWAY_TOKEN` | 是 | Gateway 认证 Token，客户端连接时使用 |
| `FLUSS_BOOTSTRAP_SERVERS` | 是 | 外部 Fluss 集群地址 (如 `192.168.1.100:9123`) |
| `DINGTALK_CLIENT_ID` | 否 | 钉钉开放平台应用 AppKey |
| `DINGTALK_CLIENT_SECRET` | 否 | 钉钉开放平台应用 AppSecret |

## DingTalk 机器人配置

1. 登录 [钉钉开放平台](https://open-dev.dingtalk.com/)
2. 创建企业内部应用，获取 AppKey 和 AppSecret
3. 在应用中启用「机器人」能力
4. 将 AppKey 和 AppSecret 填入 `.env` 文件的 `DINGTALK_CLIENT_ID` 和 `DINGTALK_CLIENT_SECRET`

钉钉插件使用 Stream 模式，无需公网 IP 或 Webhook 配置。

## 与 deploy/ 配合使用

本目录部署 OpenClaw Gateway，`deploy/` 目录部署 Fluss + Flink 集群：

```bash
# 在 Fluss 服务器上
cd deploy
./scripts/setup.sh
# 编辑 .env，设置 HOST_IP
docker compose up -d

# 在 OpenClaw 服务器上（先准备 fluss-node）
./scripts/prepare-fluss-node.sh    # 从项目根目录执行
cd deploy-openclaw
./scripts/setup.sh
# 编辑 .env，设置 FLUSS_BOOTSTRAP_SERVERS 为 Fluss 服务器 IP:9123
./scripts/build.sh     # 构建镜像
docker compose up -d
```

## 常用命令

```bash
# 启动
docker compose up -d

# 查看状态
docker compose ps

# 查看日志
docker compose logs -f openclaw

# 停止
docker compose down

# 重新构建并启动
./scripts/build.sh && docker compose up -d
```

## 网络要求

此部署使用 `network_mode: host`（主机网络模式）：

- **适用**: Linux 服务器部署
- **不适用**: macOS / Windows Docker Desktop
- OpenClaw Gateway 默认监听端口 `18789`
- 确保防火墙允许端口 `18789` 的入站连接
- 确保能访问 Fluss 集群的 `9123` 和 `9124` 端口
