---
status: completed
date: 2026-04-03
---

# Review of `2026-04-03-close-5-gaps.md`

## Overall assessment

The plan is directionally correct about the gaps, but several phases are not implementable exactly as written against the current codebase. The main issues are:

- Phase 1 identifies the real isolation bug, but the proposed implementation is incomplete because branch checkout still happens inside the container today in `container/agent-runner/src/index.ts`, and the host-side lifecycle changes described in the plan are not sufficient on their own.
- Phase 2 mixes two different concerns: enforcing NanoClaw's own repository invariants, and enforcing architecture rules inside user project workspaces under `groups/shared_project/active/`. Those need different mechanisms.
- Phase 4 is the weakest part of the plan. The proposed cleanup heuristics are too blunt and would risk deleting live containers or live worktrees.
- Phase 5 is feasible, but only if the built-in Claude `WebSearch` tool is demoted or removed in practice. Otherwise agents will have two competing search paths and the Gemini requirement will remain ambiguous.

The overall ordering is also not ideal. The safest order is:

1. Phase 1 first.
2. Phase 5 can happen independently.
3. Phase 3 should move earlier than Phase 2 or at least be done in parallel, because the architecture/agent docs clarify the intended invariants before trying to enforce them mechanically.
4. Phase 2 should come after the architecture rules are written down.
5. Phase 4 should come last, after worktree lifecycle and enforcement behavior are stable.

## Phase 1: Per-Agent Worktree Isolation

### Feasibility

Implementable, but not exactly as described. The current bug is real:

- `src/container-runner.ts` still mounts the same project directory at `/workspace/shared`.
- `container/agent-runner/src/index.ts` still runs `git checkout <branch>` inside `/workspace/shared` when `branchName` is set.

Creating a host-side worktree is the right direction, but the phase is incomplete unless it also removes or changes the container-side checkout logic. If the mounted directory is already a branch-specific worktree, the container should not still create or switch branches inside it.

### Risks

- Worktree cleanup after container exit can race with other consumers if Argus or another agent is intentionally reviewing the same branch/worktree.
- Reusing the same `agentId + branchName` worktree is unsafe unless the system guarantees only one live container can use it at a time.
- `git worktree add <path> <branch>` will fail if the branch is already checked out in another worktree. The plan assumes simple reuse, but git's actual constraints are stricter.
- Nesting `.worktrees/` inside the repo is workable, but it increases the chance of backup noise, accidental scans, and stale metadata if cleanup is partial.
- The proposed tests are too optimistic. They do not cover branch checkout conflicts, cleanup after failure, dirty worktrees, or container crash paths.

### Missing gaps and edge cases

- No change is described for `container/agent-runner/src/index.ts`, which is currently the code that does the conflicting checkout.
- No `try/finally` style lifecycle is described for guaranteed cleanup when container startup fails before the normal exit handler path.
- No protection exists against removing a dirty worktree containing unmerged work.
- No strategy is described for merge/review phases that need the same branch after the implementer container exits.
- No test coverage is proposed for concurrent agents on different branches of the same repo, which is the core failure mode being fixed.
- The plan assumes every mounted project directory is a git repo with healthy metadata. It does not describe behavior for detached HEAD, missing branch, bare repo, or corrupted worktree metadata.

### Better alternative

Use host-created worktrees, but make the host the single source of truth for branch selection:

- Create the worktree before container start.
- Mount that worktree path into `/workspace/shared`.
- Remove the container-side `git checkout` branch-switching path, or reduce it to a verification check that the mounted worktree is already on the expected branch.
- Track active worktrees explicitly in host state instead of inferring liveness from path existence.
- Clean up worktrees only when the owning workflow reaches a terminal state, not merely when one container exits.

## Phase 2: Mechanical Enforcement

### Feasibility

Partially feasible, but not as described.

The repo already has `eslint` and a `lint` script in `package.json`, CI already runs format/typecheck/tests, and `.husky/pre-commit` already exists. That part is straightforward.

What is not straightforward is the proposed CI step that iterates `groups/shared_project/active/*/` and runs `lint-architecture.sh`. On GitHub Actions, those generated project workspaces will usually not exist, and even if they do, they are not the NanoClaw repo itself. This means the plan is mixing host-repo CI with per-project workspace quality checks.

There is also a mismatch in naming:

- The plan says `lint-check.sh` is the template/problem statement.
- The repo template actually contains `container/skills/discord-project/templates/lint-architecture.sh`.
- The current Argus skill looks for `lint-check.sh`, not `lint-architecture.sh`.

