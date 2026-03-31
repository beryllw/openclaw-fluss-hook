import type { OpenClawPluginApi } from "./src/types.js";
import { resolveConfig } from "./src/config.js";
import { FlussClientManager } from "./src/fluss-client.js";
import { MultiTableBuffer } from "./src/message-buffer.js";
import {
  mapBeforeAgentStart,
  mapAgentEnd,
  mapBeforeCompaction,
  mapAfterCompaction,
  mapMessageReceived,
  mapMessageSending,
  mapMessageSent,
  mapBeforeToolCall,
  mapAfterToolCall,
  mapToolResultPersist,
  mapSessionStart,
  mapSessionEnd,
  mapGatewayStart,
  mapGatewayStop,
} from "./src/event-mappers.js";

const plugin = {
  id: "fluss-hook",
  name: "Fluss Hook Event Logger",
  description: "Log all OpenClaw hook events to Apache Fluss for real-time analytics",

  register(api: OpenClawPluginApi) {
    const config = resolveConfig(api.pluginConfig);
    const flussClient = new FlussClientManager(config, api.logger);
    const buffer = new MultiTableBuffer(flussClient, config, api.logger);

    // -- Agent Hooks --
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

    // -- Message Hooks --
    api.on("message_received", (event, ctx) => {
      buffer.push("message_received", mapMessageReceived(event, ctx));
    });

    api.on("message_sending", (event, ctx) => {
      buffer.push("message_sending", mapMessageSending(event, ctx));
    });

    api.on("message_sent", (event, ctx) => {
      buffer.push("message_sent", mapMessageSent(event, ctx));
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

    // -- Gateway Hooks --
    api.on("gateway_start", (event, ctx) => {
      buffer.push("gateway_start", mapGatewayStart(event, ctx));
    });

    api.on("gateway_stop", (event, ctx) => {
      buffer.push("gateway_stop", mapGatewayStop(event, ctx));
    });

    api.registerService({
      id: "fluss-hook",
      start: () => {
        buffer.start();
      },
      stop: async () => {
        await buffer.stop();
      },
    });

    api.logger.info("[fluss-hook] Plugin registered (14 hooks)");
  },
};

export default plugin;
