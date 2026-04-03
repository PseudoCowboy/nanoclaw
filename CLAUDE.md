# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process with skill-based channel system. Channels (WhatsApp, Telegram, Slack, Discord, Gmail) are skills that self-register at startup. Messages route to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/registry.ts` | Channel registry (self-registration at startup) |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/agent-browser/SKILL.md` | Browser automation tool (available to all agents via Bash) |
| `container/skills/codex/SKILL.md` | Codex CLI coding tool (requires copilot-api-responses on host:4142) |
| `container/skills/gemini/SKILL.md` | Gemini CLI coding tool (uses Google OAuth, creds mounted from host) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/search-logs` | Search and analyze service logs — find errors, patterns, events |
| `/nanoclaw-logs` | Diagnose NanoClaw failures (messages, containers, IPC) |
| `/update-nanoclaw` | Bring upstream NanoClaw updates into a customized install |
| `/qodo-pr-resolver` | Fetch and fix Qodo PR review issues interactively or in batch |
| `/get-qodo-rules` | Load org- and repo-level coding rules from Qodo before code tasks |

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management:
```bash
# macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # restart

# Linux (systemd)
systemctl --user start nanoclaw
systemctl --user stop nanoclaw
systemctl --user restart nanoclaw
```

## Troubleshooting

**WhatsApp not connecting after upgrade:** WhatsApp is now a separate skill, not bundled in core. Run `/add-whatsapp` (or `npx tsx scripts/apply-skill.ts .claude/skills/add-whatsapp && npm run build`) to install it. Existing auth credentials and groups are preserved.

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.

## AI Tools in Containers — How They Connect

Container agents have access to three external AI tools (Claude Code, Codex, Gemini). Each authenticates differently. Two separate GitHub Copilot proxy services run on the host because Claude and Codex need different API formats.

### Architecture Overview

```
Container (Docker)                              Host VM
┌──────────────────────────────────┐           ┌─────────────────────────────────────┐
│                                  │           │                                     │
│  Claude Agent SDK                │           │  copilot-api (original)             │
│  ANTHROPIC_API_KEY=dummy         ├──────────→│  copilot-api@0.7.0                  │
│  ANTHROPIC_BASE_URL=             │  :4141    │  /v1/chat/completions ✅             │
│    http://172.18.0.1:4141        │           │  /v1/responses ❌                    │
│  (secrets via stdin, not env)    │           │  systemd: copilot-api.service       │
│                                  │           │                                     │
│  Codex CLI                       │           │  copilot-api-responses              │
│  ~/.codex/config.toml            ├──────────→│  @jeffreycao/copilot-api            │
│    base_url=http://              │  :4142    │  /v1/responses ✅                    │
│    host.docker.internal:4142/v1  │           │  /v1/chat/completions ✅             │
│  COPILOT_API_KEY=dummy (ENV)     │           │  systemd: copilot-api-responses     │
│                                  │           │                                     │
│  Gemini CLI                      │           │  (no proxy — direct Google API)     │
│  ~/.gemini/ (mounted read-only   ├──────────→│  Google OAuth credentials           │
│    from host ~/.gemini/)         │  HTTPS    │  ~/.gemini/oauth_creds.json         │
│  gemini -p "prompt"              │           │                                     │
│                                  │           │                                     │
└──────────────────────────────────┘           └─────────────────────────────────────┘
```

### Claude Code (Agent SDK) — Port 4141

- **Protocol**: Chat Completions API (`/v1/chat/completions`)
- **Host proxy**: `copilot-api@0.7.0` (`systemctl --user status copilot-api`)
- **Auth delivery**: `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` passed via stdin JSON to the container process, injected into the SDK's `env` parameter — never written to disk or `process.env`
- **Security**: A `PreToolUse` hook strips `ANTHROPIC_API_KEY` from every Bash subprocess so tools like Codex/Gemini can't see it
- **Container config**: No config files needed — all via environment variables in stdin

### Codex CLI — Port 4142

- **Protocol**: Responses API (`/v1/responses`) — required by Codex, not supported by the original copilot-api
- **Host proxy**: `@jeffreycao/copilot-api` fork (`systemctl --user status copilot-api-responses`)
- **Why a separate proxy**: The original `copilot-api@0.7.0` only supports Chat Completions. Codex requires the Responses API format, which only the `@jeffreycao/copilot-api` fork implements
- **Auth delivery**: `COPILOT_API_KEY=dummy` baked into the Dockerfile as ENV. Real GitHub auth handled by the proxy
- **Container config**: Baked into container at `/home/node/.codex/config.toml` pointing to `host.docker.internal:4142`

### Gemini CLI — Direct Google API

- **Protocol**: Direct HTTPS to Google's API (no proxy needed)
- **Auth**: Google OAuth credentials mounted read-only from host `~/.gemini/` to container `/home/node/.gemini/`
- **Mount**: Added by `container-runner.ts` — `buildVolumeMounts()` mounts `~/.gemini/` if it exists
- **No API key**: Uses OAuth tokens in `oauth_creds.json`, auto-refreshed by the Gemini CLI

### Host Services (systemd)

| Service | Port | Package | Purpose | Check |
|---------|------|---------|---------|-------|
| `copilot-api` | 4141 | `copilot-api@0.7.0` | Chat Completions for Claude Code | `curl localhost:4141/v1/models` |
| `copilot-api-responses` | 4142 | `@jeffreycao/copilot-api` | Responses API for Codex | `curl localhost:4142/v1/models` |
| `nanoclaw` | — | NanoClaw | Main process | `systemctl --user status nanoclaw` |

### Boot Status Check

`scripts/check-copilot-credentials.sh` runs on boot (via `copilot-check.timer`) and every 6 hours. Checks:
1. **Copilot API (4141)** — models endpoint + test completion
2. **Copilot Responses (4142)** — models endpoint + test Responses API call
3. **Gemini CLI** — `gemini -p "hi"` with JSON output

Sends Telegram notification with per-service status.

### Credential Renewal

| Tool | When to renew | How |
|------|--------------|-----|
| Copilot API (4141) | GitHub token expires | `copilot-api auth` on host |
| Copilot Responses (4142) | GitHub token expires | `copilot-api-responses auth` on host |
| Gemini CLI | Google OAuth expires | Run `gemini` interactively on host, re-auth with Google |

## Plan Persistence

When creating a multi-step implementation plan, **always save the plan to `docs/plans/`** before starting execution. This ensures the plan survives session clears and can be continued later.

- Save as: `docs/plans/{descriptive-name}.md`
- Include: context, phases, steps, file summary, verification checklist
- Reference the plan file at the top of each batch so context is recoverable
- When resuming a session, check `docs/plans/` and `OPTIMIZATION.md` for in-progress work

## Logs

All service logs are centralized in `logs/`. Use `/search-logs` to find things. Log rotation runs via `scripts/rotate-logs.sh` (called by daily checkpoint, or run manually).
