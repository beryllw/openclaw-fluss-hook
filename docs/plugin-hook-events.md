# Plugin Hook Events 文档

## 概述

OpenClaw 通过 Plugin Hook 机制允许插件在关键生命周期节点拦截事件。Fluss Hook 插件捕获全部 14 种 Hook 事件，写入 Apache Fluss 列式表用于实时分析。

> **注意**：Hook Event 类型定义在 `openclaw/src/plugins/types.ts` 中，但 **不通过 `openclaw/plugin-sdk` 公共 API 导出**。 Fluss Hook 使用本地类型定义与 openclaw 对齐。

---

## 1. before_agent_start

**触发时机**：Agent 启动前，prompt 已构建完成但尚未发送给 LLM。

**触发位置**：
- `openclaw/src/agents/pi-embedded-runner/run/setup.ts`
- `openclaw/src/agents/pi-embedded-runner/run/attempt.prompt-helpers.ts`

### Event 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `prompt` | `string` | 构建完成的完整 prompt 文本 |
| `messages` | `unknown[]?` | 当前消息历史（可选，预会话阶段可能为空） |

### Context 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `agentId` | `string?` | Agent 标识 |
| `sessionKey` | `string?` | 会话密钥 |
| `workspaceDir` | `string?` | 工作目录 |
| `messageProvider` | `string?` | 消息提供者 |
| `sessionId` | `string?` | 会话 ID |
| `trigger` | `string?` | 触发来源（如 `"api"`, `"cli"`） |
| `channelId` | `string?` | 频道 ID |
| `runId` | `string?` | 运行 ID |

### 对应 openclaw 代码

```ts
// openclaw/src/plugins/types.ts:2081-2085
export type PluginHookBeforeAgentStartEvent = {
  prompt: string;
  messages?: unknown[];
};
```

---

## 2. agent_end

**触发时机**：Agent 执行完成（成功或失败）。

**触发位置**：
- `openclaw/src/agents/pi-embedded-runner/run/attempt.ts`

### Event 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `messages` | `unknown[]` | 最终消息历史 |
| `success` | `boolean` | 是否成功完成 |
| `error` | `string?` | 错误信息（失败时） |
| `durationMs` | `number?` | 执行耗时（毫秒） |

### Context 字段

同 `before_agent_start`。

### 对应 openclaw 代码

```ts
// openclaw/src/plugins/types.ts:2155-2160
export type PluginHookAgentEndEvent = {
  messages: unknown[];
  success: boolean;
  error?: string;
  durationMs?: number;
};
```

---

## 3. before_compaction

**触发时机**：上下文压缩（compaction）开始前，即将调用 LLM 进行摘要。

**触发位置**：
- `openclaw/src/agents/pi-embedded-runner/run.ts`
- `openclaw/src/agents/pi-embedded-runner/compact.ts`
- `openclaw/src/agents/pi-embedded-runner/compaction-hooks.ts`

### Event 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `messageCount` | `number` | 会话中的总消息数（截断/压缩前） |
| `tokenCount` | `number?` | 估算 token 数 |
| `compactingCount` | `number?` | 正在送入压缩 LLM 的消息数（history-limit 截断后） |
| `messages` | `unknown[]?` | 当前消息快照 |
| `sessionFile` | `string?` | 会话 JSONL 文件路径。所有消息已在磁盘上，插件可异步读取此文件，与压缩 LLM 调用并行处理 |

### Context 字段

同 `before_agent_start`。

### 对应 openclaw 代码

```ts
// openclaw/src/plugins/types.ts:2163-2174
export type PluginHookBeforeCompactionEvent = {
  messageCount: number;
  compactingCount?: number;
  tokenCount?: number;
  messages?: unknown[];
  sessionFile?: string;
};
```

---

## 4. after_compaction

**触发时机**：上下文压缩完成后。

**触发位置**：
- `openclaw/src/agents/pi-embedded-runner/run.ts`
- `openclaw/src/agents/pi-embedded-runner/compact.ts`
- `openclaw/src/agents/pi-embedded-runner/compaction-hooks.ts`

### Event 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `messageCount` | `number` | 压缩后的消息数 |
| `tokenCount` | `number?` | 估算 token 数 |
| `compactedCount` | `number` | 被压缩掉的消息数 |
| `sessionFile` | `string?` | 会话 JSONL 文件路径 |

### Context 字段

同 `before_agent_start`。

### 对应 openclaw 代码

```ts
// openclaw/src/plugins/types.ts:2183-2191
export type PluginHookAfterCompactionEvent = {
  messageCount: number;
  tokenCount?: number;
  compactedCount: number;
  sessionFile?: string;
};
```

