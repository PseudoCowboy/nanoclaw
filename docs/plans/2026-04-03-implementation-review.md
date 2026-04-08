---
status: completed
date: 2026-04-03
---

# Review of 2026-04-03 5-Gap Implementation

## Overall Assessment

The implementation made real progress on all five phases, but only Phases 2 and 4 are close to fully satisfying the revised plan and the original Codex review feedback. Phase 1 fixes the core shared-checkout bug, yet still keeps the risky container-exit cleanup model that the original review explicitly warned about. Phase 3 improves enforcement directionally, but the local hook is fragile and CI still does not cover the container-side TypeScript changed in Phases 1 and 4. Phase 5 is the weakest phase: it added labels and a maintenance entry point, but it still relies on blunt heuristics and checkpoint-hook execution rather than explicit state and real scheduled maintenance.

## Phase 1: Worktree Isolation

### 1. Does it address the original Codex review feedback?

Partially.

It does address the core isolation bug by creating host-side worktrees in [src/container-runner.ts](/home/pseudo/nanoclaw/src/container-runner.ts#L166) and mounting them into `/workspace/shared`, and it removes container-side branch switching in favor of verification in [container/agent-runner/src/index.ts](/home/pseudo/nanoclaw/container/agent-runner/src/index.ts#L642). That satisfies the most important part of the original review: the host is now responsible for branch selection instead of `git checkout` happening inside the shared bind mount.

It does not address the original review's lifecycle concerns. Worktrees are still cleaned up immediately on container exit in [src/container-runner.ts](/home/pseudo/nanoclaw/src/container-runner.ts#L582), which is exactly the area the original review called out as needing workflow-aware ownership rather than exit-time cleanup.

### 2. Remaining issues

- Dirty or still-needed worktrees can be force-deleted. `removeWorktree()` uses `git worktree remove --force` and falls back to `rm -rf`, with no dirty-state protection or workflow-state check in [src/worktree.ts](/home/pseudo/nanoclaw/src/worktree.ts#L70).
- Branch verification is non-enforcing. If the mounted worktree is on the wrong branch, the runner only logs a warning and continues in [container/agent-runner/src/index.ts](/home/pseudo/nanoclaw/container/agent-runner/src/index.ts#L651). That can silently run an agent on the wrong branch.
- The fallback path still mounts the shared project directly when `branchName` is set but the project is missing `.git`, instead of failing closed, in [src/container-runner.ts](/home/pseudo/nanoclaw/src/container-runner.ts#L166) and [src/container-runner.ts](/home/pseudo/nanoclaw/src/container-runner.ts#L183).
- Test coverage is materially thinner than the risks raised in the original review. [src/worktree.test.ts](/home/pseudo/nanoclaw/src/worktree.test.ts#L11) has no coverage for same-branch conflicts across agents, dirty worktrees, concurrent branch use, or failure/cleanup races.

### 3. Code quality assessment

The extraction into [src/worktree.ts](/home/pseudo/nanoclaw/src/worktree.ts) is clean and small, and the host/container responsibility split is much better than before. The remaining problem is policy, not structure: lifecycle and failure handling are still too aggressive for mutable git state.

## Phase 2: Repo Knowledge

### 1. Does it address the original Codex review feedback?

Largely yes.

The implementation adds the requested documentation set: [ARCHITECTURE.md](/home/pseudo/nanoclaw/ARCHITECTURE.md), [AGENTS.md](/home/pseudo/nanoclaw/AGENTS.md), [docs/decisions/README.md](/home/pseudo/nanoclaw/docs/decisions/README.md), [docs/decisions/000-template.md](/home/pseudo/nanoclaw/docs/decisions/000-template.md), and [docs/decisions/001-container-isolation.md](/home/pseudo/nanoclaw/docs/decisions/001-container-isolation.md). It also follows the original review's recommendation to focus `AGENTS.md` on stable models, and `ARCHITECTURE.md` does document state boundaries in [ARCHITECTURE.md](/home/pseudo/nanoclaw/ARCHITECTURE.md#L287).

### 2. Remaining issues

- [ARCHITECTURE.md](/home/pseudo/nanoclaw/ARCHITECTURE.md#L93) is already stale relative to the implementation. It still lists built-in `WebSearch` as an available tool, and [ARCHITECTURE.md](/home/pseudo/nanoclaw/ARCHITECTURE.md#L304) still says agents use `git checkout` at container startup, which no longer matches Phases 1 and 4.
- The same doc still describes implementation flow using branch checkout in the shared workspace in [ARCHITECTURE.md](/home/pseudo/nanoclaw/ARCHITECTURE.md#L358), again contradicting the new worktree model.
- [AGENTS.md](/home/pseudo/nanoclaw/AGENTS.md#L46) describes "read-only skill mounts," but the current implementation copies skills into a writable per-group `.claude` mount in [src/container-runner.ts](/home/pseudo/nanoclaw/src/container-runner.ts#L245). The high-level model is useful, but this specific wording is inaccurate.

### 3. Code quality assessment

Good structure, good discoverability, and the ADR folder is set up sensibly. The main weakness is maintenance discipline: the docs drifted almost immediately, which undercuts the value of adding them.

## Phase 3: Mechanical Enforcement

### 1. Does it address the original Codex review feedback?

Partially.

The good part is that CI now focuses on the NanoClaw repo itself in [ci.yml](/home/pseudo/nanoclaw/.github/workflows/ci.yml#L18), rather than trying to walk mutable `groups/shared_project` directories. The review skill also moved toward opportunistic project-local checks in [discord-review-workstream/SKILL.md](/home/pseudo/nanoclaw/container/skills/discord-review-workstream/SKILL.md#L47), which addresses the original review's repo-vs-project split.

The implementation does not fully satisfy the enforcement concerns, because some changed code paths are still outside the enforced surface and the local hook is not reliably installed.

### 2. Remaining issues

- The pre-commit hook is fragile. [pre-commit](/home/pseudo/nanoclaw/.husky/pre-commit#L1) has no shebang or Husky wrapper, and the file is not executable in the current workspace. That means the intended local gate may not run at all.
- CI still does not cover container-side TypeScript changes. [ci.yml](/home/pseudo/nanoclaw/.github/workflows/ci.yml#L18) calls root scripts, but [package.json](/home/pseudo/nanoclaw/package.json#L15) lints only `src/`, [package.json](/home/pseudo/nanoclaw/package.json#L14) format-checks only `src/**/*.ts`, and [tsconfig.json](/home/pseudo/nanoclaw/tsconfig.json#L16) includes only `src/**/*`. That leaves `container/agent-runner/src/**/*` outside the main enforcement path even though Phases 1 and 4 changed it.
- The Argus review skill is still only a partial generalization. It checks `lint-architecture.sh`, `npx tsc --noEmit`, `npm test`, and `pytest` in [discord-review-workstream/SKILL.md](/home/pseudo/nanoclaw/container/skills/discord-review-workstream/SKILL.md#L54), but it still does not detect other common project-local check entry points such as `test-structure.sh`, `pnpm`, `bun`, or other non-Node ecosystems beyond a minimal pytest branch.

### 3. Code quality assessment

Directionally good. The repo/project split is much clearer than in the original plan. The quality problem is inconsistency: the enforcement story looks stronger than it actually is because important code under `container/` is still outside CI's normal checks.

## Phase 4: Gemini Search

### 1. Does it address the original Codex review feedback?

Mostly yes.

The main ambiguity is resolved: `WebSearch` is no longer in `allowedTools` in [container/agent-runner/src/index.ts](/home/pseudo/nanoclaw/container/agent-runner/src/index.ts#L458), the new `gemini_search` MCP tool exists in [container/agent-runner/src/ipc-mcp-stdio.ts](/home/pseudo/nanoclaw/container/agent-runner/src/ipc-mcp-stdio.ts#L609), and the web-search skill now tells agents to prefer that tool in [container/skills/web-search/SKILL.md](/home/pseudo/nanoclaw/container/skills/web-search/SKILL.md#L9). Keeping `WebFetch` for direct URL fetches is also a reasonable explicit contract.

### 2. Remaining issues

- The tool contract is still not truly strict or structured. `runGeminiSearch()` asks Gemini to emit JSON, but if parsing fails it silently falls back to treating the whole CLI output as unstructured summary text in [container/agent-runner/src/ipc-mcp-stdio.ts](/home/pseudo/nanoclaw/container/agent-runner/src/ipc-mcp-stdio.ts#L588). That only partially addresses the original review's request for a first-class structured response shape.
- The MCP tool itself returns a text blob to the model in [container/agent-runner/src/ipc-mcp-stdio.ts](/home/pseudo/nanoclaw/container/agent-runner/src/ipc-mcp-stdio.ts#L637), not a schema-enforced object with explicit fields.
- There is no test coverage here for CLI parsing, auth expiry, malformed output, or timeout behavior.

### 3. Code quality assessment

Good direction and reasonable factoring. The wrapper function keeps the CLI call out of the tool definition, which is better than embedding shell logic inline. The weak point is robustness: the parsing contract is soft and untested.

## Phase 5: Garbage Collection

### 1. Does it address the original Codex review feedback?

Only minimally.

It does add labels at container creation in [src/container-runner.ts](/home/pseudo/nanoclaw/src/container-runner.ts#L384), and it introduces cleanup helpers in [src/container-runtime.ts](/home/pseudo/nanoclaw/src/container-runtime.ts#L78) plus a maintenance entry point in [src/maintenance.ts](/home/pseudo/nanoclaw/src/maintenance.ts#L9). But the original review's main objection was that cleanup needed explicit state and real scheduling, not heuristics and backup hooks. That objection is still largely unresolved.

### 2. Remaining issues

- `cleanupStaleContainers()` still uses the blunt `docker ps ... RunningFor` heuristic and kills anything matching `hours|days` in [src/container-runtime.ts](/home/pseudo/nanoclaw/src/container-runtime.ts#L81). That is the same class of unsafe heuristic the original review rejected.
- Maintenance is still triggered from [scripts/checkpoint.sh](/home/pseudo/nanoclaw/scripts/checkpoint.sh#L87), not from a dedicated scheduled maintenance flow. I did not find any other caller of `runMaintenance()`.
- Worktree cleanup is still not workflow-aware. [src/maintenance.ts](/home/pseudo/nanoclaw/src/maintenance.ts#L36) removes any worktree not currently registered in git, and [src/worktree.ts](/home/pseudo/nanoclaw/src/worktree.ts#L81) force-removes it. There is still no retention policy for review/debug branches or explicit ownership registry.
- Test coverage is not sufficient for a risky cleanup phase. [src/maintenance.test.ts](/home/pseudo/nanoclaw/src/maintenance.test.ts#L1) only checks that `runMaintenance` exists, and there are no tests for `cleanupStaleContainers()` behavior.
- One of the new labels is low-quality. [src/container-runner.ts](/home/pseudo/nanoclaw/src/container-runner.ts#L386) derives `nanoclaw.group` from `containerName.split('-')[1]`, which truncates multi-token group names such as `dc-athena` to just `dc`.

### 3. Code quality assessment

The code is at least organized into dedicated modules, which is better than shelling everything directly from the checkpoint script. The actual policy remains too heuristic-heavy for destructive cleanup, and the tests do not provide confidence.

## Verification

I ran:

- `npx vitest run src/worktree.test.ts src/container-runtime.test.ts src/maintenance.test.ts`
- `npm run build`

Both completed successfully in this workspace.
