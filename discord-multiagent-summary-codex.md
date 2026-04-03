# NanoClaw Discord Multi-Agent Workflow Summary

Generated on 2026-04-03 after reviewing code, agent instructions, planning docs, and recent git history.

## 1. Architecture Overview

The Discord bot is not a standalone subsystem anymore. It is a Discord channel adapter plus a large command/orchestration layer inside NanoClaw’s main process.

- The channel is self-registered through the channel registry and optional-import barrel: [src/channels/index.ts](/home/pseudo/nanoclaw/src/channels/index.ts#L1), [src/channels/registry.ts](/home/pseudo/nanoclaw/src/channels/registry.ts#L1), [src/channels/discord.ts](/home/pseudo/nanoclaw/src/channels/discord.ts#L284).
- Inbound Discord messages enter `DiscordChannel.handleMessage()`. `!` commands are intercepted first and handled locally; normal messages are converted into NanoClaw `NewMessage` records and forwarded into the main message loop with `chat_jid = dc:<channelId>` and optional `projectSlug`: [src/channels/discord.ts](/home/pseudo/nanoclaw/src/channels/discord.ts#L72).
- Outbound replies and attachments go back through `DiscordChannel.sendMessage()` and `sendDocument()`, including Discord-safe message splitting: [src/channels/discord.ts](/home/pseudo/nanoclaw/src/channels/discord.ts#L172), [src/channels/discord.ts](/home/pseudo/nanoclaw/src/channels/discord.ts#L205).
- The main orchestrator stores registered groups, writes `channel-jids.json` for cross-channel routing, and exposes those JIDs to agents, including the standalone Discord agent bots: [src/index.ts](/home/pseudo/nanoclaw/src/index.ts#L89), [src/index.ts](/home/pseudo/nanoclaw/src/index.ts#L132).
- Agent execution is containerized. Non-main groups get their own `/workspace/group`, a scoped `/workspace/shared` mount, per-group `.claude` state/skills, and per-group IPC; when `projectSlug` is present, mounts are narrowed to `groups/shared_project/active/<project>`: [src/container-runner.ts](/home/pseudo/nanoclaw/src/container-runner.ts#L59).

The practical message paths are:

```text
Discord user message
  -> DiscordChannel
  -> either discord-commands.ts (for !commands)
  -> or NanoClaw message loop / container agent

Agent bot @mention in Discord
  -> agents/shared/agent-runner.ts
  -> runContainerAgent(... projectSlug ...)
  -> container writes files / posts streamed Discord response
```

The orchestration center is [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L1). It holds:

- persisted channel-to-project mapping: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L25)
- in-memory planning/discussion/project/watcher state: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L62), [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L127)
- project workspace bootstrap logic: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L197)
- all Discord command handlers: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L443)

One important architectural distinction:

- Iris is the main assistant/orchestrator, shared across Telegram and Discord after the Unified Iris work: [docs/plans/2026-03-17-unified-iris-design.md](/home/pseudo/nanoclaw/docs/plans/2026-03-17-unified-iris-design.md#L6), [groups/iris/CLAUDE.md](/home/pseudo/nanoclaw/groups/iris/CLAUDE.md#L40).
- Athena, Hermes, Atlas, Apollo, Argus, and some leftover Prometheus code are separate Discord bot processes built on the shared agent runner: [agents/shared/agent-runner.ts](/home/pseudo/nanoclaw/agents/shared/agent-runner.ts#L32).

## 2. Agent Roster and Roles

### Current implemented roster

The live config currently defines 5 active agents, not 6: [agents/config.json](/home/pseudo/nanoclaw/agents/config.json#L1).

| Agent | Tool | Role | Channel patterns | Notes |
|---|---|---|---|---|
| Athena | Codex | Plan Designer | `control-room`, `plan-room`, `plan-*`, `discuss-*` | `listenToBots: true`; second step in current planning/discussion flow: [agents/config.json](/home/pseudo/nanoclaw/agents/config.json#L4), [groups/dc_athena/CLAUDE.md](/home/pseudo/nanoclaw/groups/dc_athena/CLAUDE.md#L5) |
| Hermes | Claude | Planning Collaborator | `plan-room`, `plan-*`, `discuss-*`, `control-room` | First reviewer and current planning entry point: [agents/config.json](/home/pseudo/nanoclaw/agents/config.json#L17), [groups/dc_hermes/CLAUDE.md](/home/pseudo/nanoclaw/groups/dc_hermes/CLAUDE.md#L5) |
| Atlas | Claude | Backend Engineer | `backend-dev`, `ws-*` | Executes workstream tasks one at a time: [agents/config.json](/home/pseudo/nanoclaw/agents/config.json#L30), [groups/dc_atlas/CLAUDE.md](/home/pseudo/nanoclaw/groups/dc_atlas/CLAUDE.md#L37) |
| Apollo | Gemini | Frontend Engineer | `frontend-ui`, `ws-*` | Same workstream protocol, frontend/API coordination focus: [agents/config.json](/home/pseudo/nanoclaw/agents/config.json#L43), [groups/dc_apollo/CLAUDE.md](/home/pseudo/nanoclaw/groups/dc_apollo/CLAUDE.md#L37) |
| Argus | Claude | Monitor / Code Reviewer | `qa-alerts`, `control-room`, `backend-dev`, `frontend-ui` | Reviewer persona exists, but current workflow uses him mostly as a status identity, not an automated loop: [agents/config.json](/home/pseudo/nanoclaw/agents/config.json#L56), [groups/dc_argus/CLAUDE.md](/home/pseudo/nanoclaw/groups/dc_argus/CLAUDE.md#L5) |

### Current workflow roles in code

- Planning agents in code are explicitly `['Hermes', 'Athena']`: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L116).
- Discussion chain is also `['Hermes', 'Athena']`: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L117).
- Workstream assignment is defined by stream type. Backend/devops are Atlas-led; frontend is Apollo-led; research is Athena/Hermes; QA is Argus-only on paper: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L366).

### Prometheus status

Prometheus is partially retired, not cleanly removed.

- Prometheus is absent from the active config and absent from the command-layer `AGENTS` list: [agents/config.json](/home/pseudo/nanoclaw/agents/config.json#L3), [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L334).
- Prometheus still has a bot entrypoint that hard-fails if he is not present in config: [agents/prometheus.ts](/home/pseudo/nanoclaw/agents/prometheus.ts#L1).
- The process manager still tries to start Prometheus: [agents/start-all.sh](/home/pseudo/nanoclaw/agents/start-all.sh#L3).
- Several CLAUDE/docs files still describe Prometheus as active: [groups/dc_prometheus/CLAUDE.md](/home/pseudo/nanoclaw/groups/dc_prometheus/CLAUDE.md#L1), [groups/iris/CLAUDE.md](/home/pseudo/nanoclaw/groups/iris/CLAUDE.md#L15), [docs/discord-bot-summary.md](/home/pseudo/nanoclaw/docs/discord-bot-summary.md#L100).

That means the repo contains both the current 5-agent implementation and a stale 6-agent mental model.

## 3. Development History

### High-level timeline from docs and git log

1. **2026-03-17: planning debate system designed.** The first design expanded the Discord team from 4 to 6 agents and introduced 3-round planning debates in `#plan-room`, with Prometheus included: [docs/plans/2026-03-17-planning-discussion-system-design.md](/home/pseudo/nanoclaw/docs/plans/2026-03-17-planning-discussion-system-design.md#L8).
2. **2026-03-17: Unified Iris designed.** Iris became a single shared assistant across Telegram and Discord, with one folder, shared memory, and cross-channel routing via `channel-jids.json`: [docs/plans/2026-03-17-unified-iris-design.md](/home/pseudo/nanoclaw/docs/plans/2026-03-17-unified-iris-design.md#L6).
3. **2026-03-17: legacy orchestration commands reintroduced.** The command-handler design brought back 15 legacy commands and made `!commands` local/instant rather than container-backed: [docs/plans/2026-03-17-discord-orchestration-commands-design.md](/home/pseudo/nanoclaw/docs/plans/2026-03-17-discord-orchestration-commands-design.md#L6).
4. **2026-03-18: file-based discussion system designed.** The next design replaced chat-only discussions with git-backed shared folders, explicit file artifacts, and watchdog-driven handoffs. The design still assumed Prometheus → Athena → Hermes: [docs/plans/2026-03-18-file-based-discussion-system-design.md](/home/pseudo/nanoclaw/docs/plans/2026-03-18-file-based-discussion-system-design.md#L6).
5. **2026-03-25: workstream execution monitoring designed.** `!decompose` became the bridge from approved plans into parallel work channels with `tasks.md`, `progress.md`, and stream watchers: [docs/plans/2026-03-25-workstream-execution-monitoring-design.md](/home/pseudo/nanoclaw/docs/plans/2026-03-25-workstream-execution-monitoring-design.md#L17).
6. **By current HEAD: the live workflow has simplified to Hermes ↔ Athena planning plus file-first workstreams.** That is what the code and current help text implement: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L116), [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L494).

### Git log milestones

Recent relevant commits, oldest to newest in the current path:

- `61cc445` added the planning discussion design doc.
- `09cab74` added the planning discussion implementation plan.
- `38d98c5` added the Discord channel and agent bot framework.
- `078ce0f` and `9c0ed96` added Unified Iris design/implementation planning.
- `a3ac845` and `06be542` added orchestration-command design/implementation docs.
- `7bb7dd6` added the legacy orchestration commands into NanoClaw.
- `b47e8dc` and `3584a2a` added the file-based discussion design/implementation docs.
- `e806ade`, `4c98693`, `e5450bc`, `d8645e7`, `70dc26a`, `86414a1`, `428725e`, `622c3ae`, `814314c` implemented the discussion rewrite.
- `7109778`, `0f2cc10`, `0c50010`, `9f8b1a5`, `e875995` implemented workstream monitoring and the `discord-workstream` skill.

### What changed conceptually across phases

- **Phase A:** chat-native moderation and 3-round debates.
- **Phase B:** file-first planning artifacts with git history.
- **Phase C:** project workspaces under `groups/shared_project/active/<project>/`.
- **Phase D:** decomposition into stream-local task queues plus watcher-driven execution.
- **Current state:** 2 planning agents, 2 implementation agents, 1 reviewer/monitor, but old Prometheus-era docs and boot scripts still remain.

## 4. Planning and Discussion Flow

### `!plan`

The current `!plan` flow is a 4-step Hermes-first workflow, not the original 3-round debate.

- It only runs in `#plan-room` or `#control-room`: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L880).
- It creates a separate shared folder `groups/shared_project/plan-<slug>/` via `initDiscussionFolder()`, writes `plan.md`, and optionally appends `control/draft-plan.md` from the active project workspace if one exists: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L163), [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L880).
- Iris commits the initial draft as `Iris <iris@nanoclaw>` and records both a planning session and discussion session in memory: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L944).
- If the command was issued from `#control-room`, Iris redirects the active session to the sibling `#plan-room`: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L965).
- Iris posts an embed describing the 4 steps: Human Input -> Hermes Reviews -> Athena Architects -> Hermes Finalizes, then triggers Hermes directly: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L994).

### `!create_discussion`

`!create_discussion` is the ad-hoc version of the same Hermes/Athena workflow.

- It creates or reuses a global `DISCUSSIONS` category and a `#discuss-<slug>` channel: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L2861).
- It creates a git repo under `groups/shared_project/discuss-<slug>/`, posts instructions, and waits for either pasted plan text or a `yes/ready` signal if files were pre-staged: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L2925), [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L2977).
- If the user pasted content, Iris writes `plan.md`, commits it, then starts the same Hermes-first flow: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L3004).

### Discussion watchdog and handoff logic

- `startDiscussionWatchdog()` monitors bot messages, tracks which agent currently owns the turn, nudges after 5 minutes, and treats `@Athena` / `@Hermes` handoffs plus `Planning complete` / `Discussion complete` as state transitions: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L2727).
- On completion, it posts the final `plan-v2.md` back into Discord in chunks: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L2783).
- `!close_discussion` also closes `ws-*` channels and cleans up both discussion listeners and stream watchers: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L3071).

### Agent-side discussion protocol

The current discussion skill and per-agent instructions align with the live Hermes -> Athena -> Hermes loop, not the older Prometheus-first design.

- Shared protocol: [container/skills/discord-discussion/SKILL.md](/home/pseudo/nanoclaw/container/skills/discord-discussion/SKILL.md#L6).
- Hermes role: first reviewer, writes initial `plan-v2.md`: [groups/dc_hermes/CLAUDE.md](/home/pseudo/nanoclaw/groups/dc_hermes/CLAUDE.md#L55).
- Athena role: architectural refinement after Hermes: [groups/dc_athena/CLAUDE.md](/home/pseudo/nanoclaw/groups/dc_athena/CLAUDE.md#L56).

## 5. Work Stream Execution and Monitoring

### Project/workspace bootstrap

`!create_project` now creates a file-first workspace plus only 3 core channels, not the old 6-channel layout.

- Workspace directories: `control/`, `coordination/`, `workstreams/`, `archive/`: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L201).
- Seed coordination files: `progress.md`, `dependencies.md`, `integration-points.md`, `status-board.md`: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L221).
- Core channels are `control-room`, `plan-room`, `release-log`: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L412).
- Command implementation: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L594).

### `!decompose`

`!decompose` is the handoff from planning into execution.

- It only runs from `#plan-room` or `#control-room`: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L1713).
- If streams are not supplied, it infers them from plan keywords in `approved-plan.md` or `draft-plan.md`, falling back to `backend frontend qa`: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L1075), [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L1730).
- It resolves plan content from three sources in priority order: planning-session `plan-v2.md`, `active/<project>/control/approved-plan.md`, then `draft-plan.md`: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L1750).
- It creates each workstream folder, writes `plan-for-decompose.md` and `decompose-instructions.md`, and explicitly instructs Hermes to write `tasks.md` and improve `scope.md`: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L1787).
- It polls for Hermes-generated `tasks.md` up to 5 minutes, then creates the Discord `ws-*` channels, registers them with NanoClaw, posts workstream instructions, triggers the lead agent, and writes `control/decomposition.md`: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L1824), [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L1871), [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L1966).

