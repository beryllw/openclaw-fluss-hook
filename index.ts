import type { OpenClawPluginApi } from "./src/types.js";
import { resolveConfig } from "./src/config.js";
import { FlussClientManager } from "./src/fluss-client.js";
import { MessageBuffer } from "./src/message-buffer.js";
import { mapMessageReceived, mapMessageSent, mapAgentEnd } from "./src/message-mapper.js";

const plugin = {
  id: "fluss-hook",
  name: "Fluss Message Logger",
  description: "Log all messages to Apache Fluss for real-time analytics",

  register(api: OpenClawPluginApi) {
    const config = resolveConfig(api.pluginConfig);
    const flussClient = new FlussClientManager(config, api.logger);
    const buffer = new MessageBuffer(flussClient, config, api.logger);

    api.on("message_received", (event, ctx) => {
      buffer.push(mapMessageReceived(event, ctx));
    });

    api.on("message_sent", (event, ctx) => {
      buffer.push(mapMessageSent(event, ctx));
    });

    api.on("agent_end", (event, ctx) => {
      const rows = mapAgentEnd(event, ctx);
      for (const row of rows) {
        buffer.push(row);
      }
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

    api.logger.info("[fluss-hook] Plugin registered");
  },
};

export default plugin;
