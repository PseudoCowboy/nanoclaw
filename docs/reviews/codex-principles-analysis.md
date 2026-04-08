# NanoClaw Multi-Agent Discord Workflow Analysis Through Agent-First Principles

## Scope

This analysis traces the multi-agent Discord workflow from the March design/planning docs through the April 3 implementation, gap analysis, worktree isolation work, and stale-doc cleanup.

Primary artifacts reviewed:

- `docs/AGENT-FIRST-PRINCIPLES.md`
- `docs/plans/2026-03-17-*`, `docs/plans/2026-03-18-*`, `docs/plans/2026-03-25-*`, `docs/plans/2026-04-03-*`
- Key commits: `c419037`, `354090e`, `2926668`, `32ad96d`, `9019d78`, `a032c3d`, `4ec8cbc`, `a7502ab`, `cb94cb2`
- Current implementation and docs under `src/channels/discord-commands/`, `container/skills/`, `agents/config.json`, `ARCHITECTURE.md`, and `docs/discord-bot-summary.md`

The goal here is not to restate the principles. It is to show how the absence of each principle created concrete problems during this workflow's development, and how to turn each principle into an active guardrail that would have prevented those problems.

## Development Arc

### Round 1: Initial multi-agent concept and Discord orchestration plans

The March 17 plan set established three parallel ideas:

- `2026-03-17-planning-discussion-system-*`: 3-round planning debates with Athena, Hermes, and Prometheus.
- `2026-03-17-discord-orchestration-commands-*`: 15 commands, in-process planning session state, and command-driven Discord orchestration.
- `2026-03-17-unified-iris-*`: shared Telegram/Discord Iris, multi-JID support, and folder-level session sharing.

This round created a lot of intended behavior in docs before the system had a single stable runtime protocol.

### Round 2: Pivot to file-first discussions

The March 18 file-based discussion design replaced the original chat debate model with shared markdown, git commits, and agent handoffs. The design still described three rounds and still included Prometheus as a first-class planning agent.

This was the key architectural pivot, but the earlier documents were not retired or mechanically superseded.

### Round 3: Workstreams and watcher-driven execution

The March 25 workstream design introduced `!decompose`, `tasks.md`, `task-state.json`, stream watchers, review loops, silence detection, and restart recovery. This moved the system from "agents discuss" to "agents execute a typed workflow with state transitions".

This was the first part of the workflow that started to look like an actual state machine.

### Round 4: Large implementation burst

On April 3, the major commits landed in a compressed sequence:

- `c419037`: agent folders, planning discussion docs, unified Iris docs
- `354090e`: command surface and tests
- `2926668`: file-based discussion skills/docs
- `32ad96d`: split monolith, workstreams, watchers, multi-agent fixes, branch isolation phase
- `9019d78`: principles/gap analysis/docs

This got the feature set in quickly, but it also froze multiple generations of design assumptions into the repo at once.

### Round 5: Analysis exposed hidden defects

The gap-analysis and review docs identified problems that were not caught by the original build/test path:

- docs still described Prometheus after the active planning roster had become Hermes/Athena
- some docs and skills still described 3-round or IPC-driven flows while code used a 4-step `@mention` handoff model
- worktree isolation was still incomplete until `a032c3d` and `4ec8cbc`
- code bugs existed in orchestration state handling and restart recovery

### Round 6: Cleanup and hardening

`a7502ab` finally added `ARCHITECTURE.md`, and `cb94cb2` fixed three important orchestration bugs:

- orphaned sessions when `!plan` started in `#control-room`
- Argus self-review in `ws-qa`
- planning/discussion sessions not being fully rehydrated on restart

`cb94cb2` also cleaned a large set of stale docs and skills, which is itself evidence that the repo lacked active drift detection.

## Principle-by-Principle Analysis

### 1. Repo as Single Source of Truth

#### How its absence caused problems

The repo contained multiple competing truths at the same time.

- Early design docs described a 3-round Athena/Hermes/Prometheus planning model.
- Later skills and code moved to a 4-step Hermes/Athena file-first handoff model.
- Prometheus remained in plans, summaries, and skills after the active implementation roster had dropped to 5 agents.
- before `a7502ab`, there was no canonical architecture map showing which files actually defined the live workflow.

That meant agents and humans could both read valid-looking repo documents and come away with contradictory mental models. The stale doc cleanup in `cb94cb2` is the clearest symptom: knowledge was in the repo, but not in one authoritative, mechanically maintained place.

#### Guardrails that would have prevented it

