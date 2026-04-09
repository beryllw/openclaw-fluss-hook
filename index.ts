import type { OpenClawPluginApi } from "./src/types.js";
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

import type { FlussHookPlugin } from "./src/types.js";

// OpenClaw 在启动过程中可能多次调用 register()（如 reloadDeferredGatewayPlugins 与首次加载
// 的 cache key 不一致时会绕过缓存，导致重复执行 register）。加模块级守卫避免重复创建 buffer
// 和注册 handler。
let registered = false;

const plugin: FlussHookPlugin = {
  id: "fluss-hook",
  name: "Fluss Hook Event Logger",
  description: "Log all OpenClaw hook events to Apache Fluss for real-time analytics",

  register(api: OpenClawPluginApi) {
    if (registered) {
      api.logger.info("[fluss-hook] already registered, skipping duplicate registration");
      return;
    }
    registered = true;

    const config = resolveConfig(api.pluginConfig);

    let sink: EventSink;
    let recordingSink: RecordingSink | undefined;

    if (config.outputMode === "console") {
      // Prints events to stdout for local debugging, also records them
      const consoleSink = new ConsoleSink();
      recordingSink = new RecordingSink(consoleSink);
      plugin.__recordingSink = recordingSink;
      sink = recordingSink;
    } else if (config.outputMode === "memory") {
      // Test-only mode: records events without writing anywhere
      const noOpSink: EventSink = {
        appendBatch: () => Promise.resolve(),
        close: () => {},
      };
      recordingSink = new RecordingSink(noOpSink);
      plugin.__recordingSink = recordingSink;
      sink = recordingSink;
    } else {
      sink = new GatewayClient(config, api.logger);
    }

    const buffer = new MultiTableBuffer(sink, config, api.logger);
    plugin.__testBuffer = { flushAll: () => buffer.flushAll() };

    // -- Agent Hooks --
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

    // -- Message Hooks --
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

    // -- Tool Hooks --
    api.on("before_tool_call", (event, ctx) => {
      buffer.push("before_tool_call", mapBeforeToolCall(event, ctx));
    });

    api.on("after_tool_call", (event, ctx) => {
      buffer.push("after_tool_call", mapAfterToolCall(event, ctx));
    });

    api.on("tool_result_persist", (event, ctx) => {
      buffer.push("tool_result_persist", mapToolResultPersist(event, ctx));
    });

    // -- Session Hooks --
    api.on("session_start", (event, ctx) => {
      buffer.push("session_start", mapSessionStart(event, ctx));
    });

    api.on("session_end", (event, ctx) => {
      buffer.push("session_end", mapSessionEnd(event, ctx));
    });

    // -- Subagent Hooks --
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

    // -- Gateway Hooks --
    api.on("gateway_start", (event, ctx) => {
      buffer.push("gateway_start", mapGatewayStart(event, ctx));
    });

    api.on("gateway_stop", (event, ctx) => {
      buffer.push("gateway_stop", mapGatewayStop(event, ctx));
    });

    api.registerService({
      id: "fluss-hook",
      start: async () => {
        if (config.outputMode === "fluss") {
          await (sink as GatewayClient).ensureDatabase();
        }
        buffer.start();
      },
      stop: async () => {
        await buffer.stop();
      },
    });

    api.logger.info(`[fluss-hook] Plugin registered (26 hooks, output=${config.outputMode})`);
  },
};

/** Test-only: reset registration guard so each test starts fresh. */
export function __testResetRegistered(): void {
  registered = false;
}

export default plugin;
