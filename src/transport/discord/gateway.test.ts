import { EventEmitter } from "node:events";
import { Events } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { makeTestConfig } from "../../test/test-config.js";
import { registerGatewayHandlers } from "./gateway.js";

class FakeGateway extends EventEmitter {
  user = { id: "bot-1", tag: "OpenChord#0001" };

  override once(event: string | symbol, listener: (...args: unknown[]) => void): this {
    return super.once(event, listener);
  }

  override on(event: string | symbol, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  async login(_token: string): Promise<string> {
    return "logged-in";
  }

  destroy(): void {}
}

function makeDiscordMessage(params: {
  id: string;
  channelId: string;
  guildId?: string;
  content: string;
  authorId: string;
  authorBot?: boolean;
}): Record<string, unknown> {
  return {
    id: params.id,
    channelId: params.channelId,
    guildId: params.guildId ?? "guild-1",
    content: params.content,
    author: {
      id: params.authorId,
      username: "user",
      globalName: "User",
      bot: Boolean(params.authorBot),
    },
    attachments: new Map(),
    reference: null,
    createdAt: new Date("2026-03-24T10:00:00.000Z"),
    inGuild: () => true,
  };
}

describe("registerGatewayHandlers", () => {
  it("ignores unbound channels and bot messages, and routes bound messages", async () => {
    const gateway = new FakeGateway();
    const actionClient = {
      buildExecutableTools: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue({ id: "reply-1" }),
      editMessage: vi.fn().mockResolvedValue({ id: "reply-1" }),
      sendTyping: vi.fn().mockResolvedValue(undefined),
    };
    const provider = {
      runTurn: vi.fn().mockResolvedValue({
        threadId: "thread-1",
        finalText: "Gateway reply",
        model: "gpt-5.4",
      }),
    };
    const db = {
      getSession: vi.fn().mockReturnValue(null),
      saveBindingSession: vi.fn().mockResolvedValue({
        channelKey: "guild-1:channel-1",
        guildId: "guild-1",
        channelId: "channel-1",
        provider: "codex-app-server",
        model: "gpt-5.4",
        threadId: "thread-1",
        lastSeenMessageId: "m-good",
        updatedAt: Date.now(),
      }),
      hasProcessedMessage: vi.fn().mockReturnValue(false),
      markProcessed: vi.fn(),
    };

    registerGatewayHandlers(gateway, {
      config: makeTestConfig({
        bindings: [{ guildId: "guild-1", channelId: "channel-1", mode: "mention", enabled: true }],
      }),
      appId: "bot-1",
      actionClient,
      provider,
      db,
    });

    gateway.emit(Events.MessageCreate, makeDiscordMessage({
      id: "m-unbound",
      channelId: "other-channel",
      content: "<@bot-1> hi",
      authorId: "user-1",
    }));
    gateway.emit(Events.MessageCreate, makeDiscordMessage({
      id: "m-bot",
      channelId: "channel-1",
      content: "<@bot-1> hi",
      authorId: "user-2",
      authorBot: true,
    }));
    gateway.emit(Events.MessageCreate, makeDiscordMessage({
      id: "m-good",
      channelId: "channel-1",
      content: "<@bot-1> hi",
      authorId: "user-3",
    }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(actionClient.sendMessage).toHaveBeenCalledTimes(1);
    expect(actionClient.sendTyping).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "channel-1" }),
    );
    expect(actionClient.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "channel-1" }),
      "Thinking...",
      { replyToMessageId: "m-good" },
    );
    expect(actionClient.editMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "channel-1" }),
      "reply-1",
      "Gateway reply",
    );
  });

  it("reports ready without polling", () => {
    const gateway = new FakeGateway();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    registerGatewayHandlers(gateway, {
      config: makeTestConfig({
        bindings: [{ guildId: "guild-1", channelId: "channel-1", mode: "mention", enabled: true }],
      }),
      appId: "bot-1",
      actionClient: {
        buildExecutableTools: vi.fn(),
        sendMessage: vi.fn(),
        editMessage: vi.fn(),
        sendTyping: vi.fn(),
      },
      provider: {
        runTurn: vi.fn(),
      },
      db: {
        getSession: vi.fn(),
        saveBindingSession: vi.fn(),
        hasProcessedMessage: vi.fn(),
        markProcessed: vi.fn(),
      },
    });

    gateway.emit(Events.ClientReady, { user: { tag: "OpenChord#0001" } });

    expect(consoleSpy).toHaveBeenCalledWith(
      "OpenChord gateway ready as OpenChord#0001. Listening to 1 channel(s).",
    );
    consoleSpy.mockRestore();
  });
});
