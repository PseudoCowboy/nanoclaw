# Discord Bot Multi-Agent Workflow — Summary & Improvement Analysis
**Author:** Claude (Opus 4.6-1M)
**Date:** 2026-04-03

---

## 1. System Overview

NanoClaw's Discord integration is a **file-first, multi-agent orchestration system** that coordinates 5 AI agents through a single Discord bot (Iris). The architecture evolved from a legacy standalone bot.js into a channel skill that self-registers in NanoClaw's plugin system.

### Core Architecture
```
Discord Server (discord.js Gateway WebSocket)
    |
    v
DiscordChannel class (src/channels/discord.ts)
    |
    +-- !commands --> discord-commands.ts (instant, no container)
    |
    +-- @mentions --> Channel Registry --> Message Loop --> Container Agent (Claude SDK)
                                                               |
                                                               v
                                                         Response via DiscordChannel.sendMessage()
```

### The 5 Agents

| Agent | Role | AI Tool | Primary Function |
|-------|------|---------|------------------|
| **Hermes** | Planning Collaborator | Claude | Strategy, review, analysis, final authority |
| **Athena** | Plan Designer | Codex (GPT) | Architecture design, plan structure |
| **Atlas** | Backend Engineer | Claude | Backend implementation |
| **Apollo** | Frontend Engineer | Gemini | Frontend implementation |
| **Argus** | Monitor | Claude | Validation, alerts, PR review |

All agents run inside Docker containers via Claude Agent SDK. Each agent can delegate to its preferred AI tool (Codex, Gemini, Claude CLI) via bash inside the container.

---

## 2. Development History & Evolution

### Phase 1: Legacy Bot (Pre-March 2026)
- Standalone `bot.js` with basic agent commands
- 4 agents (Athena, Atlas, Apollo, Argus)
- Chat-only interaction, no file I/O

### Phase 2: NanoClaw Channel Integration (March 17, 2026)
- **Unified Iris Design:** Merged separate Telegram and Discord Iris instances into a single shared folder (`groups/iris/`), one container, shared memory across channels
- **Planning Discussion System:** Added Hermes (Claude) and Prometheus (Gemini) as planning agents alongside Athena. 3-round planning debates: Initial Proposals -> Refinement -> Convergence
- **Discord Orchestration Commands:** Created `discord-commands.ts` with 15+ `!` commands, self-contained command handler (no container needed)
- **Project channel structure:** `!create_project` creates categories with control-room, plan-room, backend-dev, frontend-ui, qa-alerts, release-log

### Phase 3: File-Based Discussions (March 18, 2026)
- **Major paradigm shift:** From chat-only debates to file-based collaboration
- Agents read/write shared markdown files in `groups/shared_project/`
- Git-initialized per-discussion folders with per-agent commits (`--author`)
- 3-round structure: Improve (agents <-> human) -> Disagree (agents debate each other) -> Resolve (human breaks ties)
- Watchdog monitors handoffs with 5-minute nudge timers

### Phase 4: File-First Workspace Rewrite (Late March 2026)
- **Simplified from 6 to 5 agents:** Prometheus was removed; planning reduced to Hermes + Athena (2-agent workflow)
- **4-step planning flow** replaced 3-round debates:
  1. Human Input (draft saved as plan.md)
  2. Hermes Reviews (asks questions, creates plan-v2.md)
  3. Athena Architects (edits plan-v2.md, refines)
  4. Hermes Finalizes (resolves disagreements with human)
- **Project workspace structure:**
  ```
  active/{project}/
  +-- control/          (plans, approvals)
  +-- coordination/     (progress, deps, status)
  +-- workstreams/      (per-stream scope + progress)
  +-- archive/          (completed work)
  ```
- `!decompose` command to break plans into work stream channels

### Phase 5: Work Stream Execution Monitoring (March 25, 2026)
- **Hermes decomposition step:** After planning, Hermes parses plan into per-stream `tasks.md` checklists
- **Stream watchers:** Per-stream polling (10 min interval) that:
  - Reports hourly status to control-room
  - Detects silence (1 hour) and nudges agents
  - Re-triggers agents when tasks.md updates
  - Detects completion (all tasks checked)
