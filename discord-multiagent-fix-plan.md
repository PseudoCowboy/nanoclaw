# Discord Multi-Agent Workflow — Final Fix Plan

**Author:** Claude (Opus 4.6-1M), reviewed by Codex (GPT-5.4)
**Date:** 2026-04-03
**Status:** Ready for human review

---

## Context

This plan addresses the gap between the current Discord multi-agent implementation and the goal: a human-supervised, semi-autonomous AI development team operating through Discord.

**Codex reviewed the first draft and found 4 critical issues:**
1. Bot-to-bot trigger path is broken — Atlas/Apollo/Argus have `listenToBots: false`, so Iris's @mentions to them are silently dropped by `agent-runner.ts:216`
2. The existing `discord-review` skill assumes GitHub PRs + isolated worktrees, not the current shared-folder model
3. Stream watcher auto-completes on checkbox count, racing with any review step
4. State persistence can't serialize interval handles and listener functions

All four are addressed below.

---

## Phase 0: Fix the Trigger Model (Prerequisite for Everything)

**This must come first.** Without it, the existing stream watcher re-triggers AND the proposed review loop are both broken.

### 0.1 Enable Bot-to-Bot Handoffs for Automated Agents

**Problem:** `agents/config.json` sets `listenToBots: false` for Atlas, Apollo, and Argus. The agent-runner drops bot-authored messages at line 216 of `agents/shared/agent-runner.ts`:
```typescript
if (message.author.bot && !opts.listenToBots) return;
```
Iris is a bot. So when the stream watcher posts `@Atlas — continue with the next unchecked task`, Atlas never sees it. Same for Argus review triggers.

**Fix:**
- `agents/config.json`: Set `listenToBots: true` for Atlas, Apollo, and Argus
- **Guard against loops:** Add a safety check in the agent-runner so agents don't respond to their own messages or to other agent bots in an unbounded loop. Only respond to bot-authored messages from **Iris** (the orchestrator). Other agent bot messages should be skipped unless `listenToBots` is explicitly `"all"`.

**Implementation in `agents/shared/agent-runner.ts`:**
```typescript
// Replace the simple bot check:
if (message.author.bot && !opts.listenToBots) return;

// With:
if (message.author.bot) {
  if (!opts.listenToBots) return;
  // Only listen to Iris (orchestrator) bot messages, not other agent bots
  // unless listenToBots is explicitly true (planning agents that debate)
  if (opts.listenToBots === 'iris-only') {
    const irisId = client.guilds.cache.first()?.members.cache.find(
      m => m.user.bot && m.displayName.toLowerCase() === 'iris'
    )?.user.id;
    if (message.author.id !== irisId) return;
  }
}
```

**Config change in `agents/config.json`:**
```json
// Atlas, Apollo: listenToBots: "iris-only"
// Argus: listenToBots: "iris-only"
// Hermes, Athena: listenToBots: true (they need to hear each other for planning)
```

**Tests:**
- Atlas responds to @mention from Iris bot
- Atlas ignores @mention from Apollo bot
- Atlas ignores own messages
- Hermes still responds to Athena's handoff messages

### 0.2 Fix the Watcher Listener Leak

**Problem:** `completeStreamWatcher()` at line 1689 calls `stopStreamWatcher(watcherKey)` without passing the client. But `stopStreamWatcher()` only removes the `messageCreate` listener if `client` is provided (line 1696-1704). Dead listeners accumulate.

**Fix in `src/channels/discord-commands.ts`:**
```typescript
// Line 1689: Change from:
stopStreamWatcher(watcherKey);
// To:
stopStreamWatcher(watcherKey, client);
```

**Tests:**
- After stream completion, verify no listener remains on the client for that channel

---

## Phase 1: Fix the Stream Watcher State Machine

The current watcher has no concept of "waiting for review." It must be fixed before adding Argus review.

### 1.1 Add Explicit Task States

**Problem:** Tasks in `tasks.md` are binary: `- [ ]` or `- [x]`. There's no `in_review` or `changes_requested` state. The watcher auto-completes when all checkboxes are checked (line 1560-1564) and auto-re-triggers on any file update (line 1609-1618), which will race with review.

**Solution:** Add a structured task state file alongside `tasks.md`.

**New file per workstream:** `workstreams/<stream>/task-state.json`
```json
{
  "tasks": [
    { "id": 1, "status": "approved", "reviewRounds": 1 },
    { "id": 2, "status": "in_review", "reviewRounds": 0, "lastCommit": "abc1234" },
    { "id": 3, "status": "pending", "reviewRounds": 0 }
  ],
  "currentTask": 2,
  "lastReviewedBy": "Argus"
}
```

