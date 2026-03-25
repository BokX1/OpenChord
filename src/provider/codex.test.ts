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
    expect(prompt).toContain("Codex app-server is the backend reasoning runtime");
    expect(prompt).toContain("Write access is confined to the isolated workspace.");
    expect(prompt).toContain("Read access is broader than the workspace");
    expect(prompt).toContain("Each user message includes the current caller role");
    expect(prompt).toContain("The owner is the highest-trust operator");
    expect(prompt).toContain("not unrestricted VM or host access");
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

    const policy = buildSandboxPolicy(config) as {
      type: string;
      writableRoots: string[];
      readOnlyAccess: {
        type: string;
        includePlatformDefaults: boolean;
        readableRoots: string[];
      };
      excludeSlashTmp: boolean;
      excludeTmpdirEnvVar: boolean;
      networkAccess: boolean;
    };

    expect(policy.type).toBe("workspaceWrite");
    expect(policy.writableRoots).toEqual([workspace]);
    expect(policy.readOnlyAccess.type).toBe("restricted");
    expect(policy.readOnlyAccess.includePlatformDefaults).toBe(true);
    expect(policy.readOnlyAccess.readableRoots).toEqual(
      expect.arrayContaining([workspace, binDir, packageRoot]),
    );
    expect(policy.excludeSlashTmp).toBe(true);
    expect(policy.excludeTmpdirEnvVar).toBe(true);
    expect(policy.networkAccess).toBe(true);
  });

  it("adds resolver-readable roots when the host platform provides them", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openchord-sandbox-"));
    tempDirs.push(tempDir);
    const workspace = path.join(tempDir, "workspace");
    fs.mkdirSync(workspace, { recursive: true });

    const config = makeTestConfig({
      provider: {
        hostToolProfile: "sandboxed-workspace-write",
        isolatedCwd: workspace,
      },
    });

    const policy = buildSandboxPolicy(config) as {
      readOnlyAccess: {
        readableRoots: string[];
      };
    };

    if (process.platform === "linux") {
      for (const candidate of ["/etc/hosts", "/etc/resolv.conf", "/etc/nsswitch.conf"]) {
        if (fs.existsSync(candidate)) {
          expect(policy.readOnlyAccess.readableRoots).toContain(path.resolve(candidate));
        }
      }
      return;
    }

    if (process.platform === "darwin") {
      for (const candidate of ["/etc/hosts", "/etc/resolv.conf"]) {
        if (fs.existsSync(candidate)) {
          expect(policy.readOnlyAccess.readableRoots).toContain(path.resolve(candidate));
        }
      }
      return;
    }

    expect(policy.readOnlyAccess.readableRoots).toEqual(
      expect.not.arrayContaining([
        path.resolve("/etc/hosts"),
        path.resolve("/etc/resolv.conf"),
      ]),
    );
  });
});
