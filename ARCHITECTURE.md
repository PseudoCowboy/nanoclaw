# NanoClaw Architecture

Single Node.js process that receives messages from channels, queues them per-group, and dispatches them to Claude Agent SDK running inside Docker containers. Each group has an isolated filesystem and persistent memory.

## System Overview

```
                               HOST (Node.js process)
 ┌───────────────────────────────────────────────────────────────────────────┐
 │                                                                           │
 │  ┌──────────────────────┐    ┌────────────┐    ┌──────────────────────┐  │
 │  │   Channel Registry   │    │   SQLite    │    │   Task Scheduler     │  │
 │  │                      │    │             │    │                      │  │
 │  │  Discord  ───┐       │    │  messages   │    │  cron / interval /   │  │
 │  │  Telegram ───┼─ self │    │  groups     │    │  once               │  │
 │  │  WhatsApp ───┤  reg  │    │  sessions   │    │  polls getDueTasks() │  │
 │  │  Slack   ───┤       │    │  tasks      │    │  enqueues via queue  │  │
 │  │  Gmail   ───┘       │    │  state      │    │                      │  │
 │  └──────────┬───────────┘    └──────┬─────┘    └──────────┬───────────┘  │
 │             │ onMessage()           │                     │              │
 │             ▼                       │                     │              │
 │  ┌──────────────────────┐           │                     │              │
 │  │     Orchestrator     │◄──────────┘                     │              │
 │  │     (src/index.ts)   │                                 │              │
 │  │                      │  poll loop: getNewMessages()    │              │
 │  │  loadState()         │  check trigger pattern          │              │
 │  │  formatMessages()    │  formatMessages() → XML prompt  │              │
 │  │  saveState()         │                                 │              │
 │  └──────────┬───────────┘                                 │              │
 │             │                                             │              │
 │             ▼                                             │              │
 │  ┌──────────────────────────────────────────────┐         │              │
 │  │              Group Queue                     │◄────────┘              │
 │  │              (src/group-queue.ts)             │                        │
 │  │                                              │                        │
 │  │  Per-group serialization                     │                        │
 │  │  Global concurrency limit                    │                        │
 │  │  Retry with exponential backoff              │                        │
 │  │  Folder-level locking (multi-JID groups)     │                        │
 │  └──────────┬───────────────────────────────────┘                        │
 │             │                                                            │
 │             ▼                                                            │
 │  ┌──────────────────────┐         ┌──────────────────────┐              │
 │  │   Container Runner   │         │     IPC Watcher      │              │
 │  │ (src/container-      │         │   (src/ipc.ts)       │              │
 │  │  runner.ts)          │         │                      │              │
 │  │                      │         │  Polls data/ipc/     │              │
 │  │  buildVolumeMounts() │         │  per-group dirs      │              │
 │  │  buildContainerArgs()│         │                      │              │
 │  │  spawn(docker, ...)  │         │  messages/ → router  │              │
 │  │  stream OUTPUT       │         │  tasks/   → db       │              │
 │  │  markers on stdout   │         │  input/   → piped    │              │
 │  └──────────┬───────────┘         └──────────┬───────────┘              │
 │             │                                │                           │
 │             │                                ▼                           │
 │             │                     ┌──────────────────────┐              │
 │             │                     │       Router         │              │
 │             │                     │   (src/router.ts)    │              │
 │             │                     │                      │              │
 │             │                     │  findChannel(jid)    │              │
 │             │                     │  formatOutbound()    │              │
 │             │                     │  channel.sendMessage │              │
 │             │                     └──────────────────────┘              │
 └─────────────┼──────────────────────────────────────────────────────────┘
               │
               │ docker run -i --rm ...
               ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │                        CONTAINER (Docker)                               │
 │                                                                         │
 │  ┌──────────────────────────────────────────────────────────┐          │
 │  │                   Agent Runner                           │          │
 │  │          (container/agent-runner/src/index.ts)            │          │
 │  │                                                          │          │
 │  │  1. Read ContainerInput JSON from stdin                  │          │
 │  │  2. Build SDK env (ANTHROPIC_BASE_URL, etc.)             │          │
 │  │  3. Start MCP server (ipc-mcp-stdio.ts) as child proc   │          │
 │  │  4. Call query() from @anthropic-ai/claude-agent-sdk     │          │
 │  │  5. Stream results: OUTPUT_START / JSON / OUTPUT_END     │          │
 │  │  6. Poll /workspace/ipc/input/ for follow-up messages    │          │
 │  │  7. Loop until _close sentinel or idle timeout           │          │
 │  └──────────────────────┬───────────────────────────────────┘          │
 │                         │                                               │
 │              ┌──────────┴──────────┐                                    │
 │              ▼                     ▼                                     │
 │  ┌─────────────────────┐  ┌─────────────────────────┐                  │
 │  │  Claude Agent SDK   │  │  MCP Server (stdio)     │                  │
 │  │                     │  │  (ipc-mcp-stdio.ts)     │                  │
 │  │  model: claude-opus │  │                         │                  │
 │  │  tools: Bash, Read, │  │  send_message           │                  │
 │  │   Write, Edit,      │  │  send_document          │                  │
 │  │   Glob, Grep,       │  │  schedule_task          │                  │
 │  │   gemini_search,    │  │  list_tasks             │                  │
 │  │   WebFetch,         │  │  pause/resume/cancel    │                  │
 │  │   Task, TeamCreate, │  │  update_task            │                  │
 │  │   mcp__nanoclaw__*  │  │  register_group         │                  │
 │  │                     │  │                         │                  │
 │  │  cwd: /workspace/   │  │  Writes JSON files to   │                  │
 │  │       group         │  │  /workspace/ipc/{msgs,  │                  │
 │  │                     │  │   tasks}/ for host to   │                  │
 │  │  permissionMode:    │  │   pick up               │                  │
 │  │   bypassPermissions │  │                         │                  │
 │  └─────────────────────┘  └─────────────────────────┘                  │
 │                                                                         │
 │  Mount Points:                                                          │
 │    /workspace/group     ← groups/<name>/         (rw)                  │
 │    /workspace/ipc       ← data/ipc/<name>/       (rw)                  │
 │    /workspace/shared    ← groups/shared_project/  (rw, scoped)         │
 │    /workspace/global    ← groups/global/          (ro, non-main)       │
 │    /workspace/project   ← project root            (ro, main only)      │
 │    /home/node/.claude   ← data/sessions/<name>/   (rw, skills+config)  │
 │    /home/node/.gemini   ← ~/.gemini/              (ro, if exists)      │
 │    /app/src             ← data/sessions/<name>/agent-runner-src/ (rw)  │
 └─────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Inbound Message Path

```
User sends message
    │
    ▼
