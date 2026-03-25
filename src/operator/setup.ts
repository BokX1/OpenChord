import { spawnSync } from "node:child_process";
import { runDoctor, type CheckResult } from "./doctor.js";
import { runOnboard } from "./onboard.js";
import { runSmoke, type SmokeResult } from "./smoke.js";
import { CodexProvider } from "../provider/codex.js";
import { ServiceManager, type ServiceActionResult } from "../service/manager.js";
import { loadConfig, saveConfig } from "../store/config.js";
import { readRuntimeEnv, upsertRuntimeEnv } from "../store/runtime-env.js";
import { DisGgClient } from "../transport/disgg/client.js";
import { prompt } from "../utils/terminal.js";
import type { BridgeConfig, ChannelBinding } from "../types.js";

type PromptFn = (question: string) => Promise<string>;
type SetupClient = Pick<DisGgClient, "getAccessContext" | "listCurrentUserGuilds" | "listGuildChannels" | "fetchMessages">;

export type SetupResult = {
  binding: ChannelBinding;
  doctorResults: CheckResult[];
  smokeResult: SmokeResult;
  installResult: ServiceActionResult;
  startResult: ServiceActionResult;
  storedToken: boolean;
};

type SetupDependencies = {
  ask?: PromptFn;
  createProvider?: () => Pick<CodexProvider, "probe" | "close">;
  createClient?: (config: BridgeConfig, token: string) => SetupClient;
  serviceManager?: Pick<ServiceManager, "install" | "start">;
  runDoctorFn?: () => Promise<CheckResult[]>;
  runSmokeFn?: () => Promise<SmokeResult>;
  loginRunner?: (command: string) => void;
  verifyCodexBinary?: (command: string) => ReturnType<typeof CodexProvider.verifyCodexBinary>;
};

