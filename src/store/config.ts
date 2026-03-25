import fs from "node:fs";
import { BridgeConfigSchema, type BridgeConfig, type ChannelBinding } from "../types.js";
import { ensureParentDir } from "../utils/file-system.js";
import { resolveConfigPath, resolveIsolatedWorkspacePath } from "./paths.js";

function finalizeConfig(config: BridgeConfig): BridgeConfig {
  return BridgeConfigSchema.parse({
    ...config,
    provider: {
      ...config.provider,
      isolatedCwd: config.provider.isolatedCwd || resolveIsolatedWorkspacePath(),
    },
  });
}

export function loadConfig(): BridgeConfig {
  const configPath = resolveConfigPath();
  if (!fs.existsSync(configPath)) {
    return finalizeConfig(BridgeConfigSchema.parse({ version: 2 }));
  }

  const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
  return finalizeConfig(BridgeConfigSchema.parse(raw));
}

export function saveConfig(config: BridgeConfig): void {
  const configPath = resolveConfigPath();
  const normalized = finalizeConfig(BridgeConfigSchema.parse(config));
  ensureParentDir(configPath);
  fs.writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export function upsertBinding(binding: ChannelBinding): BridgeConfig {
  const config = loadConfig();
  const nextBindings = config.bindings.filter((entry) => entry.channelId !== binding.channelId);
  nextBindings.push(binding);
  const next = {
    ...config,
    bindings: nextBindings.sort((a, b) => a.channelId.localeCompare(b.channelId)),
  };
  saveConfig(next);
  return next;
}

export function removeBinding(channelId: string): BridgeConfig {
  const config = loadConfig();
  const next = {
    ...config,
    bindings: config.bindings.filter((entry) => entry.channelId !== channelId),
  };
  saveConfig(next);
  return next;
}
