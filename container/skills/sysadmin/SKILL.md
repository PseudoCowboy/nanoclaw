---
name: sysadmin
description: Use for system administration tasks — managing Docker containers, monitoring services, analyzing logs, checking disk/memory/CPU, managing processes, and troubleshooting server issues.
allowed-tools: Bash(docker:*), Bash(systemctl:*), Bash(journalctl:*), Bash(ps:*), Bash(top:*), Bash(df:*), Bash(du:*), Bash(free:*), Bash(ss:*), Bash(tail:*), Bash(grep:*), Bash(awk:*)
---

# System Administration

Tools and patterns for managing the host system from inside the container.

## Service Management (systemd)

```bash
# NanoClaw service
systemctl --user status nanoclaw
systemctl --user restart nanoclaw
systemctl --user stop nanoclaw
journalctl --user -u nanoclaw --no-pager -n 50

# System services (may need host access)
systemctl status docker
systemctl list-units --failed
```

## Docker Management

```bash
# Running containers
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
docker ps -a    # include stopped

# Container operations
docker logs <container> --tail 50
docker logs <container> -f           # follow
docker exec <container> sh -c "command"
docker kill <container>
docker rm <container>

# Images
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"
docker image prune -f                # clean dangling images

# Disk usage
docker system df
docker system prune -f               # clean everything unused
```

## System Monitoring

### Disk
```bash
df -h                                # filesystem usage
du -sh /path/*                       # directory sizes
du -sh /home/pseudo/* | sort -rh | head -10  # largest dirs
```

### Memory
```bash
free -h                              # memory usage
```

### CPU & Processes
```bash
# Top processes by CPU
ps aux --sort=-%cpu | head -10

# Top processes by memory
ps aux --sort=-%mem | head -10

# Process tree
ps auxf | head -30
```

### Network
```bash
ss -tlnp                             # listening ports
ss -tnp                              # active connections
curl -s ifconfig.me                  # public IP
```

## Log Analysis

```bash
# NanoClaw logs
tail -f /workspace/project/logs/nanoclaw.log
tail -100 /workspace/project/logs/nanoclaw.log

# Filter logs
grep -i error /workspace/project/logs/nanoclaw.log | tail -20
grep -i "telegram\|agent" /workspace/project/logs/nanoclaw.log | tail -20

# Container agent logs
ls -lt /workspace/project/groups/*/logs/ | head -10
tail -50 /workspace/project/groups/telegram_main/logs/*.log

# System logs
journalctl --no-pager -n 50 -p err   # recent errors
journalctl --since "1 hour ago"
```

## NanoClaw-Specific Operations

### Checkpoint & Rollback
```bash
# Create manual checkpoint
bash /workspace/project/scripts/checkpoint.sh

# List available checkpoints
bash /workspace/project/scripts/rollback.sh

# Rollback to latest
bash /workspace/project/scripts/rollback.sh latest
```

### Container Agent Health
```bash
# Check running agent containers
docker ps --filter "name=nanoclaw"

# Kill stuck agent container
docker kill $(docker ps --filter "name=nanoclaw-telegram" -q)

# Check SQLite database
sqlite3 /workspace/project/store/messages.db "SELECT jid, name, folder FROM registered_groups"

# Check recent messages
sqlite3 /workspace/project/store/messages.db "SELECT datetime(timestamp/1000, 'unixepoch'), sender_name, substr(body, 1, 80) FROM messages ORDER BY timestamp DESC LIMIT 10"
```

## Troubleshooting Checklist

When something's not working:

1. **Service running?** `systemctl --user status nanoclaw`
2. **Container runtime?** `docker info >/dev/null && echo OK`
3. **Recent errors?** `grep -i error logs/nanoclaw.log | tail -10`
4. **Disk full?** `df -h /`
5. **Memory?** `free -h`
6. **Stuck containers?** `docker ps --filter "name=nanoclaw"`
7. **Env configured?** `cat /workspace/project/.env`
