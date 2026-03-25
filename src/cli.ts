#!/usr/bin/env node
import { Command } from "commander";
import { CodexProvider } from "./provider/codex.js";
import { runDaemon } from "./daemon.js";
import { runDoctor } from "./operator/doctor.js";
import { runModelClear, runModelSet, runModelShow } from "./operator/model.js";
import { runNameClear, runNameSet, runNameShow } from "./operator/name.js";
import { runSmoke } from "./operator/smoke.js";
import { runSetup } from "./operator/setup.js";
import { ServiceManager } from "./service/manager.js";
import { loadConfig, removeBinding, upsertBinding } from "./store/config.js";
import { loadRuntimeEnvIntoProcess } from "./store/runtime-env.js";
import { StateDb } from "./store/state-db.js";
import { DisGgClient } from "./transport/disgg/client.js";
import type { ChannelBinding, ReplyMode } from "./types.js";

loadRuntimeEnvIntoProcess();

function requireDiscordToken(): { config: ReturnType<typeof loadConfig>; token: string } {
  const config = loadConfig();
  const token = process.env[config.transport.botTokenEnvVar];
  if (!token) {
    throw new Error(
      `Missing Discord bot token in environment variable ${config.transport.botTokenEnvVar}.`,
    );
  }
  return { config, token };
}

function printBindings(bindings: ChannelBinding[]): void {
  if (!bindings.length) {
    console.log("No bindings configured.");
    return;
  }
  for (const binding of bindings) {
    console.log(
      [
        binding.enabled ? "enabled" : "disabled",
        binding.mode,
        binding.guildName || binding.guildId,
        binding.channelName ? `#${binding.channelName}` : binding.channelId,
        `guild=${binding.guildId}`,
        `channel=${binding.channelId}`,
      ].join(" | "),
    );
  }
}

const program = new Command();
program
  .name("openchord")
  .description("OpenChord is a lightweight Discord bridge powered by the Discord gateway, Codex app-server, and mcp.dis.gg.")
  .version("0.1.0");

const channels = program.command("channels").description("Manage bound Discord channels.");

channels
  .command("add")
  .description("Add or update a bound Discord channel.")
  .requiredOption("--mode <mode>", "reply mode: mention or always", "mention")
  .option("--guild-id <id>", "guild ID")
  .option("--guild-name <name>", "guild name")
  .option("--channel-id <id>", "channel ID")
  .option("--channel-name <name>", "channel name")
  .option("--disabled", "store the binding disabled")
  .action(
    async (options: {
      mode: ReplyMode;
      guildId?: string;
      guildName?: string;
      channelId?: string;
      channelName?: string;
      disabled?: boolean;
    }) => {
      if (!["mention", "always"].includes(options.mode)) {
        throw new Error("Mode must be either mention or always.");
      }
      const { config, token } = requireDiscordToken();
      const client = new DisGgClient({ config, token });
      const resolved = await client.resolveBinding({
        guildId: options.guildId,
        guildName: options.guildName,
        channelId: options.channelId,
        channelName: options.channelName,
      });
      const binding: ChannelBinding = {
        ...resolved,
        mode: options.mode,
        enabled: !options.disabled,
      };
      upsertBinding(binding);
      console.log(
        `Saved binding for ${binding.guildName || binding.guildId} / #${binding.channelName || binding.channelId}.`,
      );
    },
  );

channels
  .command("remove")
  .description("Remove a bound Discord channel by channel ID.")
  .argument("<channelId>", "channel ID")
  .action((channelId: string) => {
    removeBinding(channelId);
    console.log(`Removed binding for channel ${channelId}.`);
  });

channels
  .command("list")
  .description("List all configured channel bindings.")
  .action(() => {
    const config = loadConfig();
    printBindings(config.bindings);
  });

const daemon = program.command("daemon").description("Run the bridge daemon.");

daemon
  .command("start")
  .description("Connect to the Discord gateway and listen for bound channel messages.")
  .action(async () => {
    await runDaemon();
  });

program
  .command("setup")
  .description("One-shot first-run setup for OpenChord.")
  .action(async () => {
    await runSetup();
  });

program
  .command("doctor")
  .description("Run focused readiness checks for OpenChord.")
  .option("--json", "print machine-readable JSON output")
  .action(async (options: { json?: boolean }) => {
    await runDoctor({ json: Boolean(options.json) });
  });

program
  .command("smoke")
  .description("Run a live OpenChord smoke probe against a bound channel.")
  .option("--channel-id <id>", "target a specific bound channel ID")
  .option("--post", "post the provider-confirmed smoke reply back into Discord")
  .action(async (options: { channelId?: string; post?: boolean }) => {
    await runSmoke({ channelId: options.channelId, post: Boolean(options.post) });
  });

program
  .command("start")
  .description("Start the foreground daemon.")
  .action(async () => {
    await runDaemon();
  });

