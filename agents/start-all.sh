#!/bin/bash
#
# NanoClaw Agent Bots — Process Manager
# Manages all 5 agent bot processes (Athena, Hermes, Atlas, Apollo, Argus).
#
# Usage:
#   ./start-all.sh start    — Start all agent bots
#   ./start-all.sh stop     — Stop all agent bots
#   ./start-all.sh restart  — Restart all agent bots
#   ./start-all.sh status   — Show status of all agent bots
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Run from the NanoClaw project root (parent of agents/)
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PIDS_DIR="$SCRIPT_DIR/pids"
LOGS_DIR="$SCRIPT_DIR/logs"

# Load agent tokens from .env file
ENV_FILE="$SCRIPT_DIR/.env"

AGENTS=(athena hermes atlas apollo argus)

mkdir -p "$PIDS_DIR" "$LOGS_DIR"

# Load environment variables
load_env() {
  if [ -f "$ENV_FILE" ]; then
    set -a
    source "$ENV_FILE"
    set +a
  else
    echo "WARNING: $ENV_FILE not found — agent tokens may not be set"
  fi
}

start_agent() {
  local name="$1"
  local pidfile="$PIDS_DIR/$name.pid"
  local logfile="$LOGS_DIR/$name.log"

  if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "  $name: already running (PID $(cat "$pidfile"))"
    return 0
  fi

  echo -n "  Starting $name... "

  # Run from project root so container-runner can find groups/ and data/
  cd "$PROJECT_ROOT"
  nohup npx tsx "$SCRIPT_DIR/$name.ts" >> "$logfile" 2>&1 &
  local pid=$!
  echo "$pid" > "$pidfile"
  echo "PID $pid"
}

stop_agent() {
  local name="$1"
  local pidfile="$PIDS_DIR/$name.pid"

  if [ ! -f "$pidfile" ]; then
    echo "  $name: not running (no pidfile)"
    return 0
  fi

  local pid
  pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    echo -n "  Stopping $name (PID $pid)... "
    kill "$pid"
    # Wait up to 10 seconds for graceful shutdown
    for i in {1..10}; do
      if ! kill -0 "$pid" 2>/dev/null; then
        break
      fi
      sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "force killing"
      kill -9 "$pid" 2>/dev/null || true
    else
      echo "stopped"
    fi
  else
    echo "  $name: not running (stale pidfile)"
  fi
  rm -f "$pidfile"
}

status_agent() {
  local name="$1"
  local pidfile="$PIDS_DIR/$name.pid"

  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      echo "  $name: running (PID $pid)"
    else
      echo "  $name: dead (stale pidfile, PID $pid)"
    fi
  else
    echo "  $name: stopped"
  fi
}

case "${1:-}" in
  start)
    load_env
    echo "Starting NanoClaw agent bots..."
    for agent in "${AGENTS[@]}"; do
      start_agent "$agent"
    done
    echo "Done."
    ;;

  stop)
    echo "Stopping NanoClaw agent bots..."
    for agent in "${AGENTS[@]}"; do
      stop_agent "$agent"
    done
    echo "Done."
    ;;

  restart)
    echo "Restarting NanoClaw agent bots..."
    for agent in "${AGENTS[@]}"; do
      stop_agent "$agent"
    done
    sleep 2
    load_env
    for agent in "${AGENTS[@]}"; do
      start_agent "$agent"
    done
    echo "Done."
    ;;

  status)
    echo "NanoClaw agent bots status:"
    for agent in "${AGENTS[@]}"; do
      status_agent "$agent"
    done
    ;;

  *)
    echo "Usage: $0 {start|stop|restart|status}"
    exit 1
    ;;
esac
