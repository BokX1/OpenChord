# Configuration

OpenChord reads local configuration from:

```text
Windows: %USERPROFILE%\.openchord\config.json
macOS/Linux: ~/.openchord/config.json
```

Override the storage root with:

```powershell
$env:OPENCHORD_HOME = "C:\\path\\to\\openchord-home"
```

## Environment Variables

- `BOT_TOKEN`
  Default Discord bot token env var used for:
  - Discord gateway login
  - native Discord reply sends
  - `mcp.dis.gg` requests
- `OPENCHORD_HOME`
  Optional override for config, runtime env, state, and isolated workspace storage.

`transport.botTokenEnvVar` can rename the token variable if you do not want to use `BOT_TOKEN`.

Installed runtime secrets live in:

```text
Windows: %USERPROFILE%\.openchord\runtime.env
macOS/Linux: ~/.openchord/runtime.env
```

## Config Shape

```json
{
  "version": 2,
  "identity": {
    "assistantName": "OpenChord"
  },
  "authority": {
    "ownerUserId": "",
    "adminUserIds": []
  },
  "transport": {
    "serverUrl": "https://mcp.dis.gg/v1",
    "botTokenEnvVar": "BOT_TOKEN",
    "ownerAccess": true,
    "privilegedIntents": ["message_content", "server_members"],
    "fetchLimit": 25,
    "requestTimeoutMs": 15000,
    "userAgent": "openchord/0.1.0"
  },
  "provider": {
    "backend": "codex-app-server",
    "codexCommand": "codex",
    "hostToolProfile": "sandboxed-workspace-write",
    "isolatedCwd": "C:\\Users\\you\\.openchord\\workspace\\sandboxed-workspace-write",
    "model": ""
  },
  "safety": {
    "denyTools": [],
    "targetGuildsMode": "bound-guild"
  },
  "bindings": []
}
```

## Local Files

- `config.json`
  Operator-managed runtime config and channel bindings.
- `runtime.env`
  Product-owned runtime secrets keyed by `transport.botTokenEnvVar`.
- `state.db`
  SQLite database for channel-to-thread mappings and processed Discord message IDs.
- `service/`
  Generated service wrappers or service-side helper files.
- `workspace/sandboxed-workspace-write`
  Isolated workspace used for `codex app-server`.

OpenChord does not maintain its own OAuth store. Authentication comes from the official Codex CLI login:

```text
Windows: %USERPROFILE%\.codex\auth.json
macOS/Linux: ~/.codex/auth.json
```

## Binding Semantics

Each enabled binding represents one long-lived Codex thread for one Discord channel.

`identity.assistantName` controls how the bot refers to itself in new channel sessions. It does not rename the product, CLI, or service identifiers.

`authority.ownerUserId` and `authority.adminUserIds` let OpenChord label the current caller as `owner`, `admin`, or `user` in each turn. This only guides sandboxed local-behavior policy inside the model prompt; it does not replace Discord permissions or `mcp.dis.gg` enforcement.

OpenChord expects `config.json` to already match the current version 2 shape.

`provider.hostToolProfile` controls the local Codex sandbox posture:

- `sandboxed-workspace-write`
  Allows sandboxed shell, workspace-confined writes, sandboxed network access, and read-only access to the isolated workspace plus required Codex/runtime paths and platform-default readable paths.
- `strict-read-only`
  Restricts Codex to read-only sandboxed access, with readable roots centered on the isolated workspace plus required Codex/runtime paths and platform-default readable paths.

Model selection:

- leave `provider.model` empty to let Codex choose its current default model
- set `provider.model` to one of the supported pinned values:
  `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.2`, `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`
- `provider.reasoning` is optional and supports `low`, `medium`, `high`, or `xhigh`

Runtime token precedence:

- process environment
- `OPENCHORD_HOME/runtime.env`
- missing token error

If you change `transport.botTokenEnvVar`, update both:

- the process environment for foreground runs
- the key stored in `OPENCHORD_HOME/runtime.env`
