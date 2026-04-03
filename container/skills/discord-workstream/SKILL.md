---
name: discord-workstream
description: Protocol for work stream agents (Atlas, Apollo) in ws-* channels. Work through tasks.md one at a time, mark done, update progress, commit, post summary.
---

# Discord Work Stream Protocol

When you are triggered in a `ws-*` Discord channel, follow this protocol. Your identity (name, role, preferred tool) comes from your CLAUDE.md.

## Overview

You work through a structured task list in `tasks.md`, implementing one task per trigger. After completing a task, you mark it done, update progress, commit, and post a summary. Then your container exits. Iris will re-trigger you for the next task.

## Branch Isolation

You work on an **isolated git branch** (e.g., `agent/atlas/backend`). The stream watcher created this branch from `main`, and your container checked it out automatically. **Do NOT switch to main or merge yourself** — the stream watcher handles merging after Argus reviews and approves your work.

## Workspace

Your files are at `/workspace/shared/workstreams/<stream>/`:

- `tasks.md` — Checklist of tasks from the plan. **This is your work queue.**
- `scope.md` — Deliverables and boundaries for this stream
- `progress.md` — Running log of what you've done (you maintain this)
- `handoffs.md` — Cross-team integration points

The `<stream>` value comes from the channel topic or the @mention that triggered you. The project root is already mounted at `/workspace/shared/`.

## Workflow

### 1. Read Your Tasks

```bash
cat /workspace/shared/workstreams/<stream>/tasks.md
```

Find the first unchecked task (`- [ ]`).

### 2. Implement the Task

Use your preferred tool to implement the task. Write code, tests, configs — whatever the task requires.

### 3. Mark the Task Done

Edit `tasks.md` and change the task from `- [ ]` to `- [x]`:

```bash
# Example: mark the first unchecked task as done
sed -i '0,/- \[ \]/{s/- \[ \]/- [x]/}' /workspace/shared/workstreams/<stream>/tasks.md
```

### 4. Update Progress

Append to `progress.md` with what you did:

```markdown
## [Task Name] — Completed [date]

- What was implemented
- Files created/modified
- Tests added
- Any notes or issues
```

### 5. Commit

Commit your implementation work (tasks.md, progress.md, and all code changes):

```bash
cd /workspace/shared/workstreams/<stream>/
git add -A
git commit --author="YourName <yourname@nanoclaw>" -m "Complete: [task description]"
```

Replace `YourName` and `yourname` with your actual name (e.g., Atlas, Apollo).

### 6. Update Task State

**After committing**, update `task-state.json` to signal the review gate. This must happen AFTER the commit so `lastCommit` captures the correct hash:

```bash
cd /workspace/shared/workstreams/<stream>/
python3 -c "
import json, subprocess, os
state_path = 'task-state.json'
if not os.path.exists(state_path):
    exit(0)
state = json.load(open(state_path))
current_id = state.get('currentTask')
if current_id is None:
    exit(0)
task = next((t for t in state['tasks'] if t['id'] == current_id), None)
if task is None:
    exit(0)
task['status'] = 'implemented'
try:
    task['lastCommit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD']).decode().strip()
except:
    pass
json.dump(state, open(state_path, 'w'), indent=2)
"
# Commit the task-state.json update separately
git add task-state.json
git commit --author="YourName <yourname@nanoclaw>" -m "Mark task as implemented for review"
```

This tells the stream watcher to trigger Argus for code review. **Do NOT post "Work complete"** — the watcher handles completion after all tasks are reviewed and approved.

### 7. Post Summary in Discord

Post a brief summary of what you did:

```
✅ **Completed:** [task name]
- [key changes]
- [files modified]
- Tasks: X/Y done — awaiting review
```

### 8. Exit

Your container exits after posting the summary. Iris's stream watcher detects the update and re-triggers you if tasks remain.

## Important Rules

- **One task per trigger** — complete exactly one task, then exit
- **Always update tasks.md, progress.md, AND task-state.json** — all three files must reflect your work
- **Commit BEFORE updating task-state.json** — so `lastCommit` captures the correct commit hash
- **Update task-state.json to "implemented"** — this triggers Argus code review. Do NOT post "Work complete" manually.
- **Don't skip tasks** — work through them in order unless blocked
- **If blocked** — post the blocker in the channel, update progress.md with what's blocking you, and exit. Iris will alert the control room.

- **Don't switch branches** — your branch is pre-configured. Do NOT merge to main yourself.

## Git Conventions

Your branch is pre-configured by the stream watcher. Just commit normally:

```bash
cd /workspace/shared/workstreams/<stream>/
git add -A
git commit --author="YourName <yourname@nanoclaw>" -m "Complete: [task summary]"
```
