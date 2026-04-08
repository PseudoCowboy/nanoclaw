#!/usr/bin/env bash
# install.sh — Restore NanoClaw host configuration on a new machine
#
# Usage: cd nanoclaw/setup && ./install.sh
#
# What it does:
#   1. Copies scripts to ~/
#   2. Installs systemd user services
#   3. Sets up Codex config
#   4. Sets up Claude agents config
#   5. Appends bashrc additions (if not already present)
#   6. Installs crontab
#
# What it does NOT do:
#   - Install npm/node/copilot-api/codex binaries (do that first)
#   - Copy secrets (.env, OAuth tokens, SSH keys)
#   - Start services (do that after verifying config)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="$HOME"

echo "=== NanoClaw Setup Installer ==="
echo "Installing to: $HOME_DIR"
echo ""

# 1. Scripts
echo "→ Copying scripts to ~/"
cp "$SCRIPT_DIR/scripts/gold_price_cron.sh" "$HOME_DIR/"
cp "$SCRIPT_DIR/scripts/gold_price_spider.py" "$HOME_DIR/"
cp "$SCRIPT_DIR/scripts/start-codex.sh" "$HOME_DIR/"
chmod +x "$HOME_DIR/gold_price_cron.sh" "$HOME_DIR/start-codex.sh"
echo "  ✓ gold_price_cron.sh, gold_price_spider.py, start-codex.sh"

# 2. Systemd services
echo "→ Installing systemd user services"
mkdir -p "$HOME_DIR/.config/systemd/user"
cp "$SCRIPT_DIR"/systemd/*.service "$HOME_DIR/.config/systemd/user/"
cp "$SCRIPT_DIR"/systemd/*.timer "$HOME_DIR/.config/systemd/user/"
echo "  ✓ Copied service and timer units"
echo "  ⚠ Run: systemctl --user daemon-reload"
echo "  ⚠ Run: systemctl --user enable nanoclaw copilot-api copilot-api-responses nanoclaw-agents copilot-check.timer copilot-patch.timer nanoclaw-checkpoint.timer"

# 3. Codex config
echo "→ Setting up Codex config"
mkdir -p "$HOME_DIR/.codex"
cp "$SCRIPT_DIR/config/codex/config.toml" "$HOME_DIR/.codex/"
echo "  ✓ ~/.codex/config.toml"

# 4. Claude agents config
echo "→ Setting up Claude agents config"
mkdir -p "$HOME_DIR/.claude-agents/argus" "$HOME_DIR/.claude-agents/atlas"
cp "$SCRIPT_DIR/config/claude-agents/argus/settings.json" "$HOME_DIR/.claude-agents/argus/"
cp "$SCRIPT_DIR/config/claude-agents/atlas/settings.json" "$HOME_DIR/.claude-agents/atlas/"
echo "  ✓ ~/.claude-agents/{argus,atlas}/settings.json"

# 5. NanoClaw config
echo "→ Setting up NanoClaw config"
mkdir -p "$HOME_DIR/.config/nanoclaw"
cp "$SCRIPT_DIR/config/nanoclaw/mount-allowlist.json" "$HOME_DIR/.config/nanoclaw/"
echo "  ✓ ~/.config/nanoclaw/mount-allowlist.json"

# 6. Bashrc additions
echo "→ Checking bashrc additions"
if grep -q "ANTHROPIC_BASE_URL" "$HOME_DIR/.bashrc" 2>/dev/null; then
    echo "  ⏭ bashrc already has Claude Code config — skipping"
else
    echo "" >> "$HOME_DIR/.bashrc"
    cat "$SCRIPT_DIR/config/bashrc-additions.sh" >> "$HOME_DIR/.bashrc"
    echo "  ✓ Appended Claude Code env vars to ~/.bashrc"
fi

# 7. Crontab
echo "→ Installing crontab"
echo "  Current crontab:"
crontab -l 2>/dev/null | sed 's/^/    /' || echo "    (empty)"
read -rp "  Replace crontab with saved entries? [y/N] " reply
if [[ "$reply" =~ ^[Yy]$ ]]; then
    crontab "$SCRIPT_DIR/config/crontab.txt"
    echo "  ✓ Crontab installed"
else
    echo "  ⏭ Skipped. To install manually: crontab $SCRIPT_DIR/config/crontab.txt"
fi

echo ""
echo "=== Done ==="
echo ""
echo "Next steps:"
echo "  1. Install prerequisites: node, npm, copilot-api, codex, python3, scrapy"
echo "  2. Set up secrets: .env file, OAuth tokens, SSH keys"
echo "  3. Run: systemctl --user daemon-reload"
echo "  4. Run: systemctl --user enable --now copilot-api copilot-api-responses"
echo "  5. Run: systemctl --user enable --now nanoclaw nanoclaw-agents"
echo "  6. Authenticate: copilot-api auth && copilot-api-responses auth"
echo "  7. Build NanoClaw: cd ~/nanoclaw && npm install && npm run build"
echo "  8. Build container: cd ~/nanoclaw && ./container/build.sh"
