# NanoClaw Discord Multi-Agent Workflow Analysis

This analysis is based on the current code and docs in the repo as of 2026-04-03. When docs, skills, and code disagree, I treat the current code as the ground truth and call out the drift explicitly.

## Sources Read

- `ARCHITECTURE.md`
- `multi-agent-file-first-workflow.md`
- `docs/DISCORD-WORKFLOW-VS-PRINCIPLES.md`
- `docs/discord-bot-summary.md`
- `docs/AGENT-FIRST-PRINCIPLES.md`
- `agents/config.json`
- `src/channels/discord-commands/planning.ts`
- `src/channels/discord-commands/discussion.ts`
- `src/channels/discord-commands/workstreams.ts`
- `src/channels/discord-commands/stream-watcher.ts`
- `src/channels/discord-commands/project.ts`
- `src/channels/discord-commands/workspace-watcher.ts`
- `src/channels/discord-commands/constants.ts`
- `src/container-runner.ts`
- `agents/shared/agent-runner.ts`
- `container/skills/discord-discussion/SKILL.md`
- `container/skills/discord-plan/SKILL.md`
- `container/skills/discord-project/SKILL.md`
- `container/skills/discord-workstream/SKILL.md`
- `container/skills/discord-review-workstream/SKILL.md`
- `container/skills/discord-review/SKILL.md`
- `container/skills/discord-status/SKILL.md`
- `groups/dc_athena/CLAUDE.md`
- `groups/dc_hermes/CLAUDE.md`
- `groups/dc_atlas/CLAUDE.md`
- `groups/dc_apollo/CLAUDE.md`
- `groups/dc_argus/CLAUDE.md`

## Executive Take

NanoClaw is trying to turn Discord into a human-friendly control plane for a file-first software factory. Discord is the UI. Git-backed files under `groups/shared_project/active/<project>/` are the actual shared state. Iris is the orchestrator. Athena and Hermes handle planning. Atlas and Apollo implement. Argus reviews and monitors.

The system is materially more concrete on the implementation side than on the planning side. The development workflow has a real state machine, branch/worktree-aware execution, review gating, monitoring, and restart recovery. The discussion workflow is lighter: it is mostly a one-pass Hermes -> Athena -> Hermes handoff dressed in docs/skills that still describe a richer multi-round debate system.

## 1) Full Discussion Workflow

### Project setup context

1. `!create_project <Name>` creates a project category plus `#control-room`, `#plan-room`, and `#release-log`, initializes `groups/shared_project/active/<slug>/`, registers the channels with Iris, persists the project in SQLite, and starts a workspace watcher. See `src/channels/discord-commands/project.ts:31-201`.
2. The workspace created by `initProjectWorkspace()` is explicitly file-first: `control/`, `coordination/`, `workstreams/`, and `archive/`. The human is told to write `control/draft-plan.md` before starting planning. See `src/channels/discord-commands/project.ts:116-145` and `src/channels/discord-commands/helpers.ts`.

### Project-scoped planning via `!plan`

1. A human runs `!plan <topic>` in `#plan-room` or `#control-room`. The command rejects other channels. See `src/channels/discord-commands/planning.ts:25-42`.
2. Iris resolves the project slug from the Discord category, creates a plan folder under `active/<project>/plans/plan-<slug>/`, and writes `plan.md`. If `control/draft-plan.md` exists, it is appended into `plan.md` so the human can seed the discussion through the workspace instead of chat alone. See `src/channels/discord-commands/planning.ts:61-100`.
3. Iris commits the initial artifact as `Iris <iris@nanoclaw>`, stores a planning session plus discussion session in memory and SQLite, and records the plan in the plan index. See `src/channels/discord-commands/planning.ts:102-145`.
4. If the command was issued in `#control-room`, Iris reroutes the live discussion into `#plan-room` but leaves the session metadata attached to both channels. See `src/channels/discord-commands/planning.ts:134-155`.
5. Iris posts a welcome embed explaining a 4-step workflow, starts a discussion watchdog, and then triggers Hermes first with an explicit file-first prompt: read `plan.md`, ask the human questions, create `plan-v2.md`, commit, and hand off to Athena. See `src/channels/discord-commands/planning.ts:158-199`.

