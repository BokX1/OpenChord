import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildServiceArtifacts, ServiceManager } from "./manager.js";
import { makeTestConfig } from "../test/test-config.js";

const config = makeTestConfig({
  provider: {
    isolatedCwd: "C:\\sandbox\\openchord-workspace",
  },
});

describe("buildServiceArtifacts", () => {
  it("builds a systemd unit for linux", () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "/home/test/.local/bin:/usr/bin";
    const artifacts = buildServiceArtifacts(config, {
      platform: "linux",
      nodePath: "/usr/bin/node",
      scriptPath: "/usr/lib/node_modules/openchord/dist/cli.js",
    });
    process.env.PATH = originalPath;

    expect(artifacts.servicePath).toContain(path.join(".config", "systemd", "user", "openchord.service"));
    expect(artifacts.content).toContain("ExecStart=/usr/bin/node /usr/lib/node_modules/openchord/dist/cli.js daemon start");
    expect(artifacts.content).toContain("Environment=OPENCHORD_HOME=");
    expect(artifacts.content).toContain("Environment=PATH=/home/test/.local/bin:/usr/bin");
  });

  it("builds a launch agent for macos", () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "/Users/test/.local/bin:/usr/local/bin:/usr/bin";
    const artifacts = buildServiceArtifacts(config, {
      platform: "macos",
      nodePath: "/usr/local/bin/node",
      scriptPath: "/usr/local/lib/node_modules/openchord/dist/cli.js",
    });
    process.env.PATH = originalPath;

    expect(artifacts.servicePath).toContain(path.join("Library", "LaunchAgents", "ai.openchord.agent.plist"));
    expect(artifacts.content).toContain("<string>/usr/local/bin/node</string>");
    expect(artifacts.content).toContain("<string>daemon</string>");
    expect(artifacts.content).toContain("<key>PATH</key>");
  });

  it("builds a scheduled-task wrapper for windows", () => {
    const artifacts = buildServiceArtifacts(config, {
      platform: "windows",
      nodePath: "C:\\Program Files\\nodejs\\node.exe",
      scriptPath: "C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\openchord\\dist\\cli.js",
    });

    expect(artifacts.servicePath).toContain(path.join("service", "openchord-task.ps1"));
    expect(artifacts.content).toContain("$env:OPENCHORD_HOME = ");
    expect(artifacts.content).toContain("daemon start");
  });
});

describe("ServiceManager", () => {
  it("uses systemctl enable during linux install", () => {
    const runner = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" });

    const result = new ServiceManager({
      platform: "linux",
      runner,
      nodePath: "/usr/bin/node",
      scriptPath: "/usr/lib/node_modules/openchord/dist/cli.js",
    }).install(config);

    expect(runner).toHaveBeenNthCalledWith(1, "systemctl", ["--user", "daemon-reload"]);
    expect(runner).toHaveBeenNthCalledWith(2, "systemctl", ["--user", "enable", "openchord.service"]);
    expect(result.message).toContain("Installed user service");
  });

  it("fails service status when the backing service is missing", () => {
    const manager = new ServiceManager({
      platform: "windows",
      runner: vi.fn().mockReturnValue({
        status: 1,
        stdout: "Get-ScheduledTask : No MSFT_ScheduledTask objects found with property 'TaskName' equal to 'OpenChord'.",
        stderr: "",
      }),
    });

    expect(() => manager.status()).toThrow(/Get-ScheduledTask failed/i);
  });

  it("cleans up stale windows daemon processes before start", () => {
    const runner = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" });

    const result = new ServiceManager({
      platform: "windows",
      runner,
      nodePath: "C:\\Program Files\\nodejs\\node.exe",
      scriptPath: "C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\openchord\\dist\\cli.js",
    }).start();

    expect(runner).toHaveBeenNthCalledWith(
      1,
      "powershell.exe",
      expect.arrayContaining([
        "-Command",
        expect.stringContaining("Stop-Process -Id $process.ProcessId -Force"),
      ]),
    );
    expect(runner).toHaveBeenNthCalledWith(
      2,
      "powershell.exe",
      expect.arrayContaining([
        "-Command",
        expect.stringContaining("Start-ScheduledTask -TaskName 'OpenChord'"),
      ]),
    );
    expect(result.message).toContain("Started OpenChord Scheduled Task");
  });

  it("reports daemon count in windows service status", () => {
    const manager = new ServiceManager({
      platform: "windows",
      runner: vi.fn().mockReturnValue({
        status: 0,
        stdout: "TaskName    : OpenChord\nState       : Running\nDaemonCount : 1\nDaemonPids  : 1234",
        stderr: "",
      }),
      nodePath: "C:\\Program Files\\nodejs\\node.exe",
      scriptPath: "C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\openchord\\dist\\cli.js",
    });

    const result = manager.status();

    expect(result.message).toContain("DaemonCount : 1");
    expect(result.message).toContain("DaemonPids  : 1234");
  });
});