Channel (Discord/Telegram/WhatsApp/Slack/Gmail)
    │  channel.onMessage(chatJid, msg)
    ▼
Orchestrator stores in SQLite via storeMessage()
    │
    ▼
Polling loop: getNewMessages() — finds messages since lastTimestamp
    │
    ▼
Check: is chatJid a registered group?
    │
    ▼
Check: does message match trigger pattern? (@Andy, etc.)
    │
    ▼
formatMessages() — convert to XML: <messages><message sender="..." time="...">
    │
    ▼
Two paths:
    ├─ Active container exists → queue.sendMessage() pipes via IPC file
    │   (writes JSON to data/ipc/<group>/input/<timestamp>.json)
    │
    └─ No active container → queue.enqueueMessageCheck()
        │
        ▼
    GroupQueue checks concurrency limit and folder locks
        │
        ▼
    processGroupMessages() → runContainerAgent()
        │
        ▼
    container-runner builds mounts, spawns: docker run -i --rm ...
        │
        ▼
    Writes ContainerInput JSON to container stdin, closes stdin
```

### Agent Execution (Inside Container)

```
agent-runner reads stdin → parses ContainerInput
    │
    ▼
Starts MCP server (ipc-mcp-stdio.ts) as child process
    │
    ▼
Calls query() with prompt, session resume, MCP config
    │
    ▼
