# OpenClaw Plugin Hook 机制调研文档

## 概述

OpenClaw 的插件系统提供了一套类型安全、可优先化的生命周期 Hook 机制，允许插件在 Agent 运行、消息收发、工具调用、会话管理、网关启停等关键节点介入。

本文档基于 OpenClaw 源码的完整阅读，覆盖 Hook 类型系统、执行引擎、注册机制、触发点、插件生命周期等全部细节。

> **版本**: 基于 OpenClaw `32fa5c3be5` (2026-04-01) 源码校验，适用于 `2026.3.31 (213a704)` 及更新版本。
> **上次更新**: 2026-04-02

---

## 一、14 个 Plugin Hook 完整清单

### 1.1 分类总览

OpenClaw 定义了 14 个 Plugin Hook（`src/plugins/types.ts`）：

```typescript
type PluginHookName =
  | "before_agent_start"   // Agent 启动前
  | "agent_end"            // Agent 处理完毕
  | "before_compaction"    // 会话压缩前
  | "after_compaction"     // 会话压缩后
  | "message_received"     // 收到外部消息
  | "message_sending"      // 消息即将发送
  | "message_sent"         // 消息已发送
  | "before_tool_call"     // 工具调用前
  | "after_tool_call"      // 工具调用后
  | "tool_result_persist"  // 工具结果持久化
  | "session_start"        // 会话启动
  | "session_end"          // 会话结束
  | "gateway_start"        // 网关启动
  | "gateway_stop";        // 网关停止
```

### 1.2 逐个 Hook 详解

#### Agent 类 Hook

**`before_agent_start`** — 修改型（顺序执行）

允许插件在 Agent 开始处理前注入上下文到 system prompt。

```typescript
// 事件
type PluginHookBeforeAgentStartEvent = {
  prompt: string;          // 当前 system prompt
  messages?: unknown[];    // 当前会话消息数组
};

// 上下文
type PluginHookAgentContext = {
  agentId?: string;        // Agent ID（从 sessionKey 解析）
  sessionKey?: string;     // 会话键（如 "main:webchat-session"）
  workspaceDir?: string;   // 工作空间目录
  messageProvider?: string; // 消息提供者（如 "bailian"）
};

// 返回值
type PluginHookBeforeAgentStartResult = {
  systemPrompt?: string;    // 替换 system prompt
  prependContext?: string;  // 在 prompt 前追加上下文
};
```

- 执行方式: `runModifyingHook` — 按优先级顺序执行，结果合并
- 合并策略: `systemPrompt` 取最新值；`prependContext` 用 `\n\n` 拼接累积
- 触发位置:
  - `src/agents/pi-embedded-runner/run/setup.ts:67` — 模型初始化阶段（主路径）
  - `src/agents/pi-embedded-runner/run/attempt.prompt-helpers.ts:53` — 提示词构建路径（遗留路径）

---

**`agent_end`** — 通知型（并行执行）

Agent 完成一次处理后触发，携带完整的消息数组。

```typescript
type PluginHookAgentEndEvent = {
  messages: unknown[];    // 完整会话消息快照
  success: boolean;       // 是否成功（无中断且无错误）
  error?: string;         // 错误描述
  durationMs?: number;    // 处理耗时（毫秒）
};
// 上下文: PluginHookAgentContext（同上）
// 返回值: void
```

- 执行方式: `runVoidHook` — 所有 handler 并行执行，fire-and-forget
- 触发位置: `src/agents/pi-embedded-runner/run/attempt.ts:1799`
- 调用方式: 无 `await`，`.catch()` 静默捕获错误
- 传入数据: messagesSnapshot（消息快照）, success, error, durationMs, runId, agentId, sessionKey

**messages 数组中每条消息的结构:**
```typescript
{
  role: "user" | "assistant" | "system" | "tool",
  content: string | [{ type: "text", text: "..." }],
  timestamp?: number,
  // ...其他 AgentMessage 字段
}
```

---

**`before_compaction`** — 通知型（并行执行）

会话消息压缩（token 优化）前触发。

```typescript
type PluginHookBeforeCompactionEvent = {
  messageCount: number;   // 压缩前消息数（部分路径传 -1 表示不可用）
  tokenCount?: number;    // 估算 token 数
};
// 上下文: PluginHookAgentContext
// 返回值: void
```

