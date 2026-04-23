import type { FlussHookPlugin, OpenClawPluginApi } from "./src/types.js";
import { resolveConfig } from "./src/config.js";
import { GatewayClient } from "./src/fluss-client.js";
import { MultiTableBuffer } from "./src/message-buffer.js";
import { RecordingSink, ConsoleSink, type EventSink } from "./src/sink.js";
import {
  mapBeforeModelResolve,
  mapBeforePromptBuild,
  mapBeforeAgentStart,
  mapAgentEnd,
  mapBeforeCompaction,
  mapAfterCompaction,
  mapBeforeReset,
  mapLlmInput,
  mapLlmOutput,
  mapInboundClaim,
  mapBeforeDispatch,
  mapMessageReceived,
  mapMessageSending,
  mapMessageSent,
  mapBeforeMessageWrite,
  mapBeforeToolCall,
  mapAfterToolCall,
  mapToolResultPersist,
  mapSessionStart,
  mapSessionEnd,
  mapSubagentSpawning,
  mapSubagentDeliveryTarget,
  mapSubagentSpawned,
  mapSubagentEnded,
  mapGatewayStart,
  mapGatewayStop,
} from "./src/event-mappers.js";

// ── 模块级单例状态 ───────────────────────────────────────────────────
// OpenClaw 在启动过程中可能多次调用 register()（如 reloadDeferredGatewayPlugins 与首次加载
// 的 cache key 不一致时会绕过缓存）。所有 register() 调用共享同一个 buffer/sink，确保：
// 1. 每次注册都能在新 registry 中安装 handlers（避免 global hook runner 被替换后 handlers 丢失）
// 2. 不会重复创建 buffer / GatewayClient / timer
// 3. 服务只启动一次

let singletonBuffer: MultiTableBuffer | null = null;
let singletonSink: EventSink | null = null;
let singletonRecordingSink: RecordingSink | null = null;
let singletonServiceRegistered = false;
let singletonConfig: ReturnType<typeof resolveConfig> | null = null;

function ensureSingleton(config: ReturnType<typeof resolveConfig>, logger: OpenClawPluginApi["logger"]): MultiTableBuffer {
  if (singletonBuffer) {
    if (singletonConfig && singletonConfig.outputMode !== config.outputMode) {
      logger.warn(`[fluss-hook] re-register detected with different outputMode (was=${singletonConfig.outputMode}, now=${config.outputMode}), reusing existing singleton`);
    }
    return singletonBuffer;
  }

  let sink: EventSink;
  let recordingSink: RecordingSink | undefined;

  if (config.outputMode === "console") {
    const consoleSink = new ConsoleSink();
    recordingSink = new RecordingSink(consoleSink);
    sink = recordingSink;
  } else if (config.outputMode === "memory") {
    const noOpSink: EventSink = {
      appendBatch: () => Promise.resolve(),
      close: () => {},
    };
    recordingSink = new RecordingSink(noOpSink);
    sink = recordingSink;
  } else {
    sink = new GatewayClient(config, logger);
  }

  singletonSink = sink;
  singletonRecordingSink = recordingSink ?? null;
  singletonConfig = config;
  singletonBuffer = new MultiTableBuffer(sink, config, logger);
  return singletonBuffer;
}

/** 仅用于测试：重置单例状态，确保每个测试用例从干净状态开始。 */
export function __testResetSingleton(): void {
  if (singletonBuffer) {
    singletonBuffer.clearTimer();
  }
  singletonBuffer = null;
  singletonSink = null;
  singletonRecordingSink = null;
  singletonConfig = null;
  singletonServiceRegistered = false;
}

// ── 插件定义 ─────────────────────────────────────────────────────────

