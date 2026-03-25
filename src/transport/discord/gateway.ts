import { Client, Events, GatewayIntentBits, type Message } from "discord.js";
import { processInboundMessage } from "../../runtime/bridge.js";
import type { CodexProvider } from "../../provider/codex.js";
import type { StateDb } from "../../store/state-db.js";
import type { DisGgClient } from "../disgg/client.js";
import type { BridgeConfig, ChannelBinding, DiscordMessage } from "../../types.js";

type GatewayRuntimeParams = {
  config: BridgeConfig;
  token: string;
  appId: string;
  actionClient: Pick<DisGgClient, "buildExecutableTools" | "sendMessage" | "editMessage" | "sendTyping">;
  provider: Pick<CodexProvider, "runTurn">;
  db: Pick<StateDb, "getSession" | "saveBindingSession" | "hasProcessedMessage" | "markProcessed">;
};

export type GatewayClientLike = {
  user: { id: string; tag: string } | null;
  once: (event: string | symbol, listener: (...args: unknown[]) => void) => GatewayClientLike;
  on: (event: string | symbol, listener: (...args: unknown[]) => void) => GatewayClientLike;
  login: (token: string) => Promise<string>;
  destroy: () => void;
};

function createBindingIndex(bindings: ChannelBinding[]): Map<string, ChannelBinding> {
  return new Map(bindings.filter((binding) => binding.enabled).map((binding) => [binding.channelId, binding]));
}

async function resolveReferencedAuthorId(message: Message): Promise<string | undefined> {
  try {
    const referenced = await message.fetchReference();
    return referenced.author.id;
  } catch {
    return undefined;
  }
}

async function normalizeMessage(message: Message): Promise<DiscordMessage | null> {
  if (!message.inGuild()) {
    return null;
  }
  const referencedAuthorId = message.reference?.messageId
    ? await resolveReferencedAuthorId(message)
    : undefined;
  return {
    id: message.id,
    channel_id: message.channelId,
    content: message.content,
    author: {
      id: message.author.id,
      username: message.author.username,
      global_name: message.author.globalName,
    },
    attachments: [...message.attachments.values()].map((attachment) => ({
      id: attachment.id,
      filename: attachment.name,
      url: attachment.url,
      content_type: attachment.contentType,
    })),
    ...(message.reference
      ? {
          message_reference: {
            message_id: message.reference.messageId ?? undefined,
            channel_id: message.reference.channelId ?? undefined,
            guild_id: message.reference.guildId ?? undefined,
            ...(referencedAuthorId ? { author_id: referencedAuthorId } : {}),
          },
        }
      : {}),
    timestamp: message.createdAt.toISOString(),
  };
}

function createGatewayClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });
}

async function waitForShutdown(gateway: GatewayClientLike): Promise<void> {
  await new Promise<void>((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      process.off("SIGINT", finish);
      process.off("SIGTERM", finish);
      gateway.destroy();
      resolve();
    };
    process.on("SIGINT", finish);
    process.on("SIGTERM", finish);
  });
}

export function registerGatewayHandlers(
  gateway: GatewayClientLike,
  params: Omit<GatewayRuntimeParams, "token">,
): void {
  const bindingIndex = createBindingIndex(params.config.bindings);
  const channelQueues = new Map<string, Promise<void>>();

  gateway.once(Events.ClientReady, (client) => {
    const liveClient = client as Client;
    const tag = liveClient.user?.tag || "unknown-user";
    console.log(`OpenChord gateway ready as ${tag}. Listening to ${bindingIndex.size} channel(s).`);
  });

  gateway.on(Events.Error, (error) => {
    console.error("OpenChord gateway error:", error instanceof Error ? error.message : error);
  });

  gateway.on(Events.ShardDisconnect, (_closeEvent, shardId) => {
    console.warn(`OpenChord gateway shard ${String(shardId)} disconnected.`);
  });

  gateway.on(Events.ShardResume, (shardId) => {
    console.log(`OpenChord gateway shard ${String(shardId)} resumed.`);
  });

  gateway.on(Events.MessageCreate, async (value) => {
    const message = value as Message;
    const binding = bindingIndex.get(message.channelId);
    if (!binding) {
      return;
    }
    if (message.author.bot || message.author.id === params.appId || message.author.id === gateway.user?.id) {
      return;
    }

    const normalized = await normalizeMessage(message);
    if (!normalized) {
      return;
    }

    const previous = channelQueues.get(binding.channelId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          await processInboundMessage({
            config: params.config,
            client: params.actionClient,
            provider: params.provider,
            db: params.db,
            binding,
            appId: params.appId,
            message: normalized,
          });
        } catch (error) {
          console.error(
            `Failed processing ${binding.guildId}/${binding.channelId}/${normalized.id}:`,
            error instanceof Error ? error.message : error,
          );
        }
      })
      .finally(() => {
        if (channelQueues.get(binding.channelId) === next) {
          channelQueues.delete(binding.channelId);
        }
      });
    channelQueues.set(binding.channelId, next);
  });
}

export async function runGatewayRuntime(params: GatewayRuntimeParams): Promise<void> {
  const gateway = createGatewayClient();
  registerGatewayHandlers(gateway, {
    config: params.config,
    appId: params.appId,
    actionClient: params.actionClient,
    provider: params.provider,
    db: params.db,
  });
  await gateway.login(params.token);
  await waitForShutdown(gateway);
}