- 触发位置（3 处）:
  - `src/agents/pi-embedded-subscribe.handlers.compaction.ts:26` — 自动压缩启动时（fire-and-forget）
  - `src/agents/pi-embedded-runner/run.ts:404` — 上下文引擎压缩前（await）
  - `src/agents/pi-embedded-runner/compact.ts:1068` — 引擎拥有的压缩路径（await）
- 额外传入: `messages`（消息数组，仅部分路径）, `sessionFile`（会话文件路径）
- **注意**: 仅在会话足够长触发压缩时才会调用；短对话不会触发

---

**`after_compaction`** — 通知型（并行执行）

会话消息压缩完成后触发。

```typescript
type PluginHookAfterCompactionEvent = {
  messageCount: number;    // 压缩后消息数
  tokenCount?: number;     // 压缩后 token 数
  compactedCount: number;  // 被压缩的消息数
};
// 上下文: PluginHookAgentContext
// 返回值: void
```

- 触发位置（3 处）:
  - `src/agents/pi-embedded-subscribe.handlers.compaction.ts:89` — 压缩完成后（fire-and-forget，仅在 `!willRetry` 时触发）
  - `src/agents/pi-embedded-runner/run.ts:425` — 上下文引擎压缩后（await）
  - `src/agents/pi-embedded-runner/compact.ts:1116` — 引擎拥有的压缩完成（await）
- 额外传入: `tokenCount`（压缩后 token 数）, `sessionFile`

---

#### 消息类 Hook

**`message_received`** — 通知型（并行执行）

用户发送消息时触发。通过 `dispatchReplyFromConfig` 路径调用，覆盖本地网关和外部渠道。

```typescript
type PluginHookMessageReceivedEvent = {
  from: string;                        // 发送者标识
  content: string;                     // 消息文本
  timestamp?: number;                  // Unix 时间戳
  metadata?: Record<string, unknown>;  // 渠道特定元数据
};

type PluginHookMessageContext = {
  channelId: string;        // 渠道 ID（如 "telegram", "webchat"）
  accountId?: string;       // 渠道账户 ID
  conversationId?: string;  // 会话标识
};
// 返回值: void
```

- 触发位置: `src/auto-reply/reply/dispatch-from-config.ts:421`
- 调用方式: `fireAndForgetHook(hookRunner.runMessageReceived(...))` — fire-and-forget
- 前置条件: `hookRunner?.hasHooks("message_received")` 为 true 时才触发
- metadata 包含: `to`, `provider`, `surface`, `threadId`, `originatingChannel`, `messageId`, `senderId`, `senderName`, `senderUsername`, `senderE164`
- **注意**: 本地网关（webchat）通过 `gateway/server-methods/chat.ts` → `dispatchInboundMessage` → `dispatchReplyFromConfig` 路径触发，也会经过此 hook。但被 `shouldSkipDuplicateInbound()` 判定为重复的消息、以及被插件 binding claim 提前处理的消息不会触发此 hook。

---

**`message_sending`** — 修改型（顺序执行）

Agent 回复即将发送到**外部渠道**前触发，允许修改或取消。

```typescript
type PluginHookMessageSendingEvent = {
  to: string;                          // 接收者
  content: string;                     // 合并后的消息文本
  metadata?: Record<string, unknown>;  // 附加数据（channel, accountId, mediaUrls）
};

type PluginHookMessageSendingResult = {
  content?: string;   // 替换消息内容
  cancel?: boolean;   // 取消发送
};
// 上下文: PluginHookMessageContext
```

- 合并策略: `content` 取最新值；`cancel` 取最新值
- 触发位置: `src/infra/outbound/deliver.ts:446`（在 `applyMessageSendingHook` 函数中）
- 前置条件: `hookRunner?.hasHooks("message_sending")` 为 true 时才触发
- 如果结果 `cancel === true`，消息将不会发送
- **重要限制**: 此 hook 仅在 `deliverOutboundPayloads` 出站投递管线中触发。本地网关（webchat）的 Agent 回复通过 WebSocket 流式返回，**不经过此管线**，因此本地网关模式下此 hook **不会被触发**。仅 Telegram、WhatsApp、Discord、Slack 等外部渠道回复会触发。

---

**`message_sent`** — 通知型（并行执行）

消息成功或失败发送后触发。

