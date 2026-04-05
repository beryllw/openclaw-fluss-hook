# OpenClaw Fluss Hook - 字段完整性 Review 检查表

> 基于 OpenClaw `32fa5c3be5` (2026-04-01) 源码研究文档 + fluss-hook 代码交叉比对
> 生成时间: 2026-04-02

## 检查说明

- **三层**：types.ts (类型定义) / schema.ts (表列) / event-mappers.ts (映射函数)
- **研究文档**：openclaw-plugin-hook-research.md 中提取的类型 + 传入数据
- **状态列**：`OK` = 三层内部一致 / `VERIFY` = 需要去 OpenClaw 源码确认是否实际存在 / `MISSING?` = 可能遗漏

---

## 1. before_agent_start

### Event: `PluginHookBeforeAgentStartEvent`

| # | 字段 (types.ts) | Schema 列 | Mapper Key | 研究文档 Type | 研究文档 传入数据 | 状态 |
|---|----------------|-----------|------------|-------------|---------------|------|
| 1 | `prompt` | `prompt` STRING | `event.prompt` | ✅ `prompt: string` | ✅ prompt | OK |
| 2 | `messages?` | `messages` STRING | `safeJson(event.messages)` | ✅ `messages?: unknown[]` | ✅ messages | OK |

### Context: `PluginHookAgentContext`

| # | 字段 (types.ts) | Schema 列 | Mapper Key | 研究文档 Type | 研究文档 传入数据 | 状态 |
|---|----------------|-----------|------------|-------------|---------------|------|
| 3 | `agentId?` | `agent_id` STRING | `ctx.agentId ?? ""` | ✅ `agentId?: string` | ✅ agentId | OK |
| 4 | `sessionKey?` | `session_key` STRING | `ctx.sessionKey ?? ""` | ✅ `sessionKey?: string` | ✅ sessionKey | OK |
| 5 | `workspaceDir?` | `workspace_dir` STRING | `ctx.workspaceDir ?? ""` | ✅ `workspaceDir?: string` | ✅ workspaceDir | OK |
| 6 | `messageProvider?` | `message_provider` STRING | `ctx.messageProvider ?? ""` | ✅ `messageProvider?: string` | ✅ messageProvider | OK |
| 7 | `sessionId?` | `session_id` STRING | `ctx.sessionId ?? ""` | ❌ 未出现 | ❌ 未提及 | **VERIFY** |
| 8 | `trigger?` | `trigger` STRING | `ctx.trigger ?? ""` | ❌ 未出现 | ❌ 未提及 | **VERIFY** |
| 9 | `channelId?` | `channel_id` STRING | `ctx.channelId ?? ""` | ❌ 未出现 | ❌ 未提及 | **VERIFY** |
| 10 | (auto) | `timestamp` BIGINT | `Date.now()` | - | - | OK |

> **需核查**: 在 OpenClaw 源码 `src/plugins/types.ts` 中确认 `PluginHookAgentContext` 是否有 sessionId, trigger, channelId 字段

---

## 2. agent_end

### Event: `PluginHookAgentEndEvent`

| # | 字段 (types.ts) | Schema 列 | Mapper Key | 研究文档 Type | 研究文档 传入数据 | 状态 |
|---|----------------|-----------|------------|-------------|---------------|------|
| 1 | `messages` | `messages` STRING | `safeJson(event.messages)` | ✅ `messages: unknown[]` | ✅ messagesSnapshot | OK |
| 2 | `success` | `success` BOOLEAN | `event.success` | ✅ `success: boolean` | ✅ success | OK |
| 3 | `error?` | `error` STRING | `event.error ?? ""` | ✅ `error?: string` | ✅ error | OK |
| 4 | `durationMs?` | `duration_ms` BIGINT | `event.durationMs ?? 0` | ✅ `durationMs?: number` | ✅ durationMs | OK |
| - | 不在类型中 | - | - | ❌ | ✅ **runId** | **MISSING?** |

### Context: `PluginHookAgentContext` (同 #1)

| # | 状态 |
|---|------|
| 5-10 | 同 before_agent_start 的 context 字段（#3-#9），相同的 VERIFY 状态 |

