# Discord Status

Trigger: user says `!status` or asks for system/service status.

## What This Does

Check the health of all NanoClaw services, agent bots, and infrastructure.

## Checks to Run

```bash
# NanoClaw main process
systemctl --user status nanoclaw --no-pager 2>&1 | head -5

# Agent bots
systemctl --user status nanoclaw-agents --no-pager 2>&1 | head -5

# Copilot API proxies
systemctl --user status copilot-api --no-pager 2>&1 | head -3
systemctl --user status copilot-api-responses --no-pager 2>&1 | head -3

# Running containers
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.RunningFor}}" 2>/dev/null | grep nanoclaw || echo "No active containers"

# Disk usage
du -sh /home/pseudo/nanoclaw/groups/shared_project/ 2>/dev/null || echo "Shared project: empty"
du -sh /home/pseudo/nanoclaw/data/ 2>/dev/null

# Recent errors
tail -5 /home/pseudo/nanoclaw/logs/nanoclaw.error.log 2>/dev/null || echo "No recent errors"
```

## Response Format

Report status as a clear summary:
- Services: running/stopped
- Containers: count active
- Agents: which are online
- Errors: any recent issues