```typescript
type PluginHookMessageSentEvent = {
  to: string;          // 接收者
  content: string;     // 已发送内容
  success: boolean;    // 是否成功
  error?: string;      // 错误信息
};
// 上下文: PluginHookMessageContext
// 返回值: void
```

- 触发位置: `src/infra/outbound/deliver.ts:394`（在 `createMessageSentEmitter` 中）
- 调用方式: `fireAndForgetHook(hookRunner.runMessageSent(...))` — fire-and-forget
- 前置条件: `hookRunner?.hasHooks("message_sent")` 为 true 时才触发
- **重要限制**: 与 `message_sending` 相同，仅在 `deliverOutboundPayloads` 出站投递管线中触发。本地网关模式下**不会被触发**。

---

#### 工具类 Hook

**`before_tool_call`** — 修改型（顺序执行）

Agent 调用工具前触发，允许修改参数或阻止调用。

```typescript
type PluginHookBeforeToolCallEvent = {
  toolName: string;                    // 工具名称
  params: Record<string, unknown>;     // 工具参数
};

type PluginHookToolContext = {
  agentId?: string;     // Agent ID
  sessionKey?: string;  // 会话键
  toolName: string;     // 工具名称
};

type PluginHookBeforeToolCallResult = {
  params?: Record<string, unknown>;  // 修改后的参数
  block?: boolean;                   // 是否阻止执行
  blockReason?: string;              // 阻止原因
};
```

- 合并策略: `params`/`block`/`blockReason` 均取最新非空值
- 触发位置: `src/agents/pi-tools.before-tool-call.ts:194`
- 传入数据: toolName, params（规范化后）, runId, toolCallId

---

**`after_tool_call`** — 通知型（并行执行）

工具调用完成后触发。

```typescript
type PluginHookAfterToolCallEvent = {
  toolName: string;                    // 工具名称
  params: Record<string, unknown>;     // 调用参数
  result?: unknown;                    // 工具结果
  error?: string;                      // 执行错误
  durationMs?: number;                 // 执行耗时
};
// 上下文: PluginHookToolContext
// 返回值: void
```

- 触发位置: `src/agents/pi-embedded-subscribe.handlers.tools.ts:609`
- 调用方式: `void hookRunnerAfter.runAfterToolCall(...)` — fire-and-forget
- 传入数据: toolName, params, result, error, durationMs, runId, toolCallId

---

**`tool_result_persist`** — 同步修改型（顺序执行，特殊）

工具结果即将写入会话记录时触发。**这是唯一的同步 Hook。**

```typescript
type PluginHookToolResultPersistEvent = {
  toolName?: string;       // 工具名称
  toolCallId?: string;     // 调用 ID
  message: AgentMessage;   // 将被写入的消息对象
  isSynthetic?: boolean;   // 是否由 guard/repair 合成
};

type PluginHookToolResultPersistContext = {
  agentId?: string;
  sessionKey?: string;
  toolName?: string;
  toolCallId?: string;
};

type PluginHookToolResultPersistResult = {
  message?: AgentMessage;  // 修改后的消息
};
```

- **同步执行**: handler 不能返回 Promise，返回 Promise 将被忽略并打印警告
- 触发位置: `src/agents/session-tool-result-guard-wrapper.ts:47`
- 用途: 剥离工具结果中的大型非必要字段，减少会话存储体积
- 链式处理: 每个 handler 的输出 message 作为下一个 handler 的输入

---

#### 会话类 Hook

**`session_start`** — 通知型（并行执行）

新会话启动时触发。

```typescript
type PluginHookSessionStartEvent = {
  sessionId: string;      // 会话 ID
  resumedFrom?: string;   // 从哪个会话恢复（如果是恢复）
};

type PluginHookSessionContext = {
  agentId?: string;
  sessionId: string;
};
// 返回值: void
```

- 触发位置: `src/auto-reply/reply/session.ts:704`
- 调用方式: `void hookRunner.runSessionStart(...).catch(() => {})` — fire-and-forget
- 触发条件: 仅在 `isNewSession` 时触发（首次创建会话）

---

**`session_end`** — 通知型（并行执行）

会话结束（被新会话替换）时触发。

```typescript
type PluginHookSessionEndEvent = {
  sessionId: string;     // 会话 ID
  messageCount: number;  // 会话消息总数
  durationMs?: number;   // 会话持续时间
};
// 上下文: PluginHookSessionContext
// 返回值: void
```

