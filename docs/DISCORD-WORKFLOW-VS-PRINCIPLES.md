# Discord Bot Development Workflow vs. Agent-First Principles

Generated: 2026-03-24

Comparison of the current Discord bot multi-agent development workflow (6 skills + 17 commands + 5 agents) against [Agent-First Development Principles](./AGENT-FIRST-PRINCIPLES.md).

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
| Specs & decisions | In-repo, versioned | `!create_spec` generates a template but no standard for recording decisions | ⚠️ Partial |

**Gap:** No plan index, no decision log, no central map. An agent arriving mid-project has no way to quickly understand the current state.

---

### P2. Agent Legibility

| Aspect | Principle says | Discord workflow does | Verdict |
|---|---|---|---|
| Observable by agents | Logs, metrics, UI inspectable | `discord-status` checks systemd services + containers. Agents can read shared files. | ⚠️ Basic |
| Isolated environments | Worktree per agent | Agents work on per-agent git branches (e.g., `agent/atlas/backend`). Stream watcher merges to main after Argus review. | ⚠️ Branch-based |
| If agent can't inspect it, it doesn't exist | Everything observable | Agent-browser exists but no automated observability. Agents can't query build logs, test results, or CI status. | ❌ Missing |

**Gap:** No isolated worktrees for parallel implementation. Atlas and Apollo writing to the same `src/` can conflict. No way for agents to inspect test results, build output, or running services.

---

### P3. Enforce Architecture Mechanically

| Aspect | Principle says | Discord workflow does | Verdict |
|---|---|---|---|
| Boundary enforcement | Custom linters, structural tests | `lint-check.sh` template generated per project. Argus runs mechanical checks before semantic review. | ⚠️ Template only |
| Agent-readable lint errors | Lint messages include remediation | No linting at all | ❌ Missing |
| Invariants over implementations | Enforce "what" not "how" | No invariants defined anywhere | ❌ Missing |

**Gap:** Biggest miss. There's nothing stopping Atlas from importing frontend code, Apollo from bypassing the API contract, or anyone from violating architecture boundaries. The `!create_contract` command generates a template but nothing validates adherence.

---

### P4. Build Feedback Loops, Not Instructions

| Aspect | Principle says | Discord workflow does | Verdict |
|---|---|---|---|
| Agent-to-agent review | Automated review loops until satisfied | Athena↔Hermes in planning. Argus auto-reviews each task via `discord-review-workstream` skill. Iterates up to 3 rounds. | ✅ Good |
| Skills & tools | Build capabilities agents can invoke | 4 Discord skills + web-search + codex + gemini + agent-browser | ✅ Good |
| Ralph Wiggum Loop | Agents iterate on PRs until clean | Stream watcher drives implement → review → fix cycles via task-state.json. Escalates after 3 rounds. | ✅ Good |

**Gap:** The discussion workflow has a single review pass (Hermes reviews → Athena finalizes). No iterative loop. Argus is defined as "monitor" but has no automated review capability — it's notified but never acts autonomously.

---

### P5. Plans as First-Class Artifacts

| Aspect | Principle says | Discord workflow does | Verdict |
|---|---|---|---|
| Versioned in repo | Yes | ✅ `discuss-<slug>/` is a git repo, plan-v2.md committed with author info | ✅ Good |
| Progress & decision logs | Tracked alongside plan | No progress log. No decision log. Disagreements are resolved but not recorded as decisions. | ❌ Missing |
| Lifecycle tracking | Active / completed / abandoned | `!plans` command shows plan lifecycle from SQLite index. Plans tracked as active/completed. | ✅ Good |
| Lightweight vs. detailed | Scale to task size | One-size-fits-all discussion protocol regardless of task complexity | ⚠️ Rigid |

**Gap:** Plans are created and finalized but never tracked after. No way to know which plans are active, which were implemented, which were abandoned. No decision log explaining "why" choices were made.

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
| Corrections over blocking | Fix-forward | `!escalate_blocker` blocks for human intervention. Discussion requires human sign-off on disagreements. | ⚠️ Blocks |
| Parallel execution | Independent tasks in parallel | Atlas (backend) + Apollo (frontend) could work in parallel, but share the same workspace with no isolation | ⚠️ Risky |

**Gap:** The `!escalate_blocker` and human-decides-disagreements patterns create blocking points. No fix-forward culture. Parallel agent work is theoretically possible but unsafe without isolated workspaces.

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
2. **Argus is a ghost (P4/P6)** — Argus is defined but does nothing. Wire it up as an automated reviewer and quality scanner.
3. **No workspace isolation (P2)** — Atlas and Apollo sharing `/workspace/shared/src/` is a conflict risk. Need per-agent branches or worktrees.

### Medium Priority (reducing human bottlenecks)

4. **No plan lifecycle (P5)** — Add status tracking (active/completed/abandoned), decision logs, and a plan index.
5. **No iterative review loops (P4)** — Discussion does one pass. Implementation has zero review. Add automated review-iterate cycles.
6. **No progressive disclosure (P1)** — Add `AGENTS.md` and `ARCHITECTURE.md` so agents can self-orient.

### Low Priority (nice to have)

7. **No background quality scans (P6)** — Use the task scheduler to run periodic drift detection.
8. **Blocking patterns (P7)** — Reduce human decision points; let agents fix-forward with human review after.

### What's Already Good

- ✅ Git-backed plan files with agent authorship
- ✅ Skills system gives agents real tools
- ✅ Boring technology stack
- ✅ Discussion workflow is lightweight (2 agents, 4 steps)
- ✅ File-based collaboration model (agents read/write markdown, not APIs)
