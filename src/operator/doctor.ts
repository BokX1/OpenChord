import { CodexProvider } from "../provider/codex.js";
import { loadConfig } from "../store/config.js";
import { StateDb } from "../store/state-db.js";
import { DisGgClient } from "../transport/disgg/client.js";
import type { BridgeConfig, ChannelBinding } from "../types.js";

export type CheckStatus = "pass" | "warn" | "fail";

export type CheckResult = {
  id: string;
  title: string;
  status: CheckStatus;
  message: string;
};

type DoctorDependencies = {
  config: BridgeConfig;
  botToken?: string;
  provider: Pick<CodexProvider, "probe" | "close">;
  client?: Pick<DisGgClient, "getAccessContext" | "fetchMessages">;
  db: Pick<StateDb, "listSessions" | "close">;
};

function makeResult(id: string, title: string, status: CheckStatus, message: string): CheckResult {
  return { id, title, status, message };
}

export function buildDoctorNextAction(results: CheckResult[], envVar = "BOT_TOKEN"): string {
  const blocking = results.find((result) => result.status === "fail");
  if (blocking) {
    switch (blocking.id) {
      case "env.bot_token":
        return `Run \`openchord setup\` to store ${envVar}, then rerun \`openchord doctor\`.`;
      case "codex.binary":
        return "Install Codex CLI or point `provider.codexCommand` at a valid binary.";
      case "codex.auth":
      case "app_server.initialize":
        return "Run `codex login`, then rerun `openchord doctor`.";
      case "transport.access":
        return "Confirm the bot token can reach mcp.dis.gg and the service is online.";
      case "bindings.readability":
        return "Fix or replace the unreadable channel bindings before starting the daemon.";
      default:
        return `Resolve ${blocking.title.toLowerCase()} and rerun \`openchord doctor\`.`;
    }
  }

  const warning = results.find((result) => result.status === "warn");
  if (warning) {
    if (warning.id === "bindings.configured") {
      return "Add a binding with `openchord channels add` or run `openchord setup`.";
    }
    return `Review ${warning.title.toLowerCase()} before starting the daemon.`;
  }

  return "No immediate action needed. OpenChord looks ready.";
}

export async function runDoctorChecks(deps: DoctorDependencies): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const envVar = deps.config.transport.botTokenEnvVar;

  results.push(makeResult("config.parse", "Config file", "pass", "Config parsed successfully."));

  const binaryProbe = CodexProvider.verifyCodexBinary(deps.config.provider.codexCommand);
  results.push(
    makeResult(
      "codex.binary",
      "Codex binary",
      binaryProbe.ok ? "pass" : "fail",
      binaryProbe.message,
    ),
  );

  if (!deps.botToken) {
    results.push(makeResult("env.bot_token", "Discord bot token", "fail", `${envVar} is missing.`));
    results.push(makeResult("gateway.prerequisites", "Discord gateway prerequisites", "warn", `Skipped because ${envVar} is missing.`));
    results.push(makeResult("codex.auth", "Codex login", binaryProbe.ok ? "warn" : "fail", binaryProbe.ok ? `Skipped because ${envVar} is missing.` : "Skipped because Codex is unavailable."));
    results.push(makeResult("app_server.initialize", "Codex app-server", "warn", `Skipped because ${envVar} is missing.`));
    results.push(makeResult("transport.access", "mcp.dis.gg access", "warn", `Skipped because ${envVar} is missing.`));
    results.push(makeResult("bindings.configured", "Channel bindings", deps.config.bindings.length ? "pass" : "warn", deps.config.bindings.length ? `${deps.config.bindings.length} binding(s) configured.` : "No bindings configured."));
    return results;
  }

  results.push(makeResult("env.bot_token", "Discord bot token", "pass", `${envVar} is present.`));
  results.push(makeResult("gateway.prerequisites", "Discord gateway prerequisites", "pass", "Gateway runtime prerequisites are satisfied."));

  if (!binaryProbe.ok) {
    results.push(makeResult("codex.auth", "Codex login", "fail", "Skipped because the Codex binary is unavailable."));
    results.push(makeResult("app_server.initialize", "Codex app-server", "fail", "Skipped because the Codex binary is unavailable."));
  } else {
    try {
      const probe = await deps.provider.probe(deps.config);
      const authReady = Boolean(probe.authStatus.authMethod);
      results.push(
        makeResult(
          "codex.auth",
          "Codex login",
          authReady ? "pass" : "fail",
          authReady
            ? `Authenticated via ${probe.authStatus.authMethod}.`
            : "Codex app-server reported no active login. Run `codex login` first.",
        ),
      );
      results.push(
        makeResult(
          "app_server.initialize",
          "Codex app-server",
          "pass",
          `Initialized successfully and reported ${probe.modelCount} model(s).`,
        ),
      );
    } catch (error) {
      results.push(
        makeResult(
          "codex.auth",
          "Codex login",
          "fail",
          error instanceof Error ? error.message : String(error),
        ),
      );
      results.push(
        makeResult(
          "app_server.initialize",
          "Codex app-server",
          "fail",
          error instanceof Error ? error.message : String(error),
        ),
      );
    } finally {
      await deps.provider.close();
    }
  }

  if (!deps.client) {
    results.push(makeResult("transport.access", "mcp.dis.gg access", "fail", "Discord transport client is unavailable."));
  } else {
    try {
      const access = await deps.client.getAccessContext();
      results.push(makeResult("transport.access", "mcp.dis.gg access", "pass", `Connected as app ${access.app_id}.`));
    } catch (error) {
      results.push(
        makeResult(
          "transport.access",
          "mcp.dis.gg access",
          "fail",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }

  results.push(makeResult("sqlite.state", "State database", "pass", `${deps.db.listSessions().length} session(s) indexed.`));

  const enabledBindings = deps.config.bindings.filter((binding) => binding.enabled);
  if (!enabledBindings.length) {
    results.push(makeResult("bindings.configured", "Channel bindings", "warn", "No enabled bindings configured."));
    return results;
  }

  const unreadable: string[] = [];
  if (deps.client) {
    for (const binding of enabledBindings) {
      try {
        await deps.client.fetchMessages(binding, null, 1);
      } catch {
        unreadable.push(`${binding.guildId}/${binding.channelId}`);
      }
    }
  }

  results.push(
    unreadable.length
      ? makeResult("bindings.readability", "Binding readability", "fail", `Unreadable bindings: ${unreadable.join(", ")}`)
      : makeResult("bindings.readability", "Binding readability", "pass", `${enabledBindings.length} enabled binding(s) readable.`),
  );

  return results;
}

export async function runDoctor(params?: { json?: boolean }): Promise<CheckResult[]> {
  const config = loadConfig();
  const botToken = process.env[config.transport.botTokenEnvVar];
  const db = new StateDb();
  const provider = new CodexProvider();
  try {
    const client = botToken ? new DisGgClient({ config, token: botToken }) : undefined;
    const results = await runDoctorChecks({
      config,
      botToken,
      provider,
      client,
      db,
    });
    if (params?.json) {
      console.log(JSON.stringify({ results, nextAction: buildDoctorNextAction(results, config.transport.botTokenEnvVar) }, null, 2));
    } else {
      for (const result of results) {
        console.log(`[${result.status.toUpperCase()}] ${result.title}: ${result.message}`);
      }
      console.log(buildDoctorNextAction(results, config.transport.botTokenEnvVar));
    }
    return results;
  } finally {
    await provider.close();
    db.close();
  }
}