### Ad hoc planning via `!create_discussion`

1. `!create_discussion "topic"` creates a top-level `DISCUSSIONS` category if needed, then creates a dedicated `#discuss-<slug>` channel. See `src/channels/discord-commands/discussion.ts:212-276`.
2. Iris creates a git-initialized shared folder at `groups/shared_project/discuss-<slug>/`, tracks the discussion in memory/SQLite, and adds it to the plan index. See `src/channels/discord-commands/discussion.ts:274-299` and `src/channels/discord-commands/helpers.ts:43-90`.
3. Iris posts a welcome embed telling the human to paste draft content. A one-shot content handler waits up to 10 minutes; pasted content becomes `plan.md` and gets committed by Iris. Typing `yes`/`ready` skips the save step if the files were placed manually. See `src/channels/discord-commands/discussion.ts:301-413`.
4. Once content exists, Iris marks Hermes as current, stores a paired planning session, and triggers Hermes with the same basic instruction: read files, ask questions, create `plan-v2.md`, commit, hand off to Athena. See `src/channels/discord-commands/discussion.ts:392-413`.

### How the actual agent debate works

1. The trigger model is split by agent type. Athena and Hermes have `listenToBots: true`, so they can hear Iris and each other in `plan-room` and `discuss-*`. Atlas, Apollo, and Argus are `iris-only`, so they do not participate in planning chatter. See `agents/config.json:4-29` and `agents/shared/agent-runner.ts:253-283`.
2. Hermes is explicitly first reviewer and Athena is explicitly second architect, both in their `CLAUDE.md` files and in `DISCUSSION_CHAIN`. See `groups/dc_hermes/CLAUDE.md`, `groups/dc_athena/CLAUDE.md`, and `src/channels/discord-commands/constants.ts:3-6`.
3. The discussion watchdog is simple. It watches for bot messages mentioning `@Athena`, then `@Hermes`, then a completion phrase like `Planning complete` or `Discussion complete`. It also posts a 5-minute nudge if the expected agent has not handed off. See `src/channels/discord-commands/discussion.ts:43-209`.
4. When Hermes posts the completion phrase, Iris marks the plan complete in the plan index, deletes the active planning/discussion session for the live channel, and posts the full final `plan-v2.md` back into Discord. See `src/channels/discord-commands/discussion.ts:99-186`.

### What the current planning workflow really is

The current code implements a 4-step linear handoff:

1. Human input
2. Hermes review and clarification
3. Athena architecture refinement
4. Hermes finalization

That is not the same thing as the richer 3-round debate protocol still described in `container/skills/discord-discussion/SKILL.md`, which talks about an explicit disagreement round, `disagreements.md`, and Iris-orchestrated resolution. The code never announces or enforces those extra rounds. It only watches a single Hermes -> Athena -> Hermes chain.

### Planning-phase artifacts

- Project mode: `active/<project>/control/draft-plan.md`, `active/<project>/plans/plan-<slug>/plan.md`, `active/<project>/plans/plan-<slug>/plan-v2.md`
- Ad hoc mode: `groups/shared_project/discuss-<slug>/plan.md`, `plan-v2.md`
- Tracking: SQLite `planning_session`, `discussion_session`, and `plan_index`

## 2) Full Development Workflow

### Decomposition from plan to workstreams

