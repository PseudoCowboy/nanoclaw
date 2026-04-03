# NanoClaw Gap Analysis: Agent-First Principles vs. Current State

Generated: 2026-03-24

Comparison of [Agent-First Principles](./AGENT-FIRST-PRINCIPLES.md) against the current NanoClaw implementation.

## Summary

| Principle | Status | Gap Severity |
|---|---|---|
| 1. Repo as single source of truth | Partial | Medium |
| 2. Agent legibility | Partial | Medium |
| 3. Enforce architecture mechanically | Missing | High |
| 4. Build feedback loops | Partial | Medium |
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

**Gaps:**
- No git worktree-per-agent isolation
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
- Skills system exists (web-search, codex, gemini, agent-browser)
- `discord-discussion` has Athena <-> Hermes review loop

**Gaps:**
- No automated "Ralph Wiggum Loop" — review is manual handoff via @mentions
- No self-improving feedback loops where agents identify missing capabilities
- No automated PR review cycle (agent opens PR, another agent reviews, iterate until clean)

### 5. Plans as First-Class Artifacts

**Current state:**
- `docs/plans/` stores plans as markdown files
- `discord-discussion` uses `plan-v2.md` with git commits

**Gaps:**
- No plan index tracking active vs. completed vs. abandoned
- No progress logs or decision logs inside plans
- Plans pile up in `docs/plans/` with no lifecycle management
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
- No parallel agent execution on independent tasks

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
3. **Plan lifecycle management** (Principle 5) — plan index, templates, status tracking
4. **Repo knowledge structure** (Principle 1) — ARCHITECTURE.md, AGENTS.md, progressive disclosure
5. **Automated review loops** (Principle 4) — agent-to-agent PR review automation
6. **Agent legibility** (Principle 2) — observability, worktree isolation
7. **Throughput** (Principle 7) — PR automation, fix-forward strategy
