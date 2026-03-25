import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../store/config.js";
import { runOnboard } from "./onboard.js";

describe("runOnboard", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openchord-onboard-"));
    process.env.OPENCHORD_HOME = tempDir;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.OPENCHORD_HOME;
  });

  it("creates and saves an initial binding", async () => {
    const ask = vi
      .fn()
      .mockResolvedValueOnce("1")
      .mockResolvedValueOnce("1")
      .mockResolvedValueOnce("");

    const binding = await runOnboard({
      botTokenPresent: true,
      codexReady: true,
      client: {
        getAccessContext: vi.fn().mockResolvedValue({ app_id: "bot-1" }),
        listCurrentUserGuilds: vi.fn().mockResolvedValue([{ id: "guild-1", name: "BING CHILLING" }]),
        listGuildChannels: vi.fn().mockResolvedValue([{ id: "channel-1", name: "build-chat", type: 0 }]),
        fetchMessages: vi.fn().mockResolvedValue([]),
      },
      ask,
    });

    expect(binding).toMatchObject({
      guildId: "guild-1",
      guildName: "BING CHILLING",
      channelId: "channel-1",
      channelName: "build-chat",
      mode: "mention",
      enabled: true,
    });
    expect(loadConfig().bindings).toHaveLength(1);
  });
});