1. A human runs `!decompose [stream types]` from `#plan-room` or `#control-room`. If no types are given, Iris keyword-scans the plan for stream hints and otherwise defaults to `backend frontend qa`. See `src/channels/discord-commands/workstreams.ts:41-85` and `src/channels/discord-commands/planning.ts:221-259`.
2. Iris finds the best available plan source in this order: current planning-session `plan-v2.md`, legacy top-level `plan-v2.md`, `control/approved-plan.md`, then `control/draft-plan.md`. See `src/channels/discord-commands/workstreams.ts:92-159`.
3. Iris pre-creates `workstreams/<stream>/` folders and scaffold files (`scope.md`, `progress.md`, `handoffs.md`). See `src/channels/discord-commands/workstreams.ts:161-168` and `src/channels/discord-commands/helpers.ts`.
4. Iris writes `control/plan-for-decompose.md` and `control/decompose-instructions.md`, then @mentions Hermes to extract real `tasks.md` and improve `scope.md` for each stream. It waits up to 5 minutes, polling every 10 seconds for checkbox content in each `tasks.md`. See `src/channels/discord-commands/workstreams.ts:170-255` and `src/channels/discord-commands/constants.ts:8-12`.
5. Iris creates a `#ws-*` channel for each stream, registers it so NanoClaw receives messages, maps the Discord channel to the project slug, posts the workspace instructions, and @mentions the lead agent for the first task. See `src/channels/discord-commands/workstreams.ts:263-381`.
6. A decomposition summary is written to `control/decomposition.md` and cross-posted to `#control-room`. See `src/channels/discord-commands/workstreams.ts:384-463`.

### Workstream execution model

1. Each stream gets a lead agent from `WORKSTREAM_DEFS`. In practice, the state machine always uses `def.agents[0]` as the worker who does the task. See `src/channels/discord-commands/constants.ts:51-90` and `src/channels/discord-commands/stream-watcher.ts:464-468`.
2. When the stream watcher starts, it parses `tasks.md` into `task-state.json` if needed. Each checkbox becomes a numbered task with initial status `pending` or `approved` if already checked. See `src/channels/discord-commands/stream-watcher.ts:97-149`.
3. The state machine is driven by `task-state.json` statuses:
   - `pending`
   - `in_progress`
   - `implemented`
   - `in_review`
   - `changes_requested`
   - `approved`
   - `merge_conflict`
4. On the first `pending` task, the watcher marks it `in_progress`, ensures an agent branch like `agent/atlas/backend`, stores that branch on the Discord channel, and pings the lead agent with the branch name. See `src/channels/discord-commands/stream-watcher.ts:763-797`.

### How the implementation agent actually runs

1. Atlas and Apollo only respond to Iris-triggered bot messages in `ws-*` channels because they are `iris-only`. See `agents/config.json:30-68` and `agents/shared/agent-runner.ts:253-283`.
2. The agent bot extracts the branch name from Iris's latest message, resolves the project slug from the Discord category, and passes both into `runContainerAgent()`. See `agents/shared/agent-runner.ts:309-345`.
3. The container runner creates a per-agent git worktree when both `projectSlug` and `branchName` are set, then mounts that worktree at `/workspace/shared`. So the current implementation is not merely "branch naming"; it does have real per-invocation worktree mounts. See `src/container-runner.ts:161-180`.
4. Inside the container, the agent runner verifies that `/workspace/shared` is on the expected branch and aborts if not. See `container/agent-runner/src/index.ts:642-656`.
5. Atlas/Apollo follow `discord-workstream` plus their own `CLAUDE.md`:
   - read `workstreams/<stream>/tasks.md`
   - implement exactly one task
   - mark the checkbox complete
   - update `progress.md`
   - commit code
   - set the current task to `implemented` in `task-state.json` and record `lastCommit`
   - commit the state update
   - post a Discord summary and exit

### Review gate and next-task loop

1. The stream watcher polls every 10 minutes. If it sees `implemented`, it changes that task to `in_review` and @mentions Argus with the task number, commit, and branch. See `src/channels/discord-commands/stream-watcher.ts:609-630` and `src/channels/discord-commands/constants.ts:8-12`.
2. Argus follows `discord-review-workstream` plus `groups/dc_argus/CLAUDE.md`:
   - read `task-state.json`
   - diff `main...agent/<name>/<stream>` when possible
   - run mechanical checks if the project exposes them
   - review the task semantically against `scope.md`, `tasks.md`, and GOLDEN-PRINCIPLES
   - update the task to `approved` or `changes_requested`
   - increment `reviewRounds`
   - post the verdict in Discord