program
  .command("status")
  .description("Show provider state, configured bindings, and active sessions.")
  .action(async () => {
    const config = loadConfig();
    const db = new StateDb();
    const provider = new CodexProvider();
    try {
      const binaryProbe = CodexProvider.verifyCodexBinary(config.provider.codexCommand);
      console.log(`Codex binary: ${binaryProbe.ok ? "ready" : `missing (${binaryProbe.message})`}`);
      if (binaryProbe.ok) {
        try {
          const probe = await provider.probe(config);
          console.log(`Codex app-server: ready (${probe.authStatus.authMethod ?? "unauthenticated"})`);
        } catch (error) {
          console.log(`Codex app-server: unavailable (${error instanceof Error ? error.message : String(error)})`);
        }
      }
      console.log(`Bindings: ${config.bindings.length}`);
      console.log(`Mapped threads: ${db.listSessions().length}`);
      if (config.bindings.length) {
        printBindings(config.bindings);
      }
    } finally {
      await provider.close();
      db.close();
    }
  });

const model = program.command("model").description("Show or update the pinned Codex model configuration.");

model
  .command("show")
  .description("Show the current model and reasoning configuration.")
  .action(() => {
    runModelShow();
  });

model
  .command("set")
  .description("Pin a supported model and/or reasoning effort.")
  .option("--model <model>", "supported model id")
  .option("--reasoning <reasoning>", "supported reasoning effort: low, medium, high, xhigh")
  .action((options: { model?: string; reasoning?: string }) => {
    runModelSet(options);
  });

model
  .command("clear")
  .description("Clear pinned model settings and defer to Codex defaults.")
  .action(() => {
    runModelClear();
  });

const name = program.command("name").description("Show or update the assistant name used in conversations.");

name
  .command("show")
  .description("Show the current assistant name.")
  .action(() => {
    runNameShow();
  });

name
  .command("set")
  .description("Set the assistant name used for new channel sessions.")
  .requiredOption("--name <name>", "assistant name shown in the bot persona")
  .action((options: { name: string }) => {
    runNameSet(options);
  });

name
  .command("clear")
  .description("Reset the assistant name back to OpenChord.")
  .action(() => {
    runNameClear();
  });

const service = program.command("service").description("Manage the installed background service.");

service
  .command("install")
  .description("Install or refresh the background service definition.")
  .action(() => {
    const result = new ServiceManager().install(loadConfig());
    console.log(result.message);
  });

service
  .command("start")
  .description("Start the background service.")
  .action(() => {
    const result = new ServiceManager().start();
    console.log(result.message);
  });

service
  .command("stop")
  .description("Stop the background service.")
  .action(() => {
    const result = new ServiceManager().stop();
    console.log(result.message);
  });

service
  .command("status")
  .description("Show the background service status.")
  .action(() => {
    const result = new ServiceManager().status();
    console.log(result.message);
  });

service
  .command("uninstall")
  .description("Remove the background service definition.")
  .action(() => {
    const result = new ServiceManager().uninstall();
    console.log(result.message);
  });

const sessions = program.command("session").description("Inspect or reset persisted channel sessions.");

sessions
  .command("list")
  .description("List all channel sessions.")
  .action(() => {
    const db = new StateDb();
    try {
      const rows = db.listSessions();
      if (!rows.length) {
        console.log("No sessions found.");
        return;
      }
      for (const session of rows) {
        console.log(
          `${session.guildId}/${session.channelId} | ${session.model} | thread=${session.threadId} | lastSeen=${session.lastSeenMessageId ?? "-"} | updated=${new Date(session.updatedAt).toISOString()}`,
        );
      }
    } finally {
      db.close();
    }
  });

sessions
  .command("show")
  .description("Show a channel session by channel ID.")
  .argument("<channelId>", "channel ID")
  .action(async (channelId: string) => {
    const db = new StateDb();
    const config = loadConfig();
    const provider = new CodexProvider();
    try {
      const session = db.listSessions().find((entry) => entry.channelId === channelId);
      if (!session) {
        throw new Error(`No session found for channel ${channelId}.`);
      }
      console.log(JSON.stringify(session, null, 2));
      try {
        const thread = await provider.readThread(config, session.threadId);
        console.log(JSON.stringify(thread, null, 2));
      } catch (error) {
        console.log(
          JSON.stringify(
            {
              threadReadError: error instanceof Error ? error.message : String(error),
            },
            null,
            2,
          ),
        );
      }
    } finally {
      await provider.close();
      db.close();
    }
  });

sessions
  .command("reset")
  .description("Reset a channel session by channel ID.")
  .argument("<channelId>", "channel ID")
  .action((channelId: string) => {
    const db = new StateDb();
    try {
      const session = db.listSessions().find((entry) => entry.channelId === channelId);
      if (!session) {
        throw new Error(`No session found for channel ${channelId}.`);
      }
      db.deleteSession({ guildId: session.guildId, channelId: session.channelId });
      console.log(`Reset session for ${session.guildId}/${session.channelId}.`);
    } finally {
      db.close();
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
