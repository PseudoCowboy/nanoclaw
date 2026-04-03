---
name: search-logs
description: "Search and analyze NanoClaw service logs. Use when user asks to find something in logs, check what happened, look for errors, or investigate any log-related question. Triggers on: 'search logs', 'check logs', 'find in logs', 'what happened', 'log error', 'look at logs'."
---

# Log Search

When the user asks you to find something in the logs, do it directly. Don't ask clarifying questions unless the request is truly ambiguous.

## Log Files

All logs live in `/home/pseudo/nanoclaw/logs/`:

| Log | Service | Content |
|-----|---------|---------|
| `nanoclaw.log` | NanoClaw main | Messages, containers, IPC, routing |
| `nanoclaw.error.log` | NanoClaw main | Uncaught exceptions, fatal errors |
| `copilot-api.log` | Port 4141 proxy | Claude Code API requests |
| `copilot-api.error.log` | Port 4141 proxy | Proxy errors |
| `copilot-api-responses.log` | Port 4142 proxy | Codex API requests |
| `copilot-api-responses.error.log` | Port 4142 proxy | Proxy errors |
| `copilot-patch.log` | Stealth patcher | Patch check/apply results |
| `copilot-check.log` | Credential checker | Health check results |
| `checkpoint.log` | Daily backup | Backup status |
| `setup.log` | Initial setup | One-time setup output |

## How to Search

**Pick the right approach based on the user's request:**

### Keyword search (most common)
```bash
# Search all logs for a term
grep -rn "PATTERN" /home/pseudo/nanoclaw/logs/ --include="*.log"

# Search specific log with context
grep -n -C 3 "PATTERN" /home/pseudo/nanoclaw/logs/nanoclaw.log

# Case-insensitive
grep -inC 3 "PATTERN" /home/pseudo/nanoclaw/logs/*.log
```

### Time-based search
```bash
# Find entries around a specific time
grep "2026-03-17 11:" /home/pseudo/nanoclaw/logs/nanoclaw.log

# Last N lines of a log
tail -100 /home/pseudo/nanoclaw/logs/nanoclaw.log
```

### Error hunting
```bash
# All errors across all logs
grep -rni "error\|fail\|fatal\|exception\|crash" /home/pseudo/nanoclaw/logs/ --include="*.log" | tail -30

# Recent errors only
tail -500 /home/pseudo/nanoclaw/logs/nanoclaw.log | grep -i "error\|fail"
```

### Systemd journal (for service lifecycle events)
```bash
# NanoClaw service events
journalctl --user -u nanoclaw --no-pager -n 30

# Copilot proxy events
journalctl --user -u copilot-api --no-pager -n 20
journalctl --user -u copilot-api-responses --no-pager -n 20

# All NanoClaw-related services
journalctl --user -u "nanoclaw*" -u "copilot*" --no-pager -n 50
```

## Response Style

- **Be direct** — show the relevant log lines, not a wall of text
- **Highlight** the key finding (the error, the timestamp, the pattern)
- **If nothing found** — say so clearly, suggest alternative search terms
- **If the user just says "check logs"** — show the last 30 lines of `nanoclaw.log` and any recent errors
