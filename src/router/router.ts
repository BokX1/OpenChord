import type { AuthorityRole, ChannelBinding, CodexTextInput, DiscordMessage } from "../types.js";

function toTimestamp(message: DiscordMessage): string {
  if (!message.timestamp) {
    return new Date().toISOString();
  }
  return Number.isNaN(Date.parse(message.timestamp)) ? new Date().toISOString() : message.timestamp;
}

function summarizeAttachments(message: DiscordMessage): string {
  const attachments = message.attachments ?? [];
  if (!attachments.length) {
    return "";
  }
  const lines = attachments.map((attachment) => {
    const label = attachment.filename || attachment.id || "attachment";
    const type = attachment.content_type ? ` (${attachment.content_type})` : "";
    const url = attachment.url ? ` - ${attachment.url}` : "";
    return `- ${label}${type}${url}`;
  });
  return `Attachments:\n${lines.join("\n")}`;
}

export function containsMention(content: string, appId: string): boolean {
  const escaped = appId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<@!?${escaped}>`, "i");
  return pattern.test(content);
}

export function cleanPromptContent(content: string, appId: string): string {
  const escaped = appId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return content
    .replace(new RegExp(`<@!?${escaped}>`, "gi"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isReplyToApp(message: Pick<DiscordMessage, "message_reference">, appId: string): boolean {
  return message.message_reference?.author_id === appId;
}

export function shouldReply(params: {
  binding: Pick<ChannelBinding, "enabled" | "mode">;
  message: Pick<DiscordMessage, "content" | "message_reference">;
  appId: string;
}): boolean {
  if (!params.binding.enabled) {
    return false;
  }
  if (params.binding.mode === "always") {
    return true;
  }
  return containsMention(params.message.content, params.appId) || isReplyToApp(params.message, params.appId);
}

export function toCodexInput(message: DiscordMessage, appId: string, role: AuthorityRole): CodexTextInput {
  const displayName = message.author.global_name || message.author.username;
  const promptText = cleanPromptContent(message.content, appId);
  const attachmentText = summarizeAttachments(message);
  const replyTarget = message.message_reference?.message_id
    ? `Reply context: this message is replying to ${message.message_reference.message_id}.`
    : "";
  const parts = [
    `Timestamp: ${toTimestamp(message)}`,
    `Author: ${displayName} (${message.author.id})`,
    `Current caller role: ${role}`,
    `Message:\n${promptText || "(no text content)"}`,
    replyTarget,
    attachmentText,
  ].filter(Boolean);

  return {
    type: "text",
    text: parts.join("\n\n"),
    text_elements: [],
  };
}
