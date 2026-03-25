# Release

This document is for maintainers publishing the install-first OpenChord CLI.

## Release Shape

OpenChord is published as:

- npm package: `openchord`
- binary name: `openchord`
- installer scripts: repo-root [install.ps1](../install.ps1) and [install.sh](../install.sh)

The public product flow is:

1. install `@openai/codex`
2. install `openchord`
3. run `openchord setup`

## Pre-Release Checks

Run:

```powershell
npm test
npm run build
npm pack
```

Confirm:

- the tarball contains `dist/`
- the tarball contains `README.md`, `docs/`, `install.ps1`, and `install.sh`
- the package name is `openchord`
- the `openchord` bin points to `dist/cli.js`

## Publish

Publish the package from the packed or working tree:

```powershell
npm publish
```

If you publish from a tarball:

```powershell
npm publish .\openchord-0.1.0.tgz
```

## Installer Hosting

If you want one-line install entrypoints, host these exact repo-root files unchanged:

- `install.ps1`
- `install.sh`

They should install:

- `@openai/codex`
- `openchord`

Then print:

- `openchord setup`

## Post-Publish Verification

On a clean machine or VM:

1. install from npm or the hosted installer
2. run `openchord --help`
3. run `openchord setup`
4. run `openchord doctor`
5. run `openchord smoke`
6. run `openchord service status`

The release is not complete until the install-first path works without a source checkout.
