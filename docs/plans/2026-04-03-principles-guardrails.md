---
status: active
date: 2026-04-03
---

# Principles-Driven Guardrails Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement 5 guardrail mechanisms that turn Agent-First Principles into active, enforceable checks for the Discord multi-agent workflow.

**Architecture:** Each guardrail is independent — a shell script, a TypeScript module, or a Discord command. They share no state and can be implemented in any order. Runtime invariants are called from existing state transition points. Drift scans piggyback on the existing `maintenance.ts` module. The `!doctor_workflow` command follows the existing command registry pattern.

**Tech Stack:** TypeScript (Node.js), Bash, Vitest, discord.js

---

### Task 1: Workflow Invariants Module

Runtime assertions for impossible orchestration states. These are pure functions that throw on violation.

**Files:**
- Create: `src/channels/discord-commands/workflow-invariants.ts`
- Test: `src/channels/discord-commands/workflow-invariants.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/channels/discord-commands/workflow-invariants.test.ts
import { describe, it, expect } from 'vitest';
import {
  assertNotSelfReview,
  assertValidTaskTransition,
  assertSessionNotOrphaned,
} from './workflow-invariants.js';

describe('workflow-invariants', () => {
  describe('assertNotSelfReview', () => {
    it('throws when lead agent is the reviewer', () => {
      expect(() => assertNotSelfReview('Argus', 'Argus')).toThrow(
        /self-review/i,
      );
    });
    it('does not throw when agents differ', () => {
      expect(() => assertNotSelfReview('Atlas', 'Argus')).not.toThrow();
    });
  });

  describe('assertValidTaskTransition', () => {
    it('allows pending → in_progress', () => {
      expect(() =>
        assertValidTaskTransition('pending', 'in_progress'),
      ).not.toThrow();
    });
    it('allows in_progress → implemented', () => {
      expect(() =>
        assertValidTaskTransition('in_progress', 'implemented'),
      ).not.toThrow();
    });
    it('allows implemented → in_review', () => {
      expect(() =>
        assertValidTaskTransition('implemented', 'in_review'),
      ).not.toThrow();
    });
    it('allows implemented → approved (auto-approve path)', () => {
      expect(() =>
        assertValidTaskTransition('implemented', 'approved'),
      ).not.toThrow();
    });
    it('allows in_review → approved', () => {
      expect(() =>
        assertValidTaskTransition('in_review', 'approved'),
      ).not.toThrow();
    });
    it('allows in_review → changes_requested', () => {
      expect(() =>
        assertValidTaskTransition('in_review', 'changes_requested'),
      ).not.toThrow();
    });
    it('allows changes_requested → in_progress', () => {
      expect(() =>
        assertValidTaskTransition('changes_requested', 'in_progress'),
      ).not.toThrow();
    });
    it('rejects pending → approved (skipping implementation)', () => {
      expect(() =>
        assertValidTaskTransition('pending', 'approved'),
      ).toThrow(/invalid.*transition/i);
    });
    it('rejects approved → in_progress (going backwards)', () => {
      expect(() =>
        assertValidTaskTransition('approved', 'in_progress'),
      ).toThrow(/invalid.*transition/i);
    });
  });

  describe('assertSessionNotOrphaned', () => {
    it('throws when session has no matching channel', () => {
      const sessions = new Map([['chan-1', { topic: 'test' }]]);
      const activeChannels = new Set<string>();
      expect(() =>
        assertSessionNotOrphaned(sessions, activeChannels),
      ).toThrow(/orphaned/i);
    });
    it('does not throw when all sessions have channels', () => {
      const sessions = new Map([['chan-1', { topic: 'test' }]]);
      const activeChannels = new Set(['chan-1']);
      expect(() =>
        assertSessionNotOrphaned(sessions, activeChannels),
      ).not.toThrow();
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/channels/discord-commands/workflow-invariants.test.ts`
Expected: FAIL — module does not exist

**Step 3: Write the implementation**

