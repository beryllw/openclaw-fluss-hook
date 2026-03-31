# OpenClaw Fluss Hook - 方案调研与架构分析

## Context

目标：实现一个 OpenClaw 插件，将用户与 Agent 的所有交互记录实时写入 Apache Fluss Log 表，支撑后续 Flink SQL 流式分析。

核心挑战：**OpenClaw 是 TypeScript/Node.js 平台（Node >= 22），Fluss 是 Rust/Java 实现的分布式流式存储系统，两者之间需要一个桥接层。**

本文档聚焦于桥接层的技术选型调研和架构对比，不涉及具体实现细节。

---

## 一、Fluss 数据写入通道调研

### 1.1 Fluss 原生 RPC 协议

Fluss 的核心通信方式是基于 Netty 的自定义 RPC 协议（非 HTTP）。

- 客户端通过 `ProduceLogRequest` 将数据发送到 TabletServer
- 内部流程: `AppendWriter.append()` → `RecordAccumulator` 批处理 → `Sender` 后台线程 → RPC 发送
- 支持幂等写入（WriterID + BatchSequence 去重）、acks 确认级别
- 协议定义: `/fluss-rpc/` 目录，基于 Protobuf

**结论: 无法直接从 Node.js/TypeScript 使用，需要通过客户端库封装。**

### 1.2 Fluss REST API

**不存在。** 在 fluss-community 和 fluss-rust 两个代码库中均无 HTTP/REST 服务器实现。

- fluss-rust 无任何 web 框架依赖（无 axum/actix/warp/rocket）
- fluss-community 的 Gateway 全部是内部 RPC Gateway（AdminGateway, TabletServerGateway, CoordinatorGateway）
- 无 REST endpoint 暴露

### 1.3 Fluss Kafka 协议兼容层

位于 `/fluss-community/fluss-kafka/`，代码框架已建立但 **PRODUCE 功能未实现**：

| API | 实现状态 | 说明 |
|-----|---------|------|
| API_VERSIONS | 已实现 | 版本协商正常 |
| METADATA | 空实现 | 无法获取 topic 元数据 |
| **PRODUCE** | **空实现** | `handleProducerRequest()` 方法体为空（第187行） |
| FETCH | 空实现 | 无法消费数据 |
| 其他 20+ API | 空实现 | 消费者组、事务等均不可用 |

- 官方文档标注: *"Kafka protocol compatibility is still in development"*
- 配置项 `kafka.enabled` 默认为 `false`

**结论: 无法通过 Kafka 客户端（如 kafkajs）写入 Fluss。**

### 1.4 Kafka REST Proxy

Confluent Kafka REST Proxy 提供 HTTP 接口写入 Kafka topic：

```
POST /topics/{topic_name}
Content-Type: application/vnd.kafka.json.v2+json

{ "records": [{ "key": "k1", "value": { ... } }] }
```

支持批量发送、Avro/JSON/Protobuf 序列化、认证。

**但此方案的前提是 Fluss 能作为 Kafka 兼容的 broker 接收 PRODUCE 请求 —— 当前不成立。**

### 1.5 可用客户端库总览

fluss-rust 项目提供了以下语言的客户端：

| 客户端 | 位置 | 技术栈 | 状态 |
|--------|------|--------|------|
| Rust | `/fluss-rust/crates/fluss/` | 原生 Rust 库 | 完整，生产就绪 |
| Java | `/fluss-community/fluss-client/` | 原生 Java 库 | 完整，生产就绪 |
| Python | `/fluss-rust/bindings/python/` | PyO3 FFI 绑定 | 完整，支持 PyArrow/Pandas |
| Node.js | `/fluss-rust/bindings/node/` | napi-rs 绑定 | 完整，需编译原生模块 |
| C++ | `/fluss-rust/bindings/cpp/` | cxx FFI 绑定 | 完整 |

**注意: 无 CLI 工具。** fluss-rust 中没有 `[[bin]]` 入口，没有 `main.rs`，纯库项目。

---

## 二、桥接方案架构对比

基于上述调研，从 Node.js/TypeScript（OpenClaw）写入 Fluss 有以下可行和不可行的方案：

### 方案 A: fluss-node N-API 原生绑定

```
OpenClaw (Node.js) ---> fluss-node (.node addon) ---> Fluss RPC ---> Fluss Cluster
                         napi-rs / Tokio runtime
```

**技术实现:**
- 使用 napi-rs 将 fluss-rust 封装为 Node.js 原生模块（`.node` 文件）
- 全局 Tokio 多线程运行时处理异步操作
- JS 对象通过 `serde_json::Value` 中转，转换为 Fluss GenericRow
- 直接在 Node.js 进程内调用，无进程间通信开销

