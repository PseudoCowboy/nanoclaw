#!/usr/bin/env bash
# start-codex.sh — Launch Codex CLI with GitHub Copilot backend
#
# Usage:
#   ~/start-codex.sh                    # default model (gpt-5.3-codex)
#   ~/start-codex.sh -m gpt-5.4         # pick a different model
#   ~/start-codex.sh --list-models      # show available models (live from API)

set -euo pipefail

PORT="${COPILOT_API_PORT:-4142}"
PROXY_PID=""

cleanup() {
    if [[ -n "$PROXY_PID" ]] && kill -0 "$PROXY_PID" 2>/dev/null; then
        echo ""
        echo "Stopping copilot-api proxy (PID $PROXY_PID)..."
        kill "$PROXY_PID" 2>/dev/null
        wait "$PROXY_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

# ── Ensure proxy is running (shared by --list-models and normal start) ──
ensure_proxy() {
    if curl -sf "http://localhost:${PORT}/v1/models" > /dev/null 2>&1; then
        echo "✓ copilot-api proxy already running on port ${PORT}"
        return 0
    fi

    echo "Starting copilot-api proxy on port ${PORT}..."
    copilot-api-responses start --port "$PORT" > /tmp/copilot-api-responses.log 2>&1 &
    PROXY_PID=$!

    for i in $(seq 1 30); do
        if curl -sf "http://localhost:${PORT}/v1/models" > /dev/null 2>&1; then
            echo "✓ copilot-api proxy ready (PID ${PROXY_PID})"
            return 0
        fi
        if ! kill -0 "$PROXY_PID" 2>/dev/null; then
            echo "✗ copilot-api proxy failed to start. Log:"
            cat /tmp/copilot-api-responses.log
            exit 1
        fi
        sleep 1
    done

    echo "✗ copilot-api proxy did not become ready in 30s. Log:"
    cat /tmp/copilot-api-responses.log
    kill "$PROXY_PID" 2>/dev/null || true
    exit 1
}

# ── List models (live from the API) ─────────────────────────────
if [[ "${1:-}" == "--list-models" ]]; then
    ensure_proxy
    echo ""
    echo "Available models through your GitHub Copilot account:"
    echo ""
    curl -sf "http://localhost:${PORT}/v1/models" | python3 -c "
import json, sys
data = json.load(sys.stdin)
models = data if isinstance(data, list) else data.get('data', data.get('models', []))
ids = sorted(set(m.get('id', m) if isinstance(m, dict) else m for m in models))
# group by prefix
groups = {}
for mid in ids:
    if 'embedding' in mid: continue
    if 'codex' in mid: key = 'Codex-optimized (best for coding)'
    elif mid.startswith('claude'): key = 'Claude'
    elif mid.startswith('gemini'): key = 'Gemini'
    elif mid.startswith('gpt'): key = 'GPT'
    elif mid.startswith(('o3','o4')): key = 'Reasoning'
    else: key = 'Other'
    groups.setdefault(key, []).append(mid)
order = ['Codex-optimized (best for coding)','GPT','Reasoning','Claude','Gemini','Other']
for g in order:
    if g in groups:
        print(f'  {g}:')
        for m in groups[g]:
            print(f'    {m}')
        print()
" 2>/dev/null || echo "  (Could not parse models — try: curl http://localhost:${PORT}/v1/models)"
    echo "Usage: $0 -m <model>"
    exit 0
fi

# ── Start proxy and launch Codex ────────────────────────────────
ensure_proxy

export COPILOT_API_KEY="dummy"
echo "Launching codex..."
echo ""
codex "$@"
