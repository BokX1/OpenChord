# Architecture

OpenChord is a single-process local daemon with four main boundaries:

- Discord gateway for inbound events
- Codex app-server for reasoning and thread continuity
- native Discord replies for the normal response path
- `mcp.dis.gg` for Discord tools and backend-enforced safety controls

The design goal is to keep the assistant feeling coherent while keeping the runtime small:

- one inbound transport
- one reasoning backend
- one Discord tool bridge
- one persistence layer

## Request Flow

```text
Discord messageCreate event
-> gateway handler
-> channel binding lookup
-> mention/reply gating
-> channel session lookup in SQLite
-> Codex app-server turn on the mapped thread
-> final assistant text extracted from turn events
-> native Discord reply to the triggering message
```

If Codex calls an approved Discord tool:

```text
Codex dynamic tool call
-> OpenChord tool dispatcher
-> mcp.dis.gg tool execution
-> tool result returned to Codex
```

## Core Modules

- `src/transport/discord`
  Discord gateway client and inbound event normalization.
- `src/runtime`
  Per-message orchestration, tool-context building, and final reply posting.
- `src/router`
  Reply gating and Discord-to-Codex input shaping.
- `src/provider`
  Local `codex app-server` adapter, JSON-RPC transport, thread lifecycle, and approval denial.
- `src/transport/disgg`
  Tool discovery, tool execution, Discord sends outside the native reply path, and request scoping.
- `src/store`
  JSON config plus SQLite persistence for channel-to-thread mappings and processed messages.

## Session Model

OpenChord keeps one persisted Codex thread per enabled bound channel.

- first message in a channel creates a Codex thread
- later messages reuse that thread
- session state survives daemon restarts through SQLite
- if a stored thread becomes invalid, OpenChord recreates it and continues

## Assistant Identity

OpenChord is the product layer around the connected runtime, while the visible assistant persona in Discord can be customized per deployment.

- users should experience a coherent assistant persona in Discord
- the assistant name defaults to `OpenChord`, but operators can change it for new sessions
- Codex app-server is the current backend reasoning runtime
- backend/runtime details should only surface when a user explicitly asks how the bot works

## Build Artifacts

`dist/` is generated output, not source code.

- source of truth lives under `src/`
- build output is recreated with `npm run build`
- stale compiled output should not be kept around across architectural changes

## Why Native Replies Exist

OpenChord uses Discord's native reply API for the final visible answer because `mcp.dis.gg` does not currently expose reply targeting on `send_message`.

That exception is intentionally narrow:

- OpenChord does not use direct Discord writes for general server actions
- broader Discord actions still flow through `mcp.dis.gg`
- the direct reply path always suppresses reply pings

## Why `mcp.dis.gg` Still Matters

`mcp.dis.gg` remains the Discord safety and action layer.

- tool calls are scoped with current guild/channel/message/user headers
- owner-mode and privileged headers are explicit
- OpenChord exposes the discovered `mcp.dis.gg` tool surface by default
- Discord-side authorization and risk checks are enforced by `mcp.dis.gg`
- OpenChord only keeps a local deny list for explicit operator overrides