### Risks

- The CI step may silently do nothing in most CI runs, which gives false confidence.
- Hardcoding workspace traversal in CI couples NanoClaw's own build to mutable runtime project folders.
- Replacing the current pre-commit hook with `format:check` and `tsc --noEmit` changes developer workflow significantly; it will stop auto-formatting and may be too heavy for every commit.
- The Argus skill change as written can over-fail reviews in repos that do not have `tsconfig`, `npm test`, or the expected project layout.
- Architecture linting based on the template is highly opinionated and only fits projects that use the template's `src/api`, `src/services`, `src/models`, `src/utils` layering.

### Missing gaps and edge cases

- No distinction is made between NanoClaw repo enforcement and generated project enforcement.
- No fallback behavior is defined when a project uses pnpm, bun, pytest, cargo, or a non-Node stack.
- No rollout strategy is described for existing repos that do not yet contain `lint-architecture.sh` or `test-structure.sh`.
- No mention of `npm run lint` for the NanoClaw repo itself, even though eslint is already installed.
- No mention of line-ending/shebang behavior for `.husky/pre-commit`; the current file is just `npm run format:fix`, so replacing it should preserve a valid executable script.

### Better alternative

Split this phase into two tracks:

- NanoClaw repo enforcement: add or tighten `npm run lint`, keep CI focused on this repo, and make `.husky/pre-commit` run a lightweight local gate such as `npm run format:check` plus `npm run typecheck` or a staged-file variant.
- Generated project enforcement: update the project template and Argus review flow so project-local checks are discovered from the project root and run opportunistically if present.

For Argus specifically, a better rule is: detect and run project-local checks in this order if they exist, for example `lint-architecture.sh`, `test-structure.sh`, `npm test`, `npx tsc --noEmit`, instead of assuming one exact toolchain.

## Phase 3: Repo Knowledge Structure

### Feasibility

High. This phase is the most straightforward. `ARCHITECTURE.md`, `AGENTS.md`, and `docs/decisions/` can all be added without major technical risk.

### Risks

- `AGENTS.md` will go stale quickly because the roster, capabilities, and persistence model are implementation details that can drift as channel behavior changes.
- An ADR template without numbering guidance, ownership, and a simple index tends to decay into an unused folder.
- A hand-written architecture map can become inaccurate unless there is an explicit update trigger when the orchestration model changes.

### Missing gaps and edge cases

- The plan does not say where these docs should be linked from. If they are not linked from `README.md` or onboarding docs, discoverability stays weak.
- No owner is assigned for keeping `AGENTS.md` current.
- No convention is defined for ADR statuses beyond the template header.
- No mention of documenting the distinction between host repo state, per-group state, per-project state, and container-only state. That boundary is one of the hard parts of this codebase.

### Better alternative

Keep the phase, but tighten it:

- Reuse and adapt `container/skills/discord-project/templates/ARCHITECTURE.md` where it helps, instead of drafting from scratch.
- Add a small `docs/decisions/README.md` or index with numbering/status conventions.
- Put the volatile agent roster in one concise section and focus the rest of `AGENTS.md` on stable concepts: trigger model, memory model, isolation model, and review/merge responsibilities.

This phase should likely move ahead of Phase 2, because mechanical enforcement should follow written architectural intent.

## Phase 4: Garbage Collection and Drift Detection

### Feasibility

Only partially feasible as written, and currently too risky to implement directly.

The repo does have `src/task-scheduler.ts`, `src/container-runtime.ts`, and `scripts/checkpoint.sh`, so there is infrastructure to build on. But the specific scripts proposed here rely on heuristics that do not match the current runtime behavior.

### Risks

- `cleanup-containers.sh` is unsafe. `docker ps --format '{{.ID}} {{.RunningFor}}' | while read id age` does not parse multi-word ages correctly, and the script would stop any NanoClaw container that has been running for hours or days even if it is healthy.
- `docker container prune --filter "label=nanoclaw"` will likely do nothing because NanoClaw containers are not labeled today.
- `cleanup-worktrees.sh` is unsafe. Filesystem mtime is not a reliable indicator of whether a worktree is active, in review, or waiting for retry.
- Running cleanup from `scripts/checkpoint.sh` is not the same as scheduled maintenance. If checkpoints fail or are skipped, cleanup does not happen.
- A periodic Argus patrol is mentioned in the phase summary but never actually specified as an implementable task.

### Missing gaps and edge cases

