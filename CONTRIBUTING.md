# Contributing

## Development Setup

```powershell
npm install
npm run build
codex login
node dist/cli.js doctor
```

`.env` is optional for source-checkout convenience only. Normal installed OpenChord uses `OPENCHORD_HOME/runtime.env` instead.

## Common Commands

```powershell
npm test
npm run build
npm run check
node dist/cli.js doctor
node dist/cli.js smoke
node dist/cli.js daemon start
```

## Contribution Guidelines

- Keep OpenChord single-process and local-first.
- Prefer small, explicit modules over framework-heavy abstractions.
- Keep general Discord actions behind `mcp.dis.gg`.
- Keep the direct Discord REST path narrow and limited to native reply threading unless there is a strong reason to expand it.
- Do not reintroduce polling as the main inbound runtime.
- Do not expose broad host access outside the isolated Codex sandbox to the Discord bot.
- Do not expand native host capabilities just because `mcp.dis.gg` is broad; Discord trust and host trust are separate concerns.
- Keep `dist/` generated and disposable. Rebuild instead of hand-editing compiled output.
- Update docs whenever runtime behavior, setup, architecture, CLI, or security posture changes.

## Documentation

- Docs index: [`docs/README.md`](./docs/README.md)
- Architecture: [`docs/architecture.md`](./docs/architecture.md)
- Configuration: [`docs/configuration.md`](./docs/configuration.md)
- CLI reference: [`docs/cli.md`](./docs/cli.md)
- Operations: [`docs/operations.md`](./docs/operations.md)
- Release: [`docs/release.md`](./docs/release.md)
- Security: [`docs/security.md`](./docs/security.md)
- Troubleshooting: [`docs/troubleshooting.md`](./docs/troubleshooting.md)
- Development: [`docs/development.md`](./docs/development.md)