**Status transitions:**
```
pending → in_progress → implemented → in_review → approved (or changes_requested → in_progress → ...)
```

**Watcher changes:**
1. Read `task-state.json` instead of parsing `tasks.md` checkboxes for state decisions
2. **Don't re-trigger lead agent** if current task is `in_review` — wait for Argus
3. **Don't auto-complete** based on checkbox count — complete only when all tasks are `approved`
4. **Don't re-trigger lead agent** immediately after `tasks.md` update — check if the current task is `implemented` first, then trigger Argus review

**Agent skill update:** `container/skills/discord-workstream/SKILL.md` — after implementing a task, agent also writes to `task-state.json`:
```bash
# After marking task done in tasks.md, update state
python3 -c "
import json
state = json.load(open('task-state.json'))
task = next(t for t in state['tasks'] if t['id'] == CURRENT_TASK_ID)
task['status'] = 'implemented'
task['lastCommit'] = '$(git rev-parse HEAD)'
state['currentTask'] = CURRENT_TASK_ID
json.dump(state, open('task-state.json', 'w'), indent=2)
"
```

### 1.2 Add Review Gate to Stream Watcher

**New flow in watcher poll loop:**

```
Poll checks task-state.json:
  If currentTask.status == "implemented":
    → Trigger Argus: "@Argus — Review task #{id} in ws-{stream}. Commit: {lastCommit}"
    → Set status to "in_review"

  If currentTask.status == "approved":
    → Advance to next pending task
    → Trigger lead agent: "@Atlas — Start task #{nextId}"
    → Set status to "in_progress"

  If currentTask.status == "changes_requested":
    → Trigger lead agent: "@Atlas — Argus requested changes on task #{id}. Fix and re-submit."
    → Set status to "in_progress"

  If all tasks "approved":
    → Complete the stream
```

**Argus updates `task-state.json`** via the workstream skill:
```json
{ "status": "approved" }   // or
{ "status": "changes_requested" }
```

---

## Phase 2: Write a File-First Review Skill for Argus

### 2.1 New Skill: `discord-review-workstream`

**Problem:** The existing `discord-review/SKILL.md` assumes GitHub PRs, `gh pr diff`, isolated worktrees, and branch checkout. The current workstream architecture has none of that — it's shared folders with local commits.

**Solution:** New skill specifically for the current shared-folder model.

**New file:** `container/skills/discord-review-workstream/SKILL.md`

```markdown
# Work Stream Code Review Protocol

When triggered to review in a ws-* channel, follow this protocol.

## Step 1 — Find What Changed
Read task-state.json to find the task under review:
  cat /workspace/shared/active/<project>/workstreams/<stream>/task-state.json

Get the commit hash for the implemented task:
  cd /workspace/shared/active/<project>/workstreams/<stream>/
  git show <lastCommit> --stat
  git diff <lastCommit>~1 <lastCommit>

## Step 2 — Review
Check against GOLDEN-PRINCIPLES.md. Look for:
- Correctness vs scope.md requirements
- Missing error handling
- Missing tests
- Architecture violations
- Code duplication

## Step 3 — Update State
If approved:
  Update task-state.json: set task status to "approved"
  Post: "✅ Task #N approved."

If changes needed:
  Update task-state.json: set task status to "changes_requested"
  Post: "❌ Task #N needs changes: [specific issues]"
  Increment reviewRounds

## Step 4 — Escalate
If reviewRounds >= 3, post:
  "⚠️ Task #N has gone 3 review rounds. Human input needed."
```

### 2.2 Update Argus CLAUDE.md

Add reference to `discord-review-workstream` skill for `ws-*` channels. Keep existing `discord-review` skill for future PR-based workflow.

---

## Phase 3: Persist Durable State (Restart Recovery)

### 3.1 Persist Orchestration Metadata (Not Runtime Handles)

**Problem (from Codex review):** Can't serialize `setInterval` handles and listener functions. The Discord client isn't available at module load time.

**Solution:** Persist only durable metadata. Rehydrate runtime handles after Discord connects.

**Persistence layer:** Use existing SQLite DB (already in `src/db.ts`), not a separate JSON file.

