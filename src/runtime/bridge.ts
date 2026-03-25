import { CodexProvider } from "../provider/codex.js";
import { shouldReply } from "../router/router.js";
import type { StateDb } from "../store/state-db.js";
import type { DiscordPostedMessage, DisGgClient, ExecutableTool } from "../transport/disgg/client.js";
import type { AuthorityRole, BridgeConfig, ChannelBinding, ChannelSession, DisGgCallContext, DiscordMessage, ProgressUpdate } from "../types.js";

const PROGRESS_DEBOUNCE_MS = 1200;
const TYPING_KEEPALIVE_MS = 7000;
const DISCORD_SAFE_MESSAGE_LENGTH = 1998;
const DEFAULT_PROGRESS_TEXT = "Thinking...";

export function getBindingLabel(binding: ChannelBinding): string {
  const guild = binding.guildName || binding.guildId;
  const channel = binding.channelName || binding.channelId;
  return `${guild} / #${channel}`;
}

export function buildToolContext(params: {
  config: BridgeConfig;
  binding: ChannelBinding;
  triggerMessage?: DiscordMessage;
}): DisGgCallContext {
  const targetGuilds =
    params.config.safety.targetGuildsMode === "bound-guild" ? [params.binding.guildId] : undefined;
  return {
    currentGuildId: params.binding.guildId,
    currentChannelId: params.binding.channelId,
    currentMessageId: params.triggerMessage?.id,
    currentUserId: params.triggerMessage?.author.id,
    targetGuilds,
  };
}

function resolveAuthorityRole(config: BridgeConfig, message: DiscordMessage): AuthorityRole {
  if (config.authority.ownerUserId && message.author.id === config.authority.ownerUserId) {
    return "owner";
  }
  if (config.authority.adminUserIds.includes(message.author.id)) {
    return "admin";
  }
  return "user";
}

export type InboundMessageDependencies = {
  config: BridgeConfig;
  client: Pick<DisGgClient, "buildExecutableTools" | "sendMessage" | "editMessage" | "sendTyping">;
  provider: Pick<CodexProvider, "runTurn">;
  db: Pick<StateDb, "getSession" | "saveBindingSession" | "hasProcessedMessage" | "markProcessed">;
  binding: ChannelBinding;
  appId: string;
  message: DiscordMessage;
};

export type InboundMessageResult = {
  replied: boolean;
  ignoredReason?: "duplicate" | "self" | "gated";
  session?: ChannelSession;
};

function readPostedMessageId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return typeof (value as DiscordPostedMessage).id === "string" ? (value as DiscordPostedMessage).id : null;
}

function findChunkBoundary(text: string, maxLength: number): number {
  const window = text.slice(0, maxLength + 1);
  const splitAt = Math.max(
    window.lastIndexOf("\n\n"),
    window.lastIndexOf("\n"),
    window.lastIndexOf(" "),
  );
  return splitAt > 0 ? splitAt : maxLength;
}