This exactly matches the March 25 design intent: Hermes decomposes once, then implementation agents work task-by-task: [docs/plans/2026-03-25-workstream-execution-monitoring-design.md](/home/pseudo/nanoclaw/docs/plans/2026-03-25-workstream-execution-monitoring-design.md#L17).

### Agent execution model in workstreams

- The shared workstream skill tells Atlas/Apollo to read the first unchecked task, implement exactly one task, update `tasks.md` and `progress.md`, commit, post a summary, and exit: [container/skills/discord-workstream/SKILL.md](/home/pseudo/nanoclaw/container/skills/discord-workstream/SKILL.md#L10).
- Atlas and Apollo’s CLAUDE files point to that exact protocol: [groups/dc_atlas/CLAUDE.md](/home/pseudo/nanoclaw/groups/dc_atlas/CLAUDE.md#L37), [groups/dc_apollo/CLAUDE.md](/home/pseudo/nanoclaw/groups/dc_apollo/CLAUDE.md#L37).

### Monitoring layers

There are two watcher classes.

1. **Workspace watcher**

- Polls workspace files every 30 seconds: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L1189), [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L1353).
- Detects `progress.md`, `handoffs.md`, and `coordination/*.md` changes.
- Syncs `coordination/status-board.md` and notifies channels about progress updates, handoff delivery, and blocked dependency counts: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L1246), [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L1303), [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L1353).

2. **Per-stream watcher**

- Polls each stream every 10 minutes: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L1476).
- Updates activity on both file changes and bot messages.
- Sends hourly status embeds to control-room.
- Nudges the lead agent after 1 hour of silence.
- Re-triggers the lead agent if `tasks.md` changed and unchecked tasks remain.
- Marks completion when all tasks are checked or an agent says `Work complete`: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L1560), [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L1644), [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L1696).