3. If Argus approves, the watcher merges the agent branch into `main`, deletes the branch, finds the next `pending` task, creates a fresh agent branch from `main`, updates `task-state.json`, and pings the lead agent again. See `src/channels/discord-commands/stream-watcher.ts:633-719`.
4. If Argus requests changes, the watcher sets the task back to `in_progress`, keeps the same branch, clears `lastReviewedTaskId`, and pings the lead agent to fix and resubmit. See `src/channels/discord-commands/stream-watcher.ts:722-752`.
5. If the merge fails, the watcher aborts the merge, sets the task to `merge_conflict`, and escalates to `#control-room` for human intervention. See `src/channels/discord-commands/stream-watcher.ts:646-669`.
6. If a task reaches 3 review rounds, the watcher escalates to `#control-room`. See `src/channels/discord-commands/stream-watcher.ts:740-750`.
7. When every task in `task-state.json` is `approved`, the watcher marks the workstream complete, posts a completion embed to `#control-room`, and stops. See `src/channels/discord-commands/stream-watcher.ts:587-597` and `src/channels/discord-commands/stream-watcher.ts:894-950`.

### Monitoring and coordination during development

1. The stream watcher posts hourly status reports to `#control-room` and alerts after 1 hour of silence. See `src/channels/discord-commands/stream-watcher.ts:812-863`.
2. The workspace watcher polls every 30 seconds for file changes in `progress.md`, `handoffs.md`, and `coordination/*.md`. It posts progress updates, auto-syncs `coordination/status-board.md`, and alerts the control room when dependencies become blocked or handoffs are marked delivered. See `src/channels/discord-commands/workspace-watcher.ts` and `src/channels/discord-commands/constants.ts:17-18`.
3. Humans can also use `!handoff`, `!stream_status`, `!dashboard`, `!checkpoint`, `!checkpoints`, and `!blocker` to inspect or steer execution.

### Development-phase artifacts

- `control/plan-for-decompose.md`
- `control/decompose-instructions.md`
- `control/decomposition.md`
- `workstreams/<stream>/scope.md`
- `workstreams/<stream>/tasks.md`
- `workstreams/<stream>/progress.md`
- `workstreams/<stream>/handoffs.md`
- `workstreams/<stream>/task-state.json`
- `coordination/progress.md`
- `coordination/dependencies.md`
- `coordination/integration-points.md`
- `coordination/status-board.md`

## 3) Inferred Ultimate Goal

The user’s ultimate goal appears to be:

- Use Discord as a lightweight operating console for software delivery, because humans already know how to coordinate there.
- Keep the real source of truth in repo-visible files and git history so agents can reason from durable artifacts instead of chat memory.
- Break software delivery into specialized agent roles with clear triggers, isolated execution environments, and bounded responsibilities.
- Minimize human micromanagement by letting Iris orchestrate planning, decomposition, implementation, review, monitoring, and escalation.
- Build an "agent-first" development system where humans set direction, review key decisions, and resolve escalations, while agents do the routine plan/build/review loop.

In short: this is trying to become a repo-native, Discord-driven agent software factory rather than a normal chatbot.

## 4) Biggest Strengths

- The core architecture is coherent. Discord is just the control plane; durable state lives in markdown, JSON, git, and SQLite.
- Roles are explicit and legible. Athena plans, Hermes critiques, Atlas/Apollo implement, Argus reviews, and Iris orchestrates.
- The implementation workflow is a real state machine, not just prompt theater. `task-state.json` materially drives execution, review, retries, and completion.
- The agent trigger model is thoughtfully scoped. Planning agents can hear bot-to-bot handoffs; implementation agents only respond to Iris, which reduces loop risk.
- The current code does support branch-aware isolated execution by mounting per-agent worktrees when a project slug and branch are available. That is stronger than several stale docs imply.
- Monitoring is built into the workflow. There are hourly stream reports, silence detection, progress file watching, control-room escalations, and restart recovery for active projects and stream watchers.
- The artifacts are inspectable by humans and agents. A human can open the project folder and see the exact plan, decomposition, task state, progress, dependencies, and handoffs.