**API 示例（参考现有 bindings/node 的设计）:**
```javascript
const conn = await FlussConnection.create(config);
const table = await conn.getTable(tablePath);
const writer = table.newAppend().createWriter();
writer.append({ col1: "value1", col2: 123 }); // fire-and-forget
await writer.flush();
```

**优点:**
- 原生性能，零序列化开销（进程内调用）
- 完整的 Fluss API 暴露（Admin、Schema、Write、Read）
- 类型安全（TypeScript `.d.ts` 自动生成）
- fluss-rust 内置批处理和重试机制（RecordAccumulator）
- 已有参考实现，14 种数据类型的双向转换已处理

**缺点:**
- 需要为每个目标平台编译原生模块（darwin-arm64, linux-x64 等）
- 部署时需要匹配的 libc 版本（musl vs glibc）
- Docker 构建流程复杂（交叉编译或容器内编译）
- 如果 napi-rs 或 fluss-rust 版本升级，需要重新编译
- 原生模块崩溃可能导致整个 Node.js 进程崩溃

**复杂度:** 中高（主要在编译和跨平台部署）

---

### 方案 B: Rust Sidecar REST 服务

```
OpenClaw (Node.js) --HTTP/JSON--> Rust REST Server ---> Fluss RPC ---> Fluss Cluster
                                  (axum/actix)
                                  独立进程
```

**技术实现:**
- 用 Rust 编写一个轻量 HTTP 服务（基于 axum 或 actix-web）
- 内部使用 fluss-rust 客户端写入 Fluss
- 暴露简单的 REST 端点（如 `POST /append`）
- OpenClaw 插件通过 `fetch()` 调用

**API 示例:**
```
POST http://localhost:8080/append
Content-Type: application/json

{
  "database": "openclaw",
  "table": "message_logs", 
  "rows": [
    { "direction": "inbound", "content": "Hello", "timestamp": 1700000000 }
  ]
}
```

**优点:**
- OpenClaw 侧纯 TypeScript，无原生依赖，`fetch()` 即可调用
- 进程隔离，sidecar 崩溃不影响 OpenClaw
- 跨语言通用，其他服务也可以调用
- 部署灵活（独立容器、同一 Pod 的 sidecar）
- 可以独立升级和扩展

**缺点:**
- 额外的网络开销（HTTP 序列化/反序列化 + TCP 往返）
- 需要部署和运维额外的服务
- 需要处理 sidecar 的健康检查、重启、端口管理
- 每次请求的 JSON 序列化开销
- 需要实现自己的批处理逻辑或依赖 sidecar 内部缓冲

**复杂度:** 中（REST 服务简单，但运维成本增加）

---

### 方案 C: Rust Sidecar CLI（子进程 + stdin/stdout）

```
OpenClaw (Node.js) --stdin/JSON Lines--> fluss-writer (Rust CLI) ---> Fluss RPC ---> Fluss Cluster
                     child_process.spawn()
```

**技术实现:**
- 用 Rust 编写 CLI 工具，从 stdin 读取 JSON Lines，写入 Fluss
- OpenClaw 通过 `child_process.spawn()` 启动，通过 stdin 管道发送数据
- 每行一个 JSON 对象，CLI 内部做批处理和 flush

**API 示例:**
```bash
echo '{"direction":"inbound","content":"Hello"}' | fluss-writer --bootstrap localhost:9123 --table openclaw.message_logs
```

**优点:**
- 部署简单，单个二进制文件
- 进程隔离
- 无需 HTTP 服务器
- 低延迟（pipe 通信比 HTTP 快）

**缺点:**
- 需要管理子进程生命周期（启动、重启、优雅关闭）
- 错误反馈机制有限（只有 stderr）
- 无法查询 Fluss 状态（单向通信）
- 无法动态创建表（或需要额外的 CLI 命令）
- 调试困难

**复杂度:** 低中

---

### 方案 D: Python 桥接（pyfluss）

```
OpenClaw (Node.js) --HTTP/子进程--> Python Server/Script --pyfluss--> Fluss RPC ---> Fluss Cluster
                                    (PyO3 绑定)
```

**技术实现:**
- 使用 pyfluss（fluss-rust 的 Python 绑定）
- 方式一：Python Flask/FastAPI 微服务 + HTTP 调用
- 方式二：Python 脚本 + 子进程 stdin 管道

**优点:**
- Python 生态丰富，开发快
- pyfluss 已支持 PyArrow、Pandas、Dict 多种输入格式

**缺点:**
- 引入 Python 运行时依赖
- 双重 FFI 开销（Node -> Python -> Rust）
- 部署复杂度高（Python 环境 + PyO3 编译）
- 性能最差