```typescript
// src/channels/discord-commands/workflow-invariants.ts
import type { TaskStatus } from './types.js';
import { logger } from '../../logger.js';

/**
 * Valid task status transitions in the stream watcher state machine.
 * Adjacency list: from → Set<to>
 */
const VALID_TRANSITIONS: Record<string, Set<string>> = {
  pending: new Set(['in_progress']),
  in_progress: new Set(['implemented']),
  implemented: new Set(['in_review', 'approved']), // approved = auto-approve path (Argus lead)
  in_review: new Set(['approved', 'changes_requested']),
  changes_requested: new Set(['in_progress']),
  approved: new Set(['merge_conflict']),
  merge_conflict: new Set(['approved']), // manual resolution sets back to approved
};

/**
 * Assert that an agent is not reviewing its own work.
 * @throws {Error} if leadAgent === reviewer
 */
export function assertNotSelfReview(
  leadAgent: string,
  reviewer: string,
): void {
  if (leadAgent === reviewer) {
    const msg = `Workflow invariant violation: self-review detected (${leadAgent} reviewing ${leadAgent})`;
    logger.error({ leadAgent, reviewer }, msg);
    throw new Error(msg);
  }
}

/**
 * Assert that a task status transition is valid per the state machine.
 * @throws {Error} if the transition is not in VALID_TRANSITIONS
 */
export function assertValidTaskTransition(
  from: TaskStatus | string,
  to: TaskStatus | string,
): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed || !allowed.has(to)) {
    const msg = `Workflow invariant violation: invalid task transition ${from} → ${to}`;
    logger.error({ from, to }, msg);
    throw new Error(msg);
  }
}

/**
 * Assert that all sessions in a map have a corresponding active channel.
 * @throws {Error} listing orphaned channel IDs
 */
export function assertSessionNotOrphaned(
  sessions: Map<string, unknown>,
  activeChannelIds: Set<string>,
): void {
  const orphaned: string[] = [];
  for (const channelId of sessions.keys()) {
    if (!activeChannelIds.has(channelId)) {
      orphaned.push(channelId);
    }
  }
  if (orphaned.length > 0) {
    const msg = `Workflow invariant violation: orphaned sessions for channels: ${orphaned.join(', ')}`;
    logger.warn({ orphaned }, msg);
    throw new Error(msg);
  }
}

/**
 * Soft-check variant that logs but doesn't throw.
 * Use in production poll loops where you want observability without crashing.
 */
export function checkInvariant(
  name: string,
  fn: () => void,
): { ok: boolean; error?: string } {
  try {
    fn();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/channels/discord-commands/workflow-invariants.test.ts`
Expected: PASS (all 9 tests)

**Step 5: Commit**

```bash
git add src/channels/discord-commands/workflow-invariants.ts src/channels/discord-commands/workflow-invariants.test.ts
git commit -m "feat: add workflow invariants module with state machine assertions"
```

---

### Task 2: Wire Invariants Into Stream Watcher

Call `assertValidTaskTransition` at every status change in the stream watcher state machine.

**Files:**
- Modify: `src/channels/discord-commands/stream-watcher.ts` (state machine switch block, ~lines 689-895)

**Step 1: Add import**

At the top of `stream-watcher.ts`, add:
```typescript
import { assertValidTaskTransition, checkInvariant } from './workflow-invariants.js';
```

**Step 2: Add transition checks at each status change**

In the `implemented` case (line ~697), before `currentTask.status = 'approved'` (auto-approve):
```typescript
assertValidTaskTransition('implemented', 'approved');
```

Before `currentTask.status = 'in_review'` (line ~711):
```typescript
assertValidTaskTransition('implemented', 'in_review');
```

In the `approved` case, before `nextTask.status = 'in_progress'` (line ~773):
```typescript
assertValidTaskTransition('pending', 'in_progress');
```

In the `changes_requested` case, before `currentTask.status = 'in_progress'` (line ~821):
```typescript
assertValidTaskTransition('changes_requested', 'in_progress');
```

In the `pending` case, before `currentTask.status = 'in_progress'` (line ~862):
```typescript
assertValidTaskTransition('pending', 'in_progress');
```

**Step 3: Re-export from barrel**

Add to `src/channels/discord-commands/index.ts` re-exports:
```typescript
export {
  assertNotSelfReview,
  assertValidTaskTransition,
  assertSessionNotOrphaned,
  checkInvariant,
} from './workflow-invariants.js';
```

**Step 4: Build to verify no type errors**

Run: `npm run build`
Expected: Success with 0 errors

**Step 5: Run all tests**

