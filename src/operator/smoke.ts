import { CodexProvider } from "../provider/codex.js";
import { getBindingLabel } from "../runtime/bridge.js";
import { loadConfig } from "../store/config.js";
import { DisGgClient } from "../transport/disgg/client.js";
import type { BridgeConfig, ChannelBinding, DiscordMessage } from "../types.js";

type SmokeDependencies = {
  config: BridgeConfig;
  client: Pick<DisGgClient, "getAccessContext" | "fetchMessages" | "buildExecutableTools" | "sendMessage">;
  provider: Pick<CodexProvider, "runTurn" | "close">;
};

export type SmokeResult = {
  binding: ChannelBinding;
  latestMessageId: string | null;
  replyPreview: string;
  posted: boolean;
};

function pickBinding(config: BridgeConfig, channelId?: string): ChannelBinding {
  if (channelId) {
    const binding = config.bindings.find((entry) => entry.channelId === channelId);
    if (!binding) {
      throw new Error(`No binding found for channel ${channelId}.`);
    }
    return binding;
  }
  const binding = config.bindings.find((entry) => entry.enabled);
  if (!binding) {
    throw new Error("No enabled bindings found. Run `openchord setup` or `openchord channels add` first.");
  }
  return binding;
}

export async function runSmokeCheck(
  deps: SmokeDependencies,
  options?: { channelId?: string; post?: boolean },
): Promise<SmokeResult> {
  const binding = pickBinding(deps.config, options?.channelId);
  await deps.client.getAccessContext();
  const messages = await deps.client.fetchMessages(binding, null, 1);
  const latestMessage = messages.at(0) ?? null;
  const latestMessageId = latestMessage?.id ?? null;
  const toolContext = {
    currentGuildId: binding.guildId,
    currentChannelId: binding.channelId,
    currentMessageId: latestMessage?.id,
    currentUserId: latestMessage?.author.id,
    targetGuilds:
      deps.config.safety.targetGuildsMode === "bound-guild" ? [binding.guildId] : undefined,
  };
  const tools = await deps.client.buildExecutableTools(toolContext);
  const syntheticMessage: DiscordMessage = {
    id: latestMessageId ?? "smoke-message",
    channel_id: binding.channelId,
    content: "OpenChord smoke test. Reply with one short sentence confirming that the bridge, app-server, and Discord tool layer are healthy.",
    author: {
      id: "openchord-smoke",
      username: "OpenChord Smoke",
      global_name: "OpenChord Smoke",
    },
    timestamp: new Date().toISOString(),
  };

  const result = await deps.provider.runTurn({
    config: deps.config,
    session: null,
    bindingLabel: getBindingLabel(binding),
    mode: binding.mode,
    userRole: "owner",
    message: syntheticMessage,
    appId: "openchord-smoke",
    tools,
  });

  if (options?.post) {
    await deps.client.sendMessage(binding, result.finalText);
  }

  return {
    binding,
    latestMessageId,
    replyPreview: result.finalText,
    posted: Boolean(options?.post),
  };
}

export async function runSmoke(options?: { channelId?: string; post?: boolean }): Promise<SmokeResult> {
  const config = loadConfig();
  const token = process.env[config.transport.botTokenEnvVar];
  if (!token) {
    throw new Error(`Missing Discord bot token in environment variable ${config.transport.botTokenEnvVar}.`);
  }

  const client = new DisGgClient({ config, token });
  const provider = new CodexProvider();
  try {
    const result = await runSmokeCheck(
      { config, client, provider },
      options,
    );

    console.log(`OpenChord smoke target: ${getBindingLabel(result.binding)}`);
    console.log(`Latest message id: ${result.latestMessageId ?? "-"}`);
    console.log(`Provider reply: ${result.replyPreview}`);
    console.log(result.posted ? "Posted smoke confirmation to Discord." : "Dry run only. Use --post to send the confirmation.");
    return result;
  } finally {
    await provider.close();
  }
}
