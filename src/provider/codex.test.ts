import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSandboxPolicy, CodexProvider } from "./codex.js";
import { makeTestConfig } from "../test/test-config.js";

describe("CodexProvider.buildSystemPrompt", () => {
  it("presents OpenChord as the public-facing persona", () => {
    const prompt = CodexProvider.buildSystemPrompt({
      assistantName: "Chordy",
      bindingLabel: "Example Guild / #example",
      mode: "mention",
    });

    expect(prompt).toContain("You are Chordy, the public-facing Discord assistant");
    expect(prompt).toContain("Codex app-server is your backend reasoning runtime");
    expect(prompt).toContain("limited sandboxed shell, file, and network access");
    expect(prompt).toContain("writes confined to the isolated workspace");
    expect(prompt).toContain("Each user message includes the current caller role");
    expect(prompt).toContain("The owner is the highest-trust operator");
    expect(prompt).toContain("not unrestricted host access outside that sandbox");
  });
});

describe("buildSandboxPolicy", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("keeps writes scoped to the workspace while allowing platform defaults for reads", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openchord-sandbox-"));
    tempDirs.push(tempDir);
    const workspace = path.join(tempDir, "workspace");
    const binDir = path.join(tempDir, "bin");
    const packageRoot = path.join(tempDir, "lib", "node_modules", "@openai", "codex");
    fs.mkdirSync(workspace, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.writeFileSync(path.join(binDir, "codex"), "", "utf8");
    fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name: "@openai/codex" }), "utf8");

    const config = makeTestConfig({
      provider: {
        hostToolProfile: "sandboxed-workspace-write",
        isolatedCwd: workspace,
        codexCommand: path.join(binDir, "codex"),
      },
    });

    expect(buildSandboxPolicy(config)).toEqual({
      type: "workspaceWrite",
      writableRoots: [workspace],
      readOnlyAccess: {
        type: "restricted",
        includePlatformDefaults: true,
        readableRoots: [workspace, binDir, packageRoot],
      },
      excludeSlashTmp: true,
      excludeTmpdirEnvVar: true,
      networkAccess: true,
    });
  });
});
