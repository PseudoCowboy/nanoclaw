# Codex Review - 2026-04-03

## Task 2 - Built-in WebSearch Audit

### Conclusion

The Claude Agent SDK's built-in `WebSearch` does **not** appear to use Gemini in the current NanoClaw setup.

### Evidence

- `container/agent-runner/src/index.ts` passes `'WebSearch'` and `'WebFetch'` into the Claude SDK `query()` call via `allowedTools`.
- That same runner imports `query` from `@anthropic-ai/claude-agent-sdk`; NanoClaw does not provide any custom implementation for `WebSearch`.
- The published SDK surface for `query()` exposes `allowedTools`, `disallowedTools`, `tools`, etc., but no option to configure a search provider/backend.
- The SDK tool type for `WebSearchInput` only exposes `query`, `allowed_domains`, and `blocked_domains`; there is no Gemini routing field.
- `container/skills/gemini/SKILL.md` documents Gemini CLI as a separate tool path with its own built-in web search.
- `container/skills/web-search/SKILL.md` is also separate; it uses `curl`/DuckDuckGo and `agent-browser`, not Gemini.

### What would be required to route search through Gemini?

You cannot do that by changing `allowedTools` alone. The current SDK integration only enables Anthropic's built-in `WebSearch` tool; it does not let NanoClaw replace that tool's internals.

Practical options:

1. Remove/disable the built-in `WebSearch` tool and add a custom search tool instead.
2. Implement that custom tool as an MCP server or host-side IPC tool that shells out to `gemini -p "..."` and returns structured search results.
3. Update the system prompt/skills so agents use the custom Gemini-backed search tool instead of Anthropic `WebSearch`.

If the user specifically wants the tool named `WebSearch` to be Gemini-backed, that likely requires Anthropic SDK support that does not exist here today. In NanoClaw, the realistic solution is a **new custom tool** that replaces the built-in one in practice.

### Is `container/skills/web-search/SKILL.md` a viable alternative?

Partially.

It is a viable **fallback search workflow**, but it is **not** a replacement for the built-in `WebSearch` tool and it does **not** satisfy the expectation that web search uses Gemini.

Why it falls short:

- It depends on the agent choosing a skill/Bash workflow, not invoking the built-in tool.
- It uses DuckDuckGo instant answers or browser-driven Google/DuckDuckGo pages, not Gemini.
- It returns unstructured human-driven search results, not a first-class SDK/MCP search tool.

Recommendation: if Gemini-backed search is the requirement, build a dedicated Gemini search tool and remove built-in `WebSearch` from the runner to avoid ambiguous behavior.

## Task 3 - Proposed Commit Grouping Review

### Conclusion

The proposed groups are directionally good, but a few commits are miscategorized or too broad to squash safely without manual review.

### What looks solid

- Group B (`e29bc6d`, `38d98c5`, `fa11d16`, `e517e76`) is coherent as the Discord channel and infrastructure base.
- Group D (`078ce0f` through `4ac8563`) is coherent as Unified Iris + multi-JID support.
- Group E (`a3ac845` through `83133f9`) is coherent as Discord orchestration commands.
- Group F (`b47e8dc` through `814314c`, plus related implementation commits) is coherent as the file-based discussion system.
- Group G (`7109778`, `0f2cc10`, `0c50010`, `9f8b1a5`, `e875995`) is coherent as workstream execution and watcher automation.
- Group H (`cc65f47`, `339729c`, `1ec22c3`, `6e5001e`, `1bd6e33`, `f7a04be`) is coherent as the multi-agent fix and later Phase 6-7 follow-up work.

### Improvements I would make

1. `a1f49b5` should not be in Group A.

It is an unrelated financial-data design doc, not infrastructure/setup. It should be its own docs commit or dropped from the cleanup if it is not meant to ship with this line of work.

2. `9a34f09` should not be in "Formatting & Style."

Its message is `feat: commit local customizations before upstream merge`, which makes it another catch-all snapshot commit, not a style commit. It needs manual redistribution into real groups, or its own temporary/local bucket if you cannot safely split it.

3. `7b9f2ef` and `9a34f09` are both risky squash anchors.

Their commit messages indicate broad snapshot commits (`commit all uncommitted project changes`, `commit local customizations`). Before squashing, inspect their diffs and redistribute the contained changes into the real logical groups. Otherwise those groups will hide unrelated edits.

