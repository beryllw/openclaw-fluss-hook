# OpenClaw 本地部署（非 Docker）

在 Linux 服务器上直接安装运行 OpenClaw Gateway，预装 fluss-hook 和 DingTalk 插件。

## 架构

```
  Fluss + Flink 集群 (deploy/)          本机 (deploy-local/)
┌──────────────────────────┐      ┌──────────────────────────────────┐
│  ZooKeeper               │      │  OpenClaw Gateway :18789         │
│  Fluss Coordinator :9123 │◄────►│    ├─ fluss-hook plugin          │
│  Fluss Tablet     :9124  │      │    ├─ DingTalk 插件 (可选)        │
│  Flink JobManager :8081  │      │    ├─ Bailian 模型               │
│  Flink TaskManager       │      │    └─ DingTalk 机器人 (可选)      │
└──────────────────────────┘      └──────────────────────────────────┘
```

## 前提条件

- Linux x86_64 服务器
- Node.js >= 22
- npm
- curl、unzip（如需自动下载 fluss-node artifact）
- 已通过 `deploy/` 部署好的 Fluss + Flink 集群

## 快速开始

### 1. 获取 fluss-node

fluss-node 有三种获取方式（任选其一）：

**方式 A：浏览器手动下载（最简单）**

1. 打开 https://github.com/beryllw/fluss-rust/actions/runs/23797039549/artifacts/6199122460
2. 登录 GitHub 后点击下载，得到 zip 文件
3. 将 zip 文件放到 `deploy-local/` 目录下

**方式 B：curl 命令行下载**

需要一个 GitHub Personal Access Token（在 https://github.com/settings/tokens 生成，公开仓库无需勾选任何 scope）：

```bash
curl -L \
  -H "Authorization: Bearer ghp_你的token" \
  -H "Accept: application/vnd.github+json" \
  -o fluss-node.zip \
  "https://api.github.com/repos/beryllw/fluss-rust/actions/artifacts/6199122460/zip"
```

**方式 C：已有编译好的 fluss-node 目录**

如果之前已经编译/下载过，直接通过 `--fluss-node-dir` 参数指定即可。

### 2. 运行安装脚本

```bash
cd deploy-local

# 方式 A：使用手动下载的 zip
./scripts/setup.sh --fluss-node-zip ./fluss-node.zip

# 方式 B：自动下载（需提供 GitHub token）
./scripts/setup.sh --github-token ghp_你的token

# 方式 C：使用已有目录
./scripts/setup.sh --fluss-node-dir /path/to/fluss-node-lib
```

常用附加选项：

```bash
# 使用国内 npm 镜像
./scripts/setup.sh --fluss-node-zip ./fluss-node.zip --registry https://registry.npmmirror.com

# 跳过 DingTalk 插件
./scripts/setup.sh --fluss-node-zip ./fluss-node.zip --skip-dingtalk

# 重新安装（覆盖已有文件）
./scripts/setup.sh --fluss-node-zip ./fluss-node.zip --force
```

### 3. 配置环境变量

编辑 `.env` 文件：

```bash
vi .env
```

```bash
# 必填
BAILIAN_API_KEY=sk-your-api-key          # 百炼 API Key
OPENCLAW_GATEWAY_TOKEN=your-token         # Gateway 认证 Token
FLUSS_BOOTSTRAP_SERVERS=192.168.1.100:9123  # Fluss 集群地址

# 可选 - DingTalk 机器人
DINGTALK_CLIENT_ID=dingxxxxxxxxx          # 钉钉应用 AppKey
DINGTALK_CLIENT_SECRET=your-app-secret    # 钉钉应用 AppSecret
```

### 4. 启动

```bash
# 前台运行（可查看实时日志）
./scripts/start.sh

# 后台运行
./scripts/start.sh --background

# 查看后台日志
tail -f openclaw-gateway.log

# 停止后台进程
./scripts/start.sh --stop
```

