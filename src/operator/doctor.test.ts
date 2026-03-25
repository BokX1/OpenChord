import { describe, expect, it, vi } from "vitest";
import { makeTestConfig } from "../test/test-config.js";
import { buildDoctorNextAction, runDoctorChecks } from "./doctor.js";

const baseConfig = makeTestConfig();

describe("doctor", () => {
  it("reports missing bot token as a blocking failure", async () => {
    const results = await runDoctorChecks({
      config: {
        ...baseConfig,
        provider: {
          ...baseConfig.provider,
          codexCommand: process.execPath,
        },
      },
      botToken: undefined,
      provider: {
        probe: vi.fn(),
        close: vi.fn(),
      },
      db: {
        listSessions: vi.fn().mockReturnValue([]),
        close: vi.fn(),
      },
    });

    expect(results.find((result) => result.id === "env.bot_token")?.status).toBe("fail");
    expect(buildDoctorNextAction(results)).toContain("openchord setup");
    expect(results.find((result) => result.id === "env.bot_token")?.message).toContain("BOT_TOKEN");
  });

  it("passes when transport, app-server, and bindings are healthy", async () => {
    const results = await runDoctorChecks({
      config: {
        ...baseConfig,
        provider: {
          ...baseConfig.provider,
          codexCommand: process.execPath,
        },
        bindings: [{ guildId: "guild-1", channelId: "channel-1", mode: "mention", enabled: true }],
      },
      botToken: "token",
      provider: {
        probe: vi.fn().mockResolvedValue({
          authStatus: { authMethod: "chatgpt" },
          modelCount: 3,
          userAgent: "codex app-server",
        }),
        close: vi.fn(),
      },
      client: {
        getAccessContext: vi.fn().mockResolvedValue({ app_id: "bot-1" }),
        fetchMessages: vi.fn().mockResolvedValue([]),
      },
      db: {
        listSessions: vi.fn().mockReturnValue([]),
        close: vi.fn(),
      },
    });

    expect(results.every((result) => result.status === "pass")).toBe(true);
    expect(buildDoctorNextAction(results)).toContain("OpenChord looks ready");
  });

  it("uses the configured token env var name in guidance", async () => {
    const results = await runDoctorChecks({
      config: {
        ...baseConfig,
        transport: {
          ...baseConfig.transport,
          botTokenEnvVar: "DISCORD_RUNTIME_TOKEN",
        },
        provider: {
          ...baseConfig.provider,
          codexCommand: process.execPath,
        },
      },
      botToken: undefined,
      provider: {
        probe: vi.fn(),
        close: vi.fn(),
      },
      db: {
        listSessions: vi.fn().mockReturnValue([]),
        close: vi.fn(),
      },
    });

    expect(results.find((result) => result.id === "env.bot_token")?.message).toContain("DISCORD_RUNTIME_TOKEN");
    expect(buildDoctorNextAction(results, "DISCORD_RUNTIME_TOKEN")).toContain("DISCORD_RUNTIME_TOKEN");
  });
});
