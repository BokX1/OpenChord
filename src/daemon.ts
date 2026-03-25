import { CodexProvider } from "./provider/codex.js";
import { loadConfig } from "./store/config.js";
import { StateDb } from "./store/state-db.js";
import { runGatewayRuntime } from "./transport/discord/gateway.js";
import { DisGgClient } from "./transport/disgg/client.js";
import type { BridgeConfig } from "./types.js";

function requireDiscordToken(config: BridgeConfig): string {
  const token = process.env[config.transport.botTokenEnvVar];
  if (!token) {
    throw new Error(
      `Missing Discord bot token in environment variable ${config.transport.botTokenEnvVar}.`,
    );
  }
  return token;
}

export async function runDaemon(): Promise<void> {
  const config = loadConfig();
  const token = requireDiscordToken(config);
  const db = new StateDb();
  const actionClient = new DisGgClient({ config, token });
  const provider = new CodexProvider();

  try {
    const accessContext = await actionClient.getAccessContext();
    const appId = accessContext.app_id;
    if (!config.bindings.length) {
      console.log("No channel bindings configured. Use `openchord setup` or `openchord channels add` first.");
      return;
    }
    await runGatewayRuntime({
      config,
      token,
      appId,
      actionClient,
      provider,
      db,
    });
  } finally {
    await provider.close();
    db.close();
  }
}
