# Check Stuck Discord Agent Bots

Diagnose and fix stuck Discord agent bots (Athena, Hermes, Atlas, Apollo, Argus, Iris).

Triggers: "check stuck", "bot stuck", "discord stuck", "agent stuck", "not responding"

## Step 1: Gather diagnostics (run ALL in parallel)

```bash
# 1a. Stuck containers — any nanoclaw container running > 3 minutes is likely stuck
docker ps --filter "name=nanoclaw-" --format "{{.Names}}\t{{.Status}}\t{{.RunningFor}}" 2>&1

# 1b. Duplicate agent processes — each agent should have exactly ONE process tree
ps aux | grep "/home/pseudo/nanoclaw/agents/.*\.ts" | grep -v grep | grep -v node_modules | awk '{print $2, $5, $9, $NF}' | sort -k4 2>&1

# 1c. Old zombie processes from telegram_main/discord-bot (legacy, should be zero)
ps aux | grep "[d]iscord-bot/agents" | grep -v node_modules 2>&1

# 1d. Agent bot logs (last 5 lines each)
for agent in athena hermes atlas apollo argus; do
  echo "=== $agent ==="
  tail -5 /home/pseudo/nanoclaw/agents/logs/$agent.log 2>/dev/null || echo "(no log)"
done

# 1e. Iris/NanoClaw Discord connection status
grep -i "Discord bot connected\|Discord bot stopped\|Discord client error" /home/pseudo/nanoclaw/logs/nanoclaw.log | tail -5

# 1f. Check for recent Discord messages being received
grep -i "Discord message stored\|unregistered Discord" /home/pseudo/nanoclaw/logs/nanoclaw.log | tail -5
```

## Step 2: Diagnose and fix

Apply fixes based on findings:

### Stuck containers (running > 3 minutes)
```bash
# Kill specific container
docker rm -f <container-name>
# Or kill all stuck nanoclaw containers
docker ps --filter "name=nanoclaw-" -q | xargs -r docker rm -f
```

### Duplicate agent processes
Each agent should have ONE process tree: `npm exec` -> `sh -c tsx` -> `node tsx` -> `node agent.ts`
If there are duplicates from different start times:
```bash
# Find the current batch start time (most recent)
ps aux | grep "/home/pseudo/nanoclaw/agents/.*\.ts" | grep -v grep | awk '{print $9}' | sort | uniq -c | sort -rn | head -1
# Kill processes NOT from the current batch
ps aux | grep "/home/pseudo/nanoclaw/agents/.*\.ts" | grep -v grep | grep -v "<current_time>" | awk '{print $2}' | xargs -r kill -9
```

### Legacy zombie processes (from telegram_main/discord-bot/)
These are old bot processes that should have been stopped. Kill them all:
```bash
ps aux | grep "[d]iscord-bot/agents" | grep -v node_modules | awk '{print $2}' | xargs -r kill
```

### Iris not receiving Discord messages
If grep shows zero "Discord message stored" entries recently, the WebSocket is silently dead:
```bash
systemctl --user restart nanoclaw
```

### Full restart (nuclear option)
If multiple issues found, do a clean restart of everything:
```bash
# Kill ALL agent-related processes
pkill -f "/home/pseudo/nanoclaw/agents/.*\.ts" 2>/dev/null
pkill -f "discord-bot/agents" 2>/dev/null
# Kill all stuck containers
docker ps --filter "name=nanoclaw-" -q | xargs -r docker rm -f
# Wait for processes to die
sleep 2
# Restart agents
/home/pseudo/nanoclaw/agents/start-all.sh start
# Restart Iris/NanoClaw
systemctl --user restart nanoclaw
```

## Step 3: Verify

```bash
# Verify clean state
echo "=== Containers (should be empty) ==="
docker ps --filter "name=nanoclaw-" --format "{{.Names}}\t{{.Status}}"

echo "=== Agent processes (should show exactly 6 npm exec processes, all same start time) ==="
/home/pseudo/nanoclaw/agents/start-all.sh status

echo "=== NanoClaw service ==="
systemctl --user status nanoclaw --no-pager | head -5

echo "=== Discord connected ==="
grep "Discord bot connected" /home/pseudo/nanoclaw/logs/nanoclaw.log | tail -1
```

## Common root causes

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| Multiple containers for same agent | Duplicate bot processes (old + new) sharing same Discord token | Kill old processes, restart agents |
| Container running > 3 min, has output | Claude process inside didn't exit after returning result; idle timeout hasn't fired yet | `docker rm -f <container>` |
| Bot connected but no messages logged | Discord WebSocket silently died | `systemctl --user restart nanoclaw` |
| Agent ignores new messages | `activeChannels` lock held by stuck container run | Kill the container to unblock |
| Orphan processes after restart | `start-all.sh stop` didn't kill full process tree | Use `pkill -f` or process group kill |