- 触发位置: `src/auto-reply/reply/session.ts:692`
- 调用方式: `void hookRunner.runSessionEnd(...).catch(() => {})` — fire-and-forget
- 触发条件: 仅在旧会话被新会话替换时触发（`previousSessionId !== effectiveSessionId`）

---

#### 网关类 Hook

**`gateway_start`** — 通知型（并行执行）

网关服务器启动时触发。

```typescript
type PluginHookGatewayStartEvent = {
  port: number;   // 网关监听端口
};

type PluginHookGatewayContext = {
  port?: number;
};
// 返回值: void
```

- 触发位置: `src/gateway/server.impl.ts:1392`
- 调用方式: `void hookRunner.runGatewayStart({ port }, { port }).catch(...)` — fire-and-forget
- 触发条件: 非最小化测试网关时触发

---

**`gateway_stop`** — 通知型（并行执行）

网关关闭时触发。

```typescript
type PluginHookGatewayStopEvent = {
  reason?: string;  // 停止原因
};
// 上下文: PluginHookGatewayContext
// 返回值: void
```

- 触发位置: `src/plugins/hook-runner-global.ts:85`（通过 `runGlobalGatewayStopSafely()` 安全函数）
- 调用方式: `await hookRunner.runGatewayStop(...)` — 等待完成，确保优雅关闭
- 触发条件: 网关优雅关闭时触发

---

## 二、Hook 执行引擎

Hook 执行引擎位于 `src/plugins/hooks.ts`，通过 `createHookRunner(registry, options)` 创建。
全局单例通过 `src/plugins/hook-runner-global.ts:32` 初始化。

### 2.1 三种执行模式

| 模式 | 函数 | 执行方式 | 适用 Hook |
|------|------|---------|-----------|
| **并行通知** | `runVoidHook()` | `Promise.all()` 并行 | agent_end, message_received, message_sent, after_tool_call, before/after_compaction, session_start/end, gateway_start/stop |
| **顺序修改** | `runModifyingHook()` | `for...of` 按优先级顺序 | before_agent_start, message_sending, before_tool_call |
| **同步修改** | `runToolResultPersist()` | 同步 `for...of` | tool_result_persist |

#### runVoidHook（并行通知）

```typescript
async function runVoidHook(hookName, event, ctx): Promise<void> {
  const hooks = getHooksForName(registry, hookName); // 按优先级排序
  const promises = hooks.map(async (hook) => {
    try {
      await hook.handler(event, ctx);
    } catch (err) {
      if (catchErrors) logger?.error(msg);
      else throw new Error(msg, { cause: err });
    }
  });
  await Promise.all(promises);  // 所有 handler 并行执行
}
```

- 所有 handler 同时启动，互不阻塞
- 一个 handler 失败不影响其他 handler
- 虽然按优先级排序后 map，但由于 `Promise.all` 是并行的，优先级在此模式下无实际执行顺序意义

#### runModifyingHook（顺序修改）

```typescript
async function runModifyingHook(hookName, event, ctx, mergeResults?): Promise<TResult | undefined> {
  const hooks = getHooksForName(registry, hookName);
  let result: TResult | undefined;
  for (const hook of hooks) {  // 按优先级从高到低顺序执行
    const handlerResult = await hook.handler(event, ctx);
    if (handlerResult != null) {
      result = mergeResults ? mergeResults(result, handlerResult) : handlerResult;
    }
  }
  return result;
}
```

- 按优先级**从高到低**顺序执行
- 每个 handler 的结果通过 `mergeResults` 函数与累积结果合并
- handler 返回 `undefined`/`null` 时不影响已有结果

#### runToolResultPersist（同步修改）

```typescript
function runToolResultPersist(event, ctx): PluginHookToolResultPersistResult | undefined {
  let current = event.message;
  for (const hook of hooks) {
    const out = hook.handler({ ...event, message: current }, ctx);
    // 如果 handler 错误地返回了 Promise，打印警告并跳过
    if (out && typeof out.then === "function") {
      logger?.warn("this hook is synchronous and the result was ignored.");
      continue;
    }
    const next = out?.message;
    if (next) current = next;  // 链式传递：输出作为下一个输入
  }
  return { message: current };
}
```