Run: `npm test`
Expected: All pass (430+ tests)

**Step 6: Commit**

```bash
git add src/channels/discord-commands/stream-watcher.ts src/channels/discord-commands/index.ts
git commit -m "feat: wire workflow invariant checks into stream watcher state machine"
```

---

### Task 3: Workflow Manifest Verification Script

Shell script that extracts canonical data from TypeScript source and compares against documentation claims.

**Files:**
- Create: `scripts/verify-workflow-manifest.sh`

**Step 1: Write the script**

```bash
#!/usr/bin/env bash
# scripts/verify-workflow-manifest.sh
# Generates a workflow manifest from source code and checks docs for drift.
# Exit 0 = clean, exit 1 = drift detected.
#
# Usage: bash scripts/verify-workflow-manifest.sh [--fix]

set -euo pipefail
cd "$(dirname "$0")/.."

ERRORS=0
MANIFEST=""

log_error() { echo "DRIFT: $1"; ERRORS=$((ERRORS + 1)); MANIFEST="${MANIFEST}DRIFT: $1\n"; }
log_ok()    { MANIFEST="${MANIFEST}OK: $1\n"; }

# --- 1. Extract canonical agents from constants.ts ---
AGENTS_SOURCE=$(grep -oP "name: '([^']+)'" src/channels/discord-commands/constants.ts | sed "s/name: '//;s/'//")
echo "=== Canonical Agents (from constants.ts) ==="
echo "$AGENTS_SOURCE"
echo ""

# Check docs for phantom agents
DOCS_TO_CHECK=(
  "docs/discord-bot-summary.md"
  "multi-agent-file-first-workflow.md"
  "docs/DISCORD-WORKFLOW-VS-PRINCIPLES.md"
)

KNOWN_NON_AGENTS="Iris|Nanoclaw|NanoClaw|Human|human"

for doc in "${DOCS_TO_CHECK[@]}"; do
  [ -f "$doc" ] || continue
  # Look for capitalized names followed by agent-like context
  for phantom in Prometheus Zeus Hera Hephaestus; do
    if grep -qi "$phantom" "$doc" 2>/dev/null; then
      log_error "$doc references removed agent '$phantom'"
    fi
  done
done

# --- 2. Extract canonical commands from index.ts ---
COMMANDS_SOURCE=$(grep -oP "^\s+(\w+):" src/channels/discord-commands/index.ts | sed 's/://;s/^\s*//' | sort)
COMMAND_COUNT=$(echo "$COMMANDS_SOURCE" | wc -l | tr -d ' ')
echo "=== Canonical Commands ($COMMAND_COUNT from index.ts) ==="
echo "$COMMANDS_SOURCE"
echo ""

# Check discord-bot-summary.md command count claim
if [ -f "docs/discord-bot-summary.md" ]; then
  CLAIMED_COUNT=$(grep -oP '\d+ total' docs/discord-bot-summary.md | head -1 | grep -oP '\d+')
  if [ -n "$CLAIMED_COUNT" ] && [ "$CLAIMED_COUNT" != "$COMMAND_COUNT" ]; then
    log_error "docs/discord-bot-summary.md claims $CLAIMED_COUNT commands, code has $COMMAND_COUNT"
  else
    log_ok "Command count matches ($COMMAND_COUNT)"
  fi
fi

# --- 3. Extract canonical workstream types from constants.ts ---
STREAMS_SOURCE=$(grep -oP "^\s+(\w+): \{" src/channels/discord-commands/constants.ts | sed 's/://;s/{//;s/^\s*//' | sort)
echo "=== Canonical Workstream Types (from constants.ts) ==="
echo "$STREAMS_SOURCE"
echo ""

# --- 4. Check for old paths ---
OLD_PATHS="/workspace/shared/projects/"
for f in container/skills/*/SKILL.md docs/*.md; do
  [ -f "$f" ] || continue
  if grep -q "$OLD_PATHS" "$f" 2>/dev/null; then
    log_error "$f contains old path pattern '$OLD_PATHS'"
  fi
done

# --- 5. Summary ---
echo ""
echo "=== Manifest Verification ==="
echo -e "$MANIFEST"

if [ "$ERRORS" -gt 0 ]; then
  echo "FAILED: $ERRORS drift issue(s) found."
  exit 1
else
  echo "PASSED: No drift detected."
  exit 0
fi
```

