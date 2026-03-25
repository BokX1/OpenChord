# Changelog

All notable changes to this project will be documented in this file.

## 0.1.1 - 2026-03-25

Patch release for sandboxed runtime reliability.

Highlights:

- fixed sandbox hostname resolution for shell-backed runtime tasks on Linux
- widened the sandbox read-only system paths needed for resolver and NSS lookups
- verified sandboxed `github.com` resolution end to end on the Ubuntu VM

## 0.1.0 - 2026-03-25

First public release of OpenChord.

Launch highlights:

- install-first CLI distribution as `openchord`
- guided onboarding through `openchord setup`
- cross-platform background service management
- persistent per-channel conversation threads
- Discord-native replies with progress updates and long-reply chunking
- configurable assistant name, model pinning, and optional owner/admin authority guidance
