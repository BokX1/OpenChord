# CLI Reference

OpenChord ships one public CLI entrypoint:

```powershell
openchord <command>
```

## Guided Setup

### `setup`

Interactive one-shot onboarding and service install.

```powershell
openchord setup
```

What it does:

- verifies Codex CLI availability
- runs `codex login` when required
- validates the configured Discord token env var
- stores the token in `OPENCHORD_HOME/runtime.env`
- optionally captures owner/admin Discord user IDs for sandbox authority guidance
- lists visible guilds and channels
- saves or refreshes the active binding
- runs `doctor` and `smoke`
- installs and starts the background service

This is the only supported first-run operator onboarding command.

Setup is safe to rerun. It refreshes stored onboarding state rather than creating a second install.

## Diagnostics

### `doctor`

Runs focused readiness checks.

```powershell
openchord doctor
openchord doctor --json
```

### `smoke`

Runs a live probe against a bound channel.

```powershell
openchord smoke
openchord smoke --channel-id <channelId>
openchord smoke --post
```

Use `--post` only when you want the smoke confirmation posted back into Discord.

## Runtime

### `daemon start`

Starts the long-running runtime directly.

```powershell
openchord daemon start
```

This is an advanced/runtime command, not the recommended first-run path.

### `start`

Starts the foreground daemon directly.

```powershell
openchord start
```

This is the easiest way to debug a live runtime without going through the installed background service.

### `status`

Shows a compact runtime summary.

```powershell
openchord status
```

## Model

### `model show`

Shows the current pinned model settings. If both values are `auto`, OpenChord defers to Codex defaults.

```powershell
openchord model show
```

### `model set`

Pins a supported model and/or reasoning effort.

```powershell
openchord model set --model gpt-5.3-codex --reasoning high
```

### `model clear`

Clears pinned values and lets Codex choose the default model/runtime settings.

```powershell
openchord model clear
```

## Assistant Name

### `name show`

Shows the current assistant name used in new conversation threads.

```powershell
openchord name show
```

### `name set`

Sets the assistant name used in new conversation threads.

```powershell
openchord name set --name "HelperBot"
```

Reset channel sessions if you want existing threads to pick up the new name immediately.

### `name clear`

Resets the assistant name back to `OpenChord`.

```powershell
openchord name clear
```

## Service

### `service install`

Installs or refreshes the service definition after setup or after upgrading the package.

```powershell
openchord service install
```

### `service start`

```powershell
openchord service start
```

### `service stop`

```powershell
openchord service stop
```

### `service status`

Shows the installed service state for the current platform. On Windows, it also reports the managed daemon count and daemon PIDs when active.

```powershell
openchord service status
```

If the service is installed but inactive, run `openchord service start`.

### `service uninstall`

```powershell
openchord service uninstall
```

## Channel Bindings

### `channels list`

```powershell
openchord channels list
```

### `channels add`

```powershell
openchord channels add --guild-id <guildId> --channel-id <channelId> --mode mention
```

### `channels remove`

```powershell
openchord channels remove <channelId>
```

## Session Inspection

### `session list`

```powershell
openchord session list
```

### `session show`

```powershell
openchord session show <channelId>
```

### `session reset`

```powershell
openchord session reset <channelId>
```