1. Add a generated `docs/generated/discord-workflow-manifest.md` built from code.
   Source it from `agents/config.json`, `src/channels/discord-commands/index.ts`, and `src/channels/discord-commands/constants.ts`.
   Include agent roster, command list, planning chain, workstream types, and skill names.

2. Add a CI parity check: `npm run verify:workflow-docs`.
   Fail if handwritten docs mention commands, agents, or planning rounds that do not exist in the manifest.

3. Add front matter to plan/design docs: `status: proposed|active|superseded` and `supersedes:`.
   A doc linter should fail if multiple active docs describe the same workflow area.

4. Keep `AGENTS.md` and `ARCHITECTURE.md` as index docs only.
   They should link to generated manifests and current workflow docs, not restate volatile details.

Practical fit for this repo:

- easy to implement with a small Node script over existing JSON/TS exports
- cheap to run in CI and pre-commit
- directly targets the Prometheus/command/round-count drift that already happened

### 2. Agent Legibility

#### How its absence caused problems

Several failures existed because the system state was not legible enough to the agents developing it.

- The shared project mount plus container-side branch checkout remained a hidden concurrency hazard until the later worktree fixes (`a032c3d`, `4ec8cbc`).
- Orphaned planning sessions were only found by manual cross-analysis because there was no single inspectable view of "live sessions in memory vs persisted sessions in SQLite vs active Discord channels".
- Restart failures happened because round transitions were not fully persisted and watchdogs were not visibly rehydrated.
- Self-review in `ws-qa` existed because the workflow could enter an invalid-but-unseen state: lead agent and reviewer were the same actor.

In other words, the workflow was running, but its internal state was not exposed in a way that made invalid orchestration states obvious.

#### Guardrails that would have prevented it

1. Add a `!doctor_workflow` or `!orchestration_state` command.
   Show live/persisted planning sessions, discussion sessions, stream watchers, current agents, and worktree paths.
   Include invariant violations inline.

2. Emit structured orchestration events to SQLite or JSONL.
   Examples: `plan_started`, `handoff_sent`, `round_transition`, `watchdog_rehydrated`, `task_entered_review`, `invalid_state_detected`.
   Then expose them through `!dashboard` and a debug script.

3. Add integration tests for restart and concurrency scenarios.
   Tests should simulate:
   - `!plan` from `control-room`
   - process restart during step 2/3/4
   - `ws-qa` task moving to `implemented`
   - two agents using different branches in the same project

4. Add a runtime invariant checker in the Discord orchestration modules.
   On every poll tick or state change, validate rules like:
   - one discussion session per active channel
   - no planning session left on source channel after completion
   - reviewer cannot equal lead agent unless stream type explicitly allows auto-approve
   - persisted round must match current agent

Practical fit for this repo:

- this codebase already has SQLite orchestration state and watcher loops
- exposing invariant checks through existing commands is low-risk and high-value
- restart and concurrency tests would have caught the exact bugs later fixed in `cb94cb2`

### 3. Enforce Architecture Mechanically

#### How its absence caused problems

The Discord workflow depended on convention-heavy rules that were never encoded as hard constraints.

- The code allowed a reviewer topology where Argus could review Argus's own work until `cb94cb2` patched it.
- Discussion round transitions existed as convention, but missing `saveDiscussionSession()` calls meant restart recovery could silently diverge from actual runtime state.
- Docs and skills could describe IPC-driven planning while code used `@mentions`, because nothing mechanically connected the written protocol to the command/state-machine implementation.
- The original shared-worktree model survived until later because there was no structural rule forbidding container-side branch switching on a shared mount.

The pattern is consistent: the architecture existed as prose and intent, not as enforceable invariants.

#### Guardrails that would have prevented it

1. Define workflow invariants in code and test them directly.
   Add a small `workflow-invariants.ts` module with checks such as:
   - `reviewer != leadAgent` unless `autoApproveSelfReview === true`
   - every nonterminal round transition must persist durable state
   - `control-room` initiated plans must record `sourceChannelId`
   - `branchName` on project containers requires host worktree mount

2. Add a dedicated integration suite for orchestration state machines.
   Not just command parsing tests. Use fixture guild/channel/message objects to validate end-to-end transitions.

3. Add a lint rule or grep-based CI check that forbids `git checkout` inside `container/agent-runner/` when `projectSlug` is mounted.
   This encodes the worktree isolation decision mechanically.

4. Add a doc-schema check for skills that define runtime protocols.
   Required metadata should include `trigger`, `transport`, `steps`, and `source_of_truth`.
   A validator should compare those fields with the command manifest and fail on mismatches like `IPC` vs `@mentions`.

Practical fit for this repo:

- the current code is already modular enough in `src/channels/discord-commands/` to support invariant modules
- many of these checks can be plain TypeScript tests without heavy infrastructure
- this is the most direct prevention for self-review, lost-round, and stale-protocol bugs

### 4. Build Feedback Loops, Not Instructions

#### How its absence caused problems

The development process produced many instructions and plans, but too few active loops that compared intent to behavior.

- Design docs and skills described workflows, but nothing repeatedly checked whether the code still matched them.
- The important bugs were found by manual cross-analysis after the fact, not by an automated review loop during implementation.
- The workstream system had a real feedback loop for task execution, but documentation and orchestration architecture did not.

The repo had a strong implementation loop in `task-state.json`, but a weak meta-loop for "does the system we built still match the system we keep describing?"

#### Guardrails that would have prevented it

1. Add an Argus "workflow conformance" review job in CI.
   On any PR touching `src/channels/discord-commands/`, `container/skills/discord-*`, or `agents/config.json`, run a scripted review that compares:
   - command registry vs docs
   - agent roster vs docs/skills
   - planning chain constants vs skills/docs

2. Add a scheduled maintenance task using the existing task scheduler.
   Daily, run a repo scan for removed agents, removed commands, dead file paths, and stale protocol strings.
   Open a report or fail the scheduled task if mismatches are found.

3. Treat skills as executable interfaces, not prose.
   Add a tiny manifest block in each skill and verify it against code. Example fields:
   - `transport: discord-mention`
   - `participants: [Hermes, Athena]`
   - `completion_signal: Planning complete`

4. Add a post-merge smoke script for the Discord workflow.
   Script the happy path and one restart path for `!plan`, `!decompose`, and review. The goal is not exhaustive coverage. It is a fast feedback loop after changes.

Practical fit for this repo:

- NanoClaw already has a task scheduler, review agent concept, and orchestration state
- the missing step is using those capabilities to review the workflow itself, not just user projects

### 5. Plans as First-Class Artifacts

#### How its absence caused problems

NanoClaw had many plan files, but they were not treated as living artifacts with explicit lifecycle and supersession.

- Multiple design/plan pairs remained effectively active even after the workflow had changed shape.
- The system pivoted from 3-round chat debate to file-first handoffs, then to a 4-step Hermes/Athena flow, but prior docs were not formally closed out.
- Gap analysis had to reconstruct the development history manually because there was no durable record of which plan was implemented, partially implemented, or replaced.

So the repo had plan volume, but weak plan governance.

#### Guardrails that would have prevented it

1. Add a required front-matter schema for all `docs/plans/*.md` files.
   Fields:
   - `status`
   - `area`
   - `implemented_by`
   - `supersedes`
   - `superseded_by`
   - `current_runtime_doc`

2. Add a `docs/plans/index.json` generated from front matter.
   Surface active/superseded status and show which commit closed each plan.

3. Require every implementation PR/commit touching workflow code to update plan status.
   CI should fail if a workflow-area code change lands with no matching plan lifecycle update.

4. Add "decision log" sections to workflow plans.
   Example decisions that should have been explicitly recorded:
   - Prometheus removed from active planning chain
   - 3-round debate replaced by 4-step file-first handoff
   - `@mention` triggers chosen over IPC for planning agents

Practical fit for this repo:

- plan files already exist; the missing part is schema and enforcement
- a simple Markdown front-matter linter is enough to stop abandoned or conflicting workflow plans from staying "implicitly current"

### 6. Continuous Garbage Collection

#### How its absence caused problems

The stale-doc cleanup commit existed because the repo had no active garbage collector.

- removed agents and old protocol descriptions sat in docs and skills until someone manually audited the entire system.
- temporary analysis files accumulated and then had to be deleted in a later sweep.
- architecture drift built up across docs, skills, and code for weeks because no scheduled process was looking for it.

This is almost the textbook failure mode of missing garbage collection: nothing was catastrophically broken in isolation, but the total cognitive load and trust erosion kept increasing.

#### Guardrails that would have prevented it

1. Add a scheduled `argus-maintenance` task.
   Run daily using the existing scheduler. It should scan for:
   - references to non-existent agents
   - docs naming commands not in the command registry
   - stale file paths in skills
   - orchestration state rows whose channels no longer exist

2. Add a `npm run lint:docs-drift` script.
   Back it with simple static checks first. Search for strings like `Prometheus`, `IPC`, `3-round`, and compare them to the current manifest.

3. Add an orphan cleanup command and scheduled mode.
   Clean stale discussion sessions, dead stream watchers, and stale worktree directories using the same invariant logic as runtime checks.

