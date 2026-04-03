# NanoClaw Gap Analysis: Agent-First Principles vs. Current State

Generated: 2026-03-24 | Updated: 2026-04-03

Comparison of [Agent-First Principles](./AGENT-FIRST-PRINCIPLES.md) against the current NanoClaw implementation.

## Summary

| Principle | Status | Gap Severity |
|---|---|---|
| 1. Repo as single source of truth | Partial | Medium |
| 2. Agent legibility | Good | Low |
| 3. Enforce architecture mechanically | Missing | High |
| 4. Build feedback loops | Good | Low |
| 5. Plans as first-class artifacts | Partial | Medium |
| 6. Continuous garbage collection | Missing | High |
| 7. Throughput over gatekeeping | Partial | Low |
| 8. Use "boring" technology | Good | Low |

## Detailed Analysis

### 1. Repo as Single Source of Truth

**Current state:**
- `docs/plans/` has 15+ plan files
- `CLAUDE.md` per group serves as per-agent memory
- `docs/REQUIREMENTS.md`, `docs/SPEC.md` exist

**Gaps:**
- No `ARCHITECTURE.md` — no central map of how the system fits together
- No index of plans tracking active / completed / abandoned status
- `groups/*/CLAUDE.md` grows organically with no progressive disclosure structure
- No `AGENTS.md` table of contents pointing to deeper docs

### 2. Agent Legibility

**Current state:**
- Containers get isolated filesystems per group
- `agent-browser` skill exists for DOM inspection
- Logs centralized in `logs/`
- `container-runner.ts` creates per-agent git worktrees when projectSlug + branchName are set
- Stream watchers provide hourly status reports and silence detection
- Workspace watchers track file changes across coordination files

**Gaps:**
- No local observability stack (LogQL/PromQL) — agents can't query metrics
- No automated UI testing or screenshot diffing
- Agents can't inspect running services inside other containers

### 3. Enforce Architecture Mechanically

**Current state:**
- No linters, no structural tests, no boundary enforcement
- `discord-project` scaffolds empty directories but enforces nothing

**Gaps:**
- Biggest gap overall
- No custom linting rules with agent-readable remediation messages
- No dependency direction enforcement
- No structural tests validating architecture invariants
- Agents have zero mechanical guardrails

### 4. Build Feedback Loops, Not Instructions

**Current state:**
- Skills system exists (web-search, codex, gemini, agent-browser, 6 discord skills)
- `discord-discussion` has Hermes ↔ Athena 4-step workflow
- Stream watcher drives implement → review → approve/changes_requested cycles
- Argus is actively wired into the review gate via task-state.json
- Review rounds are counted and escalated to control-room after 3 rounds
- QA streams with Argus as lead auto-approve (no self-review)

**Gaps:**
- Planning workflow is a single pass (not iterative review)
- No self-improving feedback loops where agents identify missing capabilities
- Feedback loops are orchestration-specific, not generalized to repo-wide CI

### 5. Plans as First-Class Artifacts

**Current state:**
- `docs/plans/` stores plans as markdown files
- `discord-discussion` uses `plan-v2.md` with git commits
- `!plans` command provides lifecycle tracking (active/completed) via SQLite index

**Gaps:**
- No progress logs or decision logs inside plans
- No standard plan template with status field, decision log section

### 6. Continuous Garbage Collection

**Current state:**
- Task scheduler exists (`task-scheduler.ts` with cron/interval support)
- Log rotation runs via `scripts/rotate-logs.sh`

**Gaps:**
- Scheduler not used for code quality
- No scheduled quality scans or drift detection
- No automated refactoring PRs
- No "golden principles" encoded for agents to check against
- No tech debt tracking or continuous paydown

### 7. Throughput Over Gatekeeping

**Current state:**
- `git-workflow` skill exists (conservative safe operations)
- No PR automation

**Gaps:**
- No PR creation or merge automation
- No flaky test handling strategy
- Discussion workflow has mandatory human sign-off which can block

### 8. Use "Boring" Technology

**Current state:**
- Node.js, SQLite, Docker, git — straightforward stack
- Stable, composable tools throughout

**Gaps:**
- Minor: could document "why we chose X" in an architecture doc
- Otherwise a good fit for agent-first development

## Priority Order for Implementation

1. **Mechanical enforcement** (Principle 3) — linters, structural tests, architecture boundaries
2. **Continuous garbage collection** (Principle 6) — scheduled quality scans using existing task scheduler
3. **Plan lifecycle management** (Principle 5) — decision logs, plan templates
4. **Repo knowledge structure** (Principle 1) — ARCHITECTURE.md, AGENTS.md, progressive disclosure
5. **Throughput** (Principle 7) — PR automation, fix-forward strategy
