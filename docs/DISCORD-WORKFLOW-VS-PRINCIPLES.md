# Discord Bot Development Workflow vs. Agent-First Principles

Generated: 2026-03-24 | Updated: 2026-04-03

Comparison of the current Discord bot multi-agent development workflow (6 skills + 18 commands + 5 agents) against [Agent-First Development Principles](./AGENT-FIRST-PRINCIPLES.md).

---

## Current Discord Workflow at a Glance

**5 agents:** Athena (planner), Hermes (collaborator), Atlas (backend), Apollo (frontend), Argus (monitor/reviewer)

**6 phases:** Project Setup → Planning → Decomposition → Implementation → Review → Monitoring

| Phase | Trigger | What happens |
|---|---|---|
| Project Setup | `!create_project` | Scaffolds Discord channels + file-first workspace |
| Planning | `!plan` / `!create_discussion` | 4-step Hermes ↔ Athena workflow, produces plan-v2.md |
| Decomposition | `!decompose` | Hermes extracts tasks, creates ws-* channels with task-state.json |
| Implementation | Agent @mentions from stream watcher | Atlas/Apollo work tasks one-by-one on isolated branches |
| Review | Argus triggered by stream watcher | Code review via task-state.json, approve or request changes |
| Monitoring | `!agent_status` / `!logs` / `!dashboard` | Per-agent health, project status |

---

## Principle-by-Principle Comparison

### P1. Repo as Single Source of Truth

| Aspect | Principle says | Discord workflow does | Verdict |
|---|---|---|---|
| Where knowledge lives | Encoded in repo | Plans in `/workspace/shared/plans/`, discussions in `discuss-<slug>/` git repos | ✅ Good |
| Progressive disclosure | Short index → deep docs | No index. Plans pile up in flat folders. No `ARCHITECTURE.md` or `AGENTS.md` | ❌ Missing |
| Specs & decisions | In-repo, versioned | No standard for recording decisions | ⚠️ Partial |

**Gap:** No plan index, no decision log, no central map. An agent arriving mid-project has no way to quickly understand the current state.

---

### P2. Agent Legibility

| Aspect | Principle says | Discord workflow does | Verdict |
|---|---|---|---|
| Observable by agents | Logs, metrics, UI inspectable | `discord-status` checks systemd services + containers. Agents can read shared files. Stream watchers provide hourly status reports and silence detection. | ⚠️ Basic |
| Isolated environments | Worktree per agent | `container-runner.ts` creates per-agent git worktrees when projectSlug + branchName are set. Each agent works on an isolated checkout mounted at `/workspace/shared`. | ✅ Implemented |
| If agent can't inspect it, it doesn't exist | Everything observable | Agent-browser exists but no automated observability. Agents can't query build logs, test results, or CI status. | ❌ Missing |

**Gap:** Per-agent worktree isolation is implemented for workstream execution. The remaining gap is observability: agents can't inspect test results, build output, or running services programmatically.

---

### P3. Enforce Architecture Mechanically

| Aspect | Principle says | Discord workflow does | Verdict |
|---|---|---|---|
| Boundary enforcement | Custom linters, structural tests | `lint-check.sh` template generated per project. Argus runs mechanical checks before semantic review. | ⚠️ Template only |
| Agent-readable lint errors | Lint messages include remediation | No linting at all | ❌ Missing |
| Invariants over implementations | Enforce "what" not "how" | No invariants defined anywhere | ❌ Missing |

**Gap:** Biggest miss. There's nothing stopping Atlas from importing frontend code, Apollo from bypassing the API contract, or anyone from violating architecture boundaries. No linting or contract validation exists.

---

### P4. Build Feedback Loops, Not Instructions

| Aspect | Principle says | Discord workflow does | Verdict |
|---|---|---|---|
| Agent-to-agent review | Automated review loops until satisfied | Athena↔Hermes in planning. Argus auto-reviews each task via `discord-review-workstream` skill. Stream watcher drives implement → review → fix cycles via task-state.json. Escalates after 3 rounds. | ✅ Good |
| Skills & tools | Build capabilities agents can invoke | 6 Discord skills + web-search + codex + gemini + agent-browser | ✅ Good |
| Ralph Wiggum Loop | Agents iterate on PRs until clean | Stream watcher drives implement → review → fix cycles via task-state.json. Escalates after 3 rounds. QA streams with Argus as lead are auto-approved. | ✅ Good |

