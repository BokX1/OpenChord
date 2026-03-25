import { describe, expect, it } from "vitest";
import {
  cleanPromptContent,
  containsMention,
  isReplyToApp,
  shouldReply,
  toCodexInput,
} from "./router.js";

describe("router mention handling", () => {
  const appId = "1485662381223710890";

  it("detects both Discord mention variants", () => {
    expect(containsMention(`<@${appId}> hello`, appId)).toBe(true);
    expect(containsMention(`<@!${appId}> hello`, appId)).toBe(true);
    expect(containsMention("hello there", appId)).toBe(false);
  });

  it("cleans bot mentions from the prompt content", () => {
    expect(cleanPromptContent(`hey <@${appId}> can you help`, appId)).toBe("hey can you help");
  });

  it("respects mention and always-on binding modes", () => {
    expect(
      shouldReply({
        binding: { enabled: true, mode: "mention" },
        message: { content: `<@${appId}> hi` },
        appId,
      }),
    ).toBe(true);
    expect(
      shouldReply({
        binding: { enabled: true, mode: "mention" },
        message: {
          content: "following up on this",
          message_reference: { message_id: "123", author_id: appId },
        },
        appId,
      }),
    ).toBe(true);
    expect(
      shouldReply({
        binding: { enabled: true, mode: "mention" },
        message: { content: "plain message" },
        appId,
      }),
    ).toBe(false);
    expect(
      shouldReply({
        binding: { enabled: true, mode: "always" },
        message: { content: "plain message" },
        appId,
      }),
    ).toBe(true);
  });

  it("detects replies to the bot without requiring a mention", () => {
    expect(isReplyToApp({ message_reference: { author_id: appId } }, appId)).toBe(true);
    expect(isReplyToApp({ message_reference: { author_id: "someone-else" } }, appId)).toBe(false);
  });
});

describe("router codex input shaping", () => {
  const appId = "1485662381223710890";

  it("formats Discord messages into Codex text inputs", () => {
    const input = toCodexInput(
      {
        id: "2",
        channel_id: "1",
        content: `<@${appId}> check this`,
        author: {
          id: "user-1",
          username: "xenthys",
          global_name: "Xenthys",
        },
        attachments: [{ filename: "bug.png", url: "https://example.com/bug.png", content_type: "image/png" }],
        timestamp: "2026-03-24T09:00:00.000Z",
      },
      appId,
      "owner",
    );

    expect(input.type).toBe("text");
    expect(input.text).toContain("Author: Xenthys (user-1)");
    expect(input.text).toContain("Current caller role: owner");
    expect(input.text).toContain("Message:\ncheck this");
    expect(input.text).toContain("Attachments:");
    expect(input.text).toContain("bug.png");
    expect(input.text_elements).toEqual([]);
  });

  it("includes reply context when present", () => {
    const input = toCodexInput(
      {
        id: "3",
        channel_id: "1",
        content: "following up",
        author: {
          id: "user-2",
          username: "blue",
        },
        message_reference: {
          message_id: "m-1",
          author_id: appId,
        },
      },
      appId,
      "user",
    );

    expect(input.text).toContain("Reply context: this message is replying to m-1.");
  });
});