- **Workspace watchers:** File-system polling (30s) for progress.md, handoffs.md, coordination changes
- **Handoff system:** `!handoff from to "description"` for cross-team integration
- **Checkpoints:** `!checkpoint from to` to verify handoff completeness

---

## 3. Current Command Set (17+ commands)

### Project Lifecycle
| Command | Description |
|---------|-------------|
| `!create_project Name` | Creates workspace + category with 3 core channels |
| `!cleanup_server` | Removes all orchestration structures |

### Planning
| Command | Description |
|---------|-------------|
| `!plan topic` | Starts 4-step Hermes-Athena planning workflow |
| `!decompose [streams]` | Breaks plan into work stream channels |

### Work Streams
| Command | Description |
|---------|-------------|
| `!add_stream type` | Add backend/frontend/qa/design/devops/research stream |
| `!handoff from to "desc"` | Cross-team handoff |
| `!stream_status` | All work stream progress |

### Monitoring
| Command | Description |
|---------|-------------|
| `!agent_status` | Live agent dashboard |
| `!dashboard` | Project-wide status from coordination files |
| `!blocker "desc"` | Escalate blocker to control-room |

### Checkpoints
| Command | Description |
|---------|-------------|
| `!checkpoint from to` | Verify handoff completeness |
| `!checkpoints` | List all handoff statuses |

### Discussions
| Command | Description |
|---------|-------------|
| `!create_discussion "topic"` | File-based discussion with git |
| `!close_discussion` | Delete current discussion/planning channel |

---

## 4. Key Technical Details

### Message Flow
1. Discord `messageCreate` event fires
2. Skip own/bot messages
3. `!` commands intercepted first -> handled locally (no container)
4. Build JID as `dc:<channelId>`
5. Translate `<@botId>` mentions -> `@AssistantName` trigger
6. If registered channel -> deliver to message loop -> spawn container
7. Container response -> router finds Discord channel by JID -> `sendMessage()`

### State Management
- **In-process Maps:** `planningSessions`, `discussionSessions`, `activeProjects`, `activeStreamWatchers`, `activeWatchers`
- **Persistent:** `channel-project-map.json` (channel -> project slug mapping)
- **File-based:** All project state in `groups/shared_project/active/{project}/`

### Container Integration
- All agents run Claude Agent SDK in Docker containers
- Shared workspace mounted at `/workspace/shared/`
- Per-agent identity via `groups/dc_{name}/CLAUDE.md`
- Container skills: `discord-discussion`, `discord-project`, `discord-status`, `discord-workstream`, `discord-plan`

---

## 5. Improvement Recommendations

### Critical Issues

#### 5.1 Single Point of Failure: In-Memory State
**Problem:** All orchestration state (planning sessions, stream watchers, project state) is held in in-process `Map` objects. If NanoClaw restarts, ALL active sessions, watchers, and project state are lost.

**Recommendation:** Persist orchestration state to SQLite or JSON files:
- Save `activeProjects` state on every mutation
- Save `activeStreamWatchers` state, restore on startup
- Save `planningSessions` / `discussionSessions` state

#### 5.2 Massive Single File (3,221 lines)
**Problem:** `discord-commands.ts` is over 3,200 lines — planning, discussions, decomposition, watchers, checkpoints, handoffs, dashboards all in one file. Hard to maintain, test, and review.

**Recommendation:** Split into modules:
- `discord-commands/planning.ts` — plan, decompose
- `discord-commands/discussions.ts` — create/close discussion, watchdog
- `discord-commands/workstreams.ts` — streams, watchers, handoffs
- `discord-commands/monitoring.ts` — status, dashboard, blockers
- `discord-commands/checkpoints.ts` — checkpoint verification
- `discord-commands/index.ts` — command registry + handleCommand

#### 5.3 Agent Handoff Reliability
**Problem:** Agent handoffs rely on @mentions in Discord messages. If an agent's container crashes, times out, or produces a malformed response, the chain breaks silently. The 5-minute nudge timer helps but doesn't recover.

