---
status: active
date: 2026-03-25
---

# Work Stream Execution Monitoring Design

*Date: 2026-03-25*

## Problem

After `!decompose` creates work stream channels, agents receive a vague "read your scope and begin work" message with a generic `scope.md`. There is:
- No structured task list from the plan
- No progress tracking mechanism
- No periodic heartbeat/status reporting
- No monitoring for silent/stuck agents
- No automatic re-triggering to continue work
- No completion detection

## Design

### Overview

After planning completes (plan-v2.md finalized), `!decompose` triggers Hermes to parse the plan into per-stream task lists before creating channels. Work stream agents (Atlas, Apollo) follow a new `discord-workstream` skill that instructs them to work through tasks one at a time, marking each done. Iris runs a per-stream watcher that reports hourly, detects silence, re-triggers agents, and detects completion.

### 1. Hermes Decomposition Step

**When:** Inside `cmdDecompose()`, after determining which streams to create but before creating Discord channels.

**Flow:**
1. `cmdDecompose()` determines which streams to create
2. Creates workspace folders (existing behavior)
3. Finds the plan file in priority order:
   - Planning session's shared folder: `plan-<slug>/plan-v2.md`
   - `active/${projectSlug}/control/approved-plan.md`
   - `active/${projectSlug}/control/draft-plan.md`
4. Triggers Hermes via container with the plan content + list of requested streams
5. Hermes writes per-stream files:
   - `workstreams/${stream}/tasks.md` — checklist of tasks extracted from plan
   - `workstreams/${stream}/scope.md` — updated with real description
6. Iris polls for `tasks.md` existence in each stream folder (timeout: 5 minutes)
7. If timeout: proceed with generic scope (fallback), warn in control-room
8. Create Discord channels and @mention lead agents with specific instructions
9. Start `startStreamWatcher()` for each created stream

**Hermes runs as a single container invocation** writing files for all streams at once, so it sees the full picture and can distribute tasks correctly.

**tasks.md format:**
```markdown
# Backend Tasks

Extracted from plan-v2.md on 2026-03-25

- [ ] Set up Express server with TypeScript
- [ ] Create user authentication endpoints
- [ ] Implement database schema with Prisma
- [ ] Add input validation middleware
- [ ] Write unit tests for auth endpoints
```

### 2. Container Skill for Work Stream Agents

**New file:** `container/skills/discord-workstream/SKILL.md`

Instructs Atlas/Apollo how to work in `ws-*` channels:

1. **On trigger:** Read `tasks.md` and `scope.md` from `/workspace/shared/active/<project>/workstreams/<stream>/`
2. **Work through tasks sequentially:** Pick the first unchecked `- [ ]` item, implement it
3. **After completing a task:** Mark it `- [x]` in `tasks.md`, update `progress.md` with what was done, commit both files
4. **When all tasks done:** Post "Work complete" in the channel, update `progress.md` with a final summary
5. **Git conventions:** Commit as yourself (e.g. `--author="Atlas <atlas@nanoclaw>"`)

The agent is triggered once per @mention. After completing one task and updating files, it posts a summary in Discord. The container exits. Iris's watcher detects the file change and re-triggers if tasks remain. This keeps each container invocation bounded and gives Iris control of the loop.

### 3. Stream Watcher

**New function:** `startStreamWatcher()` in `discord-commands.ts`

**State per stream:**
```typescript
interface StreamWatcherState {
  interval: ReturnType<typeof setInterval>;
  listener: (...args: any[]) => void;
  projectSlug: string;
  streamType: string;
  channelId: string;
  categoryId: string;
  lastActivityTime: number;
  lastStatusReport: number;
  completed: boolean;
}
```

Stored in `activeStreamWatchers` Map, keyed by `${projectSlug}:${streamType}`.

**Poll loop (every 10 minutes):**

1. **Check file changes:** Read `tasks.md` and `progress.md` mtimes. If either changed since last check → update `lastActivityTime`
2. **Track Discord activity:** A `messageCreate` listener registered at watcher start. Any agent message in the channel → update `lastActivityTime`
3. **Hourly status report:** If `now - lastStatusReport >= 1 hour`:
   - Read `tasks.md`, count `- [x]` vs total `- [ ]` items
   - Post status embed to control-room: `"⚙️ ws-backend: 3/7 tasks done (Atlas active)"`
   - Update `lastStatusReport`
4. **Silence detection:** If `now - lastActivityTime >= 1 hour`:
   - Post nudge in work stream channel: `"⏰ @Atlas — no activity detected for 1 hour. Are you blocked?"`
   - Post alert in control-room: `"⚠️ ws-backend: no activity for 1 hour. May need attention."`
5. **Re-trigger agent:** If `tasks.md` was updated AND remaining unchecked tasks exist → @mention lead agent: `"@Atlas — continue with the next unchecked task in tasks.md"`
6. **Completion detection:** If agent posts "Work complete" OR all tasks checked:
   - Stop watcher (clear interval, remove listener)
   - Post completion embed to control-room: `"✅ ws-backend complete: 7/7 tasks done"`
   - Remove from `activeStreamWatchers`

**Lifecycle:**
- Started by: `cmdDecompose()` after channel creation + agent trigger
- Stopped by: Completion detection, `!close_discussion` on ws-* channel, `!cleanup_server`

### 4. Project Isolation

Every watcher stores `projectSlug` and `categoryId`. Channel lookups always filter by `parentId === categoryId`. The watcher key `${projectSlug}:${streamType}` ensures `projectA:backend` and `projectB:backend` are completely independent.

The shared filesystem is already isolated by project slug: `groups/shared_project/active/${projectSlug}/workstreams/${stream}/`.

### 5. Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `STREAM_POLL_INTERVAL` | 600,000 (10 min) | How often the watcher polls |
| `STREAM_SILENCE_THRESHOLD` | 3,600,000 (1 hour) | When to alert on no activity |
| `STREAM_STATUS_INTERVAL` | 3,600,000 (1 hour) | How often to post status to control-room |
| `HERMES_DECOMPOSE_TIMEOUT` | 300,000 (5 min) | Max wait for Hermes to write tasks.md |

## File Summary

| File | Action | What |
|------|--------|------|
| `src/channels/discord-commands.ts` | Modify | Add `startStreamWatcher()`, `stopStreamWatcher()`, `activeStreamWatchers`. Rewrite `cmdDecompose()` to trigger Hermes + start watchers. Add re-trigger logic, completion detection. |
| `container/skills/discord-workstream/SKILL.md` | **New** | Skill for work stream agents — read tasks.md, work through items, update progress.md, mark done |
| `agents/config.json` | Modify | Add `ws-*` to Atlas and Apollo `channelNames` |
| `groups/dc_atlas/CLAUDE.md` | Minor update | Reference discord-workstream skill pattern |
| `groups/dc_apollo/CLAUDE.md` | Minor update | Same |
| `src/channels/discord-commands.test.ts` | Modify | Tests for stream watcher start/stop, task counting, completion detection |

## Verification

1. `npm run build` — TypeScript compiles
2. `npm test` — all tests pass
3. `./container/build.sh` — container rebuilds with new skill
4. Manual test:
   - `!create_project Test` → `!plan some feature` → planning completes
   - `!decompose backend frontend` → Hermes writes tasks.md → channels created → agents triggered
   - Agents work through tasks, mark done, post summaries
   - Hourly status shows up in control-room
   - Silence nudge triggers after 1 hour of inactivity
   - "Work complete" stops the watcher