**Gap:** The planning workflow is less rigorous than the workstream loop — a single Hermes→Athena→Hermes pass rather than iterative review. Feedback loops are specific to Discord orchestration, not generalized to repo-wide CI.

---

### P5. Plans as First-Class Artifacts

| Aspect | Principle says | Discord workflow does | Verdict |
|---|---|---|---|
| Versioned in repo | Yes | ✅ `discuss-<slug>/` is a git repo, plan-v2.md committed with author info | ✅ Good |
| Progress & decision logs | Tracked alongside plan | No progress log. No decision log. Disagreements are resolved but not recorded as decisions. | ❌ Missing |
| Lifecycle tracking | Active / completed / abandoned | `!plans` command shows plan lifecycle from SQLite index. Plans tracked as active/completed. | ✅ Good |
| Lightweight vs. detailed | Scale to task size | One-size-fits-all discussion protocol regardless of task complexity | ⚠️ Rigid |

**Gap:** Plans have lifecycle tracking via `!plans`, but no decision log explaining "why" choices were made. No progress log alongside plans.

---

### P6. Continuous Garbage Collection

| Aspect | Principle says | Discord workflow does | Verdict |
|---|---|---|---|
| Background quality scans | Scheduled agent tasks | Task scheduler exists but not used for quality | ❌ Not used |
| Drift detection | Agents scan for divergence | Nothing. Code can drift from spec silently. | ❌ Missing |
| Tech debt tracking | Continuous small paydowns | No tech debt awareness. Argus could do this but doesn't. | ❌ Missing |
| Golden principles | Encoded, agents check against them | GOLDEN-PRINCIPLES.md template in `discord-project` skill. Argus checks against it during review. | ⚠️ Template exists |

**Gap:** Argus is defined as "monitor" but is entirely passive. The task scheduler could run periodic quality checks but doesn't. No agent proactively looks for drift, dead code, or contract violations.

---

### P7. Throughput Over Gatekeeping

| Aspect | Principle says | Discord workflow does | Verdict |
|---|---|---|---|
| Short-lived PRs | Minimal blocking gates | No PR concept at all. Work goes directly to shared files. | ⚠️ Different model |
| Corrections over blocking | Fix-forward | `!blocker` escalates to human intervention. Discussion requires human sign-off. | ⚠️ Blocks |
| Parallel execution | Independent tasks in parallel | Atlas (backend) + Apollo (frontend) work in parallel on isolated git worktrees via `container-runner.ts` | ✅ Implemented |

**Gap:** The `!blocker` escalation pattern creates a blocking point. No fix-forward culture. Parallel agent work uses per-agent worktree isolation.

---

### P8. Use "Boring" Technology

| Aspect | Principle says | Discord workflow does | Verdict |
|---|---|---|---|
| Stable, composable tools | Preferred | Git, markdown files, Discord.js, Node.js | ✅ Good |
| Well-documented | Easy for agents to model | Discord.js is well-documented. Git is universal. | ✅ Good |

**Gap:** None significant. Good fit.

---

## Summary: What to Fix

### High Priority (blocking agent effectiveness)

1. **No mechanical enforcement (P3)** — Add linting, structural tests, contract validation. Without this, agents can silently break architecture.
2. **No background quality scans (P6)** — Use the task scheduler to run periodic drift detection. Argus could do this but doesn't yet.

### Medium Priority (reducing human bottlenecks)

3. **No iterative planning loop (P4)** — Planning is a single Hermes→Athena→Hermes pass. Consider adding iterative review.
4. **No plan lifecycle beyond active/completed (P5)** — No decision log explaining "why" choices were made.
5. **No progressive disclosure (P1)** — Add `AGENTS.md` and `ARCHITECTURE.md` so agents can self-orient.

### Low Priority (nice to have)

6. **Blocking patterns (P7)** — Reduce human decision points; let agents fix-forward with human review after.

### What's Already Good

- ✅ Git-backed plan files with agent authorship
- ✅ Skills system gives agents real tools (6 Discord skills + 3 AI tools)
- ✅ Boring technology stack
- ✅ Per-agent worktree isolation for workstream execution
- ✅ Real state machine driving implement → review → approve cycles
- ✅ Argus actively reviews code via stream watcher automation
- ✅ File-based collaboration model (agents read/write markdown, not APIs)
- ✅ Restart recovery for stream watchers, projects, and planning sessions
