import { describe, expect, it, vi } from "vitest";
import { makeTestConfig } from "../../test/test-config.js";
import { DisGgClient } from "./client.js";

describe("DisGgClient runtime replies", () => {
  it("suppresses allowed mentions for normal runtime replies", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const client = new DisGgClient({
        config: makeTestConfig(),
        token: "test-token",
      });

      await client.sendMessage(
        { guildId: "guild-1", channelId: "channel-1" },
        "<@123456789012345678> hello",
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["X-Allowed-Mentions"]).toBe('{"parse":[],"replied_user":false}');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses Discord native replies when a reply target is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: "reply-1" }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const client = new DisGgClient({
        config: makeTestConfig(),
        token: "test-token",
      });

      await client.sendMessage(
        { guildId: "guild-1", channelId: "channel-1" },
        "hello there",
        { replyToMessageId: "message-123" },
      );

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://discord.com/api/v10/channels/channel-1/messages");
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body).toEqual({
        content: "hello there",
        allowed_mentions: {
          parse: [],
          replied_user: false,
        },
        message_reference: {
          message_id: "message-123",
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("edits a native Discord message by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: "reply-1" }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const client = new DisGgClient({
        config: makeTestConfig(),
        token: "test-token",
      });

      await client.editMessage(
        { channelId: "channel-1" },
        "message-123",
        "updated text",
      );

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://discord.com/api/v10/channels/channel-1/messages/message-123");
      expect(init.method).toBe("PATCH");
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body).toEqual({
        content: "updated text",
        allowed_mentions: {
          parse: [],
          replied_user: false,
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("sends a typing indicator through Discord native API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "",
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const client = new DisGgClient({
        config: makeTestConfig(),
        token: "test-token",
      });

      await client.sendTyping({ channelId: "channel-1" });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://discord.com/api/v10/channels/channel-1/typing");
      expect(init.method).toBe("POST");
      expect(String(init.body)).toBe("{}");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
