#!/usr/bin/env bash
# NanoClaw rollback from checkpoint
# Usage:
#   ./scripts/rollback.sh              # list available checkpoints
#   ./scripts/rollback.sh latest       # restore most recent checkpoint
#   ./scripts/rollback.sh <filename>   # restore specific checkpoint
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${PROJECT_DIR}/backups"
CONFIG_DIR="${HOME}/.config/nanoclaw"

if [ ! -d "${BACKUP_DIR}" ]; then
  echo "No backups directory found. Run checkpoint.sh first."
  exit 1
fi

BACKUPS=( $(ls -1t "${BACKUP_DIR}"/checkpoint_*.tar.gz 2>/dev/null) )

if [ ${#BACKUPS[@]} -eq 0 ]; then
  echo "No checkpoints found."
  exit 1
fi

# List mode
if [ $# -eq 0 ]; then
  echo "Available checkpoints:"
  echo ""
  for i in "${!BACKUPS[@]}"; do
    FILE="${BACKUPS[$i]}"
    NAME="$(basename "${FILE}")"
    SIZE="$(du -h "${FILE}" | cut -f1)"
    DATE="$(echo "${NAME}" | sed 's/checkpoint_//;s/\.tar\.gz//;s/_/ /')"
    if [ "$i" -eq 0 ]; then
      echo "  [latest] ${NAME}  (${SIZE})  ${DATE}"
    else
      echo "          ${NAME}  (${SIZE})  ${DATE}"
    fi
  done
  echo ""
  echo "Usage: $0 latest  OR  $0 <filename>"
  exit 0
fi

# Resolve target
TARGET="$1"
if [ "${TARGET}" = "latest" ]; then
  RESTORE_FILE="${BACKUPS[0]}"
elif [ -f "${BACKUP_DIR}/${TARGET}" ]; then
  RESTORE_FILE="${BACKUP_DIR}/${TARGET}"
elif [ -f "${TARGET}" ]; then
  RESTORE_FILE="${TARGET}"
else
  echo "Checkpoint not found: ${TARGET}"
  exit 1
fi

echo "Restoring from: $(basename "${RESTORE_FILE}")"

# Stop service before restoring
echo "Stopping NanoClaw..."
systemctl --user stop nanoclaw 2>/dev/null || true
# Kill any running agent containers
docker ps --filter "name=nanoclaw" -q | xargs -r docker kill 2>/dev/null || true
sleep 1

# Restore project files
echo "Restoring project data..."
tar -xzf "${RESTORE_FILE}" -C "${PROJECT_DIR}" 2>/dev/null || true

# Restore config files if they were in the backup
if tar -tzf "${RESTORE_FILE}" 2>/dev/null | grep -q "^home/"; then
  echo "Restoring config files..."
  tar -xzf "${RESTORE_FILE}" -C / 2>/dev/null || true
fi

# Sync env to container
if [ -f "${PROJECT_DIR}/.env" ]; then
  mkdir -p "${PROJECT_DIR}/data/env"
  cp "${PROJECT_DIR}/.env" "${PROJECT_DIR}/data/env/env"
fi

# Restore Codex/copilot-api config from data/codex/ if present
CODEX_DATA="${PROJECT_DIR}/data/codex"
if [ -d "${CODEX_DATA}" ]; then
  echo "Restoring Codex configuration..."
  if [ -f "${CODEX_DATA}/config.toml" ]; then
    mkdir -p "${HOME}/.codex"
    cp "${CODEX_DATA}/config.toml" "${HOME}/.codex/config.toml"
    echo "  ✓ ~/.codex/config.toml"
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
  fi
fi

# Restore Gemini OAuth credentials from data/gemini/ if present
GEMINI_DATA="${PROJECT_DIR}/data/gemini"
if [ -d "${GEMINI_DATA}" ] && [ "$(ls -A "${GEMINI_DATA}" 2>/dev/null)" ]; then
  echo "Restoring Gemini credentials..."
  mkdir -p "${HOME}/.gemini"
  for f in "${GEMINI_DATA}"/*; do
    [ -f "$f" ] && cp "$f" "${HOME}/.gemini/" && echo "  ✓ ~/.gemini/$(basename "$f")"
  done
fi

# Restore systemd user services from data/systemd/ if present
SYSTEMD_DATA="${PROJECT_DIR}/data/systemd"
if [ -d "${SYSTEMD_DATA}" ] && [ "$(ls -A "${SYSTEMD_DATA}" 2>/dev/null)" ]; then
  echo "Restoring systemd services..."
  mkdir -p "${HOME}/.config/systemd/user"
  for f in "${SYSTEMD_DATA}"/*.service "${SYSTEMD_DATA}"/*.timer; do
    [ -f "$f" ] && cp "$f" "${HOME}/.config/systemd/user/" && echo "  ✓ $(basename "$f")"
  done
  systemctl --user daemon-reload 2>/dev/null || true
  # Enable timers
  for f in "${SYSTEMD_DATA}"/*.timer; do
    [ -f "$f" ] && systemctl --user enable "$(basename "$f")" 2>/dev/null || true
  done
  # Enable services that should start on boot
  for svc in nanoclaw copilot-api copilot-api-responses; do
    [ -f "${SYSTEMD_DATA}/${svc}.service" ] && systemctl --user enable "${svc}.service" 2>/dev/null || true
  done
fi

# Restore home directory scripts from data/home-scripts/ if present
SCRIPTS_DATA="${PROJECT_DIR}/data/home-scripts"
if [ -d "${SCRIPTS_DATA}" ] && [ "$(ls -A "${SCRIPTS_DATA}" 2>/dev/null)" ]; then
  echo "Restoring home directory scripts..."
  for f in "${SCRIPTS_DATA}"/*; do
    [ -f "$f" ] && cp "$f" "${HOME}/" && chmod +x "${HOME}/$(basename "$f")" && echo "  ✓ ~/$(basename "$f")"
  done
fi

# Restore Claude Code user settings from data/claude-code/ if present
CLAUDE_DATA="${PROJECT_DIR}/data/claude-code"
if [ -d "${CLAUDE_DATA}" ]; then
  if [ -f "${CLAUDE_DATA}/settings.json" ]; then
    echo "Restoring Claude Code user settings..."
    mkdir -p "${HOME}/.claude"
    cp "${CLAUDE_DATA}/settings.json" "${HOME}/.claude/settings.json"
    echo "  ✓ ~/.claude/settings.json"
  fi
fi

# Rebuild container image (picks up any Dockerfile changes)
echo "Rebuilding container image..."
if [ -x "${PROJECT_DIR}/container/build.sh" ]; then
  "${PROJECT_DIR}/container/build.sh" 2>&1 | tail -3
  echo "  ✓ Container image rebuilt"
else
  echo "  ⚠ container/build.sh not found — run manually: ./container/build.sh"
fi

# Restart service
echo "Restarting NanoClaw..."
systemctl --user start nanoclaw 2>/dev/null || true

echo ""
echo "Rollback complete. Service restarted."
echo "Verify with: systemctl --user status nanoclaw"
