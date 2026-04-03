#!/usr/bin/env bash
# setup-codex-from-backup.sh — Install Codex CLI + copilot-api-responses on a fresh VM
#
# Run this AFTER restoring a NanoClaw checkpoint (which puts config files in data/codex/).
# It installs the binaries and places the config files where they belong.
#
# Usage:
#   ./scripts/setup-codex-from-backup.sh
#
# What it does:
#   1. Installs @openai/codex globally (the Codex CLI)
#   2. Installs @jeffreycao/copilot-api to /opt/copilot-api-responses (Responses API fork)
#   3. Creates /usr/local/bin/copilot-api-responses symlink
#   4. Restores ~/.codex/config.toml, ~/start-codex.sh, and copilot-api github token
#      from the backup in data/codex/
#
# Prerequisites: Node.js >= 20, npm, sudo access

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CODEX_DATA="${PROJECT_DIR}/data/codex"

echo "=== Codex + copilot-api-responses Setup ==="
echo ""

# ── Check prerequisites ──────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "✗ Node.js not found. Install Node.js >= 20 first."
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "✗ Node.js $(node -v) is too old. Need >= 20."
  exit 1
fi
echo "✓ Node.js $(node -v)"

# ── Install Codex CLI ────────────────────────────────────────────
if command -v codex &>/dev/null; then
  echo "✓ codex already installed ($(codex --version 2>/dev/null || echo 'unknown version'))"
else
  echo "Installing @openai/codex..."
  sudo npm install -g @openai/codex@latest
  echo "✓ codex installed ($(codex --version 2>/dev/null || echo 'done'))"
fi

# ── Install copilot-api-responses (caozhiyuan fork) ─────────────
if command -v copilot-api-responses &>/dev/null; then
  echo "✓ copilot-api-responses already installed"
else
  echo "Installing @jeffreycao/copilot-api to /opt/copilot-api-responses..."
  sudo mkdir -p /opt/copilot-api-responses
  cd /opt/copilot-api-responses
  sudo npm init -y > /dev/null 2>&1
  sudo npm install @jeffreycao/copilot-api@latest
  sudo ln -sf /opt/copilot-api-responses/node_modules/@jeffreycao/copilot-api/dist/main.js /usr/local/bin/copilot-api-responses
  sudo chmod +x /opt/copilot-api-responses/node_modules/@jeffreycao/copilot-api/dist/main.js
  cd "${PROJECT_DIR}"
  echo "✓ copilot-api-responses installed"
fi

# ── Restore config files from backup ─────────────────────────────
if [ ! -d "${CODEX_DATA}" ]; then
  echo ""
  echo "⚠ No data/codex/ directory found — skipping config restoration."
  echo "  Config files will need to be created manually."
  echo "  Run: ~/start-codex.sh --list-models  to verify setup."
  exit 0
fi

echo ""
echo "Restoring configuration from backup..."

if [ -f "${CODEX_DATA}/config.toml" ]; then
  mkdir -p "${HOME}/.codex"
  cp "${CODEX_DATA}/config.toml" "${HOME}/.codex/config.toml"
  echo "  ✓ ~/.codex/config.toml"
else
  echo "  ⚠ No config.toml in backup — creating default..."
  mkdir -p "${HOME}/.codex"
  cat > "${HOME}/.codex/config.toml" << 'TOML'
model = "gpt-5.3-codex"
model_provider = "copilot"

[model_providers.copilot]
name = "GitHub Copilot"
base_url = "http://localhost:4142/v1"
env_key = "COPILOT_API_KEY"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
TOML
  echo "  ✓ ~/.codex/config.toml (default)"
fi

if [ -f "${CODEX_DATA}/start-codex.sh" ]; then
  cp "${CODEX_DATA}/start-codex.sh" "${HOME}/start-codex.sh"
  chmod +x "${HOME}/start-codex.sh"
  echo "  ✓ ~/start-codex.sh"
fi

if [ -f "${CODEX_DATA}/copilot-api-github-token" ]; then
  mkdir -p "${HOME}/.local/share/copilot-api"
  cp "${CODEX_DATA}/copilot-api-github-token" "${HOME}/.local/share/copilot-api/github_token"
  echo "  ✓ copilot-api github token"
else
  echo "  ⚠ No copilot-api token in backup — you'll need to run: copilot-api-responses auth"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Usage:"
echo "  ~/start-codex.sh                    # Start with default model (gpt-5.3-codex)"
echo "  ~/start-codex.sh -m gpt-5.4         # Use a different model"
echo "  ~/start-codex.sh --list-models      # Show all available models"
echo ""
echo "If you don't have a copilot-api token, authenticate first:"
echo "  copilot-api-responses auth"
