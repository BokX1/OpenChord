import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../store/config.js";
import { runModelClear, runModelSet, runModelShow } from "./model.js";

describe("model operator", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openchord-model-"));
    process.env.OPENCHORD_HOME = tempDir;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.OPENCHORD_HOME;
    vi.restoreAllMocks();
  });

  it("shows auto defaults when nothing is pinned", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    runModelShow();

    expect(spy).toHaveBeenCalledWith("Model: auto (Codex default)");
    expect(spy).toHaveBeenCalledWith("Reasoning: auto (Codex default)");
  });

  it("stores a pinned model and reasoning", () => {
    runModelSet({ model: "gpt-5.3-codex", reasoning: "high" });

    const config = loadConfig();
    expect(config.provider.model).toBe("gpt-5.3-codex");
    expect(config.provider.reasoning).toBe("high");
  });

  it("clears pinned model settings back to auto", () => {
    runModelSet({ model: "gpt-5.4", reasoning: "medium" });

    runModelClear();

    const config = loadConfig();
    expect(config.provider.model).toBe("");
    expect(config.provider.reasoning).toBeUndefined();
  });
});
