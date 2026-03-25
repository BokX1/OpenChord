# Security Model

OpenChord uses layered boundaries rather than one large trust assumption.

## Inbound Boundary

Inbound messages come from the Discord gateway only.

Current behavior:

- only enabled bound channels are processed
- bot/self-authored messages are ignored
- duplicate messages are ignored
- `mention` mode requires a direct mention or a reply to a prior bot message

## Codex Boundary

OpenChord talks to local `codex app-server`, but the bot does not receive broad native-host power.

Current restrictions:

- app-server runs inside a sandbox centered on an isolated workspace under `OPENCHORD_HOME`
- host tool profile defaults to `sandboxed-workspace-write`
- write access is confined to the isolated workspace
- read access includes the isolated workspace, Codex runtime paths needed to launch local tools, and Codex platform-default readable paths
- sandbox subprocess network access is enabled only while that sandbox is active
- approval prompts are disabled with `approvalPolicy: "never"`
- patch approvals are denied
- file-change approvals are declined
- permission escalation requests are denied
- user-input elicitations are declined

Allowed Codex-side native capabilities depend on the configured sandbox profile.

Current default posture:

- `view_image`
- sandboxed shell access with writes confined to the isolated workspace
- sandboxed file writes in the isolated workspace plus broader sandboxed read-only runtime access
- sandboxed network access while the sandbox is active

OpenChord does not provide unrestricted host access outside that sandbox.

## Discord Action Boundary

OpenChord has two outbound paths.

### 1. Native reply path

Used only for the normal "answer this user message" flow.

Properties:

- sends a native Discord reply to the triggering message
- sets `allowed_mentions.replied_user = false`
- stays narrow and fixed-purpose

### 2. `mcp.dis.gg` tool path

Used for:

- model-exposed Discord tools
- broader Discord reads and actions
- non-reply Discord sends

Properties:

- uses explicit request headers for scope and policy
- preserves current guild/channel/message/user context
- can restrict model actions to the bound guild
- delegates Discord-side authorization and safety policy to `mcp.dis.gg`
- supports an optional local `denyTools` block list for explicit operator overrides

This is intentionally a trust split:

- OpenChord constrains native host access to an isolated sandbox
- `mcp.dis.gg` constrains Discord actions

## Risk Controls

OpenChord keeps the default stance narrow:

- `targetGuildsMode` defaults to `bound-guild`
- current guild/channel/message/user context is attached to tool calls
- normal runtime replies suppress reply pings
- the bot cannot silently fall back to broad native-host access

## Red-Team Notes

The most important remaining trust surfaces are:

- the Discord bot token itself
- the permissions the bot has inside Discord
- the full `mcp.dis.gg` tool surface when `denyTools` is empty

Recommended operator posture:

- keep `targetGuildsMode` at `bound-guild`
- grant the bot only the Discord permissions you actually want it to use
- use `denyTools` if there are Discord actions you never want surfaced locally
- treat a leaked bot token as a full incident and rotate it immediately

## Credentials

OpenChord uses:

- the configured Discord token env var name (`BOT_TOKEN` by default)
- `OPENCHORD_HOME/runtime.env`
- Codex CLI auth under:
  - Windows: `%USERPROFILE%\.codex\auth.json`
  - macOS/Linux: `~/.codex/auth.json`

Best practices:

- do not commit runtime secrets
- rotate compromised bot tokens immediately
- use `denyTools` when you need to hide specific Discord tools from Codex locally
- treat the `Human`/admin role design in Discord separately from OpenChord's runtime controls