---

## 5. message_received

**触发时机**：收到来自用户的入站消息。

**触发位置**：
- `openclaw/src/infra/outbound/deliver.ts`（通过 hook runner）
- Gateway dispatch 代码

### Event 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `from` | `string` | 发送者 ID |
| `content` | `string` | 消息内容 |
| `timestamp` | `number?` | 消息时间戳 |
| `metadata` | `Record<string, unknown>?` | 附加元数据 |

### Context 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `channelId` | `string` | 频道 ID（如 `"telegram"`, `"slack"`） |
| `accountId` | `string?` | 账号 ID |
| `conversationId` | `string?` | 对话 ID |
| `messageId` | `string?` | 消息 ID（Fluss Hook 扩展字段，非 openclaw 原生） |
| `isGroup` | `boolean?` | 是否为群聊（Fluss Hook 扩展字段） |
| `groupId` | `string?` | 群组 ID（Fluss Hook 扩展字段） |

> **注意**：`messageId`、`isGroup`、`groupId` 是 Fluss Hook 本地扩展字段，不在 openclaw 原生 `PluginHookMessageContext` 中。openclaw 原生类型仅包含 `channelId`、`accountId`、`conversationId`。

### 对应 openclaw 代码

```ts
// openclaw/src/plugins/types.ts:2265-2270
export type PluginHookMessageReceivedEvent = {
  from: string;
  content: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
};
```

---

## 6. message_sending

**触发时机**：消息即将发送（出站前拦截点）。

**触发位置**：
- `openclaw/src/infra/outbound/deliver.ts`

### Event 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `to` | `string` | 接收者 ID |
| `content` | `string` | 消息内容 |
| `metadata` | `Record<string, unknown>?` | 附加元数据 |

### Context 字段

同 `message_received`。

### 对应 openclaw 代码

```ts
// openclaw/src/plugins/types.ts:2273-2277
export type PluginHookMessageSendingEvent = {
  to: string;
  content: string;
  metadata?: Record<string, unknown>;
};
```

---

## 7. message_sent

**触发时机**：消息发送完成（无论成功或失败）。

**触发位置**：
- `openclaw/src/infra/outbound/deliver.ts`

### Event 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `to` | `string` | 接收者 ID |
| `content` | `string` | 消息内容 |
| `success` | `boolean` | 是否发送成功 |
| `error` | `string?` | 错误信息（失败时） |

### Context 字段

同 `message_received`。

### 对应 openclaw 代码

```ts
// openclaw/src/plugins/types.ts:2285-2290
export type PluginHookMessageSentEvent = {
  to: string;
  content: string;
  success: boolean;
  error?: string;
};
```

---

## 8. before_tool_call

**触发时机**：工具调用执行前。

**触发位置**：
- `openclaw/src/agents/pi-tools.before-tool-call.ts`

### Event 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `toolName` | `string` | 工具名称 |
| `params` | `Record<string, unknown>` | 工具参数 |
| `runId` | `string?` | 当前运行的 ID |
| `toolCallId` | `string?` | 工具调用 ID |

### Context 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `agentId` | `string?` | Agent 标识 |
| `sessionKey` | `string?` | 会话密钥 |
| `toolName` | `string` | 工具名称（context 级别） |
| `runId` | `string?` | 运行 ID |
| `toolCallId` | `string?` | 工具调用 ID |
| `sessionId` | `string?` | 会话 ID |

### 对应 openclaw 代码

```ts
// openclaw/src/plugins/types.ts:2306-2313
export type PluginHookBeforeToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
  runId?: string;
  toolCallId?: string;
};
```

---

## 9. after_tool_call

**触发时机**：工具调用完成后。

**触发位置**：
- `openclaw/src/agents/pi-tools.before-tool-call.ts`

### Event 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `toolName` | `string` | 工具名称 |
| `params` | `Record<string, unknown>` | 工具参数 |
| `result` | `unknown?` | 工具返回结果 |
| `error` | `string?` | 错误信息 |
| `durationMs` | `number?` | 工具执行耗时（毫秒） |
| `runId` | `string?` | 运行 ID |
| `toolCallId` | `string?` | 工具调用 ID |

### Context 字段

同 `before_tool_call`。

### 对应 openclaw 代码

```ts
// openclaw/src/plugins/types.ts:2347-2357
export type PluginHookAfterToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
  runId?: string;
  toolCallId?: string;
  result?: unknown;
  error?: string;
  durationMs?: number;
};
```

---

## 10. tool_result_persist

**触发时机**：工具结果被持久化到消息历史时。

