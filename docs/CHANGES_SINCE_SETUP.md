# NanoClaw: Complete Change Log Since Initial Setup

**Initial Commit:** 2026-01-31 (`c17823a`) — "Initial commit: NanoClaw - Personal Claude assistant via WhatsApp"
**Current State:** 2026-03-17 — 369 total commits, version 1.2.6
**Repository:** `https://github.com/qwibitai/nanoclaw.git` (origin = upstream, fork-based workflow)

---

## Table of Contents

1. [Architecture Evolution](#1-architecture-evolution)
2. [Core Source Code Changes](#2-core-source-code-changes)
3. [Container System](#3-container-system)
4. [Channel System](#4-channel-system)
5. [Skills System](#5-skills-system)
6. [Agent System (Discord Bots)](#6-agent-system-discord-bots)
7. [System-Level Changes (Host VM)](#7-system-level-changes-host-vm)
8. [Database & Storage](#8-database--storage)
9. [Security Hardening](#9-security-hardening)
10. [Documentation & Tooling](#10-documentation--tooling)
11. [Group Configurations](#11-group-configurations)
12. [Design Documents & Plans](#12-design-documents--plans)
13. [File Inventory](#13-file-inventory)
14. [Disk Usage](#14-disk-usage)
15. [Refactoring Recommendations](#15-refactoring-recommendations)

---

## 1. Architecture Evolution

### Phase 1: Monolith (Jan 31)
- Single `src/index.ts` with WhatsApp-only, direct Claude API calls
- No containerization, no message queuing
- `.env`-based secrets, macOS-centric (launchd)

### Phase 2: Containerized Agent (Jan 31 – Feb 1)
- Added Apple Container runtime for agent isolation
- Extracted `db.ts`, `config.ts`, `types.ts` from monolithic index
- Added built-in task scheduler with cron support
- Added IPC system for container ↔ host communication
- Added mount security allowlist

### Phase 3: Multi-Channel + Docker Migration (Feb 2 – Feb 19)
- Migrated container runtime from Apple Container to Docker
- Added channel abstraction: WhatsApp → plugin, Telegram/Discord/Slack/Gmail as skills
- Built skills engine for structured code modifications (add/modify/manifest)
- Added per-group message queues with SQLite-backed state
- Added typing indicators, sender allowlist, bot message tracking

### Phase 4: Branch-Based Skills + Multi-Channel Registry (Feb 19 – Mar 4)
- Replaced skills engine marketplace with branch-based skills
- Implemented multi-channel architecture with `src/channels/registry.ts`
- Channels as self-registering modules at startup
- Added channel forks workflow (each channel = separate fork repo)

### Phase 5: AI Tool Integration + Custom Agents (Mar 6 – Mar 17)
- Added Codex CLI and Gemini CLI as tools inside containers
- Set up dual copilot-api proxy system (ports 4141 + 4142)
- Created copilot-stealth-patch for header spoofing
- Added 5-agent Discord bot system (Athena, Hermes, Atlas, Apollo, Argus)
- Planning discussion system with multi-AI debate

---

## 2. Core Source Code Changes

### `src/index.ts` (620 lines)
**Path:** `/home/pseudo/nanoclaw/src/index.ts`
- **Original:** Monolithic WhatsApp handler + Claude API invocation
- **Now:** Orchestrator — state management, message loop, channel registry, agent invocation
- Major refactors: per-group queue (#111, #156), multi-channel (#500), idle preemption, graceful shutdown

### `src/container-runner.ts` (727 lines)
**Path:** `/home/pseudo/nanoclaw/src/container-runner.ts`
- Spawns Docker containers with volume mounts
- Builds volume mounts (group workspace, global workspace, skills, extra mounts, ~/.gemini)
- Passes secrets via stdin JSON (never env vars)
- Container lifecycle management (start, stop, idle preemption)
- `PreToolUse` hook strips `ANTHROPIC_API_KEY` from Bash subprocesses

### `src/container-runtime.ts` (87 lines)
**Path:** `/home/pseudo/nanoclaw/src/container-runtime.ts`
- Abstraction layer for container runtime (Docker vs Apple Container)
- Runtime-specific commands: build, run, stop, remove

### `src/db.ts` (691 lines)
**Path:** `/home/pseudo/nanoclaw/src/db.ts`
- SQLite operations via `better-sqlite3`
- Tables: messages, groups, scheduled_tasks, agent_state
- Bounded queries with LIMIT (#692)
- Migration support

### `src/ipc.ts` (449 lines)
**Path:** `/home/pseudo/nanoclaw/src/ipc.ts`
- File-based IPC: container writes JSON files, host watches
- Commands: `send_message`, `send_document`, `schedule_task`, `update_task`, `register_group`
- Per-group namespace security

### `src/group-queue.ts` (365 lines)
**Path:** `/home/pseudo/nanoclaw/src/group-queue.ts`
- Per-group message queuing with SQLite state persistence
- Prevents message loss on agent failure
- Cursor-based message advancement (only on success)

### `src/task-scheduler.ts` (281 lines)
**Path:** `/home/pseudo/nanoclaw/src/task-scheduler.ts`
- Cron-based scheduled tasks
- Atomic claim mechanism prevents double-execution (#657)
- `update_task` tool for modifying scheduled tasks
- Group-scoped task isolation

### `src/mount-security.ts` (419 lines)
**Path:** `/home/pseudo/nanoclaw/src/mount-security.ts`
- Mount allowlist enforcement for container volume binds
- Path traversal prevention
- Symlink escape protection

### `src/channels/registry.ts` (29 lines)
**Path:** `/home/pseudo/nanoclaw/src/channels/registry.ts`
- Channel self-registration system
- Channels register via `registerChannel()` at startup

### `src/channels/telegram.ts` (312 lines)
**Path:** `/home/pseudo/nanoclaw/src/channels/telegram.ts`
- Telegram channel implementation using `grammy` library
- Message routing, typing indicators, document sending

### `src/channels/index.ts` (13 lines)
**Path:** `/home/pseudo/nanoclaw/src/channels/index.ts`
- Channel barrel export

### `src/router.ts` (45 lines)
**Path:** `/home/pseudo/nanoclaw/src/router.ts`
- Outbound message routing to correct channel
- Message formatting

### `src/config.ts` (69 lines)
**Path:** `/home/pseudo/nanoclaw/src/config.ts`
- Trigger patterns, paths, polling intervals
- Environment-based configuration

### `src/types.ts` (109 lines)
**Path:** `/home/pseudo/nanoclaw/src/types.ts`
- TypeScript interfaces: Message, Group, Channel, ScheduledTask, AgentState

### `src/env.ts` (42 lines)
**Path:** `/home/pseudo/nanoclaw/src/env.ts`
- Environment variable loading and validation

### `src/logger.ts` (16 lines)
**Path:** `/home/pseudo/nanoclaw/src/logger.ts`
- Shared pino logger instance

### `src/sender-allowlist.ts` (128 lines)
**Path:** `/home/pseudo/nanoclaw/src/sender-allowlist.ts`
- Per-chat access control via sender allowlist (#705)

### `src/group-folder.ts` (44 lines)
**Path:** `/home/pseudo/nanoclaw/src/group-folder.ts`
- Group folder path resolution with escape prevention

### Test Files
| Path | Lines | Purpose |
|------|-------|---------|
| `src/db.test.ts` | 426 | Database operation tests |
| `src/container-runner.test.ts` | 209 | Container runner tests |
| `src/container-runtime.test.ts` | 149 | Runtime abstraction tests |
| `src/group-queue.test.ts` | 484 | Message queue tests |
| `src/task-scheduler.test.ts` | 129 | Task scheduler tests |
| `src/ipc-auth.test.ts` | 679 | IPC security tests |
| `src/routing.test.ts` | 170 | Message routing tests |
| `src/formatting.test.ts` | 237 | Message formatting tests |
| `src/sender-allowlist.test.ts` | 216 | Allowlist tests |
| `src/group-folder.test.ts` | 43 | Group folder tests |
| `src/channels/registry.test.ts` | 42 | Channel registry tests |
| `src/channels/telegram.test.ts` | 933 | Telegram channel tests |

---

## 3. Container System

### Docker Container (`container/`)

**`container/Dockerfile`** (80 lines)
- Base: `node:22-slim`
- Installs: Chromium, CJK fonts, emoji fonts, git, curl
- Global tools: `agent-browser`, `@anthropic-ai/claude-code`, `@openai/codex`, `@google/gemini-cli`
- Baked Codex config pointing to `host.docker.internal:4142`
- Entrypoint: compiles TypeScript, reads JSON from stdin, runs agent

**`container/build.sh`** (23 lines)
- Docker build with BuildKit

**`container/agent-runner/`** — Agent process inside container
- `src/index.ts` (638 lines) — Claude Agent SDK invocation, tool handling, structured output
- `src/ipc-mcp-stdio.ts` (348 lines) — MCP-over-stdio IPC bridge
- `package.json` — Dependencies: `@anthropic-ai/claude-code`, `claude-agent-sdk`

**`container/skills/`** — Skills available to container agents
| Skill | Path | Purpose |
|-------|------|---------|
| `agent-browser/SKILL.md` | 159 lines | Web browser automation (Chromium) |
| `codex/SKILL.md` | 136 lines | Codex CLI coding tool |
| `gemini/SKILL.md` | 159 lines | Gemini CLI coding tool |
| `git-workflow/SKILL.md` | 107 lines | Git workflow patterns |
| `sysadmin/SKILL.md` | 140 lines | System administration |
| `web-search/SKILL.md` | 72 lines | Web search capabilities |

**Docker Image:** `nanoclaw-agent:latest` — 3.78GB (989MB compressed)

---

## 4. Channel System

### Active Channels
| Channel | Status | Implementation |
|---------|--------|---------------|
| **Telegram** | Active (main) | `src/channels/telegram.ts` — grammy library |
| **WhatsApp** | Available as skill | `.claude/skills/add-whatsapp/` |
| **Discord** | Available as skill | `.claude/skills/add-discord/` |
| **Slack** | Available as skill | `.claude/skills/add-slack/` |
| **Gmail** | Available as skill | `.claude/skills/add-gmail/` |

### Channel Architecture
- Channels self-register at startup via `src/channels/registry.ts`
- Each channel implements: `onMessage`, `sendMessage`, `sendDocument`, `sendTyping`
- WhatsApp was moved from built-in to skill in the multi-channel refactor

---

## 5. Skills System

### Skill Architecture (evolved through 3 phases)
1. **Phase 1:** Built-in skills with SKILL.md instructions
2. **Phase 2:** Skills engine with structured apply/modify/manifest system
3. **Phase 3:** Branch-based skills (current) — each skill is a git branch

### Installed Skills (`.claude/skills/`)
| Skill | Path | Type |
|-------|------|------|
| `add-discord` | `.claude/skills/add-discord/` | Channel |
| `add-gmail` | `.claude/skills/add-gmail/` | Channel |
| `add-ollama-tool` | `.claude/skills/add-ollama-tool/` | Tool |
| `add-parallel` | `.claude/skills/add-parallel/` | Integration |
| `add-slack` | `.claude/skills/add-slack/` | Channel |
| `add-telegram` | `.claude/skills/add-telegram/` | Channel |
| `add-telegram-swarm` | `.claude/skills/add-telegram-swarm/` | Feature |
| `add-voice-transcription` | `.claude/skills/add-voice-transcription/` | Feature |
| `add-whatsapp` | `.claude/skills/add-whatsapp/` | Channel |
| `convert-to-apple-container` | `.claude/skills/convert-to-apple-container/` | Runtime |
| `customize` | `.claude/skills/customize/` | Meta |
| `debug` | `.claude/skills/debug/` | Utility |
| `get-qodo-rules` | `.claude/skills/get-qodo-rules/` | CI/CD |
| `nanoclaw-logs` | `.claude/skills/nanoclaw-logs/` | Utility |
| `qodo-pr-resolver` | `.claude/skills/qodo-pr-resolver/` | CI/CD |
| `setup` | `.claude/skills/setup/` | Setup |
| `update-nanoclaw` | `.claude/skills/update-nanoclaw/` | Update |
| `use-local-whisper` | `.claude/skills/use-local-whisper/` | Feature |
| `x-integration` | `.claude/skills/x-integration/` | Channel |

### Skills Engine (legacy, still in repo)
**Path:** `skills-engine/` (20 files, ~3000+ lines)
- `apply.ts`, `backup.ts`, `constants.ts`, `customize.ts`, `file-ops.ts`
- `fs-utils.ts`, `index.ts`, `init.ts`, `lock.ts`, `manifest.ts`
- `merge.ts`, `migrate.ts`, `path-remap.ts`, `rebase.ts`, `replay.ts`
- `state.ts`, `structured.ts`, `types.ts`, `uninstall.ts`
- Plus 14 test files in `__tests__/`
- **Note:** This was superseded by branch-based skills but code remains in repo

---

## 6. Agent System (Discord Bots)

### Path: `agents/`

Five-agent system with role-based specialization:

| Agent | AI Tool | Role | Channels |
|-------|---------|------|----------|
| **Athena** 🟣 | Codex | Plan Designer | control-room, plan-room |
| **Hermes** 🟢 | Claude | Planning Collaborator | plan-room |
| **Atlas** 🔴 | Claude | Backend Engineer | ws-backend |
| **Apollo** 🔵 | Gemini | Frontend Engineer | ws-frontend |
| **Argus** 🟠 | Claude | Monitor & Reviewer | ws-qa, control-room, all ws-* channels |

### Files
- `agents/config.json` — Agent roster and channel assignments
- `agents/shared/agent-runner.ts` — Shared agent bot logic
- `agents/start-all.sh` — Agent lifecycle management script

### Related Files in `groups/telegram_main/`
- `discord-bot-config.json` — Discord bot configuration
- `discord-bot-autostart.sh`, `discord-bot-monitor.sh`, `discord-bot-setup.sh`, `discord-bot-startup.sh`
- `iris-discord-bot.service` — systemd service file
- `discord-orchestration-setup.js`, `enhanced-orchestration-commands.js`
- `agent-credentials.js` — Agent credential management
- `AgentOrchestration.md` — Orchestration documentation

---

## 7. System-Level Changes (Host VM)

### systemd User Services

| Service | Path | Purpose | Status |
|---------|------|---------|--------|
| `nanoclaw.service` | `~/.config/systemd/user/` | Main NanoClaw process | enabled |
| `copilot-api.service` | `~/.config/systemd/user/` | GitHub Copilot proxy (port 4141) for Claude Code | enabled |
| `copilot-api-responses.service` | `~/.config/systemd/user/` | Copilot Responses API fork (port 4142) for Codex | enabled |
| `copilot-check.service` | `~/.config/systemd/user/` | Credential validation + Telegram notification | static |
| `copilot-check.timer` | `~/.config/systemd/user/` | Every 6 hours + 60s after boot | enabled |
| `copilot-patch.service` | `~/.config/systemd/user/` | Re-apply copilot proxy patches | static |
| `copilot-patch.timer` | `~/.config/systemd/user/` | Every 6 hours + 30s after boot | enabled |
| `nanoclaw-checkpoint.service` | `~/.config/systemd/user/` | Daily backup at 03:00 UTC | static |
| `nanoclaw-checkpoint.timer` | `~/.config/systemd/user/` | Daily at 03:00 UTC | enabled |

### Global NPM Packages
| Package | Version | Purpose |
|---------|---------|---------|
| `copilot-api` | 0.7.0 | GitHub Copilot → OpenAI Chat Completions proxy (port 4141) |
| `@jeffreycao/copilot-api` | (fork) | Copilot → Responses API proxy (port 4142, installed at `/opt/copilot-api-responses/`) |
| `@google/gemini-cli` | 0.32.1 | Google Gemini CLI |

### Host Scripts
| Script | Path | Purpose |
|--------|------|---------|
| `check-copilot-credentials.sh` | `~/` | Validates all 3 AI tool credentials, sends Telegram notifications |
| `reapply-copilot-patches.sh` | `.work-sessions/2026-03-11/copilot-proxy-fix/` | Re-patches copilot-api headers |
| `patch_copilot_proxies.py` | `.work-sessions/2026-03-11/copilot-proxy-fix/` | Python patcher for copilot proxy JS |
| `copilot_stealth_patch.py` | `~/copilot-stealth-patch/` | Header spoofing patch (vscode-machineid, sessionid, org) |
| `checkpoint.sh` | `scripts/` | Daily backup script |
| `rollback.sh` | `scripts/` | Rollback to previous checkpoint |
| `setup-codex-from-backup.sh` | `scripts/` | Restore Codex config from backup |

### Host Log Files
| File | Path |
|------|------|
| `nanoclaw.log` | `logs/nanoclaw.log` |
| `nanoclaw.error.log` | `logs/nanoclaw.error.log` |
| `checkpoint.log` | `logs/checkpoint.log` |
| `copilot-api.log` | `~/copilot-api.log` |
| `copilot-api.error.log` | `~/copilot-api.error.log` |
| `copilot-api-responses.log` | `~/copilot-api-responses.log` |
| `copilot-api-responses.error.log` | `~/copilot-api-responses.error.log` |

### Network Architecture
```
Container (Docker)                              Host VM
┌──────────────────────────────────┐           ┌─────────────────────────────────────┐
│  Claude Agent SDK ──────────────────────────→│  copilot-api (port 4141)            │
│  Codex CLI ─────────────────────────────────→│  copilot-api-responses (port 4142)  │
│  Gemini CLI ────────────────────────────────→│  Direct Google API (HTTPS)          │
│                                  │           │  ~/.gemini/ mounted read-only       │
└──────────────────────────────────┘           └─────────────────────────────────────┘
```

---

## 8. Database & Storage

### SQLite Database
**Path:** `store/messages.db` (152KB)
- Tables: messages, groups, scheduled_tasks, agent_state
- Bounded queries with LIMIT to prevent memory issues

### Backup System
**Path:** `backups/` (916MB total)
- Daily checkpoint tar.gz archives (7 days shown)
- Format: `checkpoint_YYYYMMDD_HHMMSS.tar.gz`
- Triggered by `nanoclaw-checkpoint.timer` at 03:00 UTC

### Group Data
- `groups/main/` — WhatsApp main group (original)
- `groups/telegram_main/` — Telegram main group (2.2GB with migration backups)
- `groups/global/` — Shared global context
- `groups/discord_iris-bot/` — Discord Iris bot group

---

## 9. Security Hardening

### Changes Made (chronological)
1. **dotenv exposure fix** — Only expose auth vars to containers, not full `.env`
2. **IPC namespace security** — Per-group IPC namespaces prevent privilege escalation
3. **Sensitive log scrubbing** — Remove message content from info-level logs
4. **Home directory fix** — Replace hardcoded paths with `os.homedir()`
5. **Container env isolation** — Secrets via stdin JSON, never env vars (#798)
6. **PreToolUse hook** — Strip `ANTHROPIC_API_KEY` from Bash subprocesses (#171)
7. **Mount security allowlist** — Path traversal and symlink escape protection (#14)
8. **Skills path-remap security** — Block root escape including symlinks (#367)
9. **Group folder escape prevention** — Block path traversal in group folders (#387)
10. **Read-only project mount** — Container gets read-only access to project root (#392)
11. **Command injection prevention** — Sanitize PID check in setup verify
12. **Sender allowlist** — Per-chat access control (#705)
13. **Credential proxy** — Enhanced container environment isolation (#798)

---

## 10. Documentation & Tooling

### Documentation Files
| File | Path | Purpose |
|------|------|---------|
| `README.md` | Root | Main documentation (rewritten multiple times) |
| `README_zh.md` | Root | Chinese README |
| `CLAUDE.md` | Root | AI assistant context |
| `CHANGELOG.md` | Root | Version changelog |
| `CONTRIBUTING.md` | Root | Contribution guidelines |
| `CONTRIBUTORS.md` | Root | Contributor list |
| `docs/REQUIREMENTS.md` | `docs/` | Architecture decisions |
| `docs/SPEC.md` | `docs/` | Full specification |
| `docs/SECURITY.md` | `docs/` | Security documentation |
| `docs/SDK_DEEP_DIVE.md` | `docs/` | Claude Agent SDK deep dive |
| `docs/DEBUG_CHECKLIST.md` | `docs/` | Debugging guide |
| `docs/APPLE-CONTAINER-NETWORKING.md` | `docs/` | Apple Container networking |
| `docs/nanoclaw-architecture-final.md` | `docs/` | Architecture overview |
| `docs/nanorepo-architecture.md` | `docs/` | Nanorepo architecture |

### CI/CD Workflows (`.github/workflows/`)
| Workflow | Purpose |
|----------|---------|
| `ci.yml` | Build + test |
| `bump-version.yml` | Auto version bumping |
| `skill-drift.yml` | Detect skill modify/ file drift |
| `skill-pr.yml` | Skill PR checks |
| `update-tokens.yml` | Token count badge update |

### Development Tooling
| Tool | Config |
|------|--------|
| TypeScript | `tsconfig.json` |
| Vitest | `vitest.config.ts` |
| Prettier | `.prettierrc` |
| Husky | `.husky/pre-commit` |
| Node version | `.nvmrc` (Node 22) |
| ESM | `"type": "module"` in package.json |

### Scripts (`scripts/`)
| Script | Purpose |
|--------|---------|
| `apply-skill.ts` | Apply a skill from branch |
| `checkpoint.sh` | Daily backup |
| `rollback.sh` | Rollback to checkpoint |
| `fix-skill-drift.ts` | Fix drifted skill modify files |
| `rebase.ts` | Rebase helper |
| `run-migrations.ts` | Database migrations |
| `setup-codex-from-backup.sh` | Codex config restore |
| `uninstall-skill.ts` | Remove a skill |
| `validate-all-skills.ts` | Validate all skills |

---

## 11. Group Configurations

### `groups/main/CLAUDE.md` — WhatsApp main group
- Agent name: "Andy"
- Full capabilities: web browsing, file ops, scheduling, send_message, send_document
- Internal thoughts via `<internal>` tags
- WhatsApp-specific formatting rules

### `groups/global/CLAUDE.md` — Shared across all groups
- Agent name: "Andy"
- Workspace backup rules (`/workspace/group/` only)
- Memory system with `conversations/` folder
- Messaging formatting (no markdown, WhatsApp/Telegram style)

### `groups/telegram_main/CLAUDE.md` — Telegram main group
- Agent name: "Iris"
- Extended capabilities: code editing, project creation
- Home directory access
- Token report system, usage reports
- Discord bot orchestration

### `groups/telegram_main/` Data
- `migration-backups/` — 2 migration backup sets (2.6MB)
- `usage-reports/` — Daily usage analysis reports
- `daily-reports/` — Daily status reports
- `conversations/` — Conversation history
- `discord-bot/` — Agent bot system
- `outbox/` — Files pending delivery
- Various shell scripts for monitoring and reporting

---

## 12. Design Documents & Plans

### `docs/plans/`
| Document | Date | Topic |
|----------|------|-------|
| `2026-03-11-financial-data-collection-design.md` | 2026-03-11 | Financial data collection system |
| `2026-03-17-planning-discussion-system-design.md` | 2026-03-17 | Multi-agent planning debate system |
| `2026-03-17-planning-discussion-system.md` | 2026-03-17 | Implementation plan (1342 lines) |

### `plan/`
| Document | Topic |
|----------|-------|
| `STOCK_PLAN.md` | Stock/financial data plan |
| `vm-auth-bridge-design.md` | VM authentication bridge design |
| `vm-auth-bridge-design.improved.md` | Improved version |
| `vm-auth-bridge-implementation-plan.md` | Implementation plan |
| `vm-auth-bridge-implementation-plan.improved.md` | Improved version |

---

## 13. File Inventory

### Source Code (by directory)
| Directory | Files | Total Lines |
|-----------|-------|-------------|
| `src/` | 24 (12 source + 12 test) | ~6,500 |
| `container/agent-runner/src/` | 2 | ~986 |
| `container/skills/` | 6 SKILL.md files | ~773 |
| `setup/` | 10 (5 source + 3 test + 2 other) | ~1,900 |
| `skills-engine/` | 34 (20 source + 14 test) | ~5,500 |
| `scripts/` | 9 | ~1,100 |
| `.claude/skills/` | 19 skills (~90 files) | ~15,000+ |

### Configuration Files
| File | Path |
|------|------|
| `package.json` | Root |
| `tsconfig.json` | Root |
| `vitest.config.ts` | Root |
| `.prettierrc` | Root |
| `.nvmrc` | Root |
| `.gitignore` | Root |
| `.env.example` | Root |
| `.mcp.json` | Root |
| `.claude/settings.local.json` | Root |
| `.husky/pre-commit` | Root |
| `config-examples/mount-allowlist.json` | Root |

---

## 14. Disk Usage

| Path | Size | Notes |
|------|------|-------|
| `groups/telegram_main/` | 2.2 GB | Includes migration backups, workspace data |
| `backups/` | 916 MB | 7 daily checkpoint archives |
| `store/messages.db` | 152 KB | SQLite database |
| `logs/` | 172 KB | Application logs |
| Docker image | 3.78 GB | `nanoclaw-agent:latest` |
| `groups/telegram_main/migration-backups/` | 2.6 MB | 2 migration backup sets |

---

## 15. Refactoring Recommendations

### High Priority

1. **Remove dead skills-engine code** — The entire `skills-engine/` directory (34 files, ~5,500 lines) was superseded by branch-based skills. It's dead weight.

2. **Consolidate AI proxy architecture** — Running 2 separate copilot-api instances (4141, 4142) with a Python stealth-patcher running every 6 hours is fragile. Consider:
   - Single proxy that supports both Chat Completions and Responses API
   - Or containerize the proxies with proper credential management

3. **Clean up groups/telegram_main/** — 2.2GB of workspace data including migration backups, usage report scripts, discord bot code. This should be separated from the NanoClaw repo.

4. **Centralize host scripts** — Scripts are scattered across `~/`, `~/copilot-stealth-patch/`, `.work-sessions/`, `scripts/`. Consolidate to a single location.

5. **Reduce Docker image size** — 3.78GB is large. Consider multi-stage builds, or separate images for different tool combinations.

### Medium Priority

6. **Modularize `src/container-runner.ts`** (727 lines) — Split volume mount building, lifecycle management, and credential handling into separate modules.

7. **Modularize `src/db.ts`** (691 lines) — Split into domain-specific modules (messages, groups, tasks, state).

8. **Modularize `src/index.ts`** (620 lines) — Extract initialization, message processing, and agent invocation into separate modules.

9. **Clean up settings.local.json** — Contains 50+ one-off Bash permission rules accumulated over time. Consolidate into pattern-based rules.

10. **Standardize log locations** — Logs are in `logs/`, `~/copilot-api.log`, `~/copilot-api-responses.log`. Centralize to one directory.

### Low Priority

11. **Remove plan/ directory** — Design docs should be in `docs/plans/` or `docs/designs/`, not in a separate `plan/` folder.

12. **Clean up deprecated docs** — `REQUIREMENTS.md` was deleted from root but exists in `docs/`. Ensure no stale duplicates.

13. **Add dependency audit** — `grammy` is in main dependencies even when Telegram might not be the active channel. Consider making channel dependencies optional.

14. **Repo-tokens** — The `repo-tokens/` directory (GitHub Action for token counting) could be a separate repo.

15. **Backup strategy** — 916MB of backups growing daily. Add rotation or move to external storage.

16. **Test coverage** — Good test coverage for core modules, but no integration tests for the full message flow or container lifecycle.