**Step 2: Make executable and test**

Run: `chmod +x scripts/verify-workflow-manifest.sh && bash scripts/verify-workflow-manifest.sh`
Expected: `PASSED: No drift detected.` (since we already fixed all stale docs)

**Step 3: Commit**

```bash
git add scripts/verify-workflow-manifest.sh
git commit -m "feat: add workflow manifest verification script for doc-code drift detection"
```

---

### Task 4: Scheduled Drift Scan in Maintenance

Add a `scanWorkflowDrift()` function to `src/maintenance.ts` that checks active project workspaces for common staleness patterns.

**Files:**
- Modify: `src/maintenance.ts` (add function + call from `runMaintenance()`)
- Test: `src/maintenance.test.ts` (add test for export)

**Step 1: Write the failing test**

Add to `src/maintenance.test.ts`:
```typescript
it('exports a scanWorkflowDrift function', async () => {
  const mod = await import('./maintenance.js');
  expect(typeof mod.scanWorkflowDrift).toBe('function');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/maintenance.test.ts`
Expected: FAIL — `scanWorkflowDrift` is not exported

**Step 3: Write the implementation**

Add to `src/maintenance.ts`:

```typescript
/**
 * Scan active project workspaces for workflow drift patterns.
 * Logs warnings for: stale agent names, old path patterns, orphaned workstream folders,
 * zombie discussion sessions, task-state.json with impossible states.
 */
export function scanWorkflowDrift(): void {
  const sharedDir = path.join(GROUPS_DIR, 'shared_project', 'active');
  if (!fs.existsSync(sharedDir)) return;

  const CANONICAL_AGENTS = ['Athena', 'Hermes', 'Atlas', 'Apollo', 'Argus'];
  const STALE_AGENTS = ['Prometheus', 'Zeus', 'Hera', 'Hephaestus'];
  const OLD_PATH_PATTERN = '/workspace/shared/projects/';
  let driftCount = 0;

  try {
    const projects = fs
      .readdirSync(sharedDir, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const project of projects) {
      const projectDir = path.join(sharedDir, project.name);

      // 1. Scan markdown files for stale agent references
      const mdFiles = findMarkdownFiles(projectDir);
      for (const mdFile of mdFiles) {
        try {
          const content = fs.readFileSync(mdFile, 'utf8');
          for (const stale of STALE_AGENTS) {
            if (content.includes(stale)) {
              logger.warn(
                { file: mdFile, agent: stale, project: project.name },
                'Drift: stale agent reference found',
              );
              driftCount++;
            }
          }
          if (content.includes(OLD_PATH_PATTERN)) {
            logger.warn(
              { file: mdFile, project: project.name },
              'Drift: old path pattern found',
            );
            driftCount++;
          }
        } catch {
          /* skip unreadable files */
        }
      }

      // 2. Check task-state.json files for impossible states
      const wsDir = path.join(projectDir, 'workstreams');
      if (fs.existsSync(wsDir)) {
        const streams = fs
          .readdirSync(wsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory());
        for (const stream of streams) {
          const statePath = path.join(wsDir, stream.name, 'task-state.json');
          if (!fs.existsSync(statePath)) continue;
          try {
            const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            if (state.tasks) {
              for (const task of state.tasks) {
                if (task.status === 'in_review' && task.reviewRounds > 5) {
                  logger.warn(
                    { project: project.name, stream: stream.name, taskId: task.id, rounds: task.reviewRounds },
                    'Drift: task stuck in excessive review rounds',
                  );
                  driftCount++;
                }
              }
            }
          } catch {
            logger.warn(
              { statePath, project: project.name },
              'Drift: corrupt task-state.json',
            );
            driftCount++;
          }
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to scan for workflow drift');
  }

  if (driftCount > 0) {
    logger.info({ driftCount }, 'Workflow drift scan complete — issues found');
  } else {
    logger.info('Workflow drift scan complete — no issues');
  }
}

/**
 * Recursively find .md files in a directory (max depth 3).
 */
function findMarkdownFiles(dir: string, depth = 0): string[] {
  if (depth > 3) return [];
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        results.push(...findMarkdownFiles(fullPath, depth + 1));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
  } catch {
    /* permission error or broken symlink */
  }
  return results;
}
```