Claude Agent SDK processes prompt
    │  Uses tools: Bash, Read, Write, Grep, WebFetch, mcp__nanoclaw__*
    │
    ▼
For each result message:
    ├─ writeOutput() → stdout: ---NANOCLAW_OUTPUT_START--- { JSON } ---NANOCLAW_OUTPUT_END---
    │
    ├─ MCP tool calls (send_message, schedule_task, etc.)
    │  → write JSON files to /workspace/ipc/messages/ or /workspace/ipc/tasks/
    │
    └─ Wait for more IPC input or _close sentinel
```

### Outbound Response Path

```
Container stdout (OUTPUT markers)
    │  Parsed by container-runner's streaming handler
    ▼
onOutput callback in processGroupMessages()
    │  Strips <internal>...</internal> tags
    ▼
channel.sendMessage(chatJid, text)
    │
    ▼
User receives response in their channel


IPC files written by MCP server inside container
    │
    ▼
Host IPC watcher polls data/ipc/<group>/messages/*.json
    │  Validates authorization (group can only send to own JIDs, unless main)
    ▼
router → findChannel(jid) → channel.sendMessage()
    │
    ▼
User receives message
```

## Key Directories

```
nanoclaw/
├── src/                          # Host process source
│   ├── index.ts                  # Orchestrator: state, message loop, agent invocation
│   ├── channels/
│   │   ├── registry.ts           # Channel registry (self-registration pattern)
│   │   └── discord-commands/     # Discord multi-agent orchestration commands
│   ├── router.ts                 # Message formatting (XML) and outbound routing
│   ├── ipc.ts                    # IPC watcher — polls per-group dirs for messages/tasks
│   ├── container-runner.ts       # Spawns Docker containers with bind mounts
│   ├── group-queue.ts            # Per-group queue with global concurrency limit
│   ├── task-scheduler.ts         # Runs scheduled tasks (cron, interval, once)
│   ├── db.ts                     # SQLite operations (messages, groups, sessions, tasks)
│   ├── config.ts                 # Trigger pattern, paths, intervals, timeouts
│   └── container-runtime.ts      # Docker/Apple Container abstraction
│
├── container/                    # Container image
│   ├── agent-runner/src/
│   │   ├── index.ts              # Agent runner: reads stdin, runs SDK, streams output
│   │   └── ipc-mcp-stdio.ts     # MCP server: send_message, schedule_task, etc.
│   ├── skills/                   # Skills available inside containers
│   │   ├── agent-browser/        # Browser automation (Chromium)
│   │   ├── codex/                # Codex CLI coding tool
│   │   ├── gemini/               # Gemini CLI coding tool
│   │   ├── discord-project/      # Discord project setup templates
│   │   ├── discord-workstream/   # Workstream management
│   │   └── discord-review/       # Code review workflows
│   ├── Dockerfile
│   ├── build.sh
│   └── entrypoint.sh
│
├── groups/                       # Per-group state (each group is isolated)
│   ├── main/                     # Main channel (admin self-chat)
│   │   └── CLAUDE.md             # Main agent memory
│   ├── global/
│   │   └── CLAUDE.md             # Shared memory (read-only for non-main)
│   ├── <channel>_<name>/         # Channel-prefixed group folders
│   │   ├── CLAUDE.md             # Group-specific memory
│   │   ├── logs/                 # Container run logs
│   │   ├── conversations/        # Archived transcripts (pre-compaction)
│   │   └── channel-jids.json     # Channel JID map for cross-channel messaging
│   └── shared_project/
│       └── active/<slug>/        # Shared project workspaces (git repos)
│
├── data/                         # Runtime data (gitignored)
│   ├── nanoclaw.db               # SQLite database
│   ├── sessions/<group>/
│   │   ├── .claude/              # Per-group SDK config, skills, settings
│   │   └── agent-runner-src/     # Per-group copy of agent-runner (customizable)
│   └── ipc/<group>/
│       ├── messages/             # Outbound IPC: container → host → channel
│       ├── tasks/                # Task IPC: schedule, pause, resume, cancel
│       ├── input/                # Inbound IPC: host → container (follow-up messages)
│       ├── current_tasks.json    # Snapshot of tasks for container to read
│       └── available_groups.json # Snapshot of groups for container to read
│
├── agents/                       # Discord multi-agent configuration
│   ├── config.json               # Agent definitions (name, role, tool, channels)
│   └── <agent>.ts                # Per-agent standalone runner scripts
│
├── docs/                         # Plans, decisions, analysis
│   └── plans/                    # Saved implementation plans (persist across sessions)
│
├── scripts/                      # Maintenance and operations
│   ├── checkpoint-daily.sh       # Daily checkpoint (log rotation, cleanup)
│   ├── rotate-logs.sh            # Log rotation
│   └── check-copilot-credentials.sh  # Credential health check (runs on timer)
│
└── logs/                         # Centralized service logs
```

## State Boundaries

There are four distinct state scopes. Understanding these prevents accidental cross-contamination.

### Host Repo State
`src/`, `dist/`, `package.json`, `container/`, `CLAUDE.md`

The NanoClaw application itself. Mounted **read-only** into main containers (at `/workspace/project`). Non-main containers never see this. Changes here require `npm run build` and a service restart.

### Per-Group State
`groups/<name>/` — `CLAUDE.md`, `logs/`, `conversations/`, `channel-jids.json`

Each group's isolated memory and history. Mounted **read-write** at `/workspace/group`. The agent's working directory. Groups cannot see each other's folders. The global CLAUDE.md (`groups/global/`) is mounted read-only into non-main containers.

### Per-Project State
`groups/shared_project/active/<slug>/` — git repos with workstream branches

Shared workspaces scoped by project slug. When a `projectSlug` is set, the host creates per-agent git worktrees and mounts them; the container only verifies the branch. Agents on different branches work in isolation via these worktrees.

### Container-Only State
`/workspace/` mounts, `/tmp/`, agent process memory

Ephemeral. Containers run with `--rm` and are destroyed on exit. Only bind-mounted directories persist. The agent-runner source is copied per-group into `data/sessions/<group>/agent-runner-src/` so agents can customize tools without affecting other groups.

## IPC Protocol

Containers cannot make network calls to the host process. All communication uses the filesystem.

| Direction | Path | Format | Purpose |
|-----------|------|--------|---------|
| Host → Container | `data/ipc/<group>/input/*.json` | `{type:"message", text:"..."}` | Follow-up messages piped to active container |
| Host → Container | `data/ipc/<group>/input/_close` | Empty file (sentinel) | Signal container to exit gracefully |
| Container → Host | `data/ipc/<group>/messages/*.json` | `{type:"message", chatJid, text}` | Send message to channel |
| Container → Host | `data/ipc/<group>/messages/*.json` | `{type:"document", chatJid, filePath}` | Send file attachment |
| Container → Host | `data/ipc/<group>/tasks/*.json` | `{type:"schedule_task", ...}` | Create/modify scheduled tasks |
| Container → Host | `data/ipc/<group>/tasks/*.json` | `{type:"register_group", ...}` | Register new group (main only) |
| Host → Container | `data/ipc/<group>/current_tasks.json` | JSON array | Snapshot of tasks for `list_tasks` |
| Host → Container | `data/ipc/<group>/available_groups.json` | JSON object | Available groups for `register_group` |

All IPC writes use atomic rename (`write .tmp` → `rename .json`) to prevent partial reads.

Authorization is enforced by the host IPC watcher: non-main groups can only send messages to their own JIDs (with an exception for Discord cross-channel within the same server). Main can send anywhere.

## Discord Multi-Agent Workflow

NanoClaw supports multi-agent orchestration on Discord, where specialized agents collaborate on projects through dedicated channels.

### Agents

| Agent | Role | Tool | Channels |
|-------|------|------|----------|
| **Iris** | Main orchestrator | Claude (host) | All channels (main group) |
| **Athena** | Plan Designer | Codex | control-room, plan-room |
| **Hermes** | Planning Collaborator | Claude | plan-room, discuss-* |
| **Atlas** | Backend Engineer | Claude | ws-backend, ws-* |
| **Apollo** | Frontend Engineer | Gemini | ws-frontend, ws-* |
| **Argus** | Monitor / Reviewer | Claude | control-room, qa-alerts, ws-* |

### Project Phases

```
1. Setup        Iris creates Discord category + channels (control-room, plan-room,
                release-log) and workstream channels (ws-backend, ws-frontend, etc.)

2. Planning     User posts requirements → Athena designs plan in plan-room
                Hermes collaborates, challenges assumptions, refines

3. Decomposition  Hermes breaks plan into workstream tasks with file assignments
                  Each workstream gets a channel with assigned agents

4. Implementation  Atlas (backend) and Apollo (frontend) work in parallel
                   Each agent works in its own git worktree (created by the host)
                   File-based coordination via workspace watcher

5. Review       Argus monitors progress, runs tests, reviews code
                Reports to control-room with status updates

6. Monitoring   Stream watcher polls for stalled workstreams
                Workspace watcher detects file conflicts
                Argus escalates issues to control-room
```

### Channel Structure (per project)

```
discord-category/
├── control-room     # Human + Athena + Argus — oversight, decisions
├── plan-room        # Athena + Hermes + Human — planning sessions
├── release-log      # Human + Argus — deliveries, sign-offs
├── ws-backend       # Atlas + Argus — backend implementation
├── ws-frontend      # Apollo + Argus — frontend implementation
└── ws-<type>        # Dynamic workstreams (qa, design, devops, research)
```

## How to Add New Functionality

### Add a Channel

Channels are self-registering skills. Create a skill that:
1. Adds a channel module to `src/channels/` that calls `registerChannel(name, factory)` from `src/channels/registry.ts`
2. The factory returns a `Channel` object (connect, sendMessage, ownsJid, etc.) or `null` if credentials are missing
3. The orchestrator iterates registered channels at startup, creates each one, and calls `connect()`

Existing examples: `/add-whatsapp`, `/add-telegram`, `/add-discord`, `/add-slack`, `/add-gmail`

### Add a Container Skill

Skills inside containers are directories with a `SKILL.md` that Claude reads.

1. Create `container/skills/<name>/SKILL.md` with instructions
2. Optionally include helper scripts or templates
3. Skills are synced into each group's `.claude/skills/` at container startup
4. The agent discovers them via Claude Code's skills system

Examples: `agent-browser`, `codex`, `gemini`, `discord-project`

### Add an MCP Tool

MCP tools let agents communicate with the host through the IPC filesystem.

1. Add `server.tool()` in `container/agent-runner/src/ipc-mcp-stdio.ts`
2. The tool writes a JSON file to `/workspace/ipc/messages/` or `/workspace/ipc/tasks/`
3. Add a handler in `src/ipc.ts` (the `processTaskIpc` switch statement) to process the new IPC type
4. Add the tool name pattern to the `allowedTools` list in `container/agent-runner/src/index.ts` (already covered by `mcp__nanoclaw__*` wildcard)

### Add a Scheduled Task

Agents schedule tasks using the `schedule_task` MCP tool from within a conversation. No code changes needed.

- **From chat**: "Schedule a daily briefing at 9am" → agent calls `schedule_task` MCP tool
- **Programmatic**: Write a JSON file to `data/ipc/<group>/tasks/` with `type: "schedule_task"`
- The host's task scheduler (`src/task-scheduler.ts`) polls `getDueTasks()` every minute and spawns containers