function runCodexLogin(command: string): void {
  const isWindowsShim = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const result = isWindowsShim
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${command} login"`], {
        stdio: "inherit",
        windowsHide: true,
        windowsVerbatimArguments: true,
      })
    : spawnSync(command, ["login"], {
        stdio: "inherit",
        windowsHide: true,
      });

  if (result.error) {
    throw new Error(`Failed to run codex login: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`codex login exited with status ${String(result.status)}.`);
  }
}

async function promptForToken(envVar: string, ask: PromptFn): Promise<string> {
  while (true) {
    const token = await ask(`Enter your Discord bot token for ${envVar}:`);
    if (token.trim()) {
      return token.trim();
    }
    console.log("Please enter a non-empty bot token.");
  }
}

async function promptToReplaceStoredToken(envVar: string, ask: PromptFn): Promise<string | null> {
  const replacement = await ask(`Press Enter to keep the current ${envVar}, or paste a new token to replace it:`);
  return replacement.trim() ? replacement.trim() : null;
}

async function validateDiscordToken(
  config: BridgeConfig,
  token: string,
  createClient: (config: BridgeConfig, token: string) => SetupClient,
): Promise<void> {
  const client = createClient(config, token);
  await client.getAccessContext();
}

async function promptForAnotherBinding(ask: PromptFn): Promise<boolean> {
  while (true) {
    const answer = (await ask("Add another bound channel now? (y/N):")).trim().toLowerCase();
    if (!answer || answer === "n" || answer === "no") {
      return false;
    }
    if (answer === "y" || answer === "yes") {
      return true;
    }
    console.log("Please answer y or n.");
  }
}

function parseDiscordIds(input: string): string[] {
  return [...new Set(
    input
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

function isDiscordSnowflake(value: string): boolean {
  return /^\d{16,20}$/.test(value);
}

async function promptForOwnerUserId(currentOwner: string, ask: PromptFn): Promise<string> {
  while (true) {
    const answer = await ask(
      currentOwner
        ? `Owner Discord user ID [${currentOwner}] (press Enter to keep current, type clear to remove):`
        : "Owner Discord user ID (optional, press Enter to skip):",
    );
    const trimmed = answer.trim();
    if (!trimmed) {
      return currentOwner;
    }
    if (trimmed.toLowerCase() === "clear") {
      return "";
    }
    if (isDiscordSnowflake(trimmed)) {
      return trimmed;
    }
    console.log("Enter a Discord user ID as digits only, or type clear.");
  }
}

async function promptForAdminUserIds(currentAdmins: string[], ask: PromptFn): Promise<string[]> {
  while (true) {
    const answer = await ask(
      currentAdmins.length
        ? `Admin Discord user IDs, comma-separated [${currentAdmins.join(", ")}] (press Enter to keep current, type clear to remove all):`
        : "Admin Discord user IDs, comma-separated (optional, press Enter to skip):",
    );
    const trimmed = answer.trim();
    if (!trimmed) {
      return currentAdmins;
    }
    if (trimmed.toLowerCase() === "clear") {
      return [];
    }
    const ids = parseDiscordIds(trimmed);
    if (ids.length && ids.every((value) => isDiscordSnowflake(value))) {
      return ids;
    }
    console.log("Enter Discord user IDs as digits only, separated by commas, or type clear.");
  }
}

async function promptForAuthority(config: BridgeConfig, ask: PromptFn): Promise<void> {
  const currentOwner = config.authority.ownerUserId;
  const currentAdmins = config.authority.adminUserIds;
  const ownerUserId = await promptForOwnerUserId(currentOwner, ask);
  const adminUserIds = await promptForAdminUserIds(currentAdmins, ask);

  const next = {
    ...config,
    authority: {
      ownerUserId,
      adminUserIds,
    },
  };

  if (
    next.authority.ownerUserId !== config.authority.ownerUserId
    || next.authority.adminUserIds.join(",") !== config.authority.adminUserIds.join(",")
  ) {
    saveConfig(next);
  }
}

async function resolveBotToken(params: {
  config: BridgeConfig;
  ask: PromptFn;
  createClient: (config: BridgeConfig, token: string) => SetupClient;
}): Promise<{ token: string; persisted: boolean; source: "environment" | "runtime-env" }> {
  const envVar = params.config.transport.botTokenEnvVar;
  const envToken = process.env[envVar]?.trim();
  if (envToken) {
    await validateDiscordToken(params.config, envToken, params.createClient);
    return { token: envToken, persisted: false, source: "environment" };
  }

  const storedToken = readRuntimeEnv()[envVar]?.trim();
  if (storedToken) {
    try {
      await validateDiscordToken(params.config, storedToken, params.createClient);
      const replacement = await promptToReplaceStoredToken(envVar, params.ask);
      if (!replacement) {
        return { token: storedToken, persisted: false, source: "runtime-env" };
      }
      await validateDiscordToken(params.config, replacement, params.createClient);
      upsertRuntimeEnv({ [envVar]: replacement });
      return { token: replacement, persisted: true, source: "runtime-env" };
    } catch (error) {
      console.log(
        `Stored ${envVar} failed validation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  while (true) {
    const entered = await promptForToken(envVar, params.ask);
    try {
      await validateDiscordToken(params.config, entered, params.createClient);
      upsertRuntimeEnv({ [envVar]: entered });
      return { token: entered, persisted: true, source: "runtime-env" };
    } catch (error) {
      console.log(
        `Token validation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function ensureCodexReady(
  config: BridgeConfig,
  deps: Required<Pick<SetupDependencies, "createProvider" | "loginRunner" | "verifyCodexBinary">>,
): Promise<void> {
  const binaryProbe = deps.verifyCodexBinary(config.provider.codexCommand);
  if (!binaryProbe.ok) {
    throw new Error(`Codex CLI is unavailable: ${binaryProbe.message}`);
  }

  let provider = deps.createProvider();
  try {
    const probe = await provider.probe(config);
    if (probe.authStatus.authMethod) {
      return;
    }
  } finally {
    await provider.close();
  }

  console.log("Codex login is required. Launching `codex login`...");
  deps.loginRunner(config.provider.codexCommand);

  provider = deps.createProvider();
  try {
    const probe = await provider.probe(config);
    if (!probe.authStatus.authMethod) {
      throw new Error("Codex login is still unavailable after `codex login` completed.");
    }
  } finally {
    await provider.close();
  }
}

export async function runSetup(deps: SetupDependencies = {}): Promise<SetupResult> {
  const ask = deps.ask ?? prompt;
  const createProvider = deps.createProvider ?? (() => new CodexProvider());
  const createClient = deps.createClient ?? ((config, token) => new DisGgClient({ config, token }));
  const serviceManager = deps.serviceManager ?? new ServiceManager();
  const runDoctorFn = deps.runDoctorFn ?? (() => runDoctor());
  const runSmokeFn = deps.runSmokeFn ?? (() => runSmoke());
  const loginRunner = deps.loginRunner ?? runCodexLogin;
  const verifyCodexBinary = deps.verifyCodexBinary ?? ((command) => CodexProvider.verifyCodexBinary(command));

  const config = loadConfig();
  await ensureCodexReady(config, { createProvider, loginRunner, verifyCodexBinary });

  const envVar = config.transport.botTokenEnvVar;
  const tokenResolution = await resolveBotToken({
    config,
    ask,
    createClient,
  });
  await promptForAuthority(loadConfig(), ask);
  const runtimeConfig = loadConfig();

  const bindings: ChannelBinding[] = [];
  const binding = await runOnboard({
    botTokenPresent: true,
    codexReady: true,
    client: createClient(runtimeConfig, tokenResolution.token),
    ask,
  });
  bindings.push(binding);
  while (await promptForAnotherBinding(ask)) {
    const nextBinding = await runOnboard({
      botTokenPresent: true,
      codexReady: true,
      client: createClient(loadConfig(), tokenResolution.token),
      ask,
    });
    bindings.push(nextBinding);
  }

  const doctorResults = await runDoctorFn();
  const blocking = doctorResults.find((result) => result.status === "fail");
  if (blocking) {
    throw new Error(`Setup halted after doctor failure: ${blocking.title} - ${blocking.message}`);
  }

  const smokeResult = await runSmokeFn();
  const installResult = serviceManager.install(loadConfig());
  const startResult = serviceManager.start();

  console.log(
    tokenResolution.persisted
      ? `Stored ${envVar} in runtime env.`
      : `Using ${envVar} from ${tokenResolution.source === "environment" ? "the process environment" : "runtime env"}.`,
  );
  console.log(
    bindings.length === 1
      ? `Binding ready: ${binding.guildName || binding.guildId} / #${binding.channelName || binding.channelId}`
      : `Bindings ready: ${bindings.length} channels configured in setup.`,
  );
  console.log(installResult.message);
  console.log(startResult.message);
  console.log("Setup complete. Use `openchord status` or `openchord service status` to inspect the running daemon.");

  return {
    binding,
    doctorResults,
    smokeResult,
    installResult,
    startResult,
    storedToken: tokenResolution.persisted,
  };
}
