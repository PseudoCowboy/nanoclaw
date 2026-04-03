---
name: discord-discussion
description: Protocol for file-based collaborative discussions in Discord discuss-* channels. Covers 3-round workflow (improve, disagree, resolve), git commit conventions, and agent handoff chain.
---

# Discord Discussion Protocol

When you are triggered in a `discuss-*` Discord channel, follow this protocol. Your identity (name, role, preferred tool, chain position) comes from your CLAUDE.md.

## Overview

Discussions use shared markdown files in `/workspace/shared/discuss-<slug>/`. This folder is a git repo. You read files, edit them, commit as yourself, and hand off to the next agent via @mention in Discord.

**Chain order:** Hermes (1st, reviewer) → Athena (2nd, architect)

## Git Conventions

**Always commit from inside the discussion folder:**

```bash
cd /workspace/shared/discuss-<slug>/
git add .
git commit --author="YourName <yourname@nanoclaw>" -m "Round N: description of changes"
```

Replace `YourName` and `yourname` with your actual name (Hermes or Athena).

**Check who changed what:**
```bash
git log --oneline
git blame plan-v2.md
```

## Round 1 — Improvement (You ↔ Human)

You are triggered by the human with a message like `@YourName read plan.md and requirements.md, improve the plan`.

1. Read the files mentioned from `/workspace/shared/discuss-<slug>/`
2. Analyze them using your preferred tool if needed
3. Ask the human questions in Discord to clarify — have a multi-turn conversation
4. When you have enough understanding, decide you're done:
   - **If you are Hermes (1st):** Create `plan-v2.md` with your improved version. Commit. Send: `@Athena your turn — check plan-v2.md under discuss-<slug>`
   - **If you are Athena (2nd):** Edit `plan-v2.md` in place with your improvements. Commit. Send: `@Hermes your turn — check plan-v2.md under discuss-<slug>`

## Round 2 — Disagreement (You ↔ Other Agents, Human Observes)

Iris will announce Round 2 and trigger Hermes. **Do not ask the human questions in this round.** You debate directly with other agents.

1. Re-read `plan-v2.md`
2. Run `git log --oneline` and `git blame plan-v2.md` to see who changed what
3. If you disagree with a change another agent made:
   - @mention that agent in Discord and ask why they made that change
   - Wait for their response and debate
   - If resolved through debate, move on
   - If still unresolved, write it to `disagreements.md` under a section with your name:
     ```markdown
     ## YourName — Disagreements

     ### Disagree with [AgentName]'s change to [section]
     **What they changed:** [describe]
     **Why I disagree:** [explain]
     ```
4. Commit your changes to `disagreements.md`
5. Hand off:
   - **Hermes (1st):** Send `@Athena your turn — review plan-v2.md and disagreements.md`
   - **Athena (2nd):** Append your disagreements to `disagreements.md`. Send `@Hermes your turn — review plan-v2.md and disagreements.md`

If you have no disagreements, say so in Discord and hand off to the next agent anyway.

## Round 3 — Resolution (Iris Orchestrates)

Iris will @mention all agents. You respond in chain order.

1. Read `plan-v2.md` and `disagreements.md`
2. For each disagreement listed:
   - State whether it's **resolved** or **still disagree**
   - If still disagree, re-describe it clearly with your reasoning
3. Update `disagreements.md` with your final positions
4. Commit

After both agents respond, Iris asks the human for input. Then:
- **Hermes only:** Iris will @mention you to produce the final version. Read the human's comments, incorporate their decisions into `plan-v2.md`, commit with message "Final version incorporating human decisions", and send `✅ Discussion complete. Final plan is plan-v2.md`

## Important Rules

- **Never modify the original files** (plan.md, requirements.md, etc.) — only edit plan-v2.md and disagreements.md
- **Always commit after your turn** — even if you made no changes, commit with a note
- **Always hand off** — don't leave the chain hanging
- **Use your preferred tool** for deep analysis, but you can read/write files directly
- **Keep Discord messages concise** — put detailed analysis in the markdown files, post summaries in Discord
