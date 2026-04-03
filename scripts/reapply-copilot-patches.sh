#!/usr/bin/env bash
# reapply-copilot-patches.sh — Re-apply copilot-api stealth patches if missing
# Called by copilot-patch.timer on boot and periodically.
# Runs from project root (WorkingDirectory in systemd unit).
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${PROJECT_DIR}/logs/copilot-patch.log"
PATCHER="${PROJECT_DIR}/scripts/copilot-stealth-patch.py"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [copilot-patch-check] $*" >> "$LOG"; }

# Dist files that get patched
FILE_4141="/usr/lib/node_modules/copilot-api/dist/main.js"
FILE_4142="/opt/copilot-api-responses/node_modules/@jeffreycao/copilot-api/dist/config-BD6sOCuT.js"

needs_patch=false

if [[ -f "$FILE_4141" ]] && ! grep -q "vscode-machineid" "$FILE_4141"; then
    log "Port 4141 needs patching (missing vscode-machineid)"
    needs_patch=true
fi

if [[ -f "$FILE_4142" ]] && ! grep -q "openai-organization" "$FILE_4142"; then
    log "Port 4142 needs patching (missing openai-organization)"
    needs_patch=true
fi

if [[ "$needs_patch" == "false" ]]; then
    log "All patches intact, nothing to do"
    exit 0
fi

log "Patches missing, re-applying..."
python3 "$PATCHER"

# Restart services so they pick up patched dist files
systemctl --user restart copilot-api 2>/dev/null || true
systemctl --user restart copilot-api-responses 2>/dev/null || true

log "Patches re-applied and services restarted"