## 5) Biggest Gaps

### The planning workflow is underspecified compared to the implementation workflow

- The code implements a simple 4-step Hermes -> Athena -> Hermes pass, but `discord-discussion` still describes a richer 3-round debate with `disagreements.md` and explicit resolution. That richer protocol is not actually enforced.
- `container/skills/discord-plan/SKILL.md` is stale. It describes Athena-first orchestration over IPC, while the current code triggers Hermes first and relies on Discord-native bot triggers.
- `container/skills/discord-project/SKILL.md` is stale. It still describes `/workspace/shared/projects/PROJECT_NAME/...`, while the current implementation uses `groups/shared_project/active/<slug>/control|coordination|workstreams|archive`.

### Planning state persistence is incomplete

- Planning and discussion sessions are persisted to SQLite, but `rehydrateOrchestrationState()` only restores projects and stream watchers. There is no restart recovery for active planning/discussion sessions or watchdog listeners. See `src/channels/discord-commands/stream-watcher.ts:211-245` and `src/channels/discord-commands/stream-watcher.ts:246-349`.
- If `!plan` starts from `#control-room`, the code stores duplicate planning/discussion session entries for both `control-room` and `plan-room`, but completion cleanup only deletes the active channel entry. That can leave stale session state behind and potentially block future `!plan` runs from `#control-room`. See `src/channels/discord-commands/planning.ts:119-151` and `src/channels/discord-commands/discussion.ts:107-112`.

### Decomposition is still fairly brittle

- Stream auto-detection is just keyword scanning.
- Hermes decomposition is trusted if `tasks.md` merely contains checkboxes; there is no semantic validation of task quality or coverage.
- If Hermes misses the timeout, the system falls back to generic scope rather than guaranteeing a usable task graph.

### Mechanical enforcement remains weak

- The system scaffolds `lint-check.sh`, but there is still no default structural enforcement of architecture boundaries, contracts, or layering.
- Argus can run checks if the project provides them, but nothing guarantees that projects define meaningful checks.
- The implementation side has orchestration discipline, but not yet strong automatic design discipline.

### Polling makes the loop slower than it needs to be

- Stream progression is driven by a 10-minute poll interval. That means review triggers and next-task triggers can lag behind the agent’s actual completion unless the poll happens to hit soon after the update.
- Planning nudges and decomposition waits are also timer-driven rather than event-driven.

### Some workstream types are only partially real

- `ws-qa` assigns Argus as the lead agent, but the watcher always routes reviews to `@Argus` as well. That means the QA stream can devolve into Argus reviewing Argus. See `src/channels/discord-commands/constants.ts:67-73` and `src/channels/discord-commands/stream-watcher.ts:610-626`.
- Multi-agent streams such as `design` (`Apollo`, `Athena`) and `research` (`Athena`, `Hermes`) are declared, but the state machine only ever drives the first agent in `def.agents[0]`. There is no real multi-agent execution protocol inside a single workstream.

### Documentation drift is significant enough to confuse agents and humans

- `docs/discord-bot-summary.md` still describes `backend-dev`, `frontend-ui`, and `qa-alerts` as part of project creation, but the current code creates only `control-room`, `plan-room`, and `release-log`, with `ws-*` channels created later.
- `multi-agent-file-first-workflow.md` still includes Prometheus and a broader 3-round planning design that is not present in `agents/config.json` or the current code.
- Several docs criticize the system for lacking isolation even though the current runtime path now mounts per-agent worktrees for project-scoped branch executions.

## Bottom Line

The current NanoClaw Discord workflow already has the skeleton of a serious multi-agent delivery system. The implementation/review loop is the strongest part: it is explicit, file-backed, observable, and guarded by a real review gate. The planning/debate loop is the weaker part: it is useful, but still simpler than the surrounding docs and skills claim.

If the goal is a dependable agent-first software factory, the next level of maturity is not more prompts. It is tightening the mismatches: make planning as stateful and recoverable as implementation, remove stale skills/docs, strengthen mechanical checks, and formalize the stream types that currently exist more as labels than as fully implemented protocols.
