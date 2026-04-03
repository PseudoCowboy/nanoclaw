---
name: discord-review-workstream
description: Review protocol for Argus in ws-* workstream channels. File-first review using task-state.json, git diffs, and GOLDEN-PRINCIPLES.md. Updates task state to approved or changes_requested.
---

# Work Stream Code Review Protocol

When triggered to review in a `ws-*` channel, follow this protocol exactly.

## Step 1 — Find What Changed

Read `task-state.json` to identify the task under review:

```bash
STREAM_DIR="/workspace/shared/workstreams/<stream>"
cat "$STREAM_DIR/task-state.json"
```

Find the task with `status: "in_review"`. Note its `id` and `lastCommit`.

## Step 2 — Get the Diff

The implementing agent works on an isolated branch. Diff against main to see all changes:

```bash
cd "$STREAM_DIR"
# Find the agent's branch
AGENT_BRANCH=$(git branch --list 'agent/*' | head -1 | tr -d ' *')

if [ -n "$AGENT_BRANCH" ]; then
  # Branch-based diff (preferred — shows all task changes vs main)
  git diff main...$AGENT_BRANCH
  git log main..$AGENT_BRANCH --oneline
else
  # Fallback: commit-based diff (legacy — no branch isolation)
  git show <lastCommit> --stat
  git diff <lastCommit>~1 <lastCommit>
fi
```

If `lastCommit` is missing and no agent branch exists, diff against the previous commit:
```bash
git log --oneline -5
git diff HEAD~1 HEAD
```

## Step 3 — Run Mechanical Checks (if available)

Check the project root for available checks and run them in order. Skip any that don't exist:

```bash
PROJECT_ROOT=$(cd "$STREAM_DIR/../.." && pwd)

# 1. Architecture lint (if exists)
if [ -f "$PROJECT_ROOT/lint-architecture.sh" ]; then
  echo "=== Architecture Lint ==="
  LINT_OUTPUT=$(bash "$PROJECT_ROOT/lint-architecture.sh" 2>&1)
  LINT_EXIT=$?
  echo "$LINT_OUTPUT"
  if [ $LINT_EXIT -ne 0 ]; then echo "LINT_FAILED"; fi
fi

# 2. TypeScript check (if tsconfig exists)
if [ -f "$PROJECT_ROOT/tsconfig.json" ]; then
  echo "=== TypeScript Check ==="
  TSC_OUTPUT=$(cd "$PROJECT_ROOT" && npx tsc --noEmit 2>&1)
  TSC_EXIT=$?
  echo "$TSC_OUTPUT"
  if [ $TSC_EXIT -ne 0 ]; then echo "TYPECHECK_FAILED"; fi
fi

# 3. Tests (if package.json has test script)
if [ -f "$PROJECT_ROOT/package.json" ] && grep -q '"test"' "$PROJECT_ROOT/package.json"; then
  echo "=== Tests ==="
  TEST_OUTPUT=$(cd "$PROJECT_ROOT" && npm test 2>&1)
  TEST_EXIT=$?
  echo "$TEST_OUTPUT"
  if [ $TEST_EXIT -ne 0 ]; then echo "TESTS_FAILED"; fi
fi

# 4. Python checks (if pyproject.toml or requirements.txt exists)
if [ -f "$PROJECT_ROOT/pyproject.toml" ] || [ -f "$PROJECT_ROOT/requirements.txt" ]; then
  if command -v pytest &>/dev/null; then
    echo "=== Pytest ==="
    PYTEST_OUTPUT=$(cd "$PROJECT_ROOT" && pytest 2>&1)
    PYTEST_EXIT=$?
    echo "$PYTEST_OUTPUT"
    if [ $PYTEST_EXIT -ne 0 ]; then echo "TESTS_FAILED"; fi
  fi
fi
```

If any check fails (exit code non-zero OR output contains `LINT_FAILED`, `TYPECHECK_FAILED`, or `TESTS_FAILED`), immediately set status to `changes_requested` and report the failures. Do not proceed to semantic review.

## Step 4 — Semantic Review

Check the code against GOLDEN-PRINCIPLES.md. Evaluate:

1. **Correctness** — Does the implementation match `scope.md` requirements for this task?
2. **Error handling** — Graceful failures, proper logging, no swallowed errors
3. **Security** — Input validation, no hardcoded secrets, proper auth checks
4. **Test coverage** — Are there tests? Do they cover edge cases?
5. **Architecture** — Does it follow dependency direction and boundary rules from GOLDEN-PRINCIPLES.md?
6. **Code duplication** — Shared utilities used where appropriate?

Read `scope.md` and `tasks.md` to understand what the task was supposed to accomplish:

```bash
cat "$STREAM_DIR/scope.md"
cat "$STREAM_DIR/tasks.md"
```

## Step 5 — Update Task State

### If Approved

```bash
cd "$STREAM_DIR"
python3 -c "
import json
state = json.load(open('task-state.json'))
# Find the task that is in_review — this is the one we just reviewed
task = next((t for t in state['tasks'] if t['status'] == 'in_review'), None)
if task is None:
    # Fallback to currentTask if no in_review found
    current_id = state.get('currentTask')
    task = next((t for t in state['tasks'] if t['id'] == current_id), None)
if task:
    task['status'] = 'approved'
    task['reviewRounds'] = task.get('reviewRounds', 0) + 1
    state['lastReviewedBy'] = 'Argus'
    json.dump(state, open('task-state.json', 'w'), indent=2)
"
```

Post in Discord:
```
APPROVED Task #<id>: [brief summary of what was reviewed]
- [any minor notes or suggestions for future tasks]
```

### If Changes Requested

```bash
cd "$STREAM_DIR"
python3 -c "
import json
state = json.load(open('task-state.json'))
# Find the task that is in_review — this is the one we just reviewed
task = next((t for t in state['tasks'] if t['status'] == 'in_review'), None)
if task is None:
    # Fallback to currentTask if no in_review found
    current_id = state.get('currentTask')
    task = next((t for t in state['tasks'] if t['id'] == current_id), None)
if task:
    task['status'] = 'changes_requested'
    task['reviewRounds'] = task.get('reviewRounds', 0) + 1
    state['lastReviewedBy'] = 'Argus'
    json.dump(state, open('task-state.json', 'w'), indent=2)
"
```

Post in Discord:
```
CHANGES REQUESTED Task #<id>:
- [specific issue 1 with file:line reference]
- [specific issue 2 with file:line reference]
- [what needs to change and why]
```

## Step 6 — Escalate if Needed

If `reviewRounds >= 3` for this task, also post:

```
WARNING Task #<id> has gone <N> review rounds. Human input needed.
```

The stream watcher will forward this to `control-room`.

## Important Rules

- **Be specific** — Reference file paths and line numbers in feedback
- **Be objective** — Focus on correctness and quality, not style preferences
- **One task per trigger** — Review exactly one task, update state, then exit
- **Always update task-state.json** — This is how the watcher knows the review is done
- **Don't fix code yourself** — Report issues for the implementing agent to fix