function hasUnclosedCodeFence(text: string): boolean {
  return (text.match(/```/g)?.length ?? 0) % 2 === 1;
}

function readFenceHeader(text: string): string {
  const markerIndex = text.lastIndexOf("```");
  if (markerIndex === -1) {
    return "```";
  }
  const lineEnd = text.indexOf("\n", markerIndex);
  const header = (lineEnd === -1 ? text.slice(markerIndex) : text.slice(markerIndex, lineEnd)).trimEnd();
  return header || "```";
}

function splitDiscordMessage(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [""];
  }

  const chunks: string[] = [];
  let remaining = normalized;
  let reopenFence = "";

  while (remaining.length) {
    const available = DISCORD_SAFE_MESSAGE_LENGTH - reopenFence.length;
    if (remaining.length <= available) {
      let finalChunk = `${reopenFence}${remaining}`.trim();
      if (hasUnclosedCodeFence(finalChunk) && finalChunk.length + "\n```".length <= DISCORD_SAFE_MESSAGE_LENGTH) {
        finalChunk += "\n```";
      }
      chunks.push(finalChunk);
      break;
    }

    let boundary = findChunkBoundary(remaining, available);
    let chunkBody = remaining.slice(0, boundary).trimEnd();
    if (!chunkBody) {
      boundary = available;
      chunkBody = remaining.slice(0, boundary);
    }

    let chunk = `${reopenFence}${chunkBody}`.trim();
    let nextReopenFence = "";

    if (hasUnclosedCodeFence(chunk)) {
      const fenceHeader = readFenceHeader(chunk);
      const closer = "\n```";
      if (chunk.length + closer.length > DISCORD_SAFE_MESSAGE_LENGTH) {
        const reducedAvailable = Math.max(1, available - closer.length);
        boundary = findChunkBoundary(remaining, reducedAvailable);
        chunkBody = remaining.slice(0, boundary).trimEnd();
        if (!chunkBody) {
          boundary = reducedAvailable;
          chunkBody = remaining.slice(0, boundary);
        }
        chunk = `${reopenFence}${chunkBody}`.trim();
      }
      chunk += closer;
      nextReopenFence = `${fenceHeader}\n`;
    }

    chunks.push(chunk);
    remaining = remaining.slice(boundary).trimStart();
    reopenFence = nextReopenFence;
  }

  return chunks;
}

export async function processInboundMessage(params: InboundMessageDependencies): Promise<InboundMessageResult> {
  const { config, client, provider, db, binding, appId, message } = params;

  if (db.hasProcessedMessage(message.id)) {
    return { replied: false, ignoredReason: "duplicate" };
  }

  if (message.author.id === appId) {
    db.markProcessed(message.id, binding);
    return { replied: false, ignoredReason: "self" };
  }

  if (!shouldReply({ binding, message, appId })) {
    db.markProcessed(message.id, binding);
    return { replied: false, ignoredReason: "gated" };
  }

  const toolContext = buildToolContext({
    config,
    binding,
    triggerMessage: message,
  });
  const userRole = resolveAuthorityRole(config, message);
  const tools = await client.buildExecutableTools(toolContext);
  const session = db.getSession(binding);
  await client.sendTyping(binding).catch(() => undefined);
  let typingTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
    void client.sendTyping(binding).catch(() => undefined);
  }, TYPING_KEEPALIVE_MS);
  const initialReply = await client.sendMessage(binding, DEFAULT_PROGRESS_TEXT, { replyToMessageId: message.id });
  const progressMessageId = readPostedMessageId(initialReply);
  let lastProgressText = DEFAULT_PROGRESS_TEXT;
  let lastProgressAt = 0;
  let progressUpdateInFlight: Promise<void> | null = null;
  const updateProgress = async (update: ProgressUpdate): Promise<void> => {
    if (!progressMessageId) {
      return;
    }
    const nextText = splitDiscordMessage(update.text)[0] ?? "";
    if (!nextText || nextText === lastProgressText) {
      return;
    }
    const now = Date.now();
    if (now - lastProgressAt < PROGRESS_DEBOUNCE_MS) {
      return;
    }
    lastProgressAt = now;
    lastProgressText = nextText;
    const nextRequest = client.editMessage(binding, progressMessageId, nextText).then(() => undefined, () => undefined);
    progressUpdateInFlight = nextRequest;
    await nextRequest;
  };

  let result;
  try {
    result = await provider.runTurn({
      config,
      session,
      bindingLabel: getBindingLabel(binding),
      mode: binding.mode,
      userRole,
      message,
      appId,
      tools: tools as ExecutableTool[],
      onProgress: (update) => updateProgress(update),
    });
  } catch (error) {
    if (typingTimer) {
      clearInterval(typingTimer);
      typingTimer = null;
    }
    if (progressMessageId) {
      await client.editMessage(binding, progressMessageId, "Sorry, something went wrong while preparing the reply.");
    }
    throw error;
  }

  if (!result.finalText) {
    throw new Error("Codex returned no visible reply text.");
  }

  await progressUpdateInFlight;
  const finalChunks = splitDiscordMessage(result.finalText);
  if (typingTimer) {
    clearInterval(typingTimer);
    typingTimer = null;
  }
  if (progressMessageId) {
    await client.editMessage(binding, progressMessageId, finalChunks[0] ?? "");
  } else {
    await client.sendMessage(binding, finalChunks[0] ?? "", { replyToMessageId: message.id });
  }
  for (const chunk of finalChunks.slice(1)) {
    await client.sendMessage(binding, chunk);
  }
  db.markProcessed(message.id, binding);
  const nextSession = db.saveBindingSession(binding, {
    model: result.model,
    threadId: result.threadId,
    lastSeenMessageId: message.id,
  });
  return { replied: true, session: nextSession };
}
