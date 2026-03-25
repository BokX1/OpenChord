# OpenChord
Bring Agent Runtimes to Discord

Your Runtime. Your Tools. Your Data.

OpenChord currently supports Codex through `codex app-server`. Claude Code support is planned next, with broader runtime support over time.

## Why OpenChord

OpenChord solves the runtime problem behind Discord agents.

Without OpenChord, getting a serious runtime into Discord usually means building your own bridge, session flow, and backend wiring. OpenChord gives you that layer out of the box.

## What You Get

Once a runtime is connected through OpenChord, it can deliver the kind of agent experience people expect from their favorite agentic platforms, directly in Discord.

- persistent per-channel context instead of starting from scratch every message
- native Discord replies with live progress, typing indicators, and long-form output
- sandboxed local shell, file, and network capabilities with workspace-confined writes
- broader Discord-side actions through `mcp.dis.gg`
- operator controls such as assistant naming, model pinning, and optional owner/admin authority guidance

`mcp.dis.gg` is the Discord power-tool layer behind OpenChord. Its public documentation describes it as a safe MCP service for Discord that provides a stable tool surface and supports explicit request-time restrictions before a request reaches Discord. See [Dis.gg MCP](https://mcp.dis.gg/) and the [Dis.gg MCP docs](https://mcp.dis.gg/docs/).

## What OpenChord Does Not Do

OpenChord is intentionally not an unrestricted host agent or a replacement for Discord-side policy.

- it does not provide unrestricted host access outside the configured sandbox
- it does not replace Discord permissions, server roles, or `mcp.dis.gg` policy enforcement
- it does not replace your own trust model or operator judgment
- it does not require a source checkout or repo-local `.env` file for normal installed use

## Install

Recommended install:

```powershell
npm install --global @openai/codex openchord
openchord setup
```

Normal installed use does not require a repo-local `.env` file. OpenChord stores runtime secrets in `OPENCHORD_HOME/runtime.env`.

Other paths:

- hosted installer:
  After you host [install.ps1](./install.ps1) and [install.sh](./install.sh) at real release URLs, users can invoke those hosted scripts directly.
- contributor/source checkout:
  Use [Development](./docs/development.md), not this install flow.

## Setup

`openchord setup` will:

- verify Codex CLI
- run `codex login` if needed
- collect and validate the configured Discord token env var
- store the token in `OPENCHORD_HOME/runtime.env`
- guide channel binding selection
- run `doctor`
- run `smoke`
- install and start the background service

`setup` asks for:

- a Discord bot token
- the optional owner Discord user ID
- the optional admin Discord user IDs
- the target guild
- the target channel
- the reply mode (`mention` or `always`)
- optionally, additional channels in the same setup run

If you already know the Discord user IDs you want to trust for sandboxed local-behavior guidance, provide them during setup. Otherwise, leave them blank and add them later in `config.json`.

## Day-to-Day

```powershell
openchord status
openchord doctor
openchord smoke
openchord service status
```

Useful follow-up commands:

- `openchord name set --name "Your Bot Name"`
- `openchord model set --model gpt-5.4 --reasoning medium`
- `openchord session reset <channelId>`

After updating the global package, refresh the service definition:

```powershell
openchord service install
openchord service start
```

For foreground debugging:

```powershell
openchord start
```

In a bound channel:

- mention the bot once to start
- after that, users can continue by replying to the bot's message

## Common Commands

```powershell
openchord setup
openchord start
openchord doctor
openchord smoke
openchord status
openchord name show
openchord model show
openchord channels list
openchord session list
openchord service status
```

See the full [CLI Reference](./docs/cli.md) for the complete command surface.

## Local Storage

Default storage root:

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

The assistant name defaults to `OpenChord`, but you can change it for new threads with:

```powershell
openchord name set --name "Your Bot Name"
```

Model pinning is optional. Leave it on auto or pin it explicitly:

```powershell
openchord model set --model gpt-5.4 --reasoning medium
```

OpenChord relies on the official Codex CLI login:

```text
Windows: %USERPROFILE%\.codex\auth.json
macOS/Linux: ~/.codex/auth.json
```

## Development

Source checkout is for contributors, not normal onboarding.

See [Development](./docs/development.md) for clone/build/test workflows.

## Documentation

- [Docs Index](./docs/README.md)

User docs:

- [Configuration](./docs/configuration.md)
- [CLI Reference](./docs/cli.md)
- [Operations](./docs/operations.md)
- [Troubleshooting](./docs/troubleshooting.md)

Maintainer docs:

- [Architecture](./docs/architecture.md)
- [Security Model](./docs/security.md)
- [Release](./docs/release.md)
- [Development](./docs/development.md)
- [Contributing](./CONTRIBUTING.md)

Project docs:

- [Changelog](./CHANGELOG.md)
- [License](./LICENSE)
