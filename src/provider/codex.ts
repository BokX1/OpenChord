import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { toCodexInput } from "../router/router.js";
import type { AuthorityRole, ChannelSession, CodexAuthStatus, CodexThreadSummary, BridgeConfig, DiscordMessage, ProgressUpdate } from "../types.js";
import type { ExecutableTool } from "../transport/disgg/client.js";

type JsonRpcId = number;

type JsonRpcSuccess = {
  id: JsonRpcId;
  result: unknown;
};

type JsonRpcError = {
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
  };
};

type JsonRpcServerRequest = {
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

type JsonRpcNotification = {
  method: string;
  params?: unknown;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type ActiveTurnCollector = {
  finalText: string;
  lastAgentText: string;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  onProgress?: (update: ProgressUpdate) => void | Promise<void>;
};

type RunTurnParams = {
  config: BridgeConfig;
  session: ChannelSession | null;
  bindingLabel: string;
  mode: string;
  userRole: AuthorityRole;
  message: DiscordMessage;
  appId: string;
  tools: ExecutableTool[];
  onProgress?: (update: ProgressUpdate) => void | Promise<void>;
};

export type RunTurnResult = {
  threadId: string;
  finalText: string;
  model: string;
};

export type ProviderProbe = {
  userAgent: string;
  authStatus: CodexAuthStatus;
  modelCount: number;
};

type CodexThreadReadResponse = {
  thread: {
    id: string;
    preview: string;
    cwd: string;
    updatedAt: number;
    createdAt: number;
    name: string | null;
    modelProvider: string;
    cliVersion: string;
    turns?: unknown[];
    status: { type: string };
  };
};

const STRICT_APPROVAL_POLICY = "never";

function isWindowsCommandShim(command: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

function quoteWindowsCmdArg(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function resolveWindowsCommandPath(command: string): string {
  if (process.platform !== "win32") {
    return command;
  }
  if (path.isAbsolute(command) || command.includes("\\") || command.includes("/") || /\.[a-z0-9]+$/i.test(command)) {
    return command;
  }

  const lookup = spawnSync("where.exe", [command], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (lookup.error || lookup.status !== 0) {
    return command;
  }

  const matches = `${lookup.stdout}\n${lookup.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const preferred = matches.find((entry) => /\.(cmd|bat)$/i.test(entry))
    ?? matches.find((entry) => /\.(exe)$/i.test(entry))
    ?? matches[0];
  return preferred || command;
}

function resolveCommandInvocation(
  command: string,
  args: string[],
): { file: string; args: string[]; windowsVerbatimArguments?: boolean } {
  const resolvedCommand = resolveWindowsCommandPath(command);

  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(resolvedCommand)) {
    const baseDir = path.dirname(resolvedCommand);
    const codexScriptPath = path.join(baseDir, "node_modules", "@openai", "codex", "bin", "codex.js");
    if (fs.existsSync(codexScriptPath)) {
      const bundledNodePath = path.join(baseDir, "node.exe");
      return {
        file: fs.existsSync(bundledNodePath) ? bundledNodePath : process.execPath,
        args: [codexScriptPath, ...args],
      };
    }
  }

  if (!isWindowsCommandShim(resolvedCommand)) {
    return { file: resolvedCommand, args };
  }

  const cmd = process.env.ComSpec || "cmd.exe";
  const commandLine = [quoteWindowsCmdArg(resolvedCommand), ...args.map((arg) => quoteWindowsCmdArg(arg))].join(" ");
  return {
    file: cmd,
    args: ["/d", "/s", "/c", `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
}

function parseModelRef(modelRef: string): { model?: string; modelProvider?: string } {
  const trimmed = modelRef.trim();
  if (!trimmed) {
    return {};
  }
  if (!trimmed.includes("/")) {
    return { model: trimmed };
  }
  const [provider, model] = trimmed.split("/", 2);
  if (!model) {
    return { model: trimmed };
  }
  return provider === "openai-codex" ? { model } : { model, modelProvider: provider };
}

function toReasoningEffort(reasoning: BridgeConfig["provider"]["reasoning"]): string | undefined {
  return reasoning;
}

function ensureIsolatedWorkspace(config: BridgeConfig): void {
  fs.mkdirSync(config.provider.isolatedCwd, { recursive: true });
}

function resolveCodexExecutablePath(command: string): string | null {
  const invocation = resolveCommandInvocation(command, ["--help"]);
  const candidate = invocation.file;
  if (!candidate) {
    return null;
  }

  if (path.isAbsolute(candidate)) {
    return candidate;
  }

  if (process.platform === "win32") {
    return resolveWindowsCommandPath(command);
  }

  const lookup = spawnSync("which", [command], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (lookup.error || lookup.status !== 0) {
    return null;
  }

  const resolved = `${lookup.stdout}\n${lookup.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return resolved || null;
}

function findCodexPackageRoot(executablePath: string): string | null {
  const resolved = path.resolve(executablePath);
  const candidates = [
    path.join(path.dirname(resolved), "node_modules", "@openai", "codex"),
    path.join(path.dirname(path.dirname(resolved)), "lib", "node_modules", "@openai", "codex"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  let cursor = path.dirname(resolved);
  for (let depth = 0; depth < 8; depth += 1) {
    const packageJsonPath = path.join(cursor, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { name?: string };
        if (parsed.name === "@openai/codex") {
          return cursor;
        }
      } catch {
        // Ignore malformed package.json while probing.
      }
    }
    const next = path.dirname(cursor);
    if (next === cursor) {
      break;
    }
    cursor = next;
  }

  return null;
}

function getResolverReadableRoots(platform: NodeJS.Platform): string[] {
  if (platform === "linux") {
    return [
      "/etc/hosts",
      "/etc/resolv.conf",
      "/etc/nsswitch.conf",
      "/etc/host.conf",
      "/etc/gai.conf",
      "/run/systemd/resolve",
    ];
  }

  if (platform === "darwin") {
    return [
      "/etc/hosts",
      "/etc/resolv.conf",
    ];
  }

  return [];
}

function collectSandboxReadableRoots(config: BridgeConfig): string[] {
  const roots = new Set<string>([path.resolve(config.provider.isolatedCwd)]);
  const executablePath = resolveCodexExecutablePath(config.provider.codexCommand);
  if (executablePath && fs.existsSync(executablePath)) {
    roots.add(path.resolve(path.dirname(executablePath)));
    const packageRoot = findCodexPackageRoot(executablePath);
    if (packageRoot) {
      roots.add(path.resolve(packageRoot));
    }
  }
  for (const resolverPath of getResolverReadableRoots(process.platform)) {
    if (fs.existsSync(resolverPath)) {
      roots.add(path.resolve(resolverPath));
    }
  }
  return [...roots];
}

export function buildSandboxPolicy(config: BridgeConfig): Record<string, unknown> {
  const readableRoots = collectSandboxReadableRoots(config);

  if (config.provider.hostToolProfile === "strict-read-only") {
    return {
      type: "readOnly",
      access: {
        type: "restricted",
        includePlatformDefaults: true,
        readableRoots,
      },
      networkAccess: false,
    };
  }

  return {
    type: "workspaceWrite",
    writableRoots: [config.provider.isolatedCwd],
    readOnlyAccess: {
      type: "restricted",
      includePlatformDefaults: true,
      readableRoots,
    },
    excludeSlashTmp: true,
    excludeTmpdirEnvVar: true,
    networkAccess: true,
  };
}

function getThreadSandboxMode(config: BridgeConfig): "read-only" | "workspace-write" {
  return config.provider.hostToolProfile === "strict-read-only" ? "read-only" : "workspace-write";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function isMissingThreadError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /not[_ -]?found|missing session|unknown thread/i.test(error.message);
}

function sanitizeThreadStatus(value: unknown): string {
  if (!isObject(value)) {
    return "unknown";
  }
  return readString(value.type, "unknown");
}

export class CodexProvider {
  private child: ChildProcessWithoutNullStreams | null = null;
  private output: Interface | null = null;
  private nextId = 1;
  private initializedForCommand: string | null = null;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly turnCollectors = new Map<string, ActiveTurnCollector>();
  private readonly threadTools = new Map<string, Map<string, ExecutableTool>>();

  async probe(config: BridgeConfig): Promise<ProviderProbe> {
    await this.ensureStarted(config);
    const authStatus = (await this.request("getAuthStatus", {})) as CodexAuthStatus;
    const models = (await this.request("model/list", {})) as { models?: unknown[] };
    return {
      userAgent: "codex app-server",
      authStatus,
      modelCount: Array.isArray(models.models) ? models.models.length : 0,
    };
  }

  async readThread(config: BridgeConfig, threadId: string): Promise<CodexThreadSummary> {
    await this.ensureStarted(config);
    const response = (await this.request("thread/read", {
      threadId,
      includeTurns: true,
    })) as CodexThreadReadResponse;
    return {
      id: response.thread.id,
      preview: response.thread.preview,
      cwd: response.thread.cwd,
      status: sanitizeThreadStatus(response.thread.status),
      updatedAt: response.thread.updatedAt,
      createdAt: response.thread.createdAt,
      name: response.thread.name,
      modelProvider: response.thread.modelProvider,
      cliVersion: response.thread.cliVersion,
      turnCount: Array.isArray(response.thread.turns) ? response.thread.turns.length : 0,
    };
  }

  async runTurn(params: RunTurnParams): Promise<RunTurnResult> {
    try {
      return await this.runTurnInternal(params);
    } catch (error) {
      if (params.session && isMissingThreadError(error)) {
        return this.runTurnInternal({
          ...params,
          session: null,
        });
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.initializedForCommand = null;
    this.output?.close();
    this.output = null;

    for (const entry of this.pending.values()) {
      entry.reject(new Error("Codex app-server connection closed."));
    }
    this.pending.clear();

    for (const collector of this.turnCollectors.values()) {
      collector.reject(new Error("Codex app-server connection closed."));
    }
    this.turnCollectors.clear();

    if (!child) {
      return;
    }

    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
        resolve();
      }, 3000);
    });
  }

  static buildSystemPrompt(params: { bindingLabel: string; mode: string; assistantName: string }): string {
    return [
      `You are ${params.assistantName}, the public-facing Discord assistant for this bound channel session.`,
      `Current channel: ${params.bindingLabel}.`,
      `Reply mode: ${params.mode}.`,
      "Codex app-server is your backend reasoning runtime, not your public-facing persona.",
      `Do not describe yourself as 'Codex running inside ${params.assistantName}' unless the user explicitly asks about internals.`,
      `If the user asks how you work, explain that ${params.assistantName} is the assistant they are talking to and Codex app-server powers the reasoning behind the scenes.`,
      "You are connected to Codex app-server inside a sandbox centered on an isolated workspace.",
      "If asked about local capabilities, say you may have limited sandboxed shell, file, and network access, with writes confined to the isolated workspace and some broader read-only runtime access, plus approved Discord tools, but not unrestricted host access outside that sandbox.",
      "Use view_image and approved Discord tools when they materially help.",
      "You may use sandboxed shell and file capabilities when they materially help, but keep writes confined to the isolated workspace and do not claim unrestricted host access.",
      "Authority is role-based per incoming message.",
      "Each user message includes the current caller role: owner, admin, or user.",
      "The owner is the highest-trust operator for this deployment.",
      "Admins are trusted operators below the owner.",
      "For sandboxed local shell, file, and network actions: you may follow owner instructions, you may usually follow admin instructions unless they conflict with owner intent, and you should be conservative with user requests. Do not expose secrets or perform sensitive local actions for unprivileged users.",
      "Discord-side authorization is handled separately by the Discord tool layer.",
      "Do not mutate OpenChord configuration, install plugins, or attempt host escalation outside the sandbox.",
      "Do not use a Discord send-message tool to answer back into the current channel; the runtime will post your final reply there.",
      "Keep replies concise, helpful, and production-safe.",
      "Avoid destructive server actions unless the user explicitly asks and the tool is available.",
    ].join("\n");
  }

  static verifyCodexBinary(command: string): { ok: boolean; message: string } {
    const invocation = resolveCommandInvocation(command, ["--help"]);
    const probe = spawnSync(invocation.file, invocation.args, {
      encoding: "utf8",
      windowsHide: true,
      ...(invocation.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });
    if (probe.error) {
      return {
        ok: false,
        message: probe.error.message,
      };
    }
    if (probe.status !== 0) {
      return {
        ok: false,
        message: (probe.stderr || probe.stdout || `Exited with ${String(probe.status)}`).trim(),
      };
    }
    return { ok: true, message: "Codex CLI is available." };
  }

  private async runTurnInternal(params: RunTurnParams): Promise<RunTurnResult> {
    await this.ensureStarted(params.config);
    const threadId = await this.ensureThread(params);
    this.threadTools.set(threadId, new Map(params.tools.map((tool) => [tool.spec.name, tool])));
    const modelRef = parseModelRef(params.config.provider.model);
    const effort = toReasoningEffort(params.config.provider.reasoning);

    const collector = await new Promise<string>((resolve, reject) => {
      this.turnCollectors.set(threadId, {
        finalText: "",
        lastAgentText: "",
        resolve,
        reject,
        onProgress: params.onProgress,
      });
      return this.request("turn/start", {
        threadId,
        input: [toCodexInput(params.message, params.appId, params.userRole)],
        cwd: params.config.provider.isolatedCwd,
        approvalPolicy: STRICT_APPROVAL_POLICY,
        sandboxPolicy: buildSandboxPolicy(params.config),
        ...(modelRef.model ? { model: modelRef.model } : {}),
        ...(effort ? { effort } : {}),
        personality: "friendly",
      }).catch((error) => {
        this.turnCollectors.delete(threadId);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });

    return {
      threadId,
      finalText: collector,
      model: params.config.provider.model || "auto",
    };
  }

  private async ensureThread(params: RunTurnParams): Promise<string> {
    const existingThreadId = params.session?.threadId;
    if (existingThreadId) {
      return existingThreadId;
    }

    const { model, modelProvider } = parseModelRef(params.config.provider.model);
    const response = (await this.request("thread/start", {
      ...(model ? { model } : {}),
      ...(modelProvider ? { modelProvider } : {}),
      cwd: params.config.provider.isolatedCwd,
      approvalPolicy: STRICT_APPROVAL_POLICY,
      sandbox: getThreadSandboxMode(params.config),
      config: {
        tools: {
          view_image: true,
        },
      },
      serviceName: "OpenChord",
      developerInstructions: CodexProvider.buildSystemPrompt({
        bindingLabel: params.bindingLabel,
        mode: params.mode,
        assistantName: params.config.identity.assistantName,
      }),
      personality: "friendly",
      dynamicTools: params.tools.map((tool) => tool.spec),
      experimentalRawEvents: false,
      persistExtendedHistory: true,
    })) as {
      thread: {
        id: string;
      };
    };

    return response.thread.id;
  }

  private async ensureStarted(config: BridgeConfig): Promise<void> {
    if (this.child && this.initializedForCommand === config.provider.codexCommand) {
      return;
    }

    await this.close();
    ensureIsolatedWorkspace(config);

    const invocation = resolveCommandInvocation(config.provider.codexCommand, [
      "app-server",
      "-c",
      "allow_login_shell=false",
      "--listen",
      "stdio://",
    ]);
    const child = spawn(invocation.file, invocation.args, {
      cwd: config.provider.isolatedCwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      ...(invocation.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });

    const output = createInterface({ input: child.stdout });
    output.on("line", (line) => {
      this.handleLine(line);
    });

    child.on("error", (error) => {
      const message = `Failed to start codex app-server: ${error.message}`;
      for (const entry of this.pending.values()) {
        entry.reject(new Error(message));
      }
      this.pending.clear();
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) {
        console.warn(`[codex app-server] ${text}`);
      }
    });

    this.child = child;
    this.output = output;
    this.initializedForCommand = config.provider.codexCommand;

    await this.request("initialize", {
      clientInfo: {
        name: "openchord",
        title: "OpenChord",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      return;
    }

    if (!isObject(parsed)) {
      return;
    }

    if ("id" in parsed && ("result" in parsed || "error" in parsed)) {
      this.handleResponse(parsed as JsonRpcSuccess | JsonRpcError);
      return;
    }

    if ("id" in parsed && "method" in parsed) {
      void this.handleServerRequest(parsed as JsonRpcServerRequest);
      return;
    }

    if ("method" in parsed) {
      this.handleNotification(parsed as JsonRpcNotification);
    }
  }

  private handleResponse(message: JsonRpcSuccess | JsonRpcError): void {
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    if ("error" in message) {
      pending.reject(new Error(message.error.message));
      return;
    }
    pending.resolve(message.result);
  }

  private handleNotification(message: JsonRpcNotification): void {
    if (message.method === "item/completed" && isObject(message.params)) {
      const threadId = readString(message.params.threadId);
      const item = isObject(message.params.item) ? message.params.item : null;
      const collector = this.turnCollectors.get(threadId);
      if (!collector || !item || item.type !== "agentMessage") {
        return;
      }

      const text = readString(item.text).trim();
      const phase = item.phase;
      if (!text) {
        return;
      }

      collector.lastAgentText = text;
      if (phase !== "final_answer") {
        void collector.onProgress?.({
          text,
          phase: typeof phase === "string" ? phase : undefined,
        });
      }
      if (phase === "final_answer") {
        collector.finalText = text;
      }
      return;
    }

    if (message.method === "turn/completed" && isObject(message.params)) {
      const threadId = readString(message.params.threadId);
      const collector = this.turnCollectors.get(threadId);
      if (!collector) {
        return;
      }

      this.turnCollectors.delete(threadId);
      const turn = isObject(message.params.turn) ? message.params.turn : {};
      const turnError = isObject(turn.error) ? readString(turn.error.message) : "";
      if (turnError) {
        collector.reject(new Error(turnError));
        return;
      }

      const finalText = collector.finalText || collector.lastAgentText;
      if (!finalText) {
        collector.reject(new Error("Codex app-server returned no visible final text."));
        return;
      }

      collector.resolve(finalText);
    }
  }

  private async handleServerRequest(message: JsonRpcServerRequest): Promise<void> {
    try {
      switch (message.method) {
        case "item/tool/call":
          await this.respond(message.id, await this.handleDynamicToolCall(message.params));
          return;
        case "item/commandExecution/requestApproval":
          await this.respond(message.id, { decision: "decline" });
          return;
        case "item/fileChange/requestApproval":
          await this.respond(message.id, { decision: "decline" });
          return;
        case "item/permissions/requestApproval":
          await this.respond(message.id, { permissions: {}, scope: "turn" });
          return;
        case "item/tool/requestUserInput":
          await this.respond(message.id, { answers: {} });
          return;
        case "mcpServer/elicitation/request":
          await this.respond(message.id, { action: "decline", content: null, _meta: null });
          return;
        case "applyPatchApproval":
          await this.respond(message.id, { decision: "denied" });
          return;
        case "execCommandApproval":
          await this.respond(message.id, { decision: "denied" });
          return;
        default:
          await this.respondError(message.id, `Unsupported server request: ${message.method}`);
      }
    } catch (error) {
      await this.respondError(message.id, error instanceof Error ? error.message : String(error));
    }
  }

  private async handleDynamicToolCall(params: unknown): Promise<unknown> {
    if (!isObject(params)) {
      return {
        contentItems: [{ type: "inputText", text: "Dynamic tool payload was invalid." }],
        success: false,
      };
    }

    const threadId = readString(params.threadId);
    const toolName = readString(params.tool);
    const threadTools = this.threadTools.get(threadId);
    const tool = threadTools?.get(toolName);
    if (!tool) {
      return {
        contentItems: [{ type: "inputText", text: `Tool "${toolName}" is unavailable in this OpenChord session.` }],
        success: false,
      };
    }

    const rawArguments = isObject(params.arguments) ? params.arguments : {};
    return tool.execute(rawArguments);
  }

  private async request<T>(method: string, params: unknown): Promise<T> {
    const child = this.child;
    if (!child) {
      throw new Error("Codex app-server is not running.");
    }

    const id = this.nextId++;
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });

    const resultPromise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
    });

    child.stdin.write(`${payload}\n`);
    return resultPromise;
  }

  private async respond(id: JsonRpcId, result: unknown): Promise<void> {
    const child = this.child;
    if (!child) {
      return;
    }
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`,
    );
  }

  private async respondError(id: JsonRpcId, message: string): Promise<void> {
    const child = this.child;
    if (!child) {
      return;
    }
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message,
        },
      })}\n`,
    );
  }
}
