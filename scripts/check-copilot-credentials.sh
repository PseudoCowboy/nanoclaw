#!/bin/bash
# check-copilot-credentials.sh
# Checks if copilot-api, copilot-api-responses, and gemini credentials are valid.
# Sends Telegram notifications on failure or (with --notify-ok) on success.
# Designed to run as a systemd timer or on boot.
# Reads tokens from .env (sourced relative to this script's location).
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${PROJECT_DIR}/logs/copilot-check.log"

# Source credentials from .env
if [ -f "${PROJECT_DIR}/.env" ]; then
  set -a
  source "${PROJECT_DIR}/.env"
  set +a
fi

TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_NOTIFY_CHAT_ID:-}"
COPILOT_API_URL="http://localhost:4141/v1/models"
COPILOT_RESPONSES_URL="http://localhost:4142/v1/models"
HOSTNAME=$(hostname)

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [copilot-check] $*" >> "$LOG"; }

send_telegram() {
  local message="$1"
  if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
    log "WARN: TELEGRAM_BOT_TOKEN or TELEGRAM_NOTIFY_CHAT_ID not set — skipping notification"
    return
  fi
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" \
    -d text="${message}" \
    -d parse_mode="Markdown" > /dev/null 2>&1
}

# Track overall status
copilot_ok=false
copilot_responses_ok=false
gemini_ok=false
any_failure=false

# ── Copilot API Check (port 4141 — Chat Completions for Claude Code) ──

log "Starting credential checks..."

# Wait for copilot-api to be ready (up to 30 seconds)
for i in $(seq 1 6); do
  if curl -s --connect-timeout 2 "${COPILOT_API_URL}" > /dev/null 2>&1; then
    break
  fi
  sleep 5
done

# Check if copilot-api responds successfully
response=$(curl -s --connect-timeout 5 -o /dev/null -w "%{http_code}" "${COPILOT_API_URL}")

if [ "$response" != "200" ]; then
  log "FAIL: Copilot API (4141) HTTP ${response}"
  send_telegram "⚠️ *Copilot API Credentials Expired*

