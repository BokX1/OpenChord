import fs from "node:fs";
import { parse } from "dotenv";
import { ensureParentDir } from "../utils/file-system.js";
import { resolveRuntimeEnvPath } from "./paths.js";

function formatValue(value: string): string {
  return JSON.stringify(value);
}

export function readRuntimeEnv(): Record<string, string> {
  const envPath = resolveRuntimeEnvPath();
  if (!fs.existsSync(envPath)) {
    return {};
  }
  return parse(fs.readFileSync(envPath, "utf8"));
}

export function loadRuntimeEnvIntoProcess(): Record<string, string> {
  const runtimeEnv = readRuntimeEnv();
  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
  return runtimeEnv;
}

export function saveRuntimeEnv(nextEnv: Record<string, string>): void {
  const envPath = resolveRuntimeEnvPath();
  ensureParentDir(envPath);
  const lines = Object.entries(nextEnv)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${formatValue(value)}`);
  fs.writeFileSync(envPath, `${lines.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  if (process.platform !== "win32") {
    fs.chmodSync(envPath, 0o600);
  }
}

export function upsertRuntimeEnv(entries: Record<string, string>): Record<string, string> {
  const current = readRuntimeEnv();
  const next = {
    ...current,
    ...entries,
  };
  saveRuntimeEnv(next);
  for (const [key, value] of Object.entries(entries)) {
    process.env[key] = value;
  }
  return next;
}
