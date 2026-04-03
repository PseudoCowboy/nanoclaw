#!/usr/bin/env bash
# rotate-logs.sh — Simple size-based log rotation for all .log files in logs/
# Keeps at most 2 rotated copies per log file:
#   file.log → file.log.1 → file.log.1.gz
# Runs from project root (called by checkpoint.sh or standalone).
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOGS_DIR="${PROJECT_DIR}/logs"
MAX_SIZE_MB=10
MAX_SIZE_BYTES=$(( MAX_SIZE_MB * 1024 * 1024 ))

if [ ! -d "$LOGS_DIR" ]; then
  echo "No logs directory at ${LOGS_DIR}"
  exit 0
fi

rotated=0

for logfile in "${LOGS_DIR}"/*.log; do
  [ -f "$logfile" ] || continue

  size=$(stat -c%s "$logfile" 2>/dev/null || echo 0)
  if [ "$size" -lt "$MAX_SIZE_BYTES" ]; then
    continue
  fi

  base="$logfile"

  # Remove oldest compressed backup
  rm -f "${base}.2.gz"

  # Compress previous rotation if it exists
  if [ -f "${base}.1" ]; then
    gzip -f "${base}.1"
    # Rename .1.gz → .2.gz to keep numbering clean
    mv -f "${base}.1.gz" "${base}.2.gz" 2>/dev/null || true
  fi

  # Rotate current log → .1
  mv -f "$logfile" "${base}.1"

  # Create fresh empty log (services will append on next write)
  touch "$logfile"

  rotated=$((rotated + 1))
  echo "Rotated: $(basename "$logfile") ($(( size / 1024 ))KB)"
done

if [ "$rotated" -eq 0 ]; then
  echo "No logs exceeded ${MAX_SIZE_MB}MB — nothing rotated"
else
  echo "Rotated ${rotated} log file(s)"
fi