> **需核查**: (1) agent_end 传入数据中的 `runId` 是放在 event 上还是 context 上？当前代码未捕获此字段。(2) 检查 `attempt.ts:1799` 附近 hookRunner.runAgentEnd 的调用方式。

---

## 3. before_compaction

### Event: `PluginHookBeforeCompactionEvent`

| # | 字段 (types.ts) | Schema 列 | Mapper Key | 研究文档 Type | 研究文档 传入数据 | 状态 |
|---|----------------|-----------|------------|-------------|---------------|------|
| 1 | `messageCount` | `message_count` INT | `event.messageCount` | ✅ `messageCount: number` | ✅ messageCount | OK |
| 2 | `tokenCount?` | `token_count` INT | `event.tokenCount ?? 0` | ✅ `tokenCount?: number` | - | OK |
| 3 | `compactingCount?` | `compacting_count` INT | `event.compactingCount ?? 0` | ❌ 未出现 | ❌ 未提及 | **VERIFY** |

### Context: `PluginHookAgentContext` (同 #1)

> **需核查**: `compactingCount` 是否存在于 OpenClaw 的 `PluginHookBeforeCompactionEvent` 类型中

---

## 4. after_compaction

### Event: `PluginHookAfterCompactionEvent`

| # | 字段 (types.ts) | Schema 列 | Mapper Key | 研究文档 Type | 研究文档 传入数据 | 状态 |
|---|----------------|-----------|------------|-------------|---------------|------|
| 1 | `messageCount` | `message_count` INT | `event.messageCount` | ✅ `messageCount: number` | ✅ messageCount | OK |
| 2 | `tokenCount?` | `token_count` INT | `event.tokenCount ?? 0` | ✅ `tokenCount?: number` | ✅ tokenCount | OK |
| 3 | `compactedCount` | `compacted_count` INT | `event.compactedCount` | ✅ `compactedCount: number` | ✅ compactedCount | OK |

### Context: `PluginHookAgentContext` (同 #1)

> OK - 全部字段对齐

---

## 5. message_received

### Event: `PluginHookMessageReceivedEvent`

| # | 字段 (types.ts) | Schema 列 | Mapper Key | 研究文档 Type | 研究文档 传入数据 | 状态 |
|---|----------------|-----------|------------|-------------|---------------|------|
| 1 | `from` | `from_id` STRING | `event.from` | ✅ `from: string` | ✅ from | OK |
| 2 | `content` | `content` STRING | `event.content` | ✅ `content: string` | ✅ content | OK |
| 3 | `timestamp?` | `event_timestamp` BIGINT | `event.timestamp ?? 0` | ✅ `timestamp?: number` | ✅ timestamp | OK |
| 4 | `metadata?` | `metadata` STRING | `safeJson(event.metadata)` | ✅ `metadata?: Record<...>` | ✅ metadata | OK |

### Context: `PluginHookMessageContext`

| # | 字段 (types.ts) | Schema 列 | Mapper Key | 研究文档 Type | 研究文档 传入数据 | 状态 |
|---|----------------|-----------|------------|-------------|---------------|------|
| 5 | `channelId` | `channel_id` STRING | `ctx.channelId` | ✅ `channelId: string` | ✅ channelId | OK |
| 6 | `accountId?` | `account_id` STRING | `ctx.accountId ?? ""` | ✅ `accountId?: string` | ✅ accountId | OK |
| 7 | `conversationId?` | `conversation_id` STRING | `ctx.conversationId ?? ""` | ✅ `conversationId?: string` | ✅ conversationId | OK |
| 8 | `messageId?` | `message_id` STRING | `ctx.messageId ?? ""` | ❌ 未出现 | metadata 内有 messageId | **VERIFY** |
| 9 | `isGroup?` | `is_group` BOOLEAN | `ctx.isGroup ?? false` | ❌ 未出现 | ❌ 未提及 | **VERIFY** |
| 10 | `groupId?` | `group_id` STRING | `ctx.groupId ?? ""` | ❌ 未出现 | ❌ 未提及 | **VERIFY** |
| 11 | (auto) | `timestamp` BIGINT | `Date.now()` | - | - | OK |