Add `scanWorkflowDrift()` call inside `runMaintenance()`:
```typescript
export function runMaintenance(): void {
  logger.info('Starting scheduled maintenance');
  cleanupOrphans();
  cleanupStaleContainers();
  cleanupStaleWorktrees();
  pruneGitMetadata();
  scanWorkflowDrift();  // <-- add this line
  logger.info('Scheduled maintenance complete');
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/maintenance.test.ts`
Expected: PASS

**Step 5: Build**

Run: `npm run build`
Expected: Success

**Step 6: Commit**

```bash
git add src/maintenance.ts src/maintenance.test.ts
git commit -m "feat: add workflow drift scan to maintenance cycle"
```

---

### Task 5: Plan Front Matter Lint Script

Shell script that validates YAML front matter in plan documents.

**Files:**
- Create: `scripts/lint-plan-frontmatter.sh`

**Step 1: Write the script**

```bash
#!/usr/bin/env bash
# scripts/lint-plan-frontmatter.sh
# Validates that plan documents in docs/plans/ have proper YAML front matter.
# Exit 0 = all plans valid, exit 1 = issues found.
#
# Required front matter fields:
#   status: draft | active | completed | superseded
#   date: YYYY-MM-DD
#
# Optional:
#   superseded_by: filename (required when status = superseded)

set -euo pipefail
cd "$(dirname "$0")/.."

PLAN_DIR="docs/plans"
ERRORS=0
CHECKED=0
VALID_STATUSES="draft active completed superseded"

if [ ! -d "$PLAN_DIR" ]; then
  echo "No plans directory found at $PLAN_DIR"
  exit 0
fi

for plan in "$PLAN_DIR"/*.md; do
  [ -f "$plan" ] || continue
  CHECKED=$((CHECKED + 1))
  basename=$(basename "$plan")

  # Check for front matter delimiter
  first_line=$(head -1 "$plan")
  if [ "$first_line" != "---" ]; then
    echo "MISSING_FRONTMATTER: $basename — no YAML front matter (first line is not '---')"
    ERRORS=$((ERRORS + 1))
    continue
  fi

  # Extract front matter (between first and second ---)
  frontmatter=$(sed -n '2,/^---$/p' "$plan" | sed '$d')
  if [ -z "$frontmatter" ]; then
    echo "EMPTY_FRONTMATTER: $basename — front matter block is empty"
    ERRORS=$((ERRORS + 1))
    continue
  fi

  # Check required fields
  status=$(echo "$frontmatter" | grep -oP '^status:\s*\K\S+' || true)
  date_field=$(echo "$frontmatter" | grep -oP '^date:\s*\K\S+' || true)

  if [ -z "$status" ]; then
    echo "MISSING_STATUS: $basename — no 'status:' field in front matter"
    ERRORS=$((ERRORS + 1))
  elif ! echo "$VALID_STATUSES" | grep -qw "$status"; then
    echo "INVALID_STATUS: $basename — status '$status' not in ($VALID_STATUSES)"
    ERRORS=$((ERRORS + 1))
  fi

  if [ -z "$date_field" ]; then
    echo "MISSING_DATE: $basename — no 'date:' field in front matter"
    ERRORS=$((ERRORS + 1))
  elif ! echo "$date_field" | grep -qP '^\d{4}-\d{2}-\d{2}$'; then
    echo "INVALID_DATE: $basename — date '$date_field' not in YYYY-MM-DD format"
    ERRORS=$((ERRORS + 1))
  fi

  # If superseded, must have superseded_by
  if [ "$status" = "superseded" ]; then
    superseded_by=$(echo "$frontmatter" | grep -oP '^superseded_by:\s*\K.+' || true)
    if [ -z "$superseded_by" ]; then
      echo "MISSING_SUPERSEDED_BY: $basename — status is 'superseded' but no 'superseded_by:' field"
      ERRORS=$((ERRORS + 1))
    fi
  fi
done

echo ""
echo "Checked $CHECKED plan(s)."
if [ "$ERRORS" -gt 0 ]; then
  echo "FAILED: $ERRORS issue(s) found."
  exit 1
else
  echo "PASSED: All plans have valid front matter."
  exit 0
fi
```

**Step 2: Make executable**

