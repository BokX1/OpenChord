import { upsertBinding } from "../store/config.js";
import type { DisGgClient } from "../transport/disgg/client.js";
import type { ChannelBinding, DiscordGuild, DiscordGuildChannel, ReplyMode } from "../types.js";
import { prompt } from "../utils/terminal.js";

type PromptFn = (question: string) => Promise<string>;

type OnboardDependencies = {
  botTokenPresent: boolean;
  codexReady: boolean;
  client: Pick<DisGgClient, "getAccessContext" | "listCurrentUserGuilds" | "listGuildChannels" | "fetchMessages">;
  ask?: PromptFn;
};

function isMessageChannel(channel: DiscordGuildChannel): boolean {
  if (typeof channel.type !== "number") {
    return true;
  }
  return [0, 5, 11, 12, 15].includes(channel.type);
}

async function chooseIndex(params: {
  title: string;
  items: string[];
  ask: PromptFn;
}): Promise<number> {
  console.log(params.title);
  params.items.forEach((item, index) => {
    console.log(`  ${index + 1}. ${item}`);
  });

  while (true) {
    const raw = await params.ask(`Choose a number (1-${params.items.length}):`);
    const value = Number.parseInt(raw, 10);
    if (Number.isInteger(value) && value >= 1 && value <= params.items.length) {
      return value - 1;
    }
    console.log("Please enter a valid number.");
  }
}

async function chooseReplyMode(ask: PromptFn): Promise<ReplyMode> {
  console.log("Reply modes:");
  console.log("  1. mention - only reply when mentioned");
  console.log("  2. always - reply to every message in the bound channel");
  while (true) {
    const raw = await ask("Choose a mode (1-2, default 1):");
    if (!raw || raw === "1") {
      return "mention";
    }
    if (raw === "2") {
      return "always";
    }
    console.log("Please enter 1 or 2.");
  }
}

export async function runOnboard(deps: OnboardDependencies): Promise<ChannelBinding> {
  const ask = deps.ask ?? prompt;
  if (!deps.botTokenPresent) {
    throw new Error("Missing Discord bot token. Run `openchord setup` or set the configured token env var before onboarding.");
  }

  if (!deps.codexReady) {
    throw new Error("Codex is not ready. Run `openchord setup` or `openchord doctor` and make sure app-server auth passes first.");
  }

  await deps.client.getAccessContext();
  const guilds = (await deps.client.listCurrentUserGuilds()).filter((guild) => Boolean(guild.id && guild.name));
  if (!guilds.length) {
    throw new Error("No guilds are visible to the current bot token.");
  }

  const guildIndex = await chooseIndex({
    title: "Visible guilds:",
    items: guilds.map((guild) => `${guild.name} (${guild.id})`),
    ask,
  });
  const guild = guilds[guildIndex] as DiscordGuild;

  const channels = (await deps.client.listGuildChannels({ guildId: guild.id }))
    .filter((channel) => isMessageChannel(channel) && Boolean(channel.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (!channels.length) {
    throw new Error(`No message-capable channels were found in ${guild.name}.`);
  }

  const channelIndex = await chooseIndex({
    title: `Channels in ${guild.name}:`,
    items: channels.map((channel) => `#${channel.name} (${channel.id})`),
    ask,
  });
  const channel = channels[channelIndex] as DiscordGuildChannel;
  const mode = await chooseReplyMode(ask);

  const binding: ChannelBinding = {
    guildId: guild.id,
    guildName: guild.name,
    channelId: channel.id,
    channelName: channel.name,
    mode,
    enabled: true,
  };

  await deps.client.fetchMessages(binding, null, 1);
  upsertBinding(binding);
  console.log(`Saved OpenChord binding for ${guild.name} / #${channel.name} in ${mode} mode.`);
  return binding;
}