4. Group I should probably disappear.

Pure formatting commits are better folded into the feature group they belong to:

- `ea69d37` should be absorbed into the adjacent feature/docs group its formatting touched.
- `cd999f2`, `6de1125`, and `c269ccc` are already correctly paired with their surrounding feature groups.

5. `61cc445` and `09cab74` are borderline between Group C and Group F.

If those docs/plans are specifically for the earlier Hermes/Prometheus planning-discussion work, Group C is acceptable. If they were the design/plan for the later file-based discussion workflow, they belong with Group F instead.

### Recommended cleaned grouping

- Group A: infrastructure/container/tooling only
  `7d852d8`, `d12404f`, `099a44f`, `39657db`
- Group A2: catch-all snapshot commits that should be redistributed before squash
  `7b9f2ef`, `9a34f09`
- Group B: Discord channel + agent bot framework
  `e29bc6d`, `38d98c5`, `fa11d16`, `e517e76`
- Group C: Hermes/Prometheus planning agents
  `f6e9aa3`, `aecba75`, `7a2e8fb`, `c7c8b64`
- Group C2 or F-prep: planning discussion docs
  `61cc445`, `09cab74`
- Group D: Unified Iris + multi-JID support
  `078ce0f`, `9c0ed96`, `58a9abd`, `7c39996`, `cac0437`, `b15c552`, `b839910`, `a16e8c3`, `4ac8563`
- Group E: Discord orchestration commands
  `a3ac845`, `06be542`, `7bb7dd6`, `6de1125`, `3ef8609`, `cd999f2`, `83133f9`
- Group F: file-based discussion system
  `b47e8dc`, `3584a2a`, `e806ade`, `4c98693`, `e5450bc`, `d8645e7`, `70dc26a`, `86414a1`, `428725e`, `622c3ae`, `814314c`, `c269ccc`
- Group G: workstream execution/watchers
  `7109778`, `0f2cc10`, `0c50010`, `9f8b1a5`, `e875995`
- Group H: multi-agent fix + Phase 6-7
  `cc65f47`, `339729c`, `1ec22c3`, `6e5001e`, `1bd6e33`, `f7a04be`
- Group I: unrelated standalone docs
  `a1f49b5`

## Task 5 - Discord Workflow vs Principles After Phase 6-7

### Conclusion

The 2026-03-24 analysis is now **partly outdated**. Several gaps identified there have improved materially, but a few important issues still remain, and one new nuance was introduced by the Phase 7 branch work.

### What improved since the previous analysis

#### P1. Repo as single source of truth

Improved.

- There is now a real plan lifecycle index in SQLite via `trackPlanInIndex()`, `completePlanInIndex()`, and `cmdPlans()`.
- Project workspaces now have a standardized file-first structure under `groups/shared_project/active/{project}/`.
- Planning/discussion state and stream watcher state are persisted and rehydrated.

The previous claim that there was "no plan index" and "no lifecycle tracking" is no longer accurate.

Remaining gap:

- There is still no central `ARCHITECTURE.md` / `AGENTS.md` style repo map.
- There is still no explicit decision log artifact.

#### P2. Agent legibility

Improved, but not solved.

- `channelBranchMap`, `branchName` propagation, and container-side branch checkout create real branch-aware execution.
- Stream watchers persist `currentBranch` and recover after restart.
- Workspace watchers and stream watchers provide more inspectable status than before.

But this is still **not true workspace isolation**.

Important nuance/new gap:

- All project-scoped agents mount the same host project directory at `/workspace/shared`.
- Phase 7 checks out the assigned branch **inside that shared bind mount**.
- That means concurrent agents on different branches can still interfere with the same working tree and `.git` state.

So the earlier "no worktree isolation" criticism remains fundamentally valid. Phase 7 improves branch discipline, merge flow, and crash recovery, but it is not equivalent to per-agent worktrees.

#### P3. Enforce architecture mechanically

Still mostly unchanged.

- `lint-check.sh` is scaffolded into project workspaces.
- Argus review protocol can run it if the project customizes it.

But there is still no real architecture enforcement:

- no enforced lints by default,
- no dependency-boundary rules,
- no structural tests,
- no CI-backed architectural invariants.

The previous analysis remains accurate here except that there is now at least a placeholder hook for mechanical checks.