- **完全同步** — 不支持 async handler
- 在会话 transcript 追加的热路径上执行，不能有异步延迟
- 链式处理：前一个 handler 的输出 message 成为后一个 handler 的输入

### 2.2 优先级系统

```typescript
function getHooksForName(registry, hookName) {
  return registry.typedHooks
    .filter((h) => h.hookName === hookName)
    .toSorted((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    //                    ^^^ 降序排列：高优先级先执行
}
```

- **默认优先级**: `0`
- **排序规则**: 降序 — 数字越大越先执行
- **支持负数**: 可以用负数确保后执行
- 对 Void Hook：优先级排序后并行执行，实际无序
- 对 Modifying Hook：优先级决定执行和合并顺序

### 2.3 错误处理

```typescript
const catchErrors = options.catchErrors ?? true;  // 默认 true
```

| `catchErrors` | 行为 |
|:---:|------|
| `true`（默认） | 错误被 `logger.error()` 记录，不中断其他 handler |
| `false` | 错误被 `throw new Error(msg, { cause: err })` 抛出，中断执行 |

---

## 三、插件注册机制

### 3.1 Registry 结构

`src/plugins/registry.ts` 定义了完整的 Registry：

```typescript
type PluginRegistry = {
  plugins: PluginRecord[];              // 已注册插件
  tools: PluginToolRegistration[];      // 工具
  hooks: PluginHookRegistration[];      // 内部 Hook（旧系统）
  typedHooks: TypedPluginHookRegistration[];  // Plugin Hook（新系统）
  channels: PluginChannelRegistration[];     // 渠道插件
  providers: PluginProviderRegistration[];   // Provider 插件
  gatewayHandlers: GatewayRequestHandlers;   // 网关方法
  httpHandlers: PluginHttpRegistration[];     // HTTP 处理器
  httpRoutes: PluginHttpRouteRegistration[];  // HTTP 路由
  cliRegistrars: PluginCliRegistration[];     // CLI 注册器
  services: PluginServiceRegistration[];     // 服务
  commands: PluginCommandRegistration[];     // 命令
  diagnostics: PluginDiagnostic[];           // 诊断信息
};
```

### 3.2 api.on() 注册 Hook

`api.on()` 方法内部调用 `registerTypedHook()`：

```typescript
const registerTypedHook = (record, hookName, handler, opts?) => {
  record.hookCount += 1;
  registry.typedHooks.push({
    pluginId: record.id,
    hookName,
    handler,
    priority: opts?.priority,
    source: record.source,
  });
};
```

- 直接 push 到 `registry.typedHooks` 数组
- 不做去重，同一插件可以对同一 Hook 注册多个 handler
- priority 可选，不传则为 `undefined`（排序时视为 `0`）

### 3.3 createApi() 工厂

为每个插件创建独立的 API 对象：

```typescript
const createApi = (record, params): OpenClawPluginApi => ({
  id: record.id,
  name: record.name,
  config: params.config,             // 全局 OpenClaw 配置
  pluginConfig: params.pluginConfig, // 该插件专属配置
  runtime: registryParams.runtime,
  logger: normalizeLogger(registryParams.logger),
  registerTool: (tool, opts) => registerTool(record, tool, opts),
  registerService: (service) => registerService(record, service),
  on: (hookName, handler, opts) => registerTypedHook(record, hookName, handler, opts),
  // ...其他 10+ 注册方法
});
```

### 3.4 插件定义格式

```typescript
type OpenClawPluginDefinition = {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  kind?: PluginKind;
  configSchema?: OpenClawPluginConfigSchema;
  register?: (api: OpenClawPluginApi) => void | Promise<void>;
  activate?: (api: OpenClawPluginApi) => void | Promise<void>;
};

// 也支持简写形式（纯函数）
type OpenClawPluginModule =
  | OpenClawPluginDefinition
  | ((api: OpenClawPluginApi) => void | Promise<void>);
```

---

## 四、Plugin API 完整能力

`api: OpenClawPluginApi` 提供以下注册能力：

