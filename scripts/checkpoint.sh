#!/usr/bin/env bash
# NanoClaw daily checkpoint backup
# Creates tar.gz backups of ALL stateful data needed for full VM restoration.
# Goal: install Claude Code + NanoClaw on a fresh VM, apply backup, everything works.
# Keeps last 7 days.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${PROJECT_DIR}/backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/checkpoint_${TIMESTAMP}.tar.gz"
MAX_BACKUPS=7

mkdir -p "${BACKUP_DIR}"

# Paths to back up (relative to PROJECT_DIR)
PATHS=(
  groups/
  store/
  .env
  data/env/
  data/codex/
  data/sessions/
  .nanoclaw/
  .claude/settings.local.json
)

# Sync external Codex/copilot-api config into data/codex/ before backup
CODEX_DATA="${PROJECT_DIR}/data/codex"
mkdir -p "${CODEX_DATA}"
[ -f "${HOME}/.codex/config.toml" ] && cp "${HOME}/.codex/config.toml" "${CODEX_DATA}/config.toml"
[ -f "${HOME}/start-codex.sh" ] && cp "${HOME}/start-codex.sh" "${CODEX_DATA}/start-codex.sh"
[ -f "${HOME}/.local/share/copilot-api/github_token" ] && cp "${HOME}/.local/share/copilot-api/github_token" "${CODEX_DATA}/copilot-api-github-token"

# Sync external configs into data/ staging area before backup
# Gemini OAuth credentials
GEMINI_DATA="${PROJECT_DIR}/data/gemini"
mkdir -p "${GEMINI_DATA}"
for f in oauth_creds.json google_accounts.json settings.json installation_id; do
  [ -f "${HOME}/.gemini/${f}" ] && cp "${HOME}/.gemini/${f}" "${GEMINI_DATA}/${f}"
done

# Systemd user services (nanoclaw, copilot-api, timers, etc.)
SYSTEMD_DATA="${PROJECT_DIR}/data/systemd"
mkdir -p "${SYSTEMD_DATA}"
if [ -d "${HOME}/.config/systemd/user" ]; then
  # Copy service and timer files only (not symlink dirs like default.target.wants)
  find "${HOME}/.config/systemd/user" -maxdepth 1 -type f -name '*.service' -o -name '*.timer' | \
    while read -r f; do cp "$f" "${SYSTEMD_DATA}/"; done
fi

# Home directory utility scripts — no longer needed, check-copilot-credentials.sh is now in scripts/
# (kept as comment for history — the old sync target was data/home-scripts/)

# Claude Code user settings
CLAUDE_DATA="${PROJECT_DIR}/data/claude-code"
mkdir -p "${CLAUDE_DATA}"
[ -f "${HOME}/.claude/settings.json" ] && cp "${HOME}/.claude/settings.json" "${CLAUDE_DATA}/settings.json"

# Build list of existing paths only
EXISTING=()
for p in "${PATHS[@]}"; do
  if [ -e "${PROJECT_DIR}/${p}" ]; then
    EXISTING+=("${p}")
  fi
done

# Add the newly synced data dirs
for d in data/gemini data/systemd data/claude-code; do
  if [ -d "${PROJECT_DIR}/${d}" ] && [ "$(ls -A "${PROJECT_DIR}/${d}" 2>/dev/null)" ]; then
    EXISTING+=("${d}/")
  fi
done

# Also grab nanoclaw config from ~/.config/nanoclaw/ if it exists
CONFIG_DIR="${HOME}/.config/nanoclaw"
EXTRA_ARGS=()
if [ -d "${CONFIG_DIR}" ]; then
  EXTRA_ARGS+=(-C / "${CONFIG_DIR#/}/")
fi

if [ ${#EXISTING[@]} -eq 0 ]; then
  echo "Nothing to back up."
  exit 0
fi

# Rotate logs before backup to avoid bloated archives
"${PROJECT_DIR}/scripts/rotate-logs.sh" 2>/dev/null || true

# Create compressed backup
# Exclude debug logs, cache, and large transient files from sessions
tar -czf "${BACKUP_FILE}" \
  -C "${PROJECT_DIR}" \
  --exclude='data/sessions/*/\.claude/debug' \
  --exclude='data/sessions/*/\.claude/cache' \
  --exclude='data/sessions/*/\.claude/shell-snapshots' \
  "${EXISTING[@]}" \
  "${EXTRA_ARGS[@]}" \
  2>/dev/null

SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "Checkpoint created: ${BACKUP_FILE} (${SIZE})"

# Rotate: keep only last N backups
BACKUPS=( $(ls -1t "${BACKUP_DIR}"/checkpoint_*.tar.gz 2>/dev/null) )
if [ ${#BACKUPS[@]} -gt ${MAX_BACKUPS} ]; then
  for old in "${BACKUPS[@]:${MAX_BACKUPS}}"; do
    rm -f "${old}"
    echo "Rotated old checkpoint: $(basename "${old}")"
  done
fi

# Summary
REMAINING=$(ls -1 "${BACKUP_DIR}"/checkpoint_*.tar.gz 2>/dev/null | wc -l)
echo "Total checkpoints: ${REMAINING}/${MAX_BACKUPS}"