Run: `chmod +x scripts/lint-plan-frontmatter.sh`

**Step 3: Add front matter to key plan files**

For each existing plan file in `docs/plans/`, add YAML front matter. Plans from March 17 that were superseded by later designs get `status: superseded`. Recent active plans get `status: active`. Example:

```yaml
---
status: superseded
date: 2026-03-17
superseded_by: 2026-03-18-file-based-discussion-system.md
---
```

At minimum, add front matter to these files:
- `2026-03-17-planning-discussion-system.md` → superseded
- `2026-03-17-planning-discussion-system-design.md` → superseded
- `2026-03-17-discord-orchestration-commands.md` → superseded
- `2026-03-17-discord-orchestration-commands-design.md` → superseded
- `2026-03-17-unified-iris.md` → superseded
- `2026-03-17-unified-iris-design.md` → superseded
- `2026-03-18-file-based-discussion-system.md` → superseded (by workstream plan)
- `2026-03-18-file-based-discussion-system-design.md` → superseded
- `2026-03-25-workstream-execution-monitoring-plan.md` → active
- `2026-03-25-workstream-execution-monitoring-design.md` → active
- `2026-04-03-principles-guardrails-design.md` → active
- All other `2026-04-03-*.md` → completed

**Step 4: Run lint**

Run: `bash scripts/lint-plan-frontmatter.sh`
Expected: PASSED

**Step 5: Commit**

```bash
git add scripts/lint-plan-frontmatter.sh docs/plans/
git commit -m "feat: add plan front matter linting and retroactive lifecycle metadata"
```

---

### Task 6: `!doctor_workflow` Diagnostic Command

Discord command that exposes live orchestration state for debugging.

**Files:**
- Create: `src/channels/discord-commands/doctor.ts`
- Modify: `src/channels/discord-commands/index.ts` (register command)

**Step 1: Write the implementation**

```typescript
// src/channels/discord-commands/doctor.ts
import { Client, Message, EmbedBuilder, TextChannel } from 'discord.js';
import { getAllOrchestrationState } from '../../db.js';
import {
  activeStreamWatchers,
  activeProjects,
  planningSessions,
  discussionSessions,
  channelBranchMap,
} from './state.js';
import { findProjectSlugForChannel } from './helpers.js';
import { checkInvariant } from './workflow-invariants.js';
import { readTaskState } from './stream-watcher.js';
import { WORKSTREAM_DEFS } from './constants.js';

export async function cmdDoctorWorkflow(
  message: Message,
  _client: Client,
): Promise<void> {
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];
  const issues: string[] = [];

  // 1. In-memory state counts
  fields.push({
    name: 'In-Memory State',
    value:
      `Projects: ${activeProjects.size}\n` +
      `Stream watchers: ${activeStreamWatchers.size}\n` +
      `Planning sessions: ${planningSessions.size}\n` +
      `Discussion sessions: ${discussionSessions.size}\n` +
      `Branch mappings: ${channelBranchMap.size}`,
    inline: true,
  });

  // 2. SQLite state counts
  const dbWatchers = getAllOrchestrationState('stream_watcher');
  const dbProjects = getAllOrchestrationState('project');
  const dbPlanning = getAllOrchestrationState('planning_session');
  const dbDiscussion = getAllOrchestrationState('discussion_session');

  fields.push({
    name: 'SQLite State',
    value:
      `Watchers: ${dbWatchers.length}\n` +
      `Projects: ${dbProjects.length}\n` +
      `Planning: ${dbPlanning.length}\n` +
      `Discussion: ${dbDiscussion.length}`,
    inline: true,
  });

  // 3. Consistency checks
  // Memory vs SQLite watcher count
  if (activeStreamWatchers.size !== dbWatchers.filter((r) => {
    try { return !JSON.parse(r.data).completed; } catch { return false; }
  }).length) {
    issues.push('Watcher count mismatch: in-memory vs SQLite (active only)');
  }

  // Check for orphaned SQLite sessions (channel no longer exists)
  if (message.guild) {
    for (const row of dbPlanning) {
      try {
        const meta = JSON.parse(row.data);
        const ch = message.guild.channels.cache.get(meta.channelId);
        if (!ch) {
          issues.push(`Orphaned planning session: ${meta.channelId} (${meta.topic})`);
        }
      } catch { /* skip */ }
    }
    for (const row of dbDiscussion) {
      try {
        const meta = JSON.parse(row.data);
        const ch = message.guild.channels.cache.get(meta.channelId);
        if (!ch) {
          issues.push(`Orphaned discussion session: ${meta.channelId} (${meta.topic})`);
        }
      } catch { /* skip */ }
    }
  }

  // 4. Per-watcher status
  const watcherLines: string[] = [];
  for (const [key, watcher] of activeStreamWatchers) {
    const taskResult = readTaskState(watcher.projectSlug, watcher.streamType);
    const taskInfo = taskResult.state
      ? `${taskResult.state.tasks.filter((t) => t.status === 'approved').length}/${taskResult.state.tasks.length} approved`
      : taskResult.corrupt
        ? 'CORRUPT task-state.json'
        : 'no task-state.json';
    const silenceMin = Math.round((Date.now() - watcher.lastActivityTime) / 60000);
    watcherLines.push(`**${key}**: ${taskInfo} | silent ${silenceMin}m | branch: ${watcher.currentBranch || 'none'}`);

    if (taskResult.corrupt) {
      issues.push(`${key}: task-state.json is corrupt`);
    }
  }

  if (watcherLines.length > 0) {
    fields.push({
      name: 'Active Watchers',
      value: watcherLines.join('\n').slice(0, 1024),
      inline: false,
    });
  }

  // 5. Issues summary
  const color = issues.length === 0 ? 0x00ff00 : 0xff9900;
  const statusText = issues.length === 0
    ? 'All checks passed'
    : `${issues.length} issue(s) detected`;

  if (issues.length > 0) {
    fields.push({
      name: 'Issues',
      value: issues.map((i) => `- ${i}`).join('\n').slice(0, 1024),
      inline: false,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('Workflow Diagnostic Report')
    .setDescription(statusText)
    .addFields(fields)
    .setFooter({ text: '!doctor_workflow' })
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}
```