> **需核查**: (1) `messageId` 是在 context 上还是只在 metadata 中？ (2) `isGroup` 和 `groupId` 是否存在？
> **注意**: 研究文档指出 metadata 包含丰富字段: to, provider, surface, threadId, originatingChannel, messageId, senderId, senderName, senderUsername, senderE164。当前用 safeJson 整体序列化是安全的，但如果需要独立查询这些字段，需要考虑是否拆分。

---

## 6. message_sending

### Event: `PluginHookMessageSendingEvent`

| # | 字段 (types.ts) | Schema 列 | Mapper Key | 研究文档 Type | 研究文档 传入数据 | 状态 |
|---|----------------|-----------|------------|-------------|---------------|------|
| 1 | `to` | `to_id` STRING | `event.to` | ✅ `to: string` | ✅ to | OK |
| 2 | `content` | `content` STRING | `event.content` | ✅ `content: string` | ✅ content | OK |
| 3 | `metadata?` | `metadata` STRING | `safeJson(event.metadata)` | ✅ `metadata?: Record<...>` | ✅ metadata | OK |

### Context: `PluginHookMessageContext` (同 #5)

> 同 message_received 的 context VERIFY 项

---

## 7. message_sent

### Event: `PluginHookMessageSentEvent`

| # | 字段 (types.ts) | Schema 列 | Mapper Key | 研究文档 Type | 研究文档 传入数据 | 状态 |
|---|----------------|-----------|------------|-------------|---------------|------|
| 1 | `to` | `to_id` STRING | `event.to` | ✅ `to: string` | ✅ to | OK |
| 2 | `content` | `content` STRING | `event.content` | ✅ `content: string` | ✅ content | OK |
| 3 | `success` | `success` BOOLEAN | `event.success` | ✅ `success: boolean` | ✅ success | OK |
| 4 | `error?` | `error` STRING | `event.error ?? ""` | ✅ `error?: string` | ✅ error | OK |

### Context: `PluginHookMessageContext` (同 #5)

> **额外注意**: 研究文档传入数据提到 message_sent 传入了 messageId，确认 messageId 是否在 context 上

---

## 8. before_tool_call

### Event: `PluginHookBeforeToolCallEvent`

| # | 字段 (types.ts) | Schema 列 | Mapper Key | 研究文档 Type | 研究文档 传入数据 | 状态 |
|---|----------------|-----------|------------|-------------|---------------|------|
| 1 | `toolName` | `tool_name` STRING | `event.toolName` | ✅ `toolName: string` | ✅ toolName | OK |
| 2 | `params` | `params` STRING | `safeJson(event.params)` | ✅ `params: Record<...>` | ✅ params | OK |
| 3 | `runId?` | `run_id` STRING | `event.runId ?? ""` | ❌ 未出现在 event type | ✅ 传入数据有 runId | **VERIFY** |
| 4 | `toolCallId?` | `tool_call_id` STRING | `event.toolCallId ?? ""` | ❌ 未出现在 event type | ✅ 传入数据有 toolCallId | **VERIFY** |

### Context: `PluginHookToolContext`

| # | 字段 (types.ts) | Schema 列 | Mapper Key | 研究文档 Type | 研究文档 传入数据 | 状态 |
|---|----------------|-----------|------------|-------------|---------------|------|
| 5 | `agentId?` | `agent_id` STRING | `ctx.agentId ?? ""` | ✅ `agentId?: string` | ✅ agentId | OK |
| 6 | `sessionKey?` | `session_key` STRING | `ctx.sessionKey ?? ""` | ✅ `sessionKey?: string` | ✅ sessionKey | OK |
| 7 | `toolName` | `context_tool_name` STRING | `ctx.toolName` | ✅ `toolName: string` | - | OK |
| 8 | `runId?` | `context_run_id` STRING | `ctx.runId ?? ""` | ❌ 未出现 | - | **VERIFY** |
| 9 | `toolCallId?` | `context_tool_call_id` STRING | `ctx.toolCallId ?? ""` | ❌ 未出现 | - | **VERIFY** |
| 10 | `sessionId?` | `context_session_id` STRING | `ctx.sessionId ?? ""` | ❌ 未出现 | - | **VERIFY** |
| 11 | (auto) | `timestamp` BIGINT | `Date.now()` | - | - | OK |

