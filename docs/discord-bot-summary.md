# Discord Bot — Full Summary

## Architecture

The Discord integration follows NanoClaw's **channel skill pattern** — a self-registering plugin that hooks into the core message loop.

```
Discord Server
    │
    ▼
discord.js Client (Gateway WebSocket)
    │
    ▼
DiscordChannel class (src/channels/discord.ts)
    │
    ├── !commands → discord-commands/ module (handled first)
    │
    └── Regular messages → Channel Registry → Message Loop → Container Agent (Claude SDK)
                                                                    │
                                                                    ▼
                                                              Response sent back
                                                              via DiscordChannel.sendMessage()
```

**Key design points:**
- **Self-registration**: The module calls `registerChannel('discord', factory)` at import time. The barrel file (`src/channels/index.ts`) dynamically imports it inside a try/catch, so if `discord.js` isn't installed, the channel is silently skipped.
- **JID format**: Discord channels are identified as `dc:<channelId>` (e.g., `dc:1234567890123456`), which the router uses to dispatch outbound messages to the correct channel.
- **Auth**: Single `DISCORD_BOT_TOKEN` env var, read from `.env` or `data/env/env`.
- **Gateway Intents**: `Guilds`, `GuildMessages`, `MessageContent`, `DirectMessages` (with `Partials.Channel` for DMs).

---

## Message Flow (Inbound)

1. `messageCreate` event fires
2. Skip if: own bot message, other bot messages
3. **`!` commands** are intercepted first → routed to `discord-commands.ts`
4. Build `chatJid` as `dc:<channelId>`
5. Translate `<@botId>` Discord mentions → `@AssistantName` trigger format
6. Append attachment placeholders (`[Attachment: filename]`)
7. Call `onChatMetadata()` for chat discovery
8. If channel is **registered** → deliver via `onMessage()` → picked up by the main message loop → spawns container agent
9. If **unregistered** → metadata only, message is dropped

## Message Flow (Outbound)

1. Agent container produces response
2. Router finds the channel that `ownsJid('dc:...')` → `DiscordChannel`
3. `sendMessage()` — auto-splits at 2000 chars (Discord limit), splitting at line boundaries
4. `sendDocument()` — sends files as `AttachmentBuilder` with optional caption
5. `setTyping()` — sends typing indicator while agent processes

---

## All `!` Commands (17 total)

### Info & Help

| Command | Description |
|---------|-------------|
| `!help` | Shows all commands as a rich embed |
| `!help_orchestration` | Full workflow guide — agents, rounds, process |

### Project Management

| Command | Description |
|---------|-------------|
| `!create_project Name` | Creates a Discord category with core channels: `control-room`, `plan-room`, `backend-dev`, `frontend-ui`, `qa-alerts` |
| `!cleanup_server` | Removes all orchestration categories and their channels |

### Planning & Discussion

| Command | Description |
|---------|-------------|
| `!plan topic` | Starts 4-step Hermes-Athena planning workflow (file-first, not chat debates) |
| `!plans` | Show all tracked plans with lifecycle status |
| `!create_discussion "topic"` | File-based discussion with shared git folder |
| `!close_discussion` | Delete current discussion, planning, or ws-* channel |
| `!decompose [streams]` | Decomposes approved plan into workstream channels |

### Monitoring & Progress

| Command | Description |
|---------|-------------|
| `!agent_status` | Per-agent health dashboard (PID check + last log) |
| `!logs <agent>` | Recent agent log output |
| `!dashboard` | Project-wide status from coordination files |
| `!blocker "description"` | Escalate blocker to control-room |

---

## Multi-Agent Orchestration System

The Discord bot coordinates **5 AI agents**, each with a distinct role and preferred tool:

| Agent | Role | AI Tool | Color | listenToBots |
|-------|------|---------|-------|--------------|
| **Athena** | Plan Designer | Codex | Purple | true (hears all bots) |
| **Hermes** | Planning Collaborator | Claude | Green | true (hears all bots) |
| **Atlas** | Backend Engineer | Claude | Red | iris-only |
| **Apollo** | Frontend Engineer | Gemini | Blue | iris-only |
| **Argus** | Monitor & Reviewer | Claude | Orange | iris-only |

### Bot-to-Bot Trigger Model

- Agents with `listenToBots: true` (Athena, Hermes) hear all bot messages — enabling planning debates
- Agents with `listenToBots: "iris-only"` (Atlas, Apollo, Argus) only respond to Iris (the orchestrator bot) — preventing agent loop storms while allowing Iris to delegate work