**Step 2: Register in command index**

In `src/channels/discord-commands/index.ts`, add:

Import:
```typescript
import { cmdDoctorWorkflow } from './doctor.js';
```

In the `commands` record, add under Monitoring:
```typescript
  doctor_workflow: cmdDoctorWorkflow,
```

**Step 3: Build**

Run: `npm run build`
Expected: Success

**Step 4: Update command count in docs**

The command count in `docs/discord-bot-summary.md` changes from 18 to 19.

**Step 5: Run manifest verification**

Run: `bash scripts/verify-workflow-manifest.sh`
Expected: PASSED (count updated to match)

**Step 6: Commit**

```bash
git add src/channels/discord-commands/doctor.ts src/channels/discord-commands/index.ts docs/discord-bot-summary.md
git commit -m "feat: add !doctor_workflow diagnostic command for live orchestration state inspection"
```

---

### Task 7: Build, Test, and Final Verification

**Step 1: Full build**

Run: `npm run build`
Expected: 0 errors

**Step 2: Full test suite**

Run: `npm test`
Expected: All pass (430+ existing + new invariant tests)

**Step 3: Run all verification scripts**

```bash
bash scripts/verify-workflow-manifest.sh
bash scripts/lint-plan-frontmatter.sh
```
Expected: Both PASSED

**Step 4: Codex review**

Run Codex to review all changes for correctness and missed edge cases.

**Step 5: Fix any Codex findings**

**Step 6: Final commit (if fixes needed)**

---

## File Summary

| File | Change Type |
|------|-------------|
| `src/channels/discord-commands/workflow-invariants.ts` | New module |
| `src/channels/discord-commands/workflow-invariants.test.ts` | New test |
| `src/channels/discord-commands/stream-watcher.ts` | Add invariant calls |
| `src/channels/discord-commands/index.ts` | Re-export invariants + register doctor command |
| `src/channels/discord-commands/doctor.ts` | New command handler |
| `scripts/verify-workflow-manifest.sh` | New script |
| `scripts/lint-plan-frontmatter.sh` | New script |
| `src/maintenance.ts` | Add scanWorkflowDrift() |
| `src/maintenance.test.ts` | Add test for new export |
| `docs/plans/*.md` | Add front matter |
| `docs/discord-bot-summary.md` | Update command count 18→19 |