#### P4. Build feedback loops, not instructions

Significantly improved.

- Argus is no longer just a conceptual monitor.
- `stream-watcher.ts` drives a concrete implementation loop: `implemented -> in_review -> approved/changes_requested -> retry/escalate`.
- Review rounds are counted and escalated to `control-room` after repeated failure.
- Watchers provide hourly status updates and silence detection.

The previous statement that "Argus is a ghost" is no longer accurate for workstream execution.

Remaining gap:

- The discussion/planning flow is still less rigorous than the workstream loop.
- Feedback loops are orchestration-specific; they are not generalized into repo-wide review/CI automation.

#### P5. Plans as first-class artifacts

Improved.

- Plans/discussions now have active/completed lifecycle tracking in SQLite.
- Standardized project and plan folders are created automatically.

Remaining gap:

- No explicit decision log.
- Lifecycle tracking exists for Discord orchestration state, not for all repo plans under `docs/plans/`.

#### P6. Continuous garbage collection

Still weak.

- There is better monitoring of active workflows.
- Restart rehydration reduces drift in orchestration state.

But the original gap still stands:

- no scheduled quality scans,
- no automated drift detection,
- no proactive stale-branch/container cleanup strategy,
- no periodic Argus quality patrol outside active workstreams.

#### P7. Throughput over gatekeeping

Mixed.

- The system is more parallel-capable than before: project/workstream decomposition, task-state automation, and branch-aware task flow all improve throughput.
- The per-task review loop is now explicit and machine-driven rather than purely human-driven.

But there are still bottlenecks:

- `!blocker` explicitly escalates to humans.
- The review gate is serialized per task.
- The Phase 7 branch model still shares one working tree, so safe parallelism is weaker than it appears.

#### P8. Boring technology

Still accurate.

The workflow remains based on Discord, git, markdown files, SQLite, Node.js, and shell scripts. No new concern here.

### Updated verdict summary

- P1 improved from partial to stronger partial.
- P2 improved, but the old "needs real workspace isolation" conclusion still stands.
- P3 remains a major gap.
- P4 improved substantially; Argus is now meaningfully active in workstream review.
- P5 improved; plan lifecycle tracking now exists.
- P6 remains a major gap.
- P7 improved operationally, but shared-working-tree branch checkout limits true parallel safety.
- P8 unchanged and still good.

## Task 6 - Goal vs Current Status Gap Analysis

### User goals

From `docs/SPEC.md` and `docs/REQUIREMENTS.md`, the core user goals are:

1. A personal multi-channel assistant.
2. Real container isolation for agent execution.
3. Persistent memory per conversation/group, plus controlled global memory.
4. Scheduled task automation that runs the same agent stack.
5. Web access and browser automation inside containers.
6. A Discord-native multi-agent development workflow.
7. File-based collaboration and coordination between agents.
8. Tight, code-level customization rather than a large configuration platform.

### What has been achieved since the 2026-03-24 analysis

#### 1. Discord orchestration matured substantially

This is the biggest area of progress.

- `src/channels/discord-commands/` is now a substantial subsystem, not a stub.
- It supports project creation, planning, discussion, decomposition, workstreams, checkpoints, monitoring, workspace watching, stream watching, and orchestration-state persistence.
- Workstream execution now has a real review gate with `task-state.json` and Argus review rounds.
- Project/plan/discussion state survives restarts through SQLite rehydration.

#### 2. File-based collaboration is now concretely implemented

- Shared project workspaces live under `groups/shared_project/active/{project}/`.
- Plans, coordination files, workstreams, discussions, and task state are all file-backed.
- Discussion folders and project workspaces are git-backed.

This is a major step beyond the earlier gap analysis.

#### 3. Project-scoped context/isolation improved

- `projectSlug` is propagated into container execution.
- Per-project memory files are created under each group's `projects/{projectSlug}/CLAUDE.md`.
- Shared mounts are scoped to the active project when possible.

#### 4. Per-agent branch flow now exists

- Discord workstreams assign branch names.
- Branch state is persisted and passed through the message loop into the container runner.
- The container runner checks out the designated branch before invoking Claude.

This is real progress even though it is not yet equivalent to true worktree isolation.

#### 5. AI tool integration in containers improved