### 5. 验证

启动后应看到类似日志：

```
[fluss-hook] Plugin registered (14 hooks)
[fluss-hook] Connected to Fluss at 192.168.1.100:9123
```

## 目录结构

```
deploy-local/
├── .env.example           # 环境变量模板
├── .env                   # 实际环境变量（安装时生成，不提交 git）
├── package.json           # openclaw npm 依赖
├── node_modules/          # openclaw 安装目录（npm install 生成）
├── config/
│   └── openclaw.json      # 配置模板（setup 时自动填充路径后写入 ~/.openclaw/）
├── scripts/
│   ├── setup.sh           # 一键安装脚本
│   └── start.sh           # 启动/停止脚本
└── INSTALL.md             # 本文档
```

fluss-node 预编译产物存放在项目根目录 `fluss-node-lib/`（zip 文件）。

安装完成后，以下文件会写入 `~/.openclaw/`：

```
~/.openclaw/
├── openclaw.json          # 主配置（百炼模型 + fluss-hook + DingTalk + gateway）
└── plugins/
    ├── fluss-hook/        # 插件源码 + fluss-node 符号链接
    └── dingtalk-connector/  # DingTalk 通道插件（可选）
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `BAILIAN_API_KEY` | 是 | 阿里云百炼 (DashScope) API Key |
| `OPENCLAW_GATEWAY_TOKEN` | 是 | Gateway 认证 Token，客户端连接时使用 |
| `FLUSS_BOOTSTRAP_SERVERS` | 是 | 外部 Fluss 集群地址 (如 `192.168.1.100:9123`) |
| `OPENCLAW_BIND` | 否 | Gateway 监听模式：`loopback`/`lan`/`tailnet`/`auto`/`custom`（默认 `lan`） |
| `DINGTALK_CLIENT_ID` | 否 | 钉钉开放平台应用 AppKey |
| `DINGTALK_CLIENT_SECRET` | 否 | 钉钉开放平台应用 AppSecret |

## DingTalk 机器人配置

1. 登录 [钉钉开放平台](https://open-dev.dingtalk.com/)
2. 创建企业内部应用，获取 AppKey 和 AppSecret
3. 在应用中启用「机器人」能力
4. 将 AppKey 和 AppSecret 填入 `.env` 文件

钉钉插件使用 Stream 模式，无需公网 IP 或 Webhook 配置。

## 常见问题

### npm install 超时或失败

使用国内镜像：

```bash
./scripts/setup.sh --fluss-node-zip ./fluss-node.zip --registry https://registry.npmmirror.com
```

### artifact 下载失败

- GitHub Actions artifact 有 90 天有效期，过期后需要重新触发 CI 构建
- 确保 GitHub token 有效（公开仓库无需特殊 scope）
- 也可以直接在浏览器中登录 GitHub 下载 artifact zip，然后使用 `--fluss-node-zip` 参数

### DingTalk 插件安装失败

可以跳过后单独安装：

```bash
./scripts/setup.sh --fluss-node-zip ./fluss-node.zip --skip-dingtalk
# 之后手动安装:
cd ~/.openclaw/plugins/dingtalk-connector
npm init -y && npm install @dingtalk-real-ai/dingtalk-connector --registry https://registry.npmmirror.com
# 将 node_modules 下的插件文件复制到目录根
DTSRC=node_modules/@dingtalk-real-ai/dingtalk-connector
cp "$DTSRC/openclaw.plugin.json" "$DTSRC/index.ts" . && cp -r "$DTSRC/src" .
```

### 更新 fluss-hook 插件

修改项目源码后重新安装：

```bash
./scripts/setup.sh --fluss-node-dir ./fluss-node-lib --force
```

### 端口冲突

OpenClaw Gateway 默认监听 `18789` 端口。确保该端口未被占用：

```bash
ss -tlnp | grep 18789
```