const plugin: FlussHookPlugin = {
  id: "fluss-hook",
  name: "Fluss Hook Event Logger",
  description: "Log all OpenClaw hook events to Apache Fluss for real-time analytics",

  register(api: OpenClawPluginApi) {
    const config = resolveConfig(api.pluginConfig);
    const buffer = ensureSingleton(config, api.logger);

    // 暴露给测试使用
    plugin.__testBuffer = { flushAll: () => buffer.flushAll() };
    if (singletonRecordingSink) {
      plugin.__recordingSink = singletonRecordingSink;
    }

    // -- Agent 钩子 --
    api.on("before_model_resolve", (event, ctx) => {
      buffer.push("before_model_resolve", mapBeforeModelResolve(event, ctx));
    });

    api.on("before_prompt_build", (event, ctx) => {
      buffer.push("before_prompt_build", mapBeforePromptBuild(event, ctx));
    });

    api.on("before_agent_start", (event, ctx) => {
      buffer.push("before_agent_start", mapBeforeAgentStart(event, ctx));
    });

    api.on("agent_end", (event, ctx) => {
      buffer.push("agent_end", mapAgentEnd(event, ctx));
    });

    api.on("before_compaction", (event, ctx) => {
      buffer.push("before_compaction", mapBeforeCompaction(event, ctx));
    });

    api.on("after_compaction", (event, ctx) => {
      buffer.push("after_compaction", mapAfterCompaction(event, ctx));
    });

    api.on("before_reset", (event, ctx) => {
      buffer.push("before_reset", mapBeforeReset(event, ctx));
    });

    api.on("llm_input", (event, ctx) => {
      buffer.push("llm_input", mapLlmInput(event, ctx));
    });

    api.on("llm_output", (event, ctx) => {
      buffer.push("llm_output", mapLlmOutput(event, ctx));
    });

    // -- 消息钩子 --
    api.on("inbound_claim", (event, ctx) => {
      buffer.push("inbound_claim", mapInboundClaim(event, ctx));
    });

    api.on("before_dispatch", (event, ctx) => {
      buffer.push("before_dispatch", mapBeforeDispatch(event, ctx));
    });

    api.on("message_received", (event, ctx) => {
      buffer.push("message_received", mapMessageReceived(event, ctx));
    });

    api.on("message_sending", (event, ctx) => {
      buffer.push("message_sending", mapMessageSending(event, ctx));
    });

    api.on("message_sent", (event, ctx) => {
      buffer.push("message_sent", mapMessageSent(event, ctx));
    });

    api.on("before_message_write", (event, ctx) => {
      buffer.push("before_message_write", mapBeforeMessageWrite(event, ctx));
    });

    // -- 工具钩子 --
    api.on("before_tool_call", (event, ctx) => {
      buffer.push("before_tool_call", mapBeforeToolCall(event, ctx));
    });

    api.on("after_tool_call", (event, ctx) => {
      buffer.push("after_tool_call", mapAfterToolCall(event, ctx));
    });

    api.on("tool_result_persist", (event, ctx) => {
      buffer.push("tool_result_persist", mapToolResultPersist(event, ctx));
    });

    // -- 会话钩子 --
    api.on("session_start", (event, ctx) => {
      buffer.push("session_start", mapSessionStart(event, ctx));
    });

    api.on("session_end", (event, ctx) => {
      buffer.push("session_end", mapSessionEnd(event, ctx));
    });

    // -- 子 Agent 钩子 --
    api.on("subagent_spawning", (event, ctx) => {
      buffer.push("subagent_spawning", mapSubagentSpawning(event, ctx));
    });

    api.on("subagent_delivery_target", (event, ctx) => {
      buffer.push("subagent_delivery_target", mapSubagentDeliveryTarget(event, ctx));
    });

    api.on("subagent_spawned", (event, ctx) => {
      buffer.push("subagent_spawned", mapSubagentSpawned(event, ctx));
    });

    api.on("subagent_ended", (event, ctx) => {
      buffer.push("subagent_ended", mapSubagentEnded(event, ctx));
    });

    // -- 网关钩子 --
    api.on("gateway_start", (event, ctx) => {
      buffer.push("gateway_start", mapGatewayStart(event, ctx));
    });

    api.on("gateway_stop", (event, ctx) => {
      buffer.push("gateway_stop", mapGatewayStop(event, ctx));
    });

    // 服务只注册一次 —— OpenClaw 会拒绝重复的 service ID
    if (!singletonServiceRegistered) {
      singletonServiceRegistered = true;
      api.registerService({
        id: "fluss-hook",
        start: async () => {
          if (config.outputMode === "fluss") {
            await (singletonSink as GatewayClient).ensureDatabase();
          }
          singletonBuffer!.start();
        },
        stop: async () => {
          await singletonBuffer!.stop();
        },
      });
    }

    api.logger.info(`[fluss-hook] Plugin registered (26 hooks, output=${config.outputMode})`);
  },
};

export default plugin;
