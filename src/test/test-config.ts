import { resolveIsolatedWorkspacePath } from "../store/paths.js";
import type { BridgeConfig } from "../types.js";

type TestConfigOverrides = Partial<BridgeConfig> & {
  transport?: Partial<BridgeConfig["transport"]>;
  provider?: Partial<BridgeConfig["provider"]>;
  safety?: Partial<BridgeConfig["safety"]>;
};

export function makeTestConfig(overrides: TestConfigOverrides = {}): BridgeConfig {
  const base: BridgeConfig = {
    version: 2,
    identity: {
      assistantName: "OpenChord",
    },
    authority: {
      ownerUserId: "",
      adminUserIds: [],
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
      isolatedCwd: resolveIsolatedWorkspacePath(),
      model: "",
    },
    safety: {
      denyTools: [],
      targetGuildsMode: "bound-guild",
    },
    bindings: [],
  };

  return {
    ...base,
    ...overrides,
    identity: {
      ...base.identity,
      ...overrides.identity,
    },
    authority: {
      ...base.authority,
      ...overrides.authority,
    },
    transport: {
      ...base.transport,
      ...overrides.transport,
    },
    provider: {
      ...base.provider,
      ...overrides.provider,
    },
    safety: {
      ...base.safety,
      ...overrides.safety,
    },
    bindings: overrides.bindings ?? base.bindings,
  };
}