### Coordination commands around execution

- `!handoff` writes both `coordination/integration-points.md` and the relevant workstream `handoffs.md` files, then notifies the target stream: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L2062).
- `!stream_status` summarizes each stream from `progress.md`: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L2181).
- `!dashboard` summarizes status, dependency counts, handoff counts, and active stream count from `coordination/`: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L2268).
- `!blocker` appends a blocked row to `dependencies.md` and cross-posts to control-room: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L2366).
- `!checkpoint` and `!checkpoints` parse `handoffs.md` and report delivery status, promoting ready handoffs in `integration-points.md`: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L2454), [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L2500), [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L2629).

## 6. Current State of Commands

### Actual command surface in code

The live command registry exposes 16 commands, not the 17 commands described in older docs: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L3127).

| Category | Commands |
|---|---|
| Help | `!help`, `!help_orchestration` |
| Project lifecycle | `!create_project`, `!cleanup_server` |
| Planning | `!plan`, `!decompose` |
| Workstreams | `!add_stream`, `!handoff`, `!stream_status` |
| Monitoring | `!agent_status`, `!dashboard`, `!blocker` |
| Checkpoints | `!checkpoint`, `!checkpoints` |
| Discussions | `!create_discussion`, `!close_discussion` |

The built-in help text already describes the current file-first workflow accurately: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L445), [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L494).