4. Keep a small `docs/KNOWN-DRIFT.md` only for intentional temporary mismatches.
   CI should fail on untracked drift, but allow listed exceptions with an expiry date.

Practical fit for this repo:

- this uses tools NanoClaw already has: scheduler, Argus role, SQLite state, and TypeScript scripts
- this would have turned `cb94cb2` from a reactive cleanup into routine hygiene

### 7. Throughput Over Gatekeeping

#### How its absence caused problems

The main issue here was not too much review. It was too much change bundled between feedback points.

- a large amount of workflow surface area landed in a compressed burst on April 3
- hidden defects survived because the effective review window happened after multiple concepts had already merged together
- plans, skills, commands, watchers, and state persistence all moved at once, which increased the cost of validating each change in isolation

This is the opposite of the principle's intended effect. High throughput means small, fast, correctable slices. What happened here was big-batch velocity.

#### Guardrails that would have prevented it

1. Introduce a workflow-change checklist that forces small slices.
   For Discord orchestration work, each slice should be one of:
   - command surface
   - planning protocol
   - workstream execution
   - review loop
   - restart persistence
   - docs/manifests

2. Require fast smoke coverage per slice before merge.
   Example:
   - command change: command registry test + help snapshot
   - planning change: start/complete/restart test
   - review change: `implemented -> in_review -> approved` test

3. Add fix-forward automation instead of merge blocking.
   If drift or invariant issues are found post-merge, automatically create a follow-up task or scheduled maintenance ticket instead of letting the repo silently degrade.

4. Track workflow changes in a dedicated changelog file generated from labels or commit tags.
   This keeps throughput high without losing traceability.

Practical fit for this repo:

- these are lightweight process constraints backed by tests, not heavy approval gates
- they preserve speed while reducing the chance that an entire protocol shift lands as one opaque batch

### 8. Use "Boring" Technology

#### How its absence caused problems

The stack itself is boring enough: Node.js, TypeScript, SQLite, Docker, Discord.js. The problem was the workflow semantics became too custom.

- the planning protocol changed across at least three conceptual forms: 3-round debate, 3-round file-based chain, then 4-step Hermes/Athena flow
- transport semantics drifted between IPC descriptions and `@mention` handoffs
- restart recovery, source-channel cleanup, and reviewer topology all became workflow-specific edge cases

That is not a tooling problem. It is a "too many bespoke protocol variants" problem.

#### Guardrails that would have prevented it

1. Standardize every Discord workflow as a typed state machine.
   Put the canonical states and transitions in one JSON/TS schema and generate docs/help text from it.

2. Declare one transport per workflow.
   For planning/discussion, encode `transport = discord-mentions` once and reject new variants unless there is a migration plan.

3. Reuse one persistence pattern.
   All long-lived workflows should persist the same shape: `state`, `current_actor`, `source_channel`, `started_at`, `updated_at`, `completion_signal`.

4. Add a design review question before new orchestration features:
   "Can this be modeled as an existing watcher + state file + handoff chain?"
   If not, the burden of proof is high.

Practical fit for this repo:

- this does not require new infrastructure
- it reduces accidental complexity by collapsing custom protocols into one boring representation
- it would have reduced the drift between 3-round, 4-step, IPC, and `@mention` descriptions

## Most Practical Guardrails to Implement First

If NanoClaw wants the highest leverage improvements for this exact codebase, the first five should be:

1. `verify:workflow-docs`
   Generate a workflow manifest from `agents/config.json` and `src/channels/discord-commands/*`, then fail CI on mismatches in docs and skills.

2. Orchestration invariant tests
   Add integration tests for `control-room` plan start, restart rehydration, reviewer topology, and worktree-required branch execution.

3. Scheduled drift scan
   Use the existing task scheduler plus Argus to run a daily docs/state drift report.

4. Plan front-matter and supersession linting
   Make old workflow plans explicitly `superseded` so agents stop treating them as live specifications.

5. `!doctor_workflow`
   Expose live and persisted orchestration state so invalid states become visible immediately instead of surfacing through manual archaeology.

## Bottom Line

The Discord workflow did not mainly fail because the ideas were wrong. It failed because the repo had plans, skills, and code, but not enough active mechanisms that forced them to stay aligned.

The clearest pattern across all eight principles is this:

- NanoClaw was good at generating artifacts.
- it was weaker at declaring which artifact was authoritative now.
- it was weakest at automatically detecting when those artifacts diverged.

If the principles are turned into manifests, invariant tests, generated docs, scheduled drift scans, and state inspectors, the problems from this three-week build would mostly have been prevented rather than discovered in a late manual cleanup.
