# Operations

## First Run

OpenChord no longer uses repo-first onboarding as the public path.

Recommended first-run path:

```powershell
npm install --global @openai/codex openchord
openchord setup
```

Alternative installer entrypoints come from the repo-root scripts [install.ps1](../install.ps1) and [install.sh](../install.sh). Publish those files at your release URL if you want a hosted one-line install flow.

Notes:

- `setup` validates the configured Discord token env var before persisting it
- `setup` stores the token in `OPENCHORD_HOME/runtime.env`
- `setup` can capture optional owner/admin Discord user IDs for sandbox authority guidance
- `setup` installs and starts the background service
- `smoke --post` remains the fastest live end-to-end confirmation

## What Setup Asks For

`openchord setup` is the only supported first-run onboarding command for operators.

It prompts for:

1. the Discord bot token
2. the optional owner Discord user ID
3. the optional admin Discord user IDs
4. the visible guild to bind
5. the message-capable channel to bind
6. the reply mode
7. whether to add another channel immediately

After that it runs readiness checks and installs the background service.

If you do not know the owner/admin IDs yet, leave them blank. You can add or update them later in `config.json`.

## Day-To-Day Operation

Typical workflow:

1. Run `openchord status`.
2. Run `openchord doctor` if you suspect a problem.
3. Optionally run `openchord smoke`.
4. Inspect or restart the service with `openchord service ...` if needed.

For foreground debugging, use `openchord start`.

After updating the installed CLI package, refresh the service definition:

```powershell
openchord service install
openchord service start
```

## Live Behavior

When the daemon is running:

- inbound messages arrive through the Discord gateway
- OpenChord checks the channel binding
- in `mention` mode, it replies when:
  - the bot is directly mentioned
  - or the user replies to a previous bot message
- normal assistant output is posted as a native Discord reply to the triggering message
- tool-driven Discord actions go through `mcp.dis.gg`

## Restarting

Restart after:

- rotating the bot token
- changing gateway intent settings in the Discord Developer Portal
- changing Codex CLI authentication
- changing owner/admin authority IDs
- resetting a channel session after prompt or identity changes
- reinstalling or refreshing the service definition

## Service Notes

Service management is platform-specific:

- Linux uses a systemd user service
- macOS uses a LaunchAgent
- Windows uses a user-scoped Scheduled Task

On Windows:

- `Running` means the daemon is currently active
- `Ready` means the task is installed and can be launched, but is not currently running
- `DaemonCount` should be `1` during a healthy active run
- rerun `openchord service start` if you need to bring it back up immediately

## Local State

Default local state directory:

```text
Windows: %USERPROFILE%\.openchord
macOS/Linux: ~/.openchord
```

Files and directories:

- `config.json`
- `runtime.env`
- `state.db`
- `service/`
- `workspace/sandboxed-workspace-write`