| 方法 | 用途 |
|------|------|
| `api.on(hookName, handler, opts?)` | 注册生命周期 Hook |
| `api.registerTool(tool, opts?)` | 注册 Agent 工具 |
| `api.registerService(service)` | 注册后台服务（start/stop 生命周期） |
| `api.registerHook(events, handler)` | 注册内部 Hook（旧系统，command/session/agent/gateway 事件） |
| `api.registerHttpHandler(handler)` | 注册 HTTP 请求处理器 |
| `api.registerHttpRoute({ path, handler })` | 注册 HTTP 路由 |
| `api.registerChannel(registration)` | 注册消息渠道 |
| `api.registerProvider(provider)` | 注册 LLM Provider |
| `api.registerGatewayMethod(method, handler)` | 注册网关 RPC 方法 |
| `api.registerCli(registrar, opts?)` | 注册 CLI 命令 |
| `api.registerCommand(command)` | 注册自定义命令（绕过 LLM） |
| `api.resolvePath(input)` | 解析用户路径 |

**只读属性:**
- `api.id` / `api.name` — 插件标识
- `api.config` — 全局 OpenClaw 配置
- `api.pluginConfig` — 插件专属配置
- `api.runtime` — 运行时信息
- `api.logger` — 日志工具（debug/info/warn/error）

---

## 五、Service 生命周期

### 5.1 Service 定义

```typescript
type OpenClawPluginService = {
  id: string;
  start: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
  stop?: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
};

type OpenClawPluginServiceContext = {
  config: OpenClawConfig;
  workspaceDir?: string;
  stateDir: string;
  logger: PluginLogger;
};
```

### 5.2 注册与执行

```typescript
// 注册
api.registerService({
  id: "my-service",
  start: (ctx) => { /* 初始化资源 */ },
  stop: async (ctx) => { /* 清理资源 */ },
});
```

- `start()` 在插件加载完成后调用
- `stop()` 在 OpenClaw 关闭时调用（可选）
- 每个 service 独立运行，互不影响

---

## 六、Hook 触发点汇总

**所有 14 个 Hook 均已在源码中实现触发点。** 但部分 Hook 的触发依赖特定的消息路径或运行条件。

| Hook | 触发位置 | 调用方式 | 传入数据 |
|------|---------|---------|---------|
| `before_agent_start` | `setup.ts:67`, `attempt.prompt-helpers.ts:53` | `await` | prompt, messages, agentId, sessionKey, workspaceDir, messageProvider |
| `agent_end` | `attempt.ts:1799` | fire-and-forget | messagesSnapshot, success, error, durationMs, runId, agentId, sessionKey |
| `before_compaction` | `handlers.compaction.ts:26`, `run.ts:404`, `compact.ts:1068` | fire-forget / await | messageCount, messages, sessionFile, sessionKey |
| `after_compaction` | `handlers.compaction.ts:89`, `run.ts:425`, `compact.ts:1116` | fire-forget / await | messageCount, compactedCount, tokenCount, sessionFile |
| `message_received` | `dispatch-from-config.ts:421` | fire-and-forget | from, content, timestamp, metadata(含10+字段), channelId, accountId, conversationId |
| `message_sending` | `deliver.ts:446` | `await` | to, content, metadata(channel, accountId, mediaUrls), channelId, accountId |
| `message_sent` | `deliver.ts:394` | fire-and-forget | to, content, success, error, channelId, accountId, conversationId, messageId |
| `before_tool_call` | `pi-tools.before-tool-call.ts:194` | `await` | toolName, params, runId, toolCallId, agentId, sessionKey |
| `after_tool_call` | `handlers.tools.ts:609` | fire-and-forget | toolName, params, result, error, durationMs, runId, toolCallId |
| `tool_result_persist` | `session-tool-result-guard-wrapper.ts:47` | 同步调用 | toolName, toolCallId, message, isSynthetic, agentId, sessionKey |
| `session_start` | `session.ts:704` | fire-and-forget | sessionId, resumedFrom, agentId |
| `session_end` | `session.ts:692` | fire-and-forget | sessionId, messageCount, durationMs, agentId |
| `gateway_start` | `server.impl.ts:1392` | fire-and-forget | port |
| `gateway_stop` | `hook-runner-global.ts:85` | `await`（安全关闭） | port |

---

## 七、消息路径与 Hook 触发关系（重要）

### 7.1 两条消息路径

OpenClaw 有两条主要的消息收发路径，不同路径触发不同的 Hook：

**路径 A: 本地网关（gateway.mode = "local"，webchat UI）**