**Recommendation:**
- Implement explicit handoff acknowledgment (agent writes a `handoff.json` file)
- Add retry logic (if nudge doesn't work after 2 attempts, escalate to control-room)
- Track handoff state in files, not just Discord messages

### Moderate Issues

#### 5.4 Prometheus Removal is Incomplete
**Problem:** The original design had 3 planning agents (Athena, Hermes, Prometheus). Prometheus was removed from the active workflow (`PLANNING_AGENTS = ['Hermes', 'Athena']`), but the docs (discord-bot-summary.md) still reference Prometheus as "Planning Collaborator" with Gemini. The `AGENTS` array still shows 5 agents but the planning only uses 2.

**Recommendation:** Clean up all references to Prometheus, update docs, or formally decide whether Prometheus should be brought back for specific use cases (e.g., research/exploration tasks).

#### 5.5 Stream Watcher Polling is Coarse
**Problem:** 10-minute polling interval means there can be 10+ minutes between an agent completing a task and Iris re-triggering the next one. For active implementation sprints, this is slow.

**Recommendation:**
- Use `fs.watch()` or `chokidar` for immediate file-change detection instead of polling
- Fall back to polling as a safety net (e.g., 5-minute backup poll)
- Consider combining with Discord message detection for faster reaction

#### 5.6 No Error Recovery in Discussion Watchdog
**Problem:** The discussion watchdog monitors agent handoffs but has no sophisticated error recovery. If an agent writes a malformed file or fails to hand off correctly, the system just nudges repeatedly.

**Recommendation:**
- Parse agent output for known failure patterns
- Implement a "give up after N nudges" threshold
- Auto-close stale discussions after 24 hours of no progress

#### 5.7 Workspace Watcher (30s polling) is Resource-Intensive
**Problem:** Polling the filesystem every 30 seconds for every active project, checking multiple directories and files, is wasteful — especially when no work is happening.

**Recommendation:**
- Increase poll interval to 60-120s when no recent changes detected
- Use adaptive polling: 30s during active work, 5-min during quiet periods
- Consider `fs.watch()` for critical files

### Nice-to-Have Improvements

#### 5.8 No Task Priority / Dependency Graph
**Problem:** `tasks.md` is a flat checklist. Tasks have no priority ordering, dependencies, or estimates. Agents just pick "the first unchecked item."

**Recommendation:**
- Add `[P1]`, `[P2]` priority markers
- Add `[depends: task-N]` for task dependencies
- Let agents skip blocked tasks and pick the next available one

#### 5.9 No Cross-Stream Communication
**Problem:** Work streams are isolated. If Atlas in backend discovers the API contract needs to change, there's no automated way to notify Apollo in frontend except through manual handoffs.

**Recommendation:**
- Implement a `coordination/messages.md` file that any stream can write to
- Workspace watcher detects new messages and routes them to relevant channels
- Or use the existing `handoffs.md` more actively with auto-notifications

#### 5.10 Limited Observability
**Problem:** The only monitoring is `!agent_status` (checks systemd service), `!dashboard` (reads coordination files), and `!stream_status`. There's no way to see agent container logs, token usage, or response quality from Discord.

**Recommendation:**
- Add `!logs <agent>` command to tail recent container logs
- Track token usage per agent per session
- Add `!cost` command showing project cost estimate
- Log agent response quality metrics (e.g., did the agent actually modify files, or just chat?)

#### 5.11 No Plan Versioning / Approval Flow
**Problem:** Plans go through `draft-plan.md` -> agent review -> `plan-v2.md`, but there's no formal approval step. `!decompose` just uses whatever plan file it finds first.

**Recommendation:**
- Add `!approve_plan` command that moves `plan-v2.md` to `approved-plan.md`
- Require explicit approval before `!decompose` proceeds
- Keep version history in git (already done) but surface it in Discord with `!plan_history`

---

## 6. Summary Assessment

The Discord multi-agent workflow is an **ambitious and well-architected system** that has evolved rapidly through 5 phases in just 2-3 weeks. The file-first approach is a strong architectural choice — it gives agents persistent, git-tracked state rather than relying on ephemeral Discord messages.

**Strengths:**
- Clean channel skill pattern with self-registration
- File-first workspace with git tracking
- Comprehensive command set covering full project lifecycle
- Stream watchers for autonomous agent management
- Cross-channel (Telegram + Discord) unified Iris

**Biggest risks:**
- In-memory state loss on restart (critical)
- 3,200-line monolith needs splitting (maintainability)
- Agent handoff reliability (operational)
- Prometheus cleanup / agent roster clarity (documentation)
