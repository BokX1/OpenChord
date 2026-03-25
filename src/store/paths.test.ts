import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveHomeDir } from "./paths.js";

describe("resolveHomeDir", () => {
  afterEach(() => {
    delete process.env.OPENCHORD_HOME;
  });

  it("prefers OPENCHORD_HOME", () => {
    process.env.OPENCHORD_HOME = "C:\\custom\\openchord";
    expect(resolveHomeDir()).toBe("C:\\custom\\openchord");
  });

  it("defaults to ~/.openchord", () => {
    expect(resolveHomeDir()).toBe(path.join(os.homedir(), ".openchord"));
  });
});
