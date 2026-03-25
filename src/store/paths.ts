import os from "node:os";
import path from "node:path";

export function resolveHomeDir(): string {
  return process.env.OPENCHORD_HOME || path.join(os.homedir(), ".openchord");
}

export function resolveConfigPath(): string {
  return path.join(resolveHomeDir(), "config.json");
}

export function resolveRuntimeEnvPath(): string {
  return path.join(resolveHomeDir(), "runtime.env");
}

export function resolveStateDbPath(): string {
  return path.join(resolveHomeDir(), "state.db");
}

export function resolveIsolatedWorkspacePath(): string {
  return path.join(resolveHomeDir(), "workspace", "sandboxed-workspace-write");
}

export function resolveServiceDirPath(): string {
  return path.join(resolveHomeDir(), "service");
}

export function resolveWindowsServiceScriptPath(): string {
  return path.join(resolveServiceDirPath(), "openchord-task.ps1");
}

export function resolveSystemdUnitPath(): string {
  return path.join(os.homedir(), ".config", "systemd", "user", "openchord.service");
}

export function resolveLaunchAgentPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", "ai.openchord.agent.plist");
}
