# Session Tasks — 2026-04-03

**Context:** Multi-task session covering context size check, websearch tool audit, git history cleanup, upstream merge, Discord workflow analysis, and goal-vs-status gap analysis.

**Resume instructions:** If session breaks, read this file first, then check TaskList for progress.

---

## Task 1: Check Current Context Size ✅ DONE

**Status:** Completed in-session
**Finding:** We are using `opus-4.6-1m` which supports 1M context. Current session is within limits. The Claude Code settings don't explicitly set a context/model parameter — it's controlled by the CLI invocation. No issues found.

---

## Task 2: Audit Built-in WebSearch Tool (Container Agents)

**Status:** Pending Codex Review
**Goal:** The built-in `WebSearch` tool in Claude Code Agent SDK should use Gemini for search. Verify if it does, and if not, fix it.

**Current findings:**
- `container/agent-runner/src/index.ts` line 434 includes `WebSearch` and `WebFetch` in `allowedTools`
- The `WebSearch` tool is a built-in Claude Agent SDK tool — its implementation is inside the SDK, not in our code
- `container/skills/web-search/SKILL.md` is a **separate** skill that uses curl/DuckDuckGo/agent-browser — this is the container-side fallback
- The built-in `WebSearch` uses whatever search backend Anthropic's SDK provides (Google by default in the SDK)
- There is NO configuration in our codebase to route `WebSearch` to Gemini

**Question for review:** Does the user want the built-in SDK `WebSearch` to route through Gemini, or is the current setup (SDK default + DuckDuckGo fallback skill) acceptable? If Gemini search is desired, we'd need to implement a custom MCP tool or modify the search skill.

---

## Task 3: Compact Commits Into Logical Groups

**Status:** Pending Codex Review
**Goal:** Reorganize the 54 commits ahead of `origin/main` into logical squashed commits.

**Current commits ahead of origin/main (54 commits):**

Proposed grouping:

### Group A: Infrastructure & Setup (commits: 7b9f2ef, d12404f, 099a44f, 39657db, 7d852d8)
- Add Codex CLI tool, .worktrees gitignore, container rebuild fix, financial design doc, uncommitted changes commit

### Group B: Discord Channel & Agent Bots (commits: e29bc6d, 38d98c5, fa11d16, e517e76)
- Add Discord channel, agent bot framework, centralize infrastructure, optimize channel system

### Group C: Discord Agent Bots — Hermes & Prometheus (commits: f6e9aa3, aecba75, 7a2e8fb, c7c8b64, 61cc445, 09cab74)
- Add Hermes and Prometheus agents, planning discussion system design

### Group D: Unified Iris & Multi-JID Support (commits: 078ce0f, 9c0ed96, 58a9abd, 7c39996, cac0437, b15c552, b839910, a16e8c3, 4ac8563)
- Unified Iris, multi-JID groups, folder serialization, migration

### Group E: Discord Orchestration Commands (commits: a3ac845, 06be542, 7bb7dd6, 6de1125, 3ef8609, cd999f2, 83133f9)
- 15 orchestration commands, Prettier formatting, tests, bug fixes

### Group F: File-Based Discussion System (commits: b47e8dc, 3584a2a, e806ade, 4c98693, e5450bc, d8645e7, 70dc26a, 86414a1, 428725e, 622c3ae, 814314c, c269ccc)
- File-based collaborative discussion design, implementation, Iris watchdog

### Group G: Workstream Execution & Stream Watchers (commits: 7109778, 0f2cc10, 0c50010, 9f8b1a5, e875995)
- Workstream monitoring plan, stream watcher implementation, cmdDecompose rewrite

### Group H: Discord Multi-Agent Fix & Phase 6-7 (commits: cc65f47, 339729c, 1ec22c3, 6e5001e, 1bd6e33, f7a04be)
- Multi-agent fix phases 0-5, Codex review fixes, monolith split, git branch isolation

### Group I: Formatting & Style (commits: ea69d37, 9a34f09)
- Prettier formatting, local customizations commit

---

## Task 4: Merge origin/main

**Status:** Pending (blocked by Task 3)
**Goal:** After compacting commits, merge `origin/main` into local `main`.
**Risk:** origin/main has ~100+ commits diverged. Expect merge conflicts in `package.json`, `package-lock.json`, possibly `src/index.ts`, `container/agent-runner/src/index.ts`.

---

## Task 5: Analyze Discord Multi-Bot Workflow Status

**Status:** Pending Codex Review
**Goal:** Check if the current Discord multi-bot workflow follows the agent-first development principles.

**Existing analysis:** `docs/DISCORD-WORKFLOW-VS-PRINCIPLES.md` (dated 2026-03-24) already exists with a detailed principle-by-principle comparison. Need to verify if it's still current after the Phase 6-7 commits.

**Key areas to audit:**
- P1: Repo as single source of truth — plan index, decision log
- P2: Agent legibility — branch isolation (Phase 7 added this), observability
- P3: Enforce architecture mechanically — CI/linting/tests
- P4: Feedback loops — stream watchers, Argus review
- P5: Plans as first-class artifacts — plan lifecycle
- P6: Garbage collection — stale branches, old containers
- P7: Throughput over gatekeeping — parallel execution
- P8: Boring technology — tech choices

---

## Task 6: Goal vs. Current Status Gap Analysis

**Status:** Pending Codex Review
**Goal:** Summarize the user's goals for NanoClaw, compare against current implementation status, and identify gaps.

**Existing docs:**
- `docs/GAP-ANALYSIS.md` (dated 2026-03-24) — principle-based gap analysis
- `docs/SPEC.md` — specification
- `docs/REQUIREMENTS.md` — architecture decisions

**Key goals to assess:**
1. Multi-channel personal assistant (WhatsApp, Telegram, Discord, Slack, Gmail)
2. Container-isolated agent execution
3. Discord multi-agent development workflow (Athena, Hermes, Atlas, Apollo, Argus)
4. File-based collaboration between agents
5. Scheduled tasks and automation
6. AI tool integration (Claude, Codex, Gemini) in containers
7. Per-group memory and isolation

---

## File Locations

| Document | Path |
|----------|------|
| This task file | `docs/plans/2026-04-03-session-tasks.md` |
| Discord workflow analysis | `docs/DISCORD-WORKFLOW-VS-PRINCIPLES.md` |
| Gap analysis | `docs/GAP-ANALYSIS.md` |
| Spec | `docs/SPEC.md` |
| Requirements | `docs/REQUIREMENTS.md` |