**触发位置**：
- `openclaw/src/agents/session-tool-result-guard-wrapper.ts`

### Event 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `toolName` | `string?` | 工具名称 |
| `toolCallId` | `string?` | 工具调用 ID |
| `message` | `unknown` | 工具结果消息（openclaw 原生类型为 `AgentMessage`，Fluss Hook 使用 `unknown` 以兼容序列化） |
| `isSynthetic` | `boolean?` | 是否为合成消息 |

### Context 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `agentId` | `string?` | Agent 标识 |
| `sessionKey` | `string?` | 会话密钥 |
| `toolName` | `string?` | 工具名称 |
| `toolCallId` | `string?` | 工具调用 ID |

### 对应 openclaw 代码

```ts
// openclaw/src/plugins/types.ts:2367-2377
export type PluginHookToolResultPersistEvent = {
  toolName?: string;
  toolCallId?: string;
  message: AgentMessage;  // Fluss Hook 使用 unknown
  isSynthetic?: boolean;
};
```

---

## 11. session_start

**触发时机**：新会话创建或恢复时。

**触发位置**：
- `openclaw/src/auto-reply/reply/session.ts`

### Event 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `sessionId` | `string` | 会话 ID |
| `resumedFrom` | `string?` | 若是从之前的会话恢复，来源会话 ID |
| `sessionKey` | `string?` | 会话密钥 |

### Context 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `agentId` | `string?` | Agent 标识 |
| `sessionId` | `string` | 会话 ID |
| `sessionKey` | `string?` | 会话密钥 |

### 对应 openclaw 代码

```ts
// openclaw/src/plugins/types.ts:2403-2407
export type PluginHookSessionStartEvent = {
  sessionId: string;
  resumedFrom?: string;
  sessionKey?: string;
};
```

---

## 12. session_end

**触发时机**：会话结束时。

**触发位置**：
- `openclaw/src/auto-reply/reply/session.ts`

### Event 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `sessionId` | `string` | 会话 ID |
| `messageCount` | `number` | 会话中的消息总数 |
| `durationMs` | `number?` | 会话持续时间（毫秒） |
| `sessionKey` | `string?` | 会话密钥 |

### Context 字段

同 `session_start`。

### 对应 openclaw 代码

```ts
// openclaw/src/plugins/types.ts:2410-2415
export type PluginHookSessionEndEvent = {
  sessionId: string;
  sessionKey?: string;
  messageCount: number;
  durationMs?: number;
};
```

---

## 13. gateway_start

**触发时机**：Gateway HTTP 服务器启动时。

**触发位置**：
- `openclaw/src/gateway/server.impl.ts`

### Event 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `port` | `number` | Gateway 监听端口 |

### Context 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `port` | `number?` | Gateway 端口 |

### 对应 openclaw 代码

```ts
// openclaw/src/plugins/types.ts:2501-2503
export type PluginHookGatewayStartEvent = {
  port: number;
};
```

---

## 14. gateway_stop

**触发时机**：Gateway 服务器停止时。

**触发位置**：
- `openclaw/src/gateway/server.impl.ts`

### Event 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `reason` | `string?` | 停止原因 |

### Context 字段

同 `gateway_start`。

### 对应 openclaw 代码

```ts
// openclaw/src/plugins/types.ts:2506-2508
export type PluginHookGatewayStopEvent = {
  reason?: string;
};
```

---

## Hook 事件分类总览

```
+------------------+
|   Agent Hooks    |  before_agent_start → agent_end
|   (生命周期)      |  before_compaction  → after_compaction
+--------+---------+
         |
+--------v---------+
|  Message Hooks   |  message_received → message_sending → message_sent
|   (入站/出站)     |
+--------+---------+
         |
+--------v---------+
|   Tool Hooks     |  before_tool_call → after_tool_call → tool_result_persist
|   (工具调用)      |
+--------+---------+
         |
+--------v---------+
|  Session Hooks   |  session_start → session_end
|   (会话管理)      |
+--------+---------+
         |
+--------v---------+
|  Gateway Hooks   |  gateway_start → gateway_stop
|   (网关生命周期)   |
+------------------+
```

## 已知差异

| 类型 | 差异 | 影响 |
|------|------|------|
| `PluginHookMessageContext` | 本地扩展了 `messageId`、`isGroup`、`groupId` 三个字段 | openclaw 原生不传递这些字段，Fluss 表中对应列可能始终为空/默认值 |
| `PluginHookToolResultPersistEvent.message` | 本地使用 `unknown`，openclaw 使用 `AgentMessage` | 无功能影响（mapper 使用 JSON 序列化） |
