---
name: nanoclaw-logs
description: "Fetch and analyze NanoClaw logs when something goes wrong. Use when user reports issues like: messages not sending, agent not responding, container crashes, Telegram errors, IPC failures, document sending failures, or any 'something went wrong' report."
---

# NanoClaw Log Analysis

When the user reports something went wrong with NanoClaw, follow this procedure to diagnose the issue.

## Step 1: Gather logs (run ALL of these in parallel)

```bash
# 1a. Host-side application log (last 80 lines — covers recent activity)
tail -80 /home/pseudo/nanoclaw/logs/nanoclaw.log

# 1b. Host-side error log
cat /home/pseudo/nanoclaw/logs/nanoclaw.error.log

# 1c. systemd journal (last 50 entries)
journalctl --user -u nanoclaw --no-pager -n 50 2>&1

# 1d. Latest container log for each active group
for f in $(ls -t /home/pseudo/nanoclaw/groups/*/logs/container-*.log 2>/dev/null | head -3); do echo "=== $f ==="; tail -60 "$f"; echo; done

# 1e. Service status
systemctl --user status nanoclaw --no-pager 2>&1
```

## Step 2: Check for specific failure patterns

Based on what the user reported, also run the relevant checks:

### If messages aren't sending / agent not responding:
```bash
# Check if service is running
systemctl --user is-active nanoclaw 2>&1

# Check for stuck containers
docker ps --filter "name=nanoclaw-" --format "{{.Names}}\t{{.Status}}\t{{.RunningFor}}" 2>&1

# Check IPC directories for stuck messages
find /home/pseudo/nanoclaw/data/ipc -name "*.json" -type f 2>/dev/null | head -20

# Check IPC error directory
ls -la /home/pseudo/nanoclaw/data/ipc/errors/ 2>/dev/null
```

### If document/file sending fails:
```bash
# Check for document-related log entries
grep -i "document\|send_doc\|filePath" /home/pseudo/nanoclaw/logs/nanoclaw.log | tail -20

# Check outbox files exist
ls -la /home/pseudo/nanoclaw/groups/*/outbox/ 2>/dev/null
```

### If Telegram is disconnected:
```bash
# Check for Telegram errors
grep -i "telegram\|bot error\|polling" /home/pseudo/nanoclaw/logs/nanoclaw.log | tail -20
```

### If container/agent crashes:
```bash
# Check copilot-api proxy status (Claude Code depends on this)
curl -s http://localhost:4141/v1/models 2>&1 | head -5
curl -s http://localhost:4142/v1/models 2>&1 | head -5

# Check for OOM or resource issues
docker stats --no-stream --format "{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}" 2>/dev/null | grep nanoclaw
```

## Step 3: Analyze and report

After gathering logs, analyze them for:

1. **Error patterns** — look for `ERROR`, `FATAL`, `Failed`, stack traces
2. **Timing** — correlate timestamps with when the user noticed the issue
3. **Root cause** — identify the actual failure (auth expired, container OOM, network, IPC path issue, etc.)
4. **State issues** — stale sessions, stuck containers, orphaned IPC files

Present findings as:
- **What happened** (the error)
- **Why** (root cause)
- **Fix** (specific commands to resolve it)

## Common fixes reference

| Issue | Fix |
|-------|-----|
| Service crashed | `systemctl --user restart nanoclaw` |
| Stuck container | `docker rm -f <container-name>` then restart |
| Stale session causing errors | `rm /home/pseudo/nanoclaw/data/sessions/{group}/.claude/projects/-workspace-group/*.jsonl` then restart |
| Copilot API proxy down | `systemctl --user restart copilot-api` or `systemctl --user restart copilot-api-responses` |
| IPC errors piling up | Check `/home/pseudo/nanoclaw/data/ipc/errors/`, read the JSON to understand what failed |
| Telegram bot token expired | Check `.env` for `TELEGRAM_BOT_TOKEN`, update if needed |
| Container image stale | `./container/build.sh` in `/home/pseudo/nanoclaw/` |