- Container skills now include `codex`, `gemini`, `agent-browser`, `discord-*`, `git-workflow`, and `web-search`.
- Gemini OAuth credentials are mounted into containers read-only when available.
- Claude's built-in `WebSearch`/`WebFetch` are enabled in the runner.

#### 6. Multi-channel status improved modestly

- Discord and Telegram are implemented channels.
- The registry/barrel loader supports optional channel modules.
- The database and routing layer understand `dc:` and `tg:` JIDs.

### Current status by major goal

#### Multi-channel personal assistant

Partial.

- Implemented: Discord, Telegram.
- Present in schema/routing assumptions but not implemented in current `src/channels/`: WhatsApp.
- Still missing: Slack, Gmail.

This is below the stated vision in the docs, especially because the requirements still frame WhatsApp as primary I/O.

#### Container-isolated agent execution

Mostly achieved.

- Agents run in containers with explicit mounts.
- Non-main groups get restricted visibility.
- Per-group sessions and IPC namespaces are isolated.
- Additional host mounts are validated against an external allowlist.

This is one of the strongest parts of the current system.

#### Persistent memory and isolation

Mostly achieved.

- Per-group folders exist.
- Non-main groups get global memory read-only.
- Per-project memory exists.
- Session state is stored per group.

The remaining concern is mostly documentation/discoverability, not core implementation.

#### Scheduled tasks and automation

Achieved at core infrastructure level.

- Scheduler loop exists.
- Tasks are stored in SQLite.
- IPC supports task creation/control.
- Scheduled tasks run through the container agent flow.

The remaining gap is not basic capability; it is higher-level use of the scheduler for quality/maintenance workflows.

#### Discord multi-agent workflow

Substantially achieved.

- This area has moved from "interesting prototype" to a real orchestration system.
- The main remaining issue is safe parallel workspace isolation and stronger mechanical enforcement.

#### File-based collaboration

Achieved.

- This is now a first-class pattern throughout the Discord workflow.

#### AI tool integration (Claude, Codex, Gemini)

Partial to strong partial.

- Claude is the core runtime.
- Codex and Gemini are available inside containers as skills/CLI workflows.
- Gemini authentication is wired into the container.

Remaining gap:

- Gemini is not integrated as the backend for the built-in Claude `WebSearch` tool.
- Codex/Gemini are auxiliary agent tools, not deeply unified runtime backends.

### Remaining gaps

#### 1. Channel coverage is still incomplete

The largest product gap versus the stated goals is channel support.

- WhatsApp is not implemented in the current channel directory.
- Slack and Gmail are still placeholders.
- The docs still describe a broader multi-channel assistant than the code currently delivers.

#### 2. Phase 7 branch isolation is not true parallel workspace isolation

This is the biggest architectural caveat in the new Discord workflow.

- Agents on different workstreams still mount the same project checkout.
- Branch checkout happens inside that shared checkout.
- That can still create cross-agent interference during concurrent work.

If the goal is safe parallel multi-agent implementation, the next step is per-agent worktrees or equivalent per-agent project clones, not just branch naming.

#### 3. Mechanical enforcement is still weak

- `lint-check.sh` is only a template.
- There is no default architectural linter, dependency boundary enforcement, or CI-backed invariant checking.
- Argus review is valuable, but it is still largely policy/process-driven rather than mechanically enforced.

#### 4. Repo knowledge structure is still incomplete

- No top-level `ARCHITECTURE.md` or `AGENTS.md` style map.
- No durable decision log.
- Discord orchestration state is well structured, but repo-wide progressive disclosure is still missing.

#### 5. Continuous garbage collection/drift detection is still missing

- Scheduler infrastructure exists, but it is not yet being used for periodic quality scans.
- There is no automated stale-branch cleanup or continuous architecture drift detection.

#### 6. Web search backend expectations are not met

- The built-in Claude SDK `WebSearch` is still Anthropic-owned behavior.
- The Gemini skill exists, but search is not routed through it automatically.

### Bottom line

Compared with the 2026-03-24 analysis, NanoClaw has made **real, material progress** in the Discord multi-agent workflow, file-based collaboration, project-scoped execution, and container tool integration.

The main things still missing are:

- broader channel coverage,
- true concurrent workspace isolation,
- stronger mechanical enforcement,
- better repo-level knowledge/decision structure,
- and explicit Gemini-backed search tooling if that is a hard requirement.