> **需核查**: (1) runId/toolCallId 是在 event 上还是 context 上？还是两者都有？(2) context 中是否有 sessionId？
> 检查文件: `src/agents/pi-tools.before-tool-call.ts:194` 附近

---

## 9. after_tool_call

### Event: `PluginHookAfterToolCallEvent`

| # | 字段 (types.ts) | Schema 列 | Mapper Key | 研究文档 Type | 研究文档 传入数据 | 状态 |
|---|----------------|-----------|------------|-------------|---------------|------|
| 1 | `toolName` | `tool_name` STRING | `event.toolName` | ✅ | ✅ | OK |
| 2 | `params` | `params` STRING | `safeJson(event.params)` | ✅ | ✅ | OK |
| 3 | `result?` | `result` STRING | `safeJson(event.result)` | ✅ `result?: unknown` | ✅ | OK |
| 4 | `error?` | `error` STRING | `event.error ?? ""` | ✅ `error?: string` | ✅ | OK |
| 5 | `durationMs?` | `duration_ms` BIGINT | `event.durationMs ?? 0` | ✅ `durationMs?: number` | ✅ | OK |
| 6 | `runId?` | `run_id` STRING | `event.runId ?? ""` | ❌ 未出现在 type | ✅ 传入数据有 | **VERIFY** |
| 7 | `toolCallId?` | `tool_call_id` STRING | `event.toolCallId ?? ""` | ❌ 未出现在 type | ✅ 传入数据有 | **VERIFY** |

### Context: `PluginHookToolContext` (同 #8)

> 检查文件: `src/agents/pi-embedded-subscribe.handlers.tools.ts:609` 附近

---

## 10. tool_result_persist

### Event: `PluginHookToolResultPersistEvent`

| # | 字段 (types.ts) | Schema 列 | Mapper Key | 研究文档 Type | 状态 |
|---|----------------|-----------|------------|-------------|------|
| 1 | `toolName?` | `tool_name` STRING | `event.toolName ?? ""` | ✅ `toolName?: string` | OK |
| 2 | `toolCallId?` | `tool_call_id` STRING | `event.toolCallId ?? ""` | ✅ `toolCallId?: string` | OK |
| 3 | `message` | `message` STRING | `safeJson(event.message)` | ✅ `message: AgentMessage` | OK |
| 4 | `isSynthetic?` | `is_synthetic` BOOLEAN | `event.isSynthetic ?? false` | ✅ `isSynthetic?: boolean` | OK |

### Context: `PluginHookToolResultPersistContext`

| # | 字段 (types.ts) | Schema 列 | Mapper Key | 研究文档 Type | 状态 |
|---|----------------|-----------|------------|-------------|------|
| 5 | `agentId?` | `agent_id` STRING | `ctx.agentId ?? ""` | ✅ | OK |
| 6 | `sessionKey?` | `session_key` STRING | `ctx.sessionKey ?? ""` | ✅ | OK |
| 7 | `toolName?` | `ctx_tool_name` STRING | `ctx.toolName ?? ""` | ✅ | OK |
| 8 | `toolCallId?` | `ctx_tool_call_id` STRING | `ctx.toolCallId ?? ""` | ✅ | OK |
| 9 | (auto) | `timestamp` BIGINT | `Date.now()` | - | OK |

> ✅ 全部对齐，无需进一步确认

---

## 11. session_start

### Event: `PluginHookSessionStartEvent`

| # | 字段 (types.ts) | Schema 列 | Mapper Key | 研究文档 Type | 研究文档 传入数据 | 状态 |
|---|----------------|-----------|------------|-------------|---------------|------|
| 1 | `sessionId` | `session_id` STRING | `event.sessionId` | ✅ `sessionId: string` | ✅ sessionId | OK |
| 2 | `resumedFrom?` | `resumed_from` STRING | `event.resumedFrom ?? ""` | ✅ `resumedFrom?: string` | ✅ resumedFrom | OK |
| 3 | `sessionKey?` | `session_key` STRING | `event.sessionKey ?? ""` | ❌ 未出现在 event type | ❌ 未提及 | **VERIFY** |

