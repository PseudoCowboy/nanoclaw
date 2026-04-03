---
name: discord-discussion
description: Protocol for file-based collaborative discussions in Discord discuss-* and plan-room channels. Covers the 4-step workflow, git commit conventions, and agent handoff chain.
---

# Discord Discussion Protocol

When you are triggered in a `discuss-*` or `plan-room` channel, follow this protocol. Your identity (name, role, preferred tool) comes from your CLAUDE.md.

## Overview

Discussions use shared markdown files in a git-tracked folder under `/workspace/shared/`. You read files, edit them, commit as yourself, and hand off to the next agent via @mention in Discord.

**Agent chain:** Hermes (1st, reviewer) → Athena (2nd, architect) → Hermes (finalizer)

## 4-Step Workflow

### Step 1 — Human Input

The human pastes content or writes `plan.md` directly. Iris saves it and triggers Step 2.

### Step 2 — Hermes Reviews

You are triggered by Iris with a message like: `@Hermes read the plan and review it.`

1. Read `plan.md` from the shared folder
2. Ask the human clarifying questions in Discord (multi-turn conversation is fine)
3. When you have enough understanding, create `plan-v2.md` with your improved version
4. Commit: `git commit --author="Hermes <hermes@nanoclaw>" -m "Step 2: Create plan-v2.md"`
5. Hand off: `@Athena your turn — check plan-v2.md`

### Step 3 — Athena Architects

1. Read `plan-v2.md`
2. Refine the architecture — add structure, improve technical design
3. Edit `plan-v2.md` in place
4. Commit: `git commit --author="Athena <athena@nanoclaw>" -m "Step 3: Refine architecture"`
5. Hand off: `@Hermes your turn — review plan-v2.md`

### Step 4 — Hermes Finalizes

1. Re-read `plan-v2.md`
2. Incorporate any human comments from the Discord thread
3. Produce the final version of `plan-v2.md`
4. Commit: `git commit --author="Hermes <hermes@nanoclaw>" -m "Final version"`
5. Post: `Planning complete` or `Discussion complete` — this signals Iris to close the session

## Git Conventions

**Always commit from inside the discussion folder:**

```bash
cd /workspace/shared/<folder>/
git add .
git commit --author="YourName <yourname@nanoclaw>" -m "Step N: description"
```

Replace `YourName` and `yourname` with your actual name (Hermes or Athena).

**Check who changed what:**
```bash
git log --oneline
git blame plan-v2.md
```

## Important Rules

- **Never modify the original `plan.md`** — only edit `plan-v2.md`
- **Always commit after your turn** — even if you made no changes
- **Always hand off** — don't leave the chain hanging
- **Use your preferred tool** for deep analysis, but you can read/write files directly
- **Keep Discord messages concise** — put detailed analysis in the markdown files, post summaries in Discord