### Commands that exist only in older docs

These were part of the March 17 legacy-command design but are not present in the current registry:

- `!next`, `!skip`
- `!create_feature`
- `!create_spec`
- `!approve_spec`
- `!create_contract`
- `!report_progress`
- `!escalate_blocker`
- `!feature_status`

Evidence of the older design: [docs/plans/2026-03-17-discord-orchestration-commands-design.md](/home/pseudo/nanoclaw/docs/plans/2026-03-17-discord-orchestration-commands-design.md#L43), [docs/discord-bot-summary.md](/home/pseudo/nanoclaw/docs/discord-bot-summary.md#L55).

### Other notable current-state observations

- `!create_project` now creates 3 core channels plus on-demand `ws-*` channels, while older summaries still claim 6 fixed project channels: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L412), [docs/discord-bot-summary.md](/home/pseudo/nanoclaw/docs/discord-bot-summary.md#L145).
- `!agent_status` only checks whether `nanoclaw-agents.service` is active, then marks every configured agent as running/offline together; it is not per-agent health: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L556).
- Tests cover routing, usage validation, constants, helper functions, and watcher exports with mocks, but not full end-to-end orchestration: [src/channels/discord-commands.test.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.test.ts#L122).

## 7. Suggested Improvements

1. **Resolve the Prometheus drift cleanly.** Right now the active config is 5 agents, but `agents/start-all.sh`, `agents/prometheus.ts`, `groups/iris/CLAUDE.md`, `groups/dc_prometheus/CLAUDE.md`, `container/skills/discord-plan`, and `docs/discord-bot-summary.md` still assume 6. Decide whether Prometheus is returning or being removed, then make code/docs/scripts consistent: [agents/config.json](/home/pseudo/nanoclaw/agents/config.json#L3), [agents/start-all.sh](/home/pseudo/nanoclaw/agents/start-all.sh#L24), [agents/prometheus.ts](/home/pseudo/nanoclaw/agents/prometheus.ts#L5), [groups/iris/CLAUDE.md](/home/pseudo/nanoclaw/groups/iris/CLAUDE.md#L15), [container/skills/discord-plan/SKILL.md](/home/pseudo/nanoclaw/container/skills/discord-plan/SKILL.md#L1).

2. **Persist orchestration state.** `planningSessions`, `discussionSessions`, `activeProjects`, `activeWatchers`, and `activeStreamWatchers` are all in-memory. A NanoClaw restart loses running sessions and watcher state even though the workspace files remain: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L127). Persist these to SQLite or workspace JSON so the system can recover.

3. **Split `discord-commands.ts`.** It is over 3,200 lines and currently mixes bootstrap, planning, discussion watchdogs, file locking, workspace watching, stream watching, and all command handlers: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L1). Breaking it into `project`, `planning`, `discussion`, `workstreams`, and `monitoring` modules would reduce review and maintenance risk.

