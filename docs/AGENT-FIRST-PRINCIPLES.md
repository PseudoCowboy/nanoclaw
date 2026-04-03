# Agent-First Development Principles

Core principles for building software with AI agent teams. Every investment should aim to multiply agent effectiveness — better tooling, clearer boundaries, richer in-repo context, and tighter feedback loops.

## 1. Repo as Single Source of Truth

- Don't rely on Slack threads, Google Docs, or tribal knowledge — agents can't see them.
- Encode architectural decisions, product specs, design docs, and conventions in the repo (e.g., `docs/`, `ARCHITECTURE.md`).
- Keep `AGENTS.md` short (~100 lines) as a table of contents, not an encyclopedia. Use progressive disclosure — point to deeper docs.

## 2. Agent Legibility

- Make your app, logs, metrics, and UI directly observable by agents (e.g., Chrome DevTools Protocol for UI testing, local observability stacks with LogQL/PromQL).
- Boot the app per git worktree so agents get isolated, disposable environments.
- If the agent can't inspect it, it effectively doesn't exist.

## 3. Enforce Architecture Mechanically

- Define strict boundaries (layered architecture, dependency direction rules) and enforce them with custom linters and structural tests.
- Write lint error messages that include remediation instructions — these become agent context.
- Enforce invariants (e.g., "parse at boundaries"), not implementations (let the agent choose Zod or whatever).

## 4. Build Feedback Loops, Not Instructions

- Instead of telling the agent "try harder," ask: "What capability is missing?" Then build that capability.
- Create skills, scripts, and tools the agent can use (e.g., DOM snapshot skills, automated review loops).
- Agent-to-agent review (Ralph Wiggum Loop): have agents review each other's PRs and iterate until satisfied.

## 5. Plans as First-Class Artifacts

- Use lightweight execution plans for small changes, detailed plans (with progress/decision logs) for complex work.
- Version and check plans into the repo alongside code.
- Track active plans, completed plans, and tech debt in one place.

## 6. Continuous Garbage Collection

- Encode "golden principles" (shared utilities over hand-rolled helpers, validate boundaries, structured logging).
- Run recurring background agent tasks that scan for drift, grade quality, and open refactoring PRs.
- Pay down tech debt continuously in small increments — don't let it compound.

## 7. Throughput Over Gatekeeping

- Keep PRs short-lived with minimal blocking merge gates.
- Corrections are cheap when throughput is high — waiting is expensive.
- Address test flakes with follow-up runs rather than blocking progress.

## 8. Use "Boring" Technology

- Prefer stable, composable, well-documented tools — they're easier for agents to model.
- Sometimes it's cheaper to reimplement a focused utility (with full test coverage and observability) than to depend on opaque upstream packages.

---

## The Mindset Shift

| Before (Human-First) | After (Agent-First) |
|---|---|
| Engineers write code | Engineers design environments & feedback loops |
| Knowledge in heads/Slack | Knowledge encoded in repo |
| Manual code review | Agent-to-agent review loops |
| Big architecture docs | Short map + progressive disclosure |
| Friday cleanup sessions | Continuous automated garbage collection |
| Style guides for humans | Mechanical linters with agent-readable errors |
| Block on flaky tests | Fix-forward with follow-up runs |

**The core takeaway:** Your most scarce resource is human time and attention. Every investment should aim to multiply agent effectiveness.
