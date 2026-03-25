import { describe, expect, it, vi } from "vitest";
import { makeTestConfig } from "../test/test-config.js";
import { processInboundMessage } from "./bridge.js";

const config = makeTestConfig();

describe("processInboundMessage", () => {
  it("ignores duplicate messages", async () => {
    const db = {
      getSession: vi.fn(),
      saveBindingSession: vi.fn(),
      hasProcessedMessage: vi.fn().mockReturnValue(true),
      markProcessed: vi.fn(),
    };

    const result = await processInboundMessage({
      config,
      client: {
        buildExecutableTools: vi.fn(),
        sendMessage: vi.fn(),
        editMessage: vi.fn(),
        sendTyping: vi.fn(),
      },
      provider: {
        runTurn: vi.fn(),
      },
      db,
      binding: { guildId: "guild-1", channelId: "channel-1", mode: "mention", enabled: true },
      appId: "bot-1",
      message: {
        id: "m-1",
        channel_id: "channel-1",
        content: "<@bot-1> hello",
        author: { id: "user-1", username: "user1" },
      },
    });

    expect(result).toEqual({ replied: false, ignoredReason: "duplicate" });
  });

  it("ignores self-authored messages", async () => {
    const db = {
      getSession: vi.fn(),
      saveBindingSession: vi.fn(),
      hasProcessedMessage: vi.fn().mockReturnValue(false),
      markProcessed: vi.fn(),
    };

    const result = await processInboundMessage({
      config,
      client: {
        buildExecutableTools: vi.fn(),
        sendMessage: vi.fn(),
        editMessage: vi.fn(),
        sendTyping: vi.fn(),
      },
      provider: {
        runTurn: vi.fn(),
      },
      db,
      binding: { guildId: "guild-1", channelId: "channel-1", mode: "mention", enabled: true },
      appId: "bot-1",
      message: {
        id: "m-1",
        channel_id: "channel-1",
        content: "hello",
        author: { id: "bot-1", username: "bot" },
      },
    });

    expect(result).toEqual({ replied: false, ignoredReason: "self" });
    expect(db.markProcessed).toHaveBeenCalledWith("m-1", expect.any(Object));
  });

  it("builds bound-guild tool context and replies to a valid mention", async () => {
    const existingSession = {
      channelKey: "guild-1:channel-1",
      guildId: "guild-1",
      channelId: "channel-1",
      provider: "codex-app-server" as const,
      model: "gpt-5.4",
      threadId: "thread-1",
      lastSeenMessageId: null,
      updatedAt: Date.now(),
    };
    const nextSession = {
      ...existingSession,
      lastSeenMessageId: "12",
      updatedAt: Date.now(),
    };
    const db = {
      getSession: vi.fn().mockReturnValue(existingSession),
      saveBindingSession: vi.fn().mockReturnValue(nextSession),
      hasProcessedMessage: vi.fn().mockReturnValue(false),
      markProcessed: vi.fn(),
    };
    const client = {
      buildExecutableTools: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue({ id: "reply-1" }),
      editMessage: vi.fn().mockResolvedValue({ id: "reply-1" }),
      sendTyping: vi.fn().mockResolvedValue(undefined),
    };
    const provider = {
      runTurn: vi.fn().mockResolvedValue({
        threadId: "thread-1",
        finalText: "OpenChord reply",
        model: "gpt-5.4",
      }),
    };

    const result = await processInboundMessage({
      config: {
        ...config,
        authority: {
          ownerUserId: "user-1",
          adminUserIds: [],
        },
      },
      client,
      provider,
      db,
      binding: {
        guildId: "guild-1",
        channelId: "channel-1",
        mode: "mention",
        enabled: true,
      },
      appId: "bot-1",
      message: {
        id: "12",
        channel_id: "channel-1",
        content: "<@bot-1> hello there",
        author: { id: "user-1", username: "user1", global_name: "User One" },
      },
    });

    expect(client.buildExecutableTools).toHaveBeenCalledWith(
      expect.objectContaining({
        currentGuildId: "guild-1",
        currentChannelId: "channel-1",
        currentUserId: "user-1",
        targetGuilds: ["guild-1"],
      }),
    );
    expect(client.sendTyping).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "guild-1", channelId: "channel-1" }),
    );
    expect(provider.runTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        session: existingSession,
        bindingLabel: "guild-1 / #channel-1",
        mode: "mention",
        userRole: "owner",
      }),
    );
    expect(client.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "guild-1", channelId: "channel-1" }),
      "Thinking...",
      { replyToMessageId: "12" },
    );
    expect(client.editMessage).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "guild-1", channelId: "channel-1" }),
      "reply-1",
      "OpenChord reply",
    );
    expect(db.saveBindingSession).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "guild-1", channelId: "channel-1" }),
      {
        model: "gpt-5.4",
        threadId: "thread-1",
        lastSeenMessageId: "12",
      },
    );
    expect(result).toEqual({ replied: true, session: nextSession });
  });

  it("replies when the user is replying to a bot message", async () => {
    const db = {
      getSession: vi.fn().mockReturnValue(null),
      saveBindingSession: vi.fn().mockReturnValue({
        channelKey: "guild-1:channel-1",
        guildId: "guild-1",
        channelId: "channel-1",
        provider: "codex-app-server" as const,
        model: "gpt-5.4",
        threadId: "thread-9",
        lastSeenMessageId: "13",
        updatedAt: Date.now(),
      }),
      hasProcessedMessage: vi.fn().mockReturnValue(false),
      markProcessed: vi.fn(),
    };
    const client = {
      buildExecutableTools: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue({ id: "reply-9" }),
      editMessage: vi.fn().mockResolvedValue({ id: "reply-9" }),
      sendTyping: vi.fn().mockResolvedValue(undefined),
    };
    const provider = {
      runTurn: vi.fn().mockResolvedValue({
        threadId: "thread-9",
        finalText: "Reply thread works",
        model: "gpt-5.4",
      }),
    };

    const result = await processInboundMessage({
      config,
      client,
      provider,
      db,
      binding: {
        guildId: "guild-1",
        channelId: "channel-1",
        mode: "mention",
        enabled: true,
      },
      appId: "bot-1",
      message: {
        id: "13",
        channel_id: "channel-1",
        content: "can you explain more",
        author: { id: "user-2", username: "user2", global_name: "User Two" },
        message_reference: {
          message_id: "12",
          author_id: "bot-1",
        },
      },
    });

    expect(provider.runTurn).toHaveBeenCalledOnce();
    expect(client.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "guild-1", channelId: "channel-1" }),
      "Thinking...",
      { replyToMessageId: "13" },
    );
    expect(client.editMessage).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "guild-1", channelId: "channel-1" }),
      "reply-9",
      "Reply thread works",
    );
    expect(result.replied).toBe(true);
  });

  it("marks configured admins with the admin role", async () => {
    const db = {
      getSession: vi.fn().mockReturnValue(null),
      saveBindingSession: vi.fn().mockReturnValue({
        channelKey: "guild-1:channel-1",
        guildId: "guild-1",
        channelId: "channel-1",
        provider: "codex-app-server" as const,
        model: "gpt-5.4",
        threadId: "thread-admin",
        lastSeenMessageId: "27",
        updatedAt: Date.now(),
      }),
      hasProcessedMessage: vi.fn().mockReturnValue(false),
      markProcessed: vi.fn(),
    };
    const client = {
      buildExecutableTools: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue({ id: "reply-admin" }),
      editMessage: vi.fn().mockResolvedValue({ id: "reply-admin" }),
      sendTyping: vi.fn().mockResolvedValue(undefined),
    };
    const provider = {
      runTurn: vi.fn().mockResolvedValue({
        threadId: "thread-admin",
        finalText: "Admin reply",
        model: "gpt-5.4",
      }),
    };

    await processInboundMessage({
      config: {
        ...config,
        authority: {
          ownerUserId: "owner-1",
          adminUserIds: ["admin-1"],
        },
      },
      client,
      provider,
      db,
      binding: {
        guildId: "guild-1",
        channelId: "channel-1",
        mode: "mention",
        enabled: true,
      },
      appId: "bot-1",
      message: {
        id: "27",
        channel_id: "channel-1",
        content: "<@bot-1> status check",
        author: { id: "admin-1", username: "admin" },
      },
    });

    expect(provider.runTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        userRole: "admin",
      }),
    );
  });

  it("streams intermediate provider updates into message edits", async () => {
    const db = {
      getSession: vi.fn().mockReturnValue(null),
      saveBindingSession: vi.fn().mockReturnValue({
        channelKey: "guild-1:channel-1",
        guildId: "guild-1",
        channelId: "channel-1",
        provider: "codex-app-server" as const,
        model: "auto",
        threadId: "thread-2",
        lastSeenMessageId: "14",
        updatedAt: Date.now(),
      }),
      hasProcessedMessage: vi.fn().mockReturnValue(false),
      markProcessed: vi.fn(),
    };
    const client = {
      buildExecutableTools: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue({ id: "reply-2" }),
      editMessage: vi.fn().mockResolvedValue({ id: "reply-2" }),
      sendTyping: vi.fn().mockResolvedValue(undefined),
    };
    const provider = {
      runTurn: vi.fn().mockImplementation(async ({ onProgress }) => {
        await onProgress?.({ text: "Reviewing context..." });
        return {
          threadId: "thread-2",
          finalText: "Final answer",
          model: "auto",
        };
      }),
    };

    await processInboundMessage({
      config,
      client,
      provider,
      db,
      binding: {
        guildId: "guild-1",
        channelId: "channel-1",
        mode: "mention",
        enabled: true,
      },
      appId: "bot-1",
      message: {
        id: "14",
        channel_id: "channel-1",
        content: "<@bot-1> stream this",
        author: { id: "user-3", username: "user3" },
      },
    });

    expect(client.editMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ guildId: "guild-1", channelId: "channel-1" }),
      "reply-2",
      "Reviewing context...",
    );
    expect(client.editMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ guildId: "guild-1", channelId: "channel-1" }),
      "reply-2",
      "Final answer",
    );
  });

  it("chunks long final replies across multiple Discord messages", async () => {
    const db = {
      getSession: vi.fn().mockReturnValue(null),
      saveBindingSession: vi.fn().mockReturnValue({
        channelKey: "guild-1:channel-1",
        guildId: "guild-1",
        channelId: "channel-1",
        provider: "codex-app-server" as const,
        model: "gpt-5.4",
        threadId: "thread-3",
        lastSeenMessageId: "15",
        updatedAt: Date.now(),
      }),
      hasProcessedMessage: vi.fn().mockReturnValue(false),
      markProcessed: vi.fn(),
    };
    const longAnswer = `${"A".repeat(1995)}\n\n${"B".repeat(50)}`;
    const client = {
      buildExecutableTools: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn()
        .mockResolvedValueOnce({ id: "reply-3" })
        .mockResolvedValueOnce({}),
      editMessage: vi.fn().mockResolvedValue({ id: "reply-3" }),
      sendTyping: vi.fn().mockResolvedValue(undefined),
    };
    const provider = {
      runTurn: vi.fn().mockResolvedValue({
        threadId: "thread-3",
        finalText: longAnswer,
        model: "gpt-5.4",
      }),
    };

    await processInboundMessage({
      config,
      client,
      provider,
      db,
      binding: {
        guildId: "guild-1",
        channelId: "channel-1",
        mode: "mention",
        enabled: true,
      },
      appId: "bot-1",
      message: {
        id: "15",
        channel_id: "channel-1",
        content: "<@bot-1> long one",
        author: { id: "user-4", username: "user4" },
      },
    });

    expect(client.editMessage).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "guild-1", channelId: "channel-1" }),
      "reply-3",
      "A".repeat(1995),
    );
    expect(client.sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ guildId: "guild-1", channelId: "channel-1" }),
      "B".repeat(50),
    );
  });

  it("preserves fenced code blocks across chunk boundaries", async () => {
    const db = {
      getSession: vi.fn().mockReturnValue(null),
      saveBindingSession: vi.fn().mockReturnValue({
        channelKey: "guild-1:channel-1",
        guildId: "guild-1",
        channelId: "channel-1",
        provider: "codex-app-server" as const,
        model: "gpt-5.4",
        threadId: "thread-4",
        lastSeenMessageId: "16",
        updatedAt: Date.now(),
      }),
      hasProcessedMessage: vi.fn().mockReturnValue(false),
      markProcessed: vi.fn(),
    };
    const longCode = `Here is the script:\n\n\`\`\`ts\n${"const value = 1;\n".repeat(180)}\`\`\``;
    const client = {
      buildExecutableTools: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn()
        .mockResolvedValueOnce({ id: "reply-4" })
        .mockResolvedValueOnce({}),
      editMessage: vi.fn().mockResolvedValue({ id: "reply-4" }),
      sendTyping: vi.fn().mockResolvedValue(undefined),
    };
    const provider = {
      runTurn: vi.fn().mockResolvedValue({
        threadId: "thread-4",
        finalText: longCode,
        model: "gpt-5.4",
      }),
    };

    await processInboundMessage({
      config,
      client,
      provider,
      db,
      binding: {
        guildId: "guild-1",
        channelId: "channel-1",
        mode: "mention",
        enabled: true,
      },
      appId: "bot-1",
      message: {
        id: "16",
        channel_id: "channel-1",
        content: "<@bot-1> code please",
        author: { id: "user-5", username: "user5" },
      },
    });

    const firstChunk = client.editMessage.mock.calls[0]?.[2] as string;
    const secondChunk = client.sendMessage.mock.calls[1]?.[1] as string;
    expect(firstChunk.length).toBeLessThanOrEqual(1998);
    expect(secondChunk.length).toBeLessThanOrEqual(1998);
    expect(firstChunk.endsWith("\n```")).toBe(true);
    expect(secondChunk.startsWith("```ts\n")).toBe(true);
  });
});