4. **Make Argus real in the current workstream model.** The stream definitions assign Argus to backend/frontend/devops/qa roles, but Argus’s `channelNames` do not include `ws-*`, so he cannot participate in most of the new channels: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L366), [agents/config.json](/home/pseudo/nanoclaw/agents/config.json#L56). Either add `ws-*` for Argus or stop listing him as an active monitor in those streams.

5. **Add isolation for parallel implementation.** The repo’s own principles doc calls out the lack of isolated worktrees/branches for Atlas and Apollo. Both agents write into shared mounts, so parallel edits can still collide even with stream folders: [docs/DISCORD-WORKFLOW-VS-PRINCIPLES.md](/home/pseudo/nanoclaw/docs/DISCORD-WORKFLOW-VS-PRINCIPLES.md#L38). Per-agent worktrees or per-stream branches would make the model safer.

6. **Replace coarse polling with event-driven watching where possible.** Workspace watching is every 30s and stream watching is every 10m. That is simple, but slow and noisy for active work: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L1189), [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L121). A hybrid `fs.watch`/poll fallback would tighten feedback loops.

7. **Improve plan lifecycle tracking.** The principles comparison correctly notes that plans exist as files but are not tracked as active/completed/abandoned artifacts with decision logs or indexes: [docs/DISCORD-WORKFLOW-VS-PRINCIPLES.md](/home/pseudo/nanoclaw/docs/DISCORD-WORKFLOW-VS-PRINCIPLES.md#L74). Add plan metadata, plan indexes, and explicit approval/finalization state inside `control/`.

8. **Upgrade observability and QA loops.** `!agent_status` is coarse, Argus is mostly passive, and there is no automatic build/test/log inspection loop in the Discord workflow: [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L556), [docs/DISCORD-WORKFLOW-VS-PRINCIPLES.md](/home/pseudo/nanoclaw/docs/DISCORD-WORKFLOW-VS-PRINCIPLES.md#L62). Useful follow-ons would be `!logs`, per-stream test summaries, and automatic Argus review handoffs after Atlas/Apollo task completion.

## Bottom Line

NanoClaw’s current Discord workflow is a **file-first orchestration layer** centered on Iris as coordinator, Hermes/Athena for planning, Atlas/Apollo for execution, and watcher-driven `ws-*` channels for ongoing work. The implementation is materially more advanced than the original March 17 chat-debate design, but the repository still carries a large amount of Prometheus-era documentation and bootstrapping drift. The code you should treat as authoritative today is the 5-agent config plus the Hermes-first command flow in [src/channels/discord-commands.ts](/home/pseudo/nanoclaw/src/channels/discord-commands.ts#L116).
