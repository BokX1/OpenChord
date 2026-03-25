import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runNameClear, runNameSet, runNameShow } from "./name.js";
import { loadConfig } from "../store/config.js";
import { resolveConfigPath } from "../store/paths.js";

describe("assistant name commands", () => {
  const originalHome = process.env.OPENCHORD_HOME;
  let testHome = "";

  function configPath(): string {
    return resolveConfigPath();
  }

  function silenceConsole<T>(fn: () => T): T {
    const originalLog = console.log;
    console.log = () => undefined;
    try {
      return fn();
    } finally {
      console.log = originalLog;
    }
  }

  afterEach(() => {
    if (testHome) {
      fs.rmSync(testHome, { recursive: true, force: true });
      testHome = "";
    }
    if (originalHome === undefined) {
      delete process.env.OPENCHORD_HOME;
    } else {
      process.env.OPENCHORD_HOME = originalHome;
    }
  });

  function prepareHome(): void {
    testHome = fs.mkdtempSync(path.join(os.tmpdir(), "openchord-name-"));
    process.env.OPENCHORD_HOME = testHome;
  }

  afterEach(() => {
    fs.rmSync(configPath(), { force: true });
  });

  it("stores a custom assistant name", () => {
    prepareHome();
    silenceConsole(() => runNameSet({ name: "HelperBot" }));
    expect(loadConfig().identity.assistantName).toBe("HelperBot");
  });

  it("resets back to OpenChord", () => {
    prepareHome();
    silenceConsole(() => runNameSet({ name: "HelperBot" }));
    silenceConsole(() => runNameClear());
    expect(loadConfig().identity.assistantName).toBe("OpenChord");
  });

  it("shows the configured assistant name", () => {
    prepareHome();
    silenceConsole(() => runNameSet({ name: "HelperBot" }));
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (line?: unknown) => {
      lines.push(String(line ?? ""));
    };
    try {
      runNameShow();
    } finally {
      console.log = originalLog;
    }

    expect(lines[0]).toContain("Assistant name: HelperBot");
  });
});