### Context: `PluginHookSessionContext`

| # | 字段 (types.ts) | Schema 列 | Mapper Key | 研究文档 Type | 状态 |
|---|----------------|-----------|------------|-------------|------|
| 4 | `agentId?` | `agent_id` STRING | `ctx.agentId ?? ""` | ✅ `agentId?: string` | OK |
| 5 | `sessionId` | `context_session_id` STRING | `ctx.sessionId` | ✅ `sessionId: string` | OK |
| 6 | (auto) | `timestamp` BIGINT | `Date.now()` | - | OK |

> **需核查**: event 上是否有 `sessionKey` 字段
> 检查文件: `src/auto-reply/reply/session.ts:704` 附近

---

## 12. session_end

### Event: `PluginHookSessionEndEvent`

| # | 字段 (types.ts) | Schema 列 | Mapper Key | 研究文档 Type | 研究文档 传入数据 | 状态 |
|---|----------------|-----------|------------|-------------|---------------|------|
| 1 | `sessionId` | `session_id` STRING | `event.sessionId` | ✅ `sessionId: string` | ✅ sessionId | OK |
| 2 | `messageCount` | `message_count` INT | `event.messageCount` | ✅ `messageCount: number` | ✅ messageCount | OK |
| 3 | `durationMs?` | `duration_ms` BIGINT | `event.durationMs ?? 0` | ✅ `durationMs?: number` | ✅ durationMs | OK |
| 4 | `sessionKey?` | `session_key` STRING | `event.sessionKey ?? ""` | ❌ 未出现 | ❌ 未提及 | **VERIFY** |

### Context: `PluginHookSessionContext` (同 #11)

> **需核查**: event 上是否有 `sessionKey` 字段
> 检查文件: `src/auto-reply/reply/session.ts:692` 附近

---

## 13. gateway_start

### Event: `PluginHookGatewayStartEvent`

| # | 字段 (types.ts) | Schema 列 | Mapper Key | 研究文档 Type | 状态 |
|---|----------------|-----------|------------|-------------|------|
| 1 | `port` | `port` INT | `event.port` | ✅ `port: number` | OK |

### Context: `PluginHookGatewayContext`

| # | 字段 (types.ts) | Schema 列 | Mapper Key | 研究文档 Type | 状态 |
|---|----------------|-----------|------------|-------------|------|
| 2 | `port?` | `context_port` INT | `ctx.port ?? 0` | ✅ `port?: number` | OK |
| 3 | (auto) | `timestamp` BIGINT | `Date.now()` | - | OK |

> ✅ 全部对齐

---

## 14. gateway_stop

### Event: `PluginHookGatewayStopEvent`

| # | 字段 (types.ts) | Schema 列 | Mapper Key | 研究文档 Type | 状态 |
|---|----------------|-----------|------------|-------------|------|
| 1 | `reason?` | `reason` STRING | `event.reason ?? ""` | ✅ `reason?: string` | OK |

### Context: `PluginHookGatewayContext`

| # | 字段 (types.ts) | Schema 列 | Mapper Key | 研究文档 Type | 状态 |
|---|----------------|-----------|------------|-------------|------|
| 2 | `port?` | `context_port` INT | `ctx.port ?? 0` | ✅ `port?: number` | OK |
| 3 | (auto) | `timestamp` BIGINT | `Date.now()` | - | OK |

> ✅ 全部对齐

---

## VERIFY 清单汇总

以下是所有需要去 OpenClaw 源码确认的项目：

### 高优先级 - 可能遗漏的字段

| # | Hook | 字段 | 问题 | 去哪里查 |
|---|------|------|------|---------|
| H1 | `agent_end` | `runId` | 传入数据明确列出但代码中未捕获 | `src/agents/pi-embedded-runner/run/attempt.ts:1799` |

### 中优先级 - 需确认字段是否存在于类型定义