```
用户 → WebSocket → gateway/server-methods/chat.ts
  → dispatchInboundMessage → dispatchReplyFromConfig
    → [message_received] ✅ 触发
  → Agent 处理
    → [before_agent_start] ✅ 触发
    → [before_tool_call / after_tool_call / tool_result_persist] ✅ 触发
    → [agent_end] ✅ 触发
  → WebSocket 流式返回
    → [message_sending] ❌ 不触发（不经过 deliverOutboundPayloads）
    → [message_sent] ❌ 不触发（不经过 deliverOutboundPayloads）
```

**路径 B: 外部渠道（Telegram、WhatsApp、Discord、Slack 等）**

```
用户 → Webhook → auto-reply/dispatch.ts
  → dispatchInboundMessage → dispatchReplyFromConfig
    → [message_received] ✅ 触发
  → Agent 处理
    → [before_agent_start] ✅ 触发
    → [before_tool_call / after_tool_call / tool_result_persist] ✅ 触发
    → [agent_end] ✅ 触发
  → deliverOutboundPayloads（外部渠道投递）
    → [message_sending] ✅ 触发
    → [message_sent] ✅ 触发
```

### 7.2 各 Hook 的触发条件总结

| Hook | 本地网关 | 外部渠道 | 触发条件说明 |
|------|:---:|:---:|------|
| `before_agent_start` | ✅ | ✅ | 每次 Agent 启动处理时 |
| `agent_end` | ✅ | ✅ | 每次 Agent 完成处理时 |
| `before_compaction` | ✅ | ✅ | 会话足够长触发压缩时 |
| `after_compaction` | ✅ | ✅ | 压缩完成时 |
| `message_received` | ✅ | ✅ | 消息进入 dispatchReplyFromConfig 且未被跳过时 |
| `message_sending` | ❌ | ✅ | **仅外部渠道** — 经过 deliverOutboundPayloads 时 |
| `message_sent` | ❌ | ✅ | **仅外部渠道** — 经过 deliverOutboundPayloads 时 |
| `before_tool_call` | ✅ | ✅ | Agent 调用工具前 |
| `after_tool_call` | ✅ | ✅ | Agent 调用工具完成后 |
| `tool_result_persist` | ✅ | ✅ | 工具结果写入会话记录前 |
| `session_start` | ✅ | ✅ | 新会话创建时（非恢复） |
| `session_end` | ✅ | ✅ | 旧会话被新会话替换时 |
| `gateway_start` | ✅ | ✅ | 网关启动时（一次性） |
| `gateway_stop` | ✅ | ✅ | 网关优雅关闭时 |

### 7.3 message_received 可能不全的原因

以下情况下 `message_received` hook 不会被触发：
1. **重复消息** — `shouldSkipDuplicateInbound(ctx)` 判定为重复时，直接跳过
2. **插件 binding claim 提前处理** — 消息被插件渠道绑定处理且返回 declined/error 时，会在 `message_received` 之前 return
3. **buffer 刷写丢失** — 插件 handler 将数据 push 到 buffer 后，如果进程在 flushInterval 内崩溃/重启，buffer 中的数据会丢失（当前配置: `batchSize=10`, `flushIntervalMs=3000`）

---

## 八、插件配置

### 8.1 openclaw.json 中的插件配置

```json
{
  "plugins": {
    "enabled": true,
    "load": {
      "paths": ["<path-to>/my-plugin"]
    },
    "entries": {
      "my-plugin-id": {
        "enabled": true,
        "config": {
          "key1": "value1",
          "key2": 42
        }
      }
    }
  }
}
```

- `plugins.enabled` — 全局插件开关
- `plugins.load.paths` — 额外插件加载路径
- `plugins.entries[id].enabled` — 单个插件开关
- `plugins.entries[id].config` — 插件专属配置，通过 `api.pluginConfig` 读取

