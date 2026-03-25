import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openchord-config-"));
    process.env.OPENCHORD_HOME = tempDir;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.OPENCHORD_HOME;
  });

  it("returns the current default config when no config file exists", () => {
    const config = loadConfig();

    expect(config.version).toBe(2);
    expect(config.provider.model).toBe("");
    expect(config.provider.reasoning).toBeUndefined();
  });

  it("rejects config files that omit the current version marker", () => {
    fs.writeFileSync(
      path.join(tempDir, "config.json"),
      `${JSON.stringify({
        provider: {
          model: "gpt-5.4",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    expect(() => loadConfig()).toThrow(/version/i);
  });
});
