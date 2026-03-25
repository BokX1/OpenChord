# Development

## Local Setup

```powershell
npm install
npm run build
codex login
node dist/cli.js doctor
```

Use a repo-local `.env` only if you want a convenient source-checkout token during development. The installed product path uses `OPENCHORD_HOME/runtime.env`, not `.env`.

## Verification

```powershell
npm test
npm run build
npm run check
```

## Manual Runtime Testing

```powershell
node dist/cli.js setup
node dist/cli.js smoke
node dist/cli.js daemon start
```

Then send either:

- a fresh mention in a bound Discord channel
- or a reply to a previous bot message in that channel

## Development Principles

- keep the runtime single-process
- avoid framework-heavy orchestration
- keep general Discord mutation behind `mcp.dis.gg`
- keep the native Discord path narrow and limited to normal replies
- keep the bot inside the isolated Codex sandbox profile
- prefer focused module tests over broad brittle integration scaffolding
- keep docs accurate to the actual runtime, not an aspirational architecture
- keep generated output out of design decisions; always reason from `src/`, not stale `dist/`
