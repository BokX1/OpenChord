$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required. Install Node.js 22.16.0 or newer first."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is required. Install npm first."
}

$nodeVersion = [version](node -p "process.versions.node")
if ($nodeVersion -lt [version]"22.16.0") {
  throw "Node.js 22.16.0 or newer is required. Current version: $nodeVersion"
}

Write-Host "==> Installing Codex CLI" -ForegroundColor Cyan
npm install --global @openai/codex@latest
if ($LASTEXITCODE -ne 0) {
  throw "Failed to install @openai/codex."
}

Write-Host "==> Installing OpenChord CLI" -ForegroundColor Cyan
npm install --global openchord@latest
if ($LASTEXITCODE -ne 0) {
  throw "Failed to install openchord."
}

Write-Host ""
Write-Host "OpenChord is installed."
Write-Host "Next step: openchord setup"
