# Agents

NanoClaw runs multiple Claude agents, each in its own Docker container with isolated memory and skills.

## Roster

| Agent | Role | Channel | Group Folder | Persistence |
|-------|------|---------|--------------|-------------|
| Iris (main) | Personal assistant | All | `main` | Session persisted |
| Athena | Planner/architect | Discord | `dc_athena` | Fresh each trigger |
| Hermes | Collaborator/discussion | Discord | `dc_hermes` | Fresh each trigger |
| Atlas | Backend developer | Discord | `dc_atlas` | Fresh each trigger |
| Apollo | Frontend developer | Discord | `dc_apollo` | Fresh each trigger |
| Argus | Reviewer/monitor | Discord | `dc_argus` | Fresh each trigger |

## Trigger Model

Agents are invoked through four mechanisms:

**Direct message.** A user sends a message to a channel (WhatsApp, Telegram, Discord, etc.). The channel routes it to the registered group's agent. The message must match the trigger pattern (e.g. `@Andy`) unless sent to the main channel.

**Workstream watcher.** `stream-watcher.ts` monitors `task-state.json` changes inside active workstream directories. When a task's status changes (e.g. to `ready` or `in_review`), the watcher triggers the appropriate implementation or review agent in its Discord channel.

**Scheduled task.** Cron-based or interval-based tasks run via `task-scheduler.ts`. The scheduler spawns a container with `isScheduledTask=true`. Tasks execute in the context of the group that created them and can send messages back.

**Cross-agent.** Agents use the `send_message` MCP tool with a `target_jid` to route messages through the host to another agent's channel. This enables coordination without shared memory.

## Memory Model

Each agent's knowledge is scoped through a layered memory system:

**Per-group memory** (`groups/<folder>/CLAUDE.md`). Every agent has a dedicated `CLAUDE.md` in its group folder. This file is read on every invocation and serves as the agent's persistent memory. Agents can write to their own `CLAUDE.md` to remember things across sessions.

**Per-project memory** (`groups/<folder>/projects/<slug>/CLAUDE.md`). When an agent works on a specific project, project-scoped memory is loaded alongside the group memory. This keeps project context separate from general agent memory.

**Global memory** (`groups/global/CLAUDE.md`). Shared context available read-only to non-main agents. Only Iris (main) can write to global memory. Used for cross-cutting information that all agents should know.

**Session persistence.** Only Iris persists conversation sessions across invocations (via `sessionId` in the Claude Agent SDK). All other agents start fresh each trigger, relying on their `CLAUDE.md` files for continuity.

## Isolation Model

Each agent invocation is sandboxed at multiple levels:

**Container isolation.** Every invocation runs in a fresh Docker container. The agent process, its Bash access, and all tool execution happen inside the container. Nothing runs on the host.

**Filesystem isolation.** The container only sees explicitly bind-mounted directories: its group folder (`/workspace/group`), shared project directory (`/workspace/shared`, when applicable), and read-only skill mounts. Agents cannot access other agents' group folders.

**Branch isolation.** When working on a project, each agent gets its own git worktree mounted from the host. This prevents concurrent agents on different branches from interfering with each other's working trees. The host creates the worktree before spawning the container and cleans it up after exit.

**Secret stripping.** A `PreToolUse` hook in the agent runner removes `ANTHROPIC_API_KEY` from every Bash subprocess environment. This prevents tools like Codex or Gemini CLI from leaking the agent's API credentials.

## Communication Model

Agents communicate through filesystem-based IPC, not shared memory or direct connections:

**Agent to Host.** Agents write JSON files to `/workspace/ipc/messages/` (outbound messages) and `/workspace/ipc/tasks/` (task scheduling commands). The host's IPC watcher (`src/ipc.ts`) polls these directories and processes each file.

**Host to Agent.** Follow-up messages are written to `/workspace/ipc/input/` and polled by the agent runner inside the container. This enables multi-turn conversations within a single container session.

**Agent to Agent.** The `send_message` MCP tool accepts a `target_jid` parameter. The message is written as an IPC file, picked up by the host watcher, and routed through the channel system to the target agent's channel. There is no direct agent-to-agent communication.

**Host IPC watcher.** `src/ipc.ts` runs a polling loop that scans all group IPC directories for new files. It processes messages (routes to channels), tasks (creates/updates scheduled tasks), and group registrations (adds new groups).

## Review Responsibilities

Code review follows a structured flow managed by Argus and the stream watcher:

1. **Trigger.** When `task-state.json` status changes to `in_review`, the stream watcher triggers Argus in its review channel.
2. **Review.** Argus reviews the code using the `discord-review-workstream` skill. It checks mechanical quality (linting, tests) and semantic correctness.
3. **Verdict.** Argus updates `task-state.json` to either `approved` or `changes_requested`, with review comments.
4. **Feedback loop.** The stream watcher picks up the state change and notifies the implementation agent (Atlas or Apollo) to address feedback.
5. **Escalation.** After 3 review rounds without approval, the review is escalated to a human for final decision.