### 8.2 插件清单文件 (openclaw.plugin.json)

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "Plugin description",
  "configSchema": {
    "type": "object",
    "properties": {
      "key1": { "type": "string", "description": "..." },
      "key2": { "type": "integer", "description": "..." }
    }
  }
}
```

- `configSchema` 使用 JSON Schema 格式验证插件配置

---

## 九、插件来源

`PluginOrigin` 定义了 4 种来源：

| 来源 | 说明 |
|------|------|
| `bundled` | OpenClaw 内置插件（`src/hooks/bundled/`） |
| `global` | 全局安装的插件 |
| `workspace` | 工作空间级别的插件 |
| `config` | 通过配置文件指定的插件 |

内置插件示例（`src/hooks/bundled/`）：
- `session-memory` — 保存会话上下文到内存文件
- `command-logger` — 记录命令事件日志
- `soul-evil` — 注入 Agent 自定义角色 prompt
- `boot-md` — 启动处理

---

## 十、对 Fluss Hook 插件的启示

基于以上调研，对 openclaw-fluss-hook 插件的设计有以下关键影响：

### 10.1 各 Hook 的实际价值（按可靠性排序）

| Hook | 可靠性 | 用途 | 说明 |
|------|--------|------|------|
| `agent_end` | **最可靠** | 捕获完整的 user/assistant/tool 消息快照 | 每次 Agent 处理完毕必触发，携带完整 messages 数组 |
| `before_agent_start` | **可靠** | 记录每次 Agent 启动和初始 prompt | 每次处理必触发 |
| `before_tool_call` | **可靠** | 记录工具调用意图和参数 | 每次工具调用必触发 |
| `after_tool_call` | **可靠** | 记录工具执行结果和耗时 | 每次工具完成必触发 |
| `tool_result_persist` | **可靠** | 记录写入会话的工具结果 | 同步 Hook，每次持久化必触发 |
| `message_received` | **较可靠** | 捕获用户输入和渠道 metadata | 覆盖本地网关和外部渠道，但重复消息等被跳过 |
| `gateway_start` | **可靠** | 记录网关启动 | 启动时一次性触发 |
| `session_start` / `session_end` | **条件触发** | 记录会话生命周期 | 仅在新建/替换会话时触发，不是每次消息都触发 |
| `before/after_compaction` | **条件触发** | 记录压缩事件 | 仅在长对话触发压缩时 |
| `message_sending` / `message_sent` | **仅外部渠道** | 记录出站消息 | 本地网关模式下不触发 |
| `gateway_stop` | **低频** | 记录关闭事件 | 仅优雅关闭时触发 |

### 10.2 关键设计约束

1. **Hook handler 中不能执行耗时操作** — 大部分 Hook 是 fire-and-forget，handler 的异常不会被传播，但长时间阻塞可能影响 `Promise.all` 的整体等待
2. **应使用 `api.registerService()` 管理 Fluss 连接生命周期** — start 时初始化 buffer/timer，stop 时 final flush 和关闭连接
3. **配置通过 `api.pluginConfig` 读取** — 应定义 `configSchema` 做验证
4. **错误不会传播到宿主** — `catchErrors` 默认为 `true`，插件崩溃不影响 OpenClaw 运行
5. **`agent_end` 的 messages 是快照** — 调用时传入的是 `messagesSnapshot`，是当前消息数组的副本
6. **`message_sending`/`message_sent` 在本地网关模式下不可用** — 如需捕获 Agent 的回复内容，应依赖 `agent_end` 的 messages 快照

### 10.3 插件骨架

```typescript
export default {
  id: "fluss-hook",
  name: "Fluss Message Logger",
  register(api) {
    const config = resolveConfig(api.pluginConfig);
    const client = new FlussClient(config);
    const buffer = new MessageBuffer(client, config);

    // 核心 — 每次 Agent 处理完毕，获取完整消息快照
    api.on("agent_end", (event, ctx) => {
      buffer.push("agent_end", mapAgentEnd(event, ctx));
    });

    // 用户消息入口 — 携带渠道 metadata
    api.on("message_received", (event, ctx) => {
      buffer.push("message_received", mapMessageReceived(event, ctx));
    });

    // 工具调用追踪
    api.on("before_tool_call", (event, ctx) => {
      buffer.push("before_tool_call", mapBeforeToolCall(event, ctx));
    });
    api.on("after_tool_call", (event, ctx) => {
      buffer.push("after_tool_call", mapAfterToolCall(event, ctx));
    });

    // 外部渠道出站（本地网关不触发，但注册无副作用）
    api.on("message_sending", (event, ctx) => {
      buffer.push("message_sending", mapMessageSending(event, ctx));
    });
    api.on("message_sent", (event, ctx) => {
      buffer.push("message_sent", mapMessageSent(event, ctx));
    });

    api.registerService({
      id: "fluss-hook",
      start: () => buffer.start(),
      stop: async () => await buffer.stop(),
    });
  },
};
```