**复杂度:** 中（开发简单，部署复杂）

---

### 方案 E: Kafka 协议（未来可行）

```
OpenClaw (Node.js) --kafkajs--> Fluss Kafka Protocol Layer ---> Fluss Cluster
                                (handleProducerRequest)
```

**当前不可行。** 等待 Fluss 实现 Kafka PRODUCE 协议后可用。

**优点（如果未来可用）:**
- 纯 JavaScript（kafkajs），零编译依赖
- 成熟的 Kafka 生态工具链
- 无需原生模块

**缺点:**
- 当前 handleProducerRequest() 为空实现
- 无 ETA，Fluss 官方标注 "still in development"
- 需要额外的 Schema 映射（Kafka 消息 -> Fluss 行）

---

### 方案 F: 自建 Fluss REST Proxy（未来方向）

```
OpenClaw --HTTP--> Fluss REST Proxy (新项目) --fluss-rust--> Fluss Cluster
                   (类似 Confluent REST Proxy)
```

基于 fluss-rust 构建一个通用的 REST Proxy，类似 Confluent Kafka REST Proxy 的角色。

**与方案 B 的区别:** 方案 B 是 hook 专用的 sidecar；方案 F 是通用的 Fluss HTTP 网关，可以服务多个应用。

**优点:**
- 通用性强，一次构建多处使用
- 可作为 Fluss 生态的基础设施

**缺点:**
- 工程量大，需要设计完整的 REST API（CRUD、Schema 管理、查询等）
- 超出当前需求范围
- 运维成本高

---

## 三、方案对比总结

| 维度 | A. N-API 绑定 | B. Sidecar REST | C. Sidecar CLI | D. Python 桥接 | E. Kafka协议 | F. REST Proxy |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **可行性** | 可行 | 可行 | 可行 | 可行 | 不可行 | 可行 |
| **性能** | 最优 | 良 | 良 | 差 | - | 良 |
| **部署复杂度** | 高 | 中 | 低 | 高 | - | 高 |
| **开发复杂度** | 中 | 中 | 低 | 低 | - | 高 |
| **进程隔离** | 无 | 有 | 有 | 有 | - | 有 |
| **原生依赖** | 需要 | 需要 | 需要 | 需要 | 不需要 | 需要 |
| **Node.js 侧代码** | 需 TS 类型 | 纯 TS (fetch) | 纯 TS (spawn) | 纯 TS | 纯 TS | 纯 TS |
| **错误隔离** | 差(进程内) | 好 | 中 | 好 | - | 好 |
| **双向通信** | 完整 | 完整 | 受限 | 完整 | - | 完整 |
| **运维开销** | 低 | 中 | 低 | 中 | - | 高 |

---

## 四、OpenClaw 插件系统调研

### 4.1 插件 Hook 机制

OpenClaw 的 Plugin Hook 系统（`/openclaw/src/plugins/types.ts`）支持以下与消息捕获相关的 hook：

| Hook | 触发时机 | 事件数据 | 上下文 |
|------|---------|---------|--------|
| `message_received` | 用户从外部渠道发消息 | `{ from, content, timestamp?, metadata? }` | `{ channelId, accountId?, conversationId? }` |
| `message_sent` | Agent 回复已发送 | `{ to, content, success, error? }` | `{ channelId, accountId?, conversationId? }` |
| `agent_end` | Agent 处理完毕 | `{ messages: unknown[], success, error?, durationMs? }` | `{ agentId?, sessionKey?, workspaceDir?, messageProvider? }` |

**已知问题:** `message_sent` 当前在 OpenClaw 中未被触发。`agent_end` 是最可靠的消息捕获机制。

### 4.2 插件生命周期

```typescript
export default {
  id: "fluss-hook",
  register(api: OpenClawPluginApi) {
    api.on("hook_name", handler, { priority? });
    api.registerService({ id, start, stop? });
  }
}
```

- 插件配置通过 `openclaw.json` → `api.pluginConfig` 传入
- Service 的 `start()` / `stop()` 管理后台资源生命周期
- Hook handler 中的错误默认被捕获并 log，不会中断宿主

---

## 五、待讨论问题

1. **方案选择**: 上述 A~F 方案中，你倾向于哪个方向？或者有其他想法？
2. **fluss-node 定位**: 假设 fluss-node 不存在，是在本项目中实现最小 N-API 绑定，还是作为独立项目（类似 bindings/node）？
3. **部署场景**: 目标部署环境是什么？Docker 容器？裸机？macOS 开发？这影响跨平台编译策略。
4. **Fluss 集群状态**: 当前是否已有运行中的 Fluss 集群？还是需要同时搭建？
