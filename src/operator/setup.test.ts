import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readRuntimeEnv } from "../store/runtime-env.js";
import { runSetup } from "./setup.js";

describe("runSetup", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openchord-setup-"));
    process.env.OPENCHORD_HOME = tempDir;
    delete process.env.BOT_TOKEN;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.OPENCHORD_HOME;
    delete process.env.BOT_TOKEN;
  });

  it("stores the bot token and installs the service after verification", async () => {
    const probe = vi.fn().mockResolvedValue({
      authStatus: { authMethod: "chatgpt" },
      modelCount: 1,
      userAgent: "codex app-server",
    });
    const close = vi.fn().mockResolvedValue(undefined);
    const install = vi.fn().mockReturnValue({ platform: "windows", message: "installed" });
    const start = vi.fn().mockReturnValue({ platform: "windows", message: "started" });

    const result = await runSetup({
      ask: vi.fn()
        .mockResolvedValueOnce("discord-token")
        .mockResolvedValueOnce("123456789012345678")
        .mockResolvedValueOnce("223456789012345678, 323456789012345678")
        .mockResolvedValueOnce("1")
        .mockResolvedValueOnce("1")
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce("n"),
      createProvider: () => ({ probe, close }),
      createClient: () => ({
        getAccessContext: vi.fn().mockResolvedValue({ app_id: "bot-1" }),
        listCurrentUserGuilds: vi.fn().mockResolvedValue([{ id: "guild-1", name: "Guild" }]),
        listGuildChannels: vi.fn().mockResolvedValue([{ id: "channel-1", name: "general", type: 0 }]),
        fetchMessages: vi.fn().mockResolvedValue([]),
      }),
      serviceManager: { install, start },
      runDoctorFn: async () => [{ id: "ok", title: "Doctor", status: "pass", message: "ok" }],
      runSmokeFn: async () => ({
        binding: {
          guildId: "guild-1",
          guildName: "Guild",
          channelId: "channel-1",
          channelName: "general",
          mode: "mention",
          enabled: true,
        },
        latestMessageId: null,
        replyPreview: "healthy",
        posted: false,
      }),
      verifyCodexBinary: () => ({ ok: true, message: "ready" }),
    });

    expect(readRuntimeEnv().BOT_TOKEN).toBe("discord-token");
    expect(install).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
    expect(result.binding.channelId).toBe("channel-1");
    const config = JSON.parse(fs.readFileSync(path.join(tempDir, "config.json"), "utf8")) as {
      authority: { ownerUserId: string; adminUserIds: string[] };
    };
    expect(config.authority).toEqual({
      ownerUserId: "123456789012345678",
      adminUserIds: ["223456789012345678", "323456789012345678"],
    });
  });

  it("re-prompts when a stored token is invalid and only persists the replacement", async () => {
    const probe = vi.fn().mockResolvedValue({
      authStatus: { authMethod: "chatgpt" },
      modelCount: 1,
      userAgent: "codex app-server",
    });
    const close = vi.fn().mockResolvedValue(undefined);
    const install = vi.fn().mockReturnValue({ platform: "windows", message: "installed" });
    const start = vi.fn().mockReturnValue({ platform: "windows", message: "started" });
    readRuntimeEnv();
    fs.writeFileSync(path.join(tempDir, "runtime.env"), "BOT_TOKEN=\"stale-token\"\n", "utf8");
    const getAccessContext = vi.fn()
      .mockRejectedValueOnce(new Error("401 Unauthorized"))
      .mockResolvedValue({ app_id: "bot-1" });

    await runSetup({
      ask: vi.fn()
        .mockResolvedValueOnce("discord-token")
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce("1")
        .mockResolvedValueOnce("1")
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce("n"),
      createProvider: () => ({ probe, close }),
      createClient: () => ({
        getAccessContext,
        listCurrentUserGuilds: vi.fn().mockResolvedValue([{ id: "guild-1", name: "Guild" }]),
        listGuildChannels: vi.fn().mockResolvedValue([{ id: "channel-1", name: "general", type: 0 }]),
        fetchMessages: vi.fn().mockResolvedValue([]),
      }),
      serviceManager: { install, start },
      runDoctorFn: async () => [{ id: "ok", title: "Doctor", status: "pass", message: "ok" }],
      runSmokeFn: async () => ({
        binding: {
          guildId: "guild-1",
          guildName: "Guild",
          channelId: "channel-1",
          channelName: "general",
          mode: "mention",
          enabled: true,
        },
        latestMessageId: null,
        replyPreview: "healthy",
        posted: false,
      }),
      verifyCodexBinary: () => ({ ok: true, message: "ready" }),
    });

    expect(getAccessContext).toHaveBeenCalledTimes(3);
    expect(readRuntimeEnv().BOT_TOKEN).toBe("discord-token");
  });

  it("can add multiple bindings during setup", async () => {
    const probe = vi.fn().mockResolvedValue({
      authStatus: { authMethod: "chatgpt" },
      modelCount: 1,
      userAgent: "codex app-server",
    });
    const close = vi.fn().mockResolvedValue(undefined);
    const install = vi.fn().mockReturnValue({ platform: "windows", message: "installed" });
    const start = vi.fn().mockReturnValue({ platform: "windows", message: "started" });

    await runSetup({
      ask: vi.fn()
        .mockResolvedValueOnce("discord-token")
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce("1")
        .mockResolvedValueOnce("1")
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce("y")
        .mockResolvedValueOnce("1")
        .mockResolvedValueOnce("2")
        .mockResolvedValueOnce("2")
        .mockResolvedValueOnce("n"),
      createProvider: () => ({ probe, close }),
      createClient: () => ({
        getAccessContext: vi.fn().mockResolvedValue({ app_id: "bot-1" }),
        listCurrentUserGuilds: vi.fn().mockResolvedValue([{ id: "guild-1", name: "Guild" }]),
        listGuildChannels: vi.fn().mockResolvedValue([
          { id: "channel-1", name: "general", type: 0 },
          { id: "channel-2", name: "builds", type: 0 },
        ]),
        fetchMessages: vi.fn().mockResolvedValue([]),
      }),
      serviceManager: { install, start },
      runDoctorFn: async () => [{ id: "ok", title: "Doctor", status: "pass", message: "ok" }],
      runSmokeFn: async () => ({
        binding: {
          guildId: "guild-1",
          guildName: "Guild",
          channelId: "channel-1",
          channelName: "general",
          mode: "mention",
          enabled: true,
        },
        latestMessageId: null,
        replyPreview: "healthy",
        posted: false,
      }),
      verifyCodexBinary: () => ({ ok: true, message: "ready" }),
    });

    const config = JSON.parse(fs.readFileSync(path.join(tempDir, "config.json"), "utf8")) as {
      bindings: Array<{ channelId: string; mode: string }>;
    };
    expect(config.bindings).toHaveLength(2);
    expect(config.bindings).toEqual([
      expect.objectContaining({ channelId: "channel-1", mode: "always" }),
      expect.objectContaining({ channelId: "channel-2", mode: "mention" }),
    ]);
  });

  it("re-prompts until authority IDs are valid snowflakes", async () => {
    const probe = vi.fn().mockResolvedValue({
      authStatus: { authMethod: "chatgpt" },
      modelCount: 1,
      userAgent: "codex app-server",
    });
    const close = vi.fn().mockResolvedValue(undefined);
    const install = vi.fn().mockReturnValue({ platform: "windows", message: "installed" });
    const start = vi.fn().mockReturnValue({ platform: "windows", message: "started" });

    await runSetup({
      ask: vi.fn()
        .mockResolvedValueOnce("discord-token")
        .mockResolvedValueOnce("owner-name")
        .mockResolvedValueOnce("123456789012345678")
        .mockResolvedValueOnce("admin-name")
        .mockResolvedValueOnce("223456789012345678")
        .mockResolvedValueOnce("1")
        .mockResolvedValueOnce("1")
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce("n"),
      createProvider: () => ({ probe, close }),
      createClient: () => ({
        getAccessContext: vi.fn().mockResolvedValue({ app_id: "bot-1" }),
        listCurrentUserGuilds: vi.fn().mockResolvedValue([{ id: "guild-1", name: "Guild" }]),
        listGuildChannels: vi.fn().mockResolvedValue([{ id: "channel-1", name: "general", type: 0 }]),
        fetchMessages: vi.fn().mockResolvedValue([]),
      }),
      serviceManager: { install, start },
      runDoctorFn: async () => [{ id: "ok", title: "Doctor", status: "pass", message: "ok" }],
      runSmokeFn: async () => ({
        binding: {
          guildId: "guild-1",
          guildName: "Guild",
          channelId: "channel-1",
          channelName: "general",
          mode: "mention",
          enabled: true,
        },
        latestMessageId: null,
        replyPreview: "healthy",
        posted: false,
      }),
      verifyCodexBinary: () => ({ ok: true, message: "ready" }),
    });

    const config = JSON.parse(fs.readFileSync(path.join(tempDir, "config.json"), "utf8")) as {
      authority: { ownerUserId: string; adminUserIds: string[] };
    };
    expect(config.authority).toEqual({
      ownerUserId: "123456789012345678",
      adminUserIds: ["223456789012345678"],
    });
  });

  it("can clear stored authority values during setup", async () => {
    fs.writeFileSync(
      path.join(tempDir, "config.json"),
      JSON.stringify({
        version: 2,
        identity: { assistantName: "OpenChord" },
        authority: {
          ownerUserId: "123456789012345678",
          adminUserIds: ["223456789012345678"],
        },
        transport: {
          serverUrl: "https://mcp.dis.gg/v1",
          botTokenEnvVar: "BOT_TOKEN",
          ownerAccess: true,
          privilegedIntents: ["message_content", "server_members"],
          fetchLimit: 25,
          requestTimeoutMs: 15000,
          userAgent: "openchord/0.1.0",
        },
        provider: {
          backend: "codex-app-server",
          codexCommand: "codex",
          hostToolProfile: "sandboxed-workspace-write",
          isolatedCwd: "",
          model: "",
        },
        safety: {
          denyTools: [],
          targetGuildsMode: "bound-guild",
        },
        bindings: [],
      }, null, 2),
      "utf8",
    );

    const probe = vi.fn().mockResolvedValue({
      authStatus: { authMethod: "chatgpt" },
      modelCount: 1,
      userAgent: "codex app-server",
    });
    const close = vi.fn().mockResolvedValue(undefined);
    const install = vi.fn().mockReturnValue({ platform: "windows", message: "installed" });
    const start = vi.fn().mockReturnValue({ platform: "windows", message: "started" });

    await runSetup({
      ask: vi.fn()
        .mockResolvedValueOnce("discord-token")
        .mockResolvedValueOnce("clear")
        .mockResolvedValueOnce("clear")
        .mockResolvedValueOnce("1")
        .mockResolvedValueOnce("1")
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce("n"),
      createProvider: () => ({ probe, close }),
      createClient: () => ({
        getAccessContext: vi.fn().mockResolvedValue({ app_id: "bot-1" }),
        listCurrentUserGuilds: vi.fn().mockResolvedValue([{ id: "guild-1", name: "Guild" }]),
        listGuildChannels: vi.fn().mockResolvedValue([{ id: "channel-1", name: "general", type: 0 }]),
        fetchMessages: vi.fn().mockResolvedValue([]),
      }),
      serviceManager: { install, start },
      runDoctorFn: async () => [{ id: "ok", title: "Doctor", status: "pass", message: "ok" }],
      runSmokeFn: async () => ({
        binding: {
          guildId: "guild-1",
          guildName: "Guild",
          channelId: "channel-1",
          channelName: "general",
          mode: "mention",
          enabled: true,
        },
        latestMessageId: null,
        replyPreview: "healthy",
        posted: false,
      }),
      verifyCodexBinary: () => ({ ok: true, message: "ready" }),
    });

    const config = JSON.parse(fs.readFileSync(path.join(tempDir, "config.json"), "utf8")) as {
      authority: { ownerUserId: string; adminUserIds: string[] };
    };
    expect(config.authority).toEqual({
      ownerUserId: "",
      adminUserIds: [],
    });
  });
});
