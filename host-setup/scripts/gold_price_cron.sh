#!/usr/bin/env bash
# Gold price cron job — runs the scrapy spider and sends result to Telegram via NanoClaw IPC
# Installed by: crontab — runs every hour
# Log: ~/logs/gold-price.log

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$HOME/logs"
LOG_FILE="$LOG_DIR/gold-price.log"
SPIDER="$SCRIPT_DIR/gold_price_spider.py"

mkdir -p "$LOG_DIR"

# Rotate log if > 1MB
if [[ -f "$LOG_FILE" ]] && [[ $(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0) -gt 1048576 ]]; then
    mv "$LOG_FILE" "$LOG_FILE.old"
fi

{
    echo "=== $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="
    SEND_TELEGRAM=1 python3 "$SPIDER" 2>&1
    echo ""
} >> "$LOG_FILE" 2>&1