### Planning Session (`!plan`)

- Runs a **4-step workflow**: Human Input → Hermes Reviews → Athena Architects → Hermes Finalizes
- File-first: plans saved as `plan.md` → `plan-v2.md` in git-tracked shared folders
- Results viewable via `!plans` lifecycle index

### File-Based Discussion (`!create_discussion`)

- Creates a dedicated `#discuss-<slug>` channel + git-initialized shared folder
- Same 4-step Hermes ↔ Athena workflow as `!plan`
- Watchdog monitors agent handoffs with 5-minute nudge timers
- All changes git-committed with agent identity (`--author="AgentName <name@nanoclaw>"`)

### Workstream Execution (`!decompose`)

- Decomposes a plan into workstream channels (`ws-backend`, `ws-frontend`, etc.)
- **Stream watcher** monitors each workstream with a polling loop:
  - Tracks `task-state.json` for task status changes
  - **Review gate**: When an agent marks a task as `implemented`, Argus is triggered for code review
  - Argus approves or requests changes via `task-state.json`
  - Stream completes only when all tasks are `approved`
  - Escalates to control-room if a task goes 3+ review rounds
- Hourly status reports to `#control-room`
- 1-hour silence detection with nudge alerts

---

## Container Skills (Agent-Side)

Agents inside containers have 5 Discord-specific skills:

| Skill | Purpose |
|-------|---------|
| `discord-discussion` | Protocol for file-based discussions — git conventions, round behavior, handoff chain |
| `discord-project` | Creates project directory structures in `/workspace/shared/` |
| `discord-status` | Checks health of all NanoClaw services, containers, and disk usage |
| `discord-plan` | Orchestrates multi-agent planning debates via IPC messages |
| `discord-workstream` | Task-by-task execution protocol — implements one task, updates task-state.json, commits, exits |
| `discord-review-workstream` | Argus code review protocol — reviews diffs, updates task-state.json to approved/changes_requested |

---

## Project Channel Structure

When `!create_project` runs, it creates:

```
ProjectName (Category)
  ├── #control-room — Human + Athena + Argus | Oversight, decisions, approvals
  ├── #plan-room — Athena + Hermes + Human | Planning sessions
  └── #release-log — Human + Argus | Deliveries, summaries, sign-offs
```

After `!decompose`, additional channels are created:
```
  ├── #ws-backend — Atlas, Argus | Backend workstream tasks
  ├── #ws-frontend — Apollo, Argus | Frontend workstream tasks
  └── #ws-qa — Argus | QA workstream tasks
```

---

## State Persistence

- **Channel-project map**: `store/channel-project-map.json` — maps Discord channel IDs to project slugs
- **Stream watchers**: Persisted to SQLite `orchestration_state` table — rehydrated on restart
- **Task state**: `task-state.json` per workstream — tracks task status (pending → in_progress → implemented → in_review → approved/changes_requested)

---

## Key Source Files

| File | Purpose |
|------|---------|
| `src/channels/discord.ts` | DiscordChannel class — connection, message handling, sending |
| `src/channels/discord-commands/` | Split module: planning, discussion, workstreams, monitoring, stream-watcher, state, etc. |
| `src/channels/registry.ts` | Channel self-registration system |
| `src/channels/index.ts` | Barrel file — dynamic imports with try/catch |
| `src/router.ts` | Outbound message routing by JID ownership |
| `src/db.ts` | SQLite database — includes orchestration_state table for persistence |
| `agents/shared/agent-runner.ts` | Shared logic for all agent bots (trigger model, message handling) |
| `agents/config.json` | Agent configuration (channels, triggers, listenToBots) |
| `container/skills/discord-discussion/SKILL.md` | Agent-side discussion protocol |
| `container/skills/discord-project/SKILL.md` | Agent-side project setup |
| `container/skills/discord-status/SKILL.md` | Agent-side status checks |
| `container/skills/discord-plan/SKILL.md` | Agent-side planning orchestration |
| `container/skills/discord-workstream/SKILL.md` | Agent-side task execution protocol |
| `container/skills/discord-review-workstream/SKILL.md` | Agent-side code review protocol |

## Setup

1. Create a Discord bot at [Discord Developer Portal](https://discord.com/developers/applications)
2. Enable **Message Content Intent** and **Server Members Intent**
3. Invite bot with `Send Messages`, `Read Message History`, `View Channels` permissions
4. Set `DISCORD_BOT_TOKEN` in `.env` and sync to `data/env/env`
5. Register channels via `dc:<channelId>` JID format
6. Build and restart NanoClaw