| # | Hook(s) | 字段 | 问题 | 去哪里查 |
|---|---------|------|------|---------|
| M1 | Agent 类 (4个) | `sessionId`, `trigger`, `channelId` on AgentContext | 研究文档的 AgentContext 只有 4 个字段 | `src/plugins/types.ts` 中 `PluginHookAgentContext` |
| M2 | Message 类 (3个) | `messageId`, `isGroup`, `groupId` on MessageContext | 研究文档的 MessageContext 只有 3 个字段 | `src/plugins/types.ts` 中 `PluginHookMessageContext` |
| M3 | Tool 类 (2个) | `runId`, `toolCallId`, `sessionId` on ToolContext | 研究文档的 ToolContext 只有 3 个字段 | `src/plugins/types.ts` 中 `PluginHookToolContext` |
| M4 | Tool 类 (2个) | `runId`, `toolCallId` on event | 研究文档的 event type 中无这些字段 | `src/plugins/types.ts` 中对应 event type |
| M5 | `before_compaction` | `compactingCount` | 研究文档的 event type 中无此字段 | `src/plugins/types.ts` 中 `PluginHookBeforeCompactionEvent` |
| M6 | Session 类 (2个) | `sessionKey` on event | 研究文档的 event type 中无此字段 | `src/plugins/types.ts` 中 `PluginHookSessionStartEvent` / `EndEvent` |

### 低优先级 - 潜在的数据丰富度优化

| # | Hook | 说明 |
|---|------|------|
| L1 | `message_received` | metadata 内含 senderId, senderName, senderUsername 等 10+ 子字段，当前整体 JSON 序列化，若需独立 SQL 查询可考虑拆分 |

---

## OpenClaw 源码核查指南

### 需要查看的 OpenClaw 文件（按优先级排序）

#### 1. 类型定义（最关键）
```
src/plugins/types.ts
```
直接搜索以下类型名，对比每个字段：
- `PluginHookAgentContext`
- `PluginHookMessageContext`
- `PluginHookToolContext`
- `PluginHookBeforeToolCallEvent`
- `PluginHookAfterToolCallEvent`
- `PluginHookBeforeCompactionEvent`
- `PluginHookSessionStartEvent`
- `PluginHookSessionEndEvent`

#### 2. Hook Runner（了解 event/context 如何组装）
```
src/plugins/hooks.ts
```
搜索每个 `run*` 方法（如 `runAgentEnd`, `runBeforeToolCall`），看传入参数如何拆分为 event 和 context。

#### 3. 触发点（了解实际传入了什么数据）

| Hook | 文件 | 行号 |
|------|------|------|
| `before_agent_start` | `src/agents/pi-embedded-runner/run/setup.ts` | ~67 |
| `agent_end` | `src/agents/pi-embedded-runner/run/attempt.ts` | ~1799 |
| `before_compaction` | `src/agents/pi-embedded-subscribe.handlers.compaction.ts` | ~26 |
| `after_compaction` | `src/agents/pi-embedded-subscribe.handlers.compaction.ts` | ~89 |
| `message_received` | `src/auto-reply/reply/dispatch-from-config.ts` | ~421 |
| `message_sending` | `src/infra/outbound/deliver.ts` | ~446 |
| `message_sent` | `src/infra/outbound/deliver.ts` | ~394 |
| `before_tool_call` | `src/agents/pi-tools.before-tool-call.ts` | ~194 |
| `after_tool_call` | `src/agents/pi-embedded-subscribe.handlers.tools.ts` | ~609 |
| `tool_result_persist` | `src/agents/session-tool-result-guard-wrapper.ts` | ~47 |
| `session_start` | `src/auto-reply/reply/session.ts` | ~704 |
| `session_end` | `src/auto-reply/reply/session.ts` | ~692 |
| `gateway_start` | `src/gateway/server.impl.ts` | ~1392 |
| `gateway_stop` | `src/plugins/hook-runner-global.ts` | ~85 |

### 建议的检查步骤

1. **打开 `src/plugins/types.ts`**，逐一对比上表中所有 VERIFY 字段
2. **打开 `src/plugins/hooks.ts`**，找到每个 `run*` 方法，确认 event/context 的组装方式
3. **对于仍不确定的字段**，去对应触发点文件查看调用代码
4. 每确认一项，在本表的状态列标注 `CONFIRMED` 或 `NOT_EXIST`
