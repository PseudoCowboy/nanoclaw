---
name: discord-review
description: GitHub PR review protocol for Argus. Use when reviewing work via GitHub PRs (e.g., when agents push branches and open PRs). For task-state.json-driven workstream reviews, see discord-review-workstream instead.
allowed-tools: Bash(gh:*), Bash(git:*), Bash(bash:*)
---

# GitHub PR Code Review Protocol

Use this protocol when reviewing code submitted as GitHub PRs. This is separate from the workstream review protocol (`discord-review-workstream`) which uses `task-state.json` and is triggered by the stream watcher.

**When to use this skill:** When an agent has pushed a branch to GitHub and opened a PR.
**When to use `discord-review-workstream` instead:** When working in a `ws-*` channel with `task-state.json`-driven execution.

## Overview

Agents work in isolated worktrees and submit GitHub PRs to merge into main. You (Argus) review these PRs using `gh` CLI, leave comments, request changes, and approve when clean.

## Step 1 — Find the PR

```bash
# List open PRs for the project
gh pr list --repo OWNER/REPO --state open

# View a specific PR
gh pr view PR_NUMBER --repo OWNER/REPO

# View the diff
gh pr diff PR_NUMBER --repo OWNER/REPO
```

## Step 2 — Run Mechanical Checks

Check out the PR branch locally and run the linter + structural tests:

```bash
cd /workspace/shared/workstreams/STREAM/
git fetch origin
git checkout BRANCH_NAME
bash ../../lint-check.sh
```

If checks fail, request changes immediately — no need for semantic review yet.

## Step 3 — Semantic Review

Review the diff for:
- Architecture violations not caught by linter (semantic boundary crossings)
- Missing tests for new code
- Error handling gaps
- Code duplication that should use shared utilities
- Unclear naming or missing documentation
- Violations of GOLDEN-PRINCIPLES.md

## Step 4 — Submit Review

```bash
# Approve
gh pr review PR_NUMBER --repo OWNER/REPO --approve --body "LGTM. Lint and structural tests pass."

# Request changes
gh pr review PR_NUMBER --repo OWNER/REPO --request-changes --body "$(cat <<'EOF'
## Issues Found

### 1. [Title]
**Severity:** blocking
**File:** path/to/file.ts:42
**Problem:** [What's wrong]
**Fix:** [Exactly what to change]

### 2. [Title]
...
EOF
)"

# Leave a comment on a specific line
gh api repos/OWNER/REPO/pulls/PR_NUMBER/comments -f body="Suggestion: ..." -f path="src/file.ts" -F line=42 -f side=RIGHT
```

## Step 5 — Hand Off

- If `changes-requested`: Send in Discord `@Author PR #N needs changes — N blocking issues` (where Author is the agent who opened the PR, e.g., @Atlas or @Apollo)
- If `approved`: Send in Discord `✅ PR #N approved. You can merge with: gh pr merge N --repo OWNER/REPO`

## Step 6 — Re-review (after fixes)

When triggered again:
1. Re-fetch the PR diff: `gh pr diff PR_NUMBER`
2. Re-run mechanical checks
3. Review only new commits since last review
4. Approve or request changes again
5. **Escalate to human after 3 rounds** — send in Discord: `⚠️ PR #N has gone 3 review rounds. Human input needed.`

## After Merge

Remind all agents to sync their worktrees:

```bash
cd /workspace/shared/workstreams/STREAM-AGENT/
git pull origin main
```