🖥 Host: \`${HOSTNAME}\`
📅 Time: $(date -u '+%Y-%m-%d %H:%M UTC')
❌ Status: HTTP ${response} (port 4141)

The copilot-api on your VM is not responding properly. Credentials may have expired.

Run \`copilot-api auth\` on the VM to re-authenticate."
  any_failure=true
else
  # Also try a lightweight completion to verify the token actually works
  test_response=$(curl -s --connect-timeout 10 -w "\n%{http_code}" \
    -H "Content-Type: application/json" \
    -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}],"max_tokens":1}' \
    "${COPILOT_API_URL%/models}/chat/completions" 2>&1)

  http_code=$(echo "$test_response" | tail -1)

  if [ "$http_code" != "200" ]; then
    log "FAIL: Copilot API (4141) completions HTTP ${http_code}"
    send_telegram "⚠️ *Copilot API Credentials Expired*

🖥 Host: \`${HOSTNAME}\`
📅 Time: $(date -u '+%Y-%m-%d %H:%M UTC')
❌ Status: Models endpoint OK but completions failed (HTTP ${http_code})

The GitHub token may have expired.

Run \`copilot-api auth\` on the VM to re-authenticate."
    any_failure=true
  else
    copilot_ok=true
    log "OK: Copilot API (4141)"
  fi
fi

# ── Copilot API Responses Check (port 4142 — Responses API for Codex) ──

# Wait for copilot-api-responses to be ready (up to 30 seconds)
for i in $(seq 1 6); do
  if curl -s --connect-timeout 2 "${COPILOT_RESPONSES_URL}" > /dev/null 2>&1; then
    break
  fi
  sleep 5
done

responses_http=$(curl -s --connect-timeout 5 -o /dev/null -w "%{http_code}" "${COPILOT_RESPONSES_URL}")

if [ "$responses_http" != "200" ]; then
  log "FAIL: Copilot Responses (4142) HTTP ${responses_http}"
  send_telegram "⚠️ *Copilot API Responses Not Running*

🖥 Host: \`${HOSTNAME}\`
📅 Time: $(date -u '+%Y-%m-%d %H:%M UTC')
❌ Status: HTTP ${responses_http} (port 4142)

The copilot-api-responses proxy (for Codex) is not responding.

Run \`systemctl --user restart copilot-api-responses\` on the VM.
If credentials expired: \`copilot-api-responses auth\`"
  any_failure=true
else
  # Test the Responses API endpoint with a Codex model
  resp_test=$(curl -s --connect-timeout 15 -w "\n%{http_code}" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer dummy" \
    -d '{"model":"gpt-5.3-codex","input":"hi","max_output_tokens":16}' \
    "${COPILOT_RESPONSES_URL%/models}/responses" 2>&1)

  resp_code=$(echo "$resp_test" | tail -1)

  if [ "$resp_code" != "200" ]; then
    log "FAIL: Copilot Responses (4142) completions HTTP ${resp_code}"
    send_telegram "⚠️ *Copilot API Responses — Auth Failed*

🖥 Host: \`${HOSTNAME}\`
📅 Time: $(date -u '+%Y-%m-%d %H:%M UTC')
❌ Models endpoint OK but Responses API failed (HTTP ${resp_code})

The GitHub token for copilot-api-responses may have expired.

Run \`copilot-api-responses auth\` on the VM to re-authenticate."
    any_failure=true
  else
    copilot_responses_ok=true
    log "OK: Copilot Responses (4142)"
  fi
fi

# ── Gemini CLI Check ─────────────────────────────────────────────

if command -v gemini &>/dev/null; then
  # Quick non-interactive test — gemini -p with JSON output for easy parsing
  gemini_output=$(gemini -p "hi" --output-format json 2>&1)
  gemini_exit=$?

  if [ $gemini_exit -eq 0 ] && echo "$gemini_output" | grep -q '"response"'; then
    gemini_ok=true
    log "OK: Gemini CLI"
  else
    # Check if it's an auth issue
    if echo "$gemini_output" | grep -qi "auth\|credential\|login\|token\|expired\|unauthorized"; then
      log "FAIL: Gemini CLI auth expired"
      send_telegram "⚠️ *Gemini CLI Auth Expired*

🖥 Host: \`${HOSTNAME}\`
📅 Time: $(date -u '+%Y-%m-%d %H:%M UTC')
❌ Gemini Google OAuth credentials expired or invalid.

Run \`gemini\` on the VM and re-authenticate with Google."
    else
      log "FAIL: Gemini CLI exit=${gemini_exit}"
      send_telegram "⚠️ *Gemini CLI Not Working*

🖥 Host: \`${HOSTNAME}\`
📅 Time: $(date -u '+%Y-%m-%d %H:%M UTC')
❌ Exit code: ${gemini_exit}

Check \`gemini\` on the VM. Output:
\`\`\`
$(echo "$gemini_output" | tail -5)
\`\`\`"
    fi
    any_failure=true
  fi
else
  # Gemini not installed — not a failure, just skip
  gemini_ok=skip
  log "SKIP: Gemini CLI not installed"
fi

# ── Summary notification ─────────────────────────────────────────

if [ "${1:-}" = "--notify-ok" ]; then
  # Build status lines
  copilot_status="✅ Copilot API (4141): credentials valid"
  [ "$copilot_ok" != "true" ] && copilot_status="❌ Copilot API (4141): FAILED"

  copilot_resp_status="✅ Copilot Responses (4142): credentials valid"
  [ "$copilot_responses_ok" != "true" ] && copilot_resp_status="❌ Copilot Responses (4142): FAILED"

  if [ "$gemini_ok" = "true" ]; then
    gemini_status="✅ Gemini CLI: Google OAuth valid"
  elif [ "$gemini_ok" = "skip" ]; then
    gemini_status="⏭ Gemini CLI: not installed"
  else
    gemini_status="❌ Gemini CLI: FAILED"
  fi

  if [ "$any_failure" = "true" ]; then
    send_telegram "⚠️ *VM Started — Issues Detected*

🖥 Host: \`${HOSTNAME}\`
📅 Time: $(date -u '+%Y-%m-%d %H:%M UTC')
${copilot_status}
${copilot_resp_status}
${gemini_status}"
  else
    send_telegram "✅ *VM Started — All Services OK*

🖥 Host: \`${HOSTNAME}\`
📅 Time: $(date -u '+%Y-%m-%d %H:%M UTC')
${copilot_status}
${copilot_resp_status}
${gemini_status}"
  fi
fi

log "Checks complete: copilot=${copilot_ok} responses=${copilot_responses_ok} gemini=${gemini_ok}"

if [ "$any_failure" = "true" ]; then
  exit 1
fi

exit 0
