# Troubleshooting

## The bot connects but does not reply

Check:

1. `openchord doctor`
2. the channel is bound and enabled
3. the bot has `Message Content Intent` enabled in the Discord Developer Portal
4. you sent a fresh message after the daemon started

In `mention` mode, the trigger must be:

- a direct mention
- or a reply to a previous bot message

## `doctor` says no bindings configured

Run:

```powershell
openchord setup
```

Or add one manually:

```powershell
openchord channels add --guild-id <guildId> --channel-id <channelId> --mode mention
```

## Codex auth fails

Supported path:

```powershell
codex login
```

OpenChord relies on the official Codex CLI auth used by `codex app-server`.

## App-server starts but turns fail

Check:

- `openchord doctor`
- `openchord smoke`
- `openchord session show <channelId>`

If a saved thread mapping is stale, reset it:

```powershell
openchord session reset <channelId>
```

If you recently changed the assistant name, authority IDs, or other conversation-facing identity settings, reset the affected channel session before retesting.

## Runtime still behaves like an older build

If you are running from a source checkout, rebuild before restarting:

```powershell
npm run build
node dist/cli.js doctor
```

Installed CLI users should reinstall or update the global package instead.

## Service is installed but not running

Check:

- `openchord service status`
- `openchord doctor`

If needed, refresh and restart the installed service:

```powershell
openchord service install
openchord service start
```

On Windows, `Ready` means the Scheduled Task is installed but not currently active. `Running` means the daemon is currently active. A healthy active run should also report `DaemonCount : 1`.

## `mcp.dis.gg` errors

Check:

- the configured Discord token env var is valid
- the service is reachable
- owner-mode headers are not being blocked upstream
- your configured privileged intents match the bot's approved intents

Run:

```powershell
openchord doctor
openchord smoke
```

## Session feels confused or stale

Reset the channel session:

```powershell
openchord session reset <channelId>
```

Then send a fresh message.

## Owner/Admin guidance is not taking effect

Check:

- `config.json` contains numeric Discord user IDs, not usernames or mentions
- the changed IDs are in the active `OPENCHORD_HOME`
- you reset the affected channel session after changing authority settings

The owner/admin settings guide sandboxed local behavior inside the runtime prompt. They do not replace Discord permissions or `mcp.dis.gg` enforcement.
