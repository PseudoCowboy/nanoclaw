#!/usr/bin/env bash
# scripts/verify-workflow-manifest.sh
# Generates a workflow manifest from source code and checks docs for drift.
# Exit 0 = clean, exit 1 = drift detected.
#
# Usage: bash scripts/verify-workflow-manifest.sh

set -euo pipefail
cd "$(dirname "$0")/.."

ERRORS=0
MANIFEST=""

log_error() { echo "DRIFT: $1"; ERRORS=$((ERRORS + 1)); MANIFEST="${MANIFEST}DRIFT: $1\n"; }
log_ok()    { MANIFEST="${MANIFEST}OK: $1\n"; }

# --- 1. Extract canonical agents from constants.ts (AGENTS array only) ---
AGENTS_SOURCE=$(sed -n '/^export const AGENTS/,/^];/p' src/channels/discord-commands/constants.ts | grep -oP "name: '([^']+)'" | sed "s/name: '//;s/'//")
echo "=== Canonical Agents (from constants.ts) ==="
echo "$AGENTS_SOURCE"
echo ""

# Check docs for phantom agents (names that don't exist in code)
DOCS_TO_CHECK=(
  "docs/discord-bot-summary.md"
  "multi-agent-file-first-workflow.md"
  "docs/DISCORD-WORKFLOW-VS-PRINCIPLES.md"
)

for doc in "${DOCS_TO_CHECK[@]}"; do
  [ -f "$doc" ] || continue
  # Look for phantom agents: any capitalized name in agent-context that's not canonical
  for phantom in Prometheus Zeus Hera Hephaestus; do
    if grep -qi "$phantom" "$doc" 2>/dev/null; then
      log_error "$doc references removed agent '$phantom'"
    fi
  done
  # Verify that documented agent names match the canonical set
  for agent in $AGENTS_SOURCE; do
    if ! grep -q "$agent" "$doc" 2>/dev/null; then
      log_error "$doc does not mention canonical agent '$agent'"
    fi
  done
done

# --- 2. Extract canonical commands from index.ts (command registry only) ---
COMMANDS_SOURCE=$(sed -n '/^const commands:/,/^};/p' src/channels/discord-commands/index.ts | grep -oP '^\s+(\w+): cmd' | sed 's/: cmd.*//;s/^\s*//' | sort)
COMMAND_COUNT=$(echo "$COMMANDS_SOURCE" | wc -l | tr -d ' ')
echo "=== Canonical Commands ($COMMAND_COUNT from index.ts) ==="
echo "$COMMANDS_SOURCE"
echo ""

# Check discord-bot-summary.md command count claim
if [ -f "docs/discord-bot-summary.md" ]; then
  CLAIMED_COUNT=$(grep -oP '\d+ total' docs/discord-bot-summary.md | head -1 | grep -oP '\d+' || true)
  if [ -n "$CLAIMED_COUNT" ] && [ "$CLAIMED_COUNT" != "$COMMAND_COUNT" ]; then
    log_error "docs/discord-bot-summary.md claims $CLAIMED_COUNT commands, code has $COMMAND_COUNT"
  else
    log_ok "Command count matches ($COMMAND_COUNT)"
  fi
fi

# --- 3. Extract canonical workstream types from constants.ts (WORKSTREAM_DEFS only) ---
STREAMS_SOURCE=$(sed -n '/^export const WORKSTREAM_DEFS/,/^};/p' src/channels/discord-commands/constants.ts | grep -oP '^\s+(\w+): \{' | sed 's/: {//;s/^\s*//' | sort)
echo "=== Canonical Workstream Types (from constants.ts) ==="
echo "$STREAMS_SOURCE"
echo ""

# --- 4. Check for old paths in skills and docs ---
OLD_PATH="/workspace/shared/projects/"
for f in container/skills/*/SKILL.md docs/*.md; do
  [ -f "$f" ] || continue
  if grep -q "$OLD_PATH" "$f" 2>/dev/null; then
    log_error "$f contains old path pattern '$OLD_PATH'"
  fi
done

# --- 5. Summary ---
echo ""
echo "=== Manifest Verification ==="
echo -e "$MANIFEST"

if [ "$ERRORS" -gt 0 ]; then
  echo "FAILED: $ERRORS drift issue(s) found."
  exit 1
else
  echo "PASSED: No drift detected."
  exit 0
fi