**New table:**
```sql
CREATE TABLE IF NOT EXISTS orchestration_state (
  key TEXT PRIMARY KEY,
  type TEXT NOT NULL,           -- 'planning_session' | 'discussion_session' | 'project' | 'stream_watcher'
  data TEXT NOT NULL,           -- JSON metadata (no handles, no functions)
  updated_at TEXT NOT NULL
);
```

**What gets persisted (JSON-safe metadata only):**
- PlanningSession: `{ channelId, topic, featureId, round }`
- DiscussionSession: `{ channelId, topic, slug, round, currentAgent }`
- ProjectState: `{ name, categoryId, controlRoomId, planRoomId, workStreamKeys[] }`
- StreamWatcher metadata: `{ projectSlug, streamType, channelId, categoryId, lastActivityTime, lastStatusReport, lastTasksMtime, completed }`

**What does NOT get persisted:** interval handles, listener functions, Map objects.

**Rehydration path:**
1. Module load: only load `channelProjectMap` (existing behavior)
2. After `DiscordChannel.connect()` resolves (client is ready): call `rehydrateOrchestrationState(client)`
3. `rehydrateOrchestrationState()`:
   - Read all rows from `orchestration_state`
   - Rebuild in-memory Maps
   - For stream watchers: re-create `setInterval` and `messageCreate` listener using live client
   - For active planning sessions: post recovery message to channel

**Save triggers:** After every mutation — same pattern as `saveChannelProjectMap()`.

### 3.2 Handle Duplicate Work on Recovery

**Problem (from Codex review):** An agent container might still be running or already finished while NanoClaw was restarting.

**Solution:**
- On rehydration, check `task-state.json` for current task status before re-triggering
- If status is `implemented` (agent finished while we were down) → proceed to review
- If status is `in_progress` → post cautious message: `"NanoClaw restarted. @{agent} — if you're still working, continue. If not, re-read task-state.json and resume."`
- Add a 2-minute grace period before re-triggering to avoid duplicate container spawns

---

## Phase 4: Cleanup & Consistency

### 4.1 Complete Prometheus Cleanup

