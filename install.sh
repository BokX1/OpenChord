#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node.js 22.16.0 or newer first." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install npm first." >&2
  exit 1
fi

if ! node -e "const [major, minor, patch] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && (minor > 16 || (minor === 16 && patch >= 0))) ? 0 : 1);" >/dev/null 2>&1; then
  echo "Node.js 22.16.0 or newer is required. Current version: $(node -p "process.versions.node")" >&2
  exit 1
fi

echo "==> Installing Codex CLI"
npm install --global @openai/codex@latest

echo "==> Installing OpenChord CLI"
npm install --global openchord@latest

echo
echo "OpenChord is installed."
echo "Next step: openchord setup"