- No source of truth is defined for active worktrees, active branches, or live review sessions.
- No exclusion is defined for worktrees belonging to currently running containers.
- No retention policy is defined for failed or changes-requested branches that should remain available for debugging.
- No drift-detection task is actually designed. The phase claims to cover drift detection, but only container/worktree cleanup is concretely specified.
- No integration is described with the existing `cleanupOrphans()` startup behavior in `src/container-runtime.ts`.

### Better alternative

This phase should be redesigned around explicit state, not heuristics:

- Label containers at creation time and track their owner/workflow in host state.
- Record worktree ownership and last-known workflow status in SQLite or another host-side registry.
- Run cleanup as a dedicated scheduled maintenance task or systemd timer, not as a side effect of backups.
- Make cleanup policy workflow-aware: only remove worktrees after merge/abandonment, and only stop containers that are known stuck by heartbeat/timeout evidence.
- Define a real drift patrol task, for example: scan for branch/worktree/state mismatches, orphaned watcher metadata, missing `currentBranch` mappings, or repos left off `main` after merge.

This is the phase most in need of redesign before implementation.

## Phase 5: Gemini-Backed Web Search

### Feasibility

Feasible, but the phase needs a sharper contract.

The container image already installs Gemini CLI, the MCP server already exists, and the current codebase already allows custom MCP tools via `mcp__nanoclaw__*`. So adding a `gemini_search` tool in `container/agent-runner/src/ipc-mcp-stdio.ts` is practical.

However, the current runner still exposes built-in Claude `WebSearch` and `WebFetch` in `container/agent-runner/src/index.ts`. If both remain enabled without prompt/tooling changes, agents will continue to use Anthropic search sometimes, which fails the requirement that search be Gemini-backed.

### Risks

- Ambiguous behavior if built-in `WebSearch` remains enabled.
- Fragile output parsing if the tool just shells out to `gemini -p` without requiring a strict output format.
- Credential or auth expiry failures from the mounted Gemini OAuth state.
- Latency and quota unpredictability if this becomes the default search path for all web lookups.
- Security/prompt-injection risk if raw Gemini output is blindly treated as trusted structured data.

### Missing gaps and edge cases

- No response schema is defined for the new MCP tool.
- No error contract is defined for auth failure, no-result cases, rate limits, or malformed CLI output.
- No tests are described.
- No decision is made about `WebFetch`: if search becomes Gemini-backed but fetching remains Claude-native, that may be acceptable, but it should be explicit.
- No prompt/skill update is described to teach agents when to prefer `gemini_search`.

### Better alternative

Implement `gemini_search` as a first-class structured tool with a strict JSON response shape, for example query echo, summary, and a list of sources. Then either:

- remove built-in `WebSearch` from `allowedTools`, or
- keep it only as an explicit fallback and change prompts/skills so Gemini is the default search path.

Also add a small wrapper function around the CLI call instead of embedding shell logic directly in the MCP tool handler. That will make testing and error handling much cleaner.

## Dependencies and ordering

The current dependency story is mostly incomplete.

- Phase 1 has a real dependency on container-runner and container agent-runner changes together. It is not just a `src/container-runner.ts` change.
- Phase 2 should depend on Phase 3's architecture docs, otherwise the rules being enforced are only implicit or borrowed from project templates.
- Phase 4 should depend on Phase 1, because worktree cleanup policy cannot be designed correctly until worktree lifecycle exists.
- Phase 5 is largely independent and could be done earlier.

Recommended ordering:

1. Phase 1: fix actual workspace isolation.
2. Phase 3: document architecture, agents, and decisions.
3. Phase 2: enforce the now-documented rules, split between NanoClaw repo checks and project-workspace checks.
4. Phase 5: add Gemini search and resolve tool-selection ambiguity.
5. Phase 4: add maintenance only after the lifecycle and invariants above are stable.

## Bottom line

I would not implement this plan verbatim. The strongest parts are the problem selection and the recognition that worktree isolation and Gemini-backed search need real code changes. The weakest parts are Phase 2's conflation of repo-vs-project enforcement and Phase 4's cleanup heuristics.

If the goal is to close the five gaps safely, the plan should be revised before implementation in these ways:

- Make Phase 1 explicitly remove container-side branch switching and add workflow-aware worktree lifecycle management.
- Split Phase 2 into NanoClaw enforcement and generated-project enforcement.
- Move Phase 3 earlier so enforcement follows documented architecture.
- Redesign Phase 4 around explicit state and scheduled maintenance, not checkpoint hooks and filesystem age heuristics.
- Make Phase 5 explicit about tool precedence so Gemini becomes the real default search path.