**Files to update (complete list including Codex's additions):**
- `agents/start-all.sh` — Remove `prometheus` from AGENTS array
- `agents/prometheus.ts` → Move to `agents/archive/prometheus.ts`
- `groups/dc_prometheus/` → Move to `groups/archive/dc_prometheus/`
- `groups/iris/CLAUDE.md` — Remove Prometheus from agent list (line 15)
- `groups/dc_athena/CLAUDE.md` — Remove Prometheus from collaboration section (line 48)
- `groups/dc_atlas/CLAUDE.md` — Remove "Hermes/Prometheus" reference (line 7)
- `docs/discord-bot-summary.md` — Correct agent count, remove Prometheus row
- **`container/skills/discord-plan/SKILL.md`** — Remove Prometheus from planning protocol (missed in draft, caught by Codex)

### 4.2 Update Stale Documentation

- `docs/discord-bot-summary.md` — Rewrite to match actual 16 commands (not 17), 5 agents (not 6), 3 core channels (not 6)
- `docs/DISCORD-WORKFLOW-VS-PRINCIPLES.md` — Update current state column to reflect file-first workspace changes

---

## Phase 5: Observability & Plan Lifecycle

### 5.1 Fix `!agent_status` to Show Real Per-Agent Health

**Problem:** Currently checks a single systemd service and marks all agents as running/offline together.

**Fix:** For each agent, check if its PID file exists and the process is alive:
```bash
kill -0 $(cat agents/pids/<agent>.pid) 2>/dev/null
```
Also show last log line timestamp to detect frozen agents.

### 5.2 Add `!logs <agent>` Command

Read last 30 lines from `agents/logs/<agent>.log` or NanoClaw main log. Post as Discord code block.

### 5.3 Add Plan Index and Decision Log

**New command:** `!plans` — reads `coordination/plan-index.md`

**Hook into both `cmdPlan()` and `cmdCreateDiscussion()`** to append entries. Include discussion-based plans that aren't tied to a project (store in a global `groups/shared_project/plan-index.md`).

**Add decision log:** When discussion completes (Hermes posts final version), also extract key decisions from `disagreements.md` into `coordination/decisions.md`.

### 5.4 Add Mechanical Validation Argus Can Run

**Problem (from Codex review + DISCORD-WORKFLOW-VS-PRINCIPLES.md):** No lint, no structural tests, no architecture enforcement. Argus reviews semantically but can't run mechanical checks.

**Solution:** Add a `lint-check.sh` script template that `!create_project` generates in the workspace:
```bash
#!/bin/bash
# Auto-generated by !create_project — customize per project
cd /workspace/shared/active/${PROJECT}/
npm run lint 2>&1 || echo "LINT_FAILED"
npm test 2>&1 || echo "TESTS_FAILED"
```
Argus's `discord-review-workstream` skill runs this before semantic review. If mechanical checks fail, return "CHANGES REQUESTED" immediately.

---

## Phase 6: Module Split (After Behavior Is Correct)

### 6.1 Split discord-commands.ts

**Moved to last phase** per Codex feedback: "the workflow has execution bugs, not code-aesthetics problems."

Same structure as originally proposed:
```
src/channels/discord-commands/
├── index.ts, types.ts, state.ts, project.ts, planning.ts,
├── discussion.ts, workstreams.ts, monitoring.ts, checkpoints.ts,
├── workspace-watcher.ts, file-lock.ts, help.ts
```

Only do this AFTER Phases 0-5 are stable and tested.

---

## Phase 7: Agent Isolation (Future — Needs Decision)

Per Codex: "Either move isolation/branches up before the review loop, or write a new file-first review protocol." We chose the latter (Phase 2). But the PR-based `discord-review` skill exists for a reason. When ready:

- **Option B: Per-agent git branches** — Each agent works on a branch, submits PR. Argus switches to `discord-review` (PR-based) skill.
- Requires `container-runner.ts` changes to checkout agent-specific branch on container start.
- Only pursue after Phase 0-5 proves the workflow end-to-end.

---

## Execution Order & Dependencies

```
Phase 0 (PREREQUISITE)
├── 0.1 Fix trigger model (listenToBots) ─────────────┐
└── 0.2 Fix watcher listener leak                     │
                                                       │
Phase 1 (Watcher State Machine) ◄──────────────────────┘
├── 1.1 Add task-state.json + explicit statuses
└── 1.2 Add review gate to stream watcher
                │
                ▼
Phase 2 (Argus Review Skill)
├── 2.1 Write discord-review-workstream skill
└── 2.2 Update Argus CLAUDE.md
                │
                ▼
Phase 3 (State Persistence)
├── 3.1 SQLite-based orchestration state
└── 3.2 Restart recovery with grace period
                │
                ├──── Phase 4 (Cleanup) — can run in parallel with Phase 3
                │     ├── 4.1 Prometheus cleanup (complete)
                │     └── 4.2 Update stale docs
                │
                ▼
Phase 5 (Observability)
├── 5.1 Fix !agent_status
├── 5.2 Add !logs
├── 5.3 Plan index + decision log
└── 5.4 Mechanical validation script
                │
                ▼
Phase 6 (Module Split) — only after behavior is stable
                │
                ▼
Phase 7 (Agent Isolation) — future, needs architectural decision
```

**Phases are strictly sequential except:** Phase 4 can run in parallel with Phase 3.

---

## Verification Checklist

After all phases:

- [ ] `npm run build` compiles
- [ ] `npm test` passes
- [ ] Iris @Atlas in ws-backend → Atlas responds (trigger model fixed)
- [ ] Atlas completes task → watcher triggers Argus review (not next task)
- [ ] Argus "CHANGES REQUESTED" → Atlas re-triggered to fix
- [ ] Argus "APPROVED" → watcher advances to next task
- [ ] 3 review rejections → escalates to control-room
- [ ] Stream doesn't auto-complete until all tasks are `approved` in task-state.json
- [ ] NanoClaw restart recovers active stream watchers and resumes monitoring
- [ ] NanoClaw restart doesn't duplicate-trigger running containers
- [ ] `grep -r "Prometheus" agents/ groups/dc_*/CLAUDE.md groups/iris/CLAUDE.md container/skills/discord-plan/` returns 0 results
- [ ] `!agent_status` shows per-agent health, not just one systemd unit
- [ ] `!logs atlas` shows recent agent logs
- [ ] `!plans` shows plan index with lifecycle status
- [ ] Argus runs `lint-check.sh` before semantic review
- [ ] No listener leak after stream completion (no dead messageCreate handlers)

---

## Credits

- **Draft plan:** Claude (Opus 4.6-1M)
- **Code review:** Codex (GPT-5.4) — found 4 critical issues: broken trigger path, PR-vs-file skill mismatch, watcher race condition, non-serializable state
- **Final plan:** Claude (Opus 4.6-1M), incorporating all Codex feedback
