import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { BridgeConfig } from "../types.js";
import { ensureParentDir } from "../utils/file-system.js";
import {
  resolveHomeDir,
  resolveLaunchAgentPath,
  resolveServiceDirPath,
  resolveSystemdUnitPath,
  resolveWindowsServiceScriptPath,
} from "../store/paths.js";

export type ServicePlatform = "windows" | "linux" | "macos";

export type ServiceActionResult = {
  message: string;
  platform: ServicePlatform;
};

type CommandRunner = (
  file: string,
  args: string[],
) => { status: number | null; stdout: string; stderr: string; error?: Error };

type ServiceManagerDependencies = {
  platform?: ServicePlatform;
  runner?: CommandRunner;
  nodePath?: string;
  scriptPath?: string;
};

const WINDOWS_TASK_NAME = "OpenChord";

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteSystemdArg(value: string): string {
  return value.replace(/(["\\\s])/g, "\\$1");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toPlatform(platformOverride?: ServicePlatform): ServicePlatform {
  if (platformOverride) {
    return platformOverride;
  }
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    default:
      return "linux";
  }
}

function defaultRunner(file: string, args: string[]): ReturnType<CommandRunner> {
  const result = spawnSync(file, args, {
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error } : {}),
  };
}

function ensureCommandSucceeded(result: ReturnType<CommandRunner>, label: string): void {
  if (result.error) {
    throw new Error(`${label} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || `exit ${String(result.status)}`).trim();
    throw new Error(`${label} failed: ${details}`);
  }
}

function runPowerShell(
  runner: CommandRunner,
  script: string,
): ReturnType<CommandRunner> {
  return runner("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ]);
}

function buildWindowsTaskCommand(servicePath: string): string {
  return `-NoProfile -ExecutionPolicy Bypass -File "${servicePath}"`;
}

function resolveCliInvocation(
  deps: Pick<ServiceManagerDependencies, "nodePath" | "scriptPath">,
): { nodePath: string; scriptPath: string } {
  const scriptPath = deps.scriptPath ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
  if (!scriptPath) {
    throw new Error("Unable to resolve the installed OpenChord CLI script path.");
  }
  return {
    nodePath: deps.nodePath ?? process.execPath,
    scriptPath: deps.scriptPath ? scriptPath : path.resolve(scriptPath),
  };
}

function resolveServicePathEnv(): string {
  return process.env.PATH || "";
}

function buildWindowsManagedProcessQuery(params: { scriptPath: string; wrapperPath: string }): string {
  void params;
  return "$_.ProcessId -ne $PID -and $_.CommandLine -and (((($_.Name -eq 'node.exe') -and $_.CommandLine.Contains($scriptPath) -and $_.CommandLine.Contains('daemon start'))) -or ((($_.Name -eq 'powershell.exe') -and $_.CommandLine.Contains($wrapperPath))))";
}

function buildWindowsCleanupScript(params: { scriptPath: string; wrapperPath: string }): string {
  const processQuery = buildWindowsManagedProcessQuery(params);
  return [
    `$scriptPath = ${quotePowerShell(params.scriptPath)}`,
    `$wrapperPath = ${quotePowerShell(params.wrapperPath)}`,
    `$processes = @(Get-CimInstance Win32_Process | Where-Object { ${processQuery} })`,
    "foreach ($process in $processes) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }",
  ].join("; ");
}

function buildWindowsStatusScript(params: { scriptPath: string; wrapperPath: string }): string {
  const processQuery = buildWindowsManagedProcessQuery(params);
  return [
    `$scriptPath = ${quotePowerShell(params.scriptPath)}`,
    `$wrapperPath = ${quotePowerShell(params.wrapperPath)}`,
    `$task = Get-ScheduledTask -TaskName ${quotePowerShell(WINDOWS_TASK_NAME)}`,
    `$nodeProcesses = @(Get-CimInstance Win32_Process | Where-Object { ${processQuery} -and $_.Name -eq 'node.exe' })`,
    "$daemonPids = (@($nodeProcesses | Select-Object -ExpandProperty ProcessId) -join ', ')",
    `Write-Output ('TaskName    : ${WINDOWS_TASK_NAME}')`,
    "Write-Output ('State       : ' + $task.State)",
    "Write-Output ('DaemonCount : ' + @($nodeProcesses).Count)",
    "if ($daemonPids) { Write-Output ('DaemonPids  : ' + $daemonPids) }",
  ].join("; ");
}

function buildSystemdUnit(params: { openchordHome: string; workingDirectory: string; nodePath: string; scriptPath: string; pathEnv: string }): string {
  return [
    "[Unit]",
    "Description=OpenChord daemon",
    "After=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `Environment=OPENCHORD_HOME=${quoteSystemdArg(params.openchordHome)}`,
    `Environment=PATH=${quoteSystemdArg(params.pathEnv)}`,
    `WorkingDirectory=${quoteSystemdArg(params.workingDirectory)}`,
    `ExecStart=${quoteSystemdArg(params.nodePath)} ${quoteSystemdArg(params.scriptPath)} daemon start`,
    "Restart=always",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

function buildLaunchAgentPlist(params: { openchordHome: string; workingDirectory: string; nodePath: string; scriptPath: string; pathEnv: string }): string {
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\">",
    "<dict>",
    "  <key>Label</key>",
    "  <string>ai.openchord.agent</string>",
    "  <key>ProgramArguments</key>",
    "  <array>",
    `    <string>${params.nodePath}</string>`,
    `    <string>${params.scriptPath}</string>`,
    "    <string>daemon</string>",
    "    <string>start</string>",
    "  </array>",
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    "    <key>OPENCHORD_HOME</key>",
    `    <string>${escapeXml(params.openchordHome)}</string>`,
    "    <key>PATH</key>",
    `    <string>${escapeXml(params.pathEnv)}</string>`,
    "  </dict>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    "  <key>WorkingDirectory</key>",
    `  <string>${params.workingDirectory}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

function buildWindowsWrapper(params: { openchordHome: string; nodePath: string; scriptPath: string }): string {
  return [
    `$env:OPENCHORD_HOME = ${quotePowerShell(params.openchordHome)}`,
    `& ${quotePowerShell(params.nodePath)} ${quotePowerShell(params.scriptPath)} daemon start`,
    "",
  ].join("\n");
}

export function buildServiceArtifacts(
  config: BridgeConfig,
  deps: Pick<ServiceManagerDependencies, "nodePath" | "platform" | "scriptPath"> = {},
): { platform: ServicePlatform; servicePath: string; content: string; commandPreview: string } {
  const platform = toPlatform(deps.platform);
  const invocation = resolveCliInvocation(deps);
  const openchordHome = resolveHomeDir();
  const workingDirectory = config.provider.isolatedCwd;
  const pathEnv = resolveServicePathEnv();

  switch (platform) {
    case "linux":
      return {
        platform,
        servicePath: resolveSystemdUnitPath(),
        content: buildSystemdUnit({
          openchordHome,
          workingDirectory,
          pathEnv,
          ...invocation,
        }),
        commandPreview: `systemctl --user start openchord`,
      };
    case "macos":
      return {
        platform,
        servicePath: resolveLaunchAgentPath(),
        content: buildLaunchAgentPlist({
          openchordHome,
          workingDirectory,
          pathEnv,
          ...invocation,
        }),
        commandPreview: `launchctl load -w ${resolveLaunchAgentPath()}`,
      };
    case "windows":
      return {
        platform,
        servicePath: resolveWindowsServiceScriptPath(),
        content: buildWindowsWrapper({
          openchordHome,
          ...invocation,
        }),
        commandPreview: `schtasks /Run /TN OpenChord`,
      };
  }
}

export class ServiceManager {
  private readonly runner: CommandRunner;
  private readonly platform?: ServicePlatform;
  private readonly nodePath?: string;
  private readonly scriptPath?: string;

  constructor(deps: ServiceManagerDependencies = {}) {
    this.platform = deps.platform;
    this.runner = deps.runner ?? defaultRunner;
    this.nodePath = deps.nodePath;
    this.scriptPath = deps.scriptPath;
  }

  install(config: BridgeConfig): ServiceActionResult {
    const artifacts = buildServiceArtifacts(config, {
      nodePath: this.nodePath,
      platform: this.platform,
      scriptPath: this.scriptPath,
    });
    ensureParentDir(artifacts.servicePath);
    fs.writeFileSync(artifacts.servicePath, artifacts.content, "utf8");

    switch (artifacts.platform) {
      case "linux": {
        ensureCommandSucceeded(this.runner("systemctl", ["--user", "daemon-reload"]), "systemctl daemon-reload");
        ensureCommandSucceeded(this.runner("systemctl", ["--user", "enable", "openchord.service"]), "systemctl enable");
        return {
          platform: artifacts.platform,
          message: `Installed user service at ${artifacts.servicePath}.`,
        };
      }
      case "macos": {
        const plistPath = artifacts.servicePath;
        const unload = this.runner("launchctl", ["unload", plistPath]);
        if (unload.status !== 0 && !/Could not find specified service|No such process/i.test(`${unload.stderr}\n${unload.stdout}`)) {
          ensureCommandSucceeded(unload, "launchctl unload");
        }
        ensureCommandSucceeded(this.runner("launchctl", ["load", "-w", plistPath]), "launchctl load");
        return {
          platform: artifacts.platform,
          message: `Installed LaunchAgent at ${plistPath}.`,
        };
      }
      case "windows": {
        ensureParentDir(resolveServiceDirPath());
        const taskCommand = buildWindowsTaskCommand(artifacts.servicePath);
        const script = [
          `$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${quotePowerShell(taskCommand)}`,
          "$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME",
          `$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Days 3650)`,
          `Register-ScheduledTask -TaskName ${quotePowerShell(WINDOWS_TASK_NAME)} -Action $action -Trigger $trigger -Settings $settings -User $env:USERNAME -RunLevel Limited -Force | Out-Null`,
        ].join("; ");
        ensureCommandSucceeded(
          runPowerShell(this.runner, script),
          "Register-ScheduledTask",
        );
        return {
          platform: artifacts.platform,
          message: `Installed Scheduled Task OpenChord with wrapper ${artifacts.servicePath}.`,
        };
      }
    }
  }

  start(): ServiceActionResult {
    const platform = toPlatform(this.platform);
    switch (platform) {
      case "linux":
        ensureCommandSucceeded(this.runner("systemctl", ["--user", "start", "openchord.service"]), "systemctl start");
        return { platform, message: "Started OpenChord user service." };
      case "macos":
        ensureCommandSucceeded(this.runner("launchctl", ["kickstart", "-k", `gui/${process.getuid?.() ?? os.userInfo().uid}/ai.openchord.agent`]), "launchctl kickstart");
        return { platform, message: "Started OpenChord LaunchAgent." };
      case "windows":
        ensureCommandSucceeded(
          runPowerShell(
            this.runner,
            buildWindowsCleanupScript({
              ...resolveCliInvocation({ nodePath: this.nodePath, scriptPath: this.scriptPath }),
              wrapperPath: resolveWindowsServiceScriptPath(),
            }),
          ),
          "OpenChord cleanup",
        );
        ensureCommandSucceeded(
          runPowerShell(this.runner, `Start-ScheduledTask -TaskName ${quotePowerShell(WINDOWS_TASK_NAME)}`),
          "Start-ScheduledTask",
        );
        return { platform, message: "Started OpenChord Scheduled Task." };
    }
  }

  stop(): ServiceActionResult {
    const platform = toPlatform(this.platform);
    switch (platform) {
      case "linux":
        ensureCommandSucceeded(this.runner("systemctl", ["--user", "stop", "openchord.service"]), "systemctl stop");
        return { platform, message: "Stopped OpenChord user service." };
      case "macos":
        ensureCommandSucceeded(this.runner("launchctl", ["bootout", `gui/${process.getuid?.() ?? os.userInfo().uid}/ai.openchord.agent`]), "launchctl bootout");
        return { platform, message: "Stopped OpenChord LaunchAgent." };
      case "windows":
        {
          const stopResult = runPowerShell(this.runner, `Stop-ScheduledTask -TaskName ${quotePowerShell(WINDOWS_TASK_NAME)}`);
          if (stopResult.status !== 0 && !/not running|is not running/i.test(`${stopResult.stderr}\n${stopResult.stdout}`)) {
            ensureCommandSucceeded(stopResult, "Stop-ScheduledTask");
          }
          ensureCommandSucceeded(
            runPowerShell(
              this.runner,
              buildWindowsCleanupScript({
                ...resolveCliInvocation({ nodePath: this.nodePath, scriptPath: this.scriptPath }),
                wrapperPath: resolveWindowsServiceScriptPath(),
              }),
            ),
            "OpenChord cleanup",
          );
        }
        return { platform, message: "Stopped OpenChord Scheduled Task." };
    }
  }

  status(): ServiceActionResult {
    const platform = toPlatform(this.platform);
    switch (platform) {
      case "linux": {
        const result = this.runner("systemctl", ["--user", "status", "openchord.service", "--no-pager"]);
        ensureCommandSucceeded(result, "systemctl status");
        return {
          platform,
          message: result.stdout.trim() || result.stderr.trim() || "No status output.",
        };
      }
      case "macos": {
        const result = this.runner("launchctl", ["list", "ai.openchord.agent"]);
        ensureCommandSucceeded(result, "launchctl list");
        return {
          platform,
          message: result.stdout.trim() || result.stderr.trim() || "No status output.",
        };
      }
      case "windows": {
        const result = runPowerShell(
          this.runner,
          buildWindowsStatusScript({
            ...resolveCliInvocation({ nodePath: this.nodePath, scriptPath: this.scriptPath }),
            wrapperPath: resolveWindowsServiceScriptPath(),
          }),
        );
        ensureCommandSucceeded(result, "Get-ScheduledTask");
        return {
          platform,
          message: result.stdout.trim() || result.stderr.trim() || "No status output.",
        };
      }
    }
  }

  uninstall(): ServiceActionResult {
    const platform = toPlatform(this.platform);
    switch (platform) {
      case "linux": {
        const unitPath = resolveSystemdUnitPath();
        const disable = this.runner("systemctl", ["--user", "disable", "--now", "openchord.service"]);
        if (disable.status !== 0 && !/not loaded|No such file/i.test(`${disable.stderr}\n${disable.stdout}`)) {
          ensureCommandSucceeded(disable, "systemctl disable");
        }
        if (fs.existsSync(unitPath)) {
          fs.unlinkSync(unitPath);
        }
        ensureCommandSucceeded(this.runner("systemctl", ["--user", "daemon-reload"]), "systemctl daemon-reload");
        return { platform, message: "Uninstalled OpenChord user service." };
      }
      case "macos": {
        const plistPath = resolveLaunchAgentPath();
        const unload = this.runner("launchctl", ["unload", plistPath]);
        if (unload.status !== 0 && !/Could not find specified service|No such process/i.test(`${unload.stderr}\n${unload.stdout}`)) {
          ensureCommandSucceeded(unload, "launchctl unload");
        }
        if (fs.existsSync(plistPath)) {
          fs.unlinkSync(plistPath);
        }
        return { platform, message: "Uninstalled OpenChord LaunchAgent." };
      }
      case "windows": {
        const scriptPath = resolveWindowsServiceScriptPath();
        const deletion = runPowerShell(
          this.runner,
          `Unregister-ScheduledTask -TaskName ${quotePowerShell(WINDOWS_TASK_NAME)} -Confirm:$false`,
        );
        if (deletion.status !== 0 && !/cannot find|No MSFT_ScheduledTask objects found/i.test(`${deletion.stderr}\n${deletion.stdout}`)) {
          ensureCommandSucceeded(deletion, "Unregister-ScheduledTask");
        }
        ensureCommandSucceeded(
          runPowerShell(
            this.runner,
            buildWindowsCleanupScript({
              ...resolveCliInvocation({ nodePath: this.nodePath, scriptPath: this.scriptPath }),
              wrapperPath: resolveWindowsServiceScriptPath(),
            }),
          ),
          "OpenChord cleanup",
        );
        if (fs.existsSync(scriptPath)) {
          fs.unlinkSync(scriptPath);
        }
        return { platform, message: "Uninstalled OpenChord Scheduled Task." };
      }
    }
  }
}
