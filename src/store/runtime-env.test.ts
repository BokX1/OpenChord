import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadRuntimeEnvIntoProcess, readRuntimeEnv, upsertRuntimeEnv } from "./runtime-env.js";

describe("runtime env", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openchord-runtime-env-"));
    process.env.OPENCHORD_HOME = tempDir;
    delete process.env.BOT_TOKEN;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.OPENCHORD_HOME;
    delete process.env.BOT_TOKEN;
  });

  it("writes runtime env entries and reloads them", () => {
    upsertRuntimeEnv({ BOT_TOKEN: "discord-token" });

    expect(readRuntimeEnv()).toEqual({ BOT_TOKEN: "discord-token" });
    expect(process.env.BOT_TOKEN).toBe("discord-token");
    if (process.platform !== "win32") {
      expect(fs.statSync(path.join(tempDir, "runtime.env")).mode & 0o777).toBe(0o600);
    }
  });

  it("does not override process env values when loading runtime env", () => {
    upsertRuntimeEnv({ BOT_TOKEN: "stored-token" });
    process.env.BOT_TOKEN = "process-token";

    const loaded = loadRuntimeEnvIntoProcess();

    expect(loaded).toEqual({ BOT_TOKEN: "stored-token" });
    expect(process.env.BOT_TOKEN).toBe("process-token");
  });
});
