import { describe, expect, it, vi } from "vitest";
import { makeTestConfig } from "../test/test-config.js";
import { runSmokeCheck } from "./smoke.js";

const config = makeTestConfig({
  bindings: [
    {
      guildId: "guild-1",
      guildName: "Guild",
      channelId: "channel-1",
      channelName: "general",
      mode: "mention",
      enabled: true,
    },
  ],
});

describe("runSmokeCheck", () => {
  it("stays dry by default", async () => {
    const client = {
      getAccessContext: vi.fn().mockResolvedValue({ app_id: "bot-1" }),
      fetchMessages: vi.fn().mockResolvedValue([{ id: "22", channel_id: "channel-1", content: "hi", author: { id: "u1", username: "u1" } }]),
      buildExecutableTools: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue({}),
    };
    const provider = {
      runTurn: vi.fn().mockResolvedValue({
        threadId: "thread-smoke",
        finalText: "OpenChord smoke confirmed.",
        model: "gpt-5.4",
      }),
      close: vi.fn(),
    };

    const result = await runSmokeCheck({ config, client, provider });

    expect(result.posted).toBe(false);
    expect(result.replyPreview).toBe("OpenChord smoke confirmed.");
    expect(client.sendMessage).not.toHaveBeenCalled();
    expect(provider.runTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          content: "OpenChord smoke test. Reply with one short sentence confirming basic OpenChord runtime health.",
        }),
      }),
    );
  });

  it("posts only when explicitly requested", async () => {
    const client = {
      getAccessContext: vi.fn().mockResolvedValue({ app_id: "bot-1" }),
      fetchMessages: vi.fn().mockResolvedValue([]),
      buildExecutableTools: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue({}),
    };
    const provider = {
      runTurn: vi.fn().mockResolvedValue({
        threadId: "thread-smoke",
        finalText: "OpenChord smoke confirmed.",
        model: "gpt-5.4",
      }),
      close: vi.fn(),
    };

    const result = await runSmokeCheck({ config, client, provider }, { post: true });

    expect(result.posted).toBe(true);
    expect(client.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "channel-1" }),
      "OpenChord smoke confirmed.",
    );
  });
});
