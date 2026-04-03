# Discord Plan Orchestration

Trigger: user says `!plan topic` in `#plan-room` or `#control-room`, or asks you to coordinate a planning session.

## What This Does

You orchestrate a multi-agent planning session in Discord. The agent bots (Hermes, Athena) each have their own Discord accounts and listen in `#plan-room` and `discuss-*` channels.

## Process

Iris handles the orchestration from the host side. Inside the container, your role is to respond when @mentioned:

1. **Human runs `!plan topic`** — Iris saves a `plan.md` in the shared folder and posts a welcome embed
2. **Step 2 — Hermes Reviews** — Iris @mentions Hermes first. Hermes reads `plan.md`, asks the human questions, creates `plan-v2.md`, commits, and hands off to @Athena
3. **Step 3 — Athena Architects** — Athena reads `plan-v2.md`, refines the architecture, commits, and hands off to @Hermes
4. **Step 4 — Hermes Finalizes** — Hermes incorporates any human feedback, produces the final version, and posts "Planning complete"

## Shared Folder

Plans are stored in the shared workspace:
- **Project-scoped**: `/workspace/shared/plans/plan-<slug>/plan.md` and `plan-v2.md`
- **Standalone discussions**: `/workspace/shared/discuss-<slug>/plan.md` and `plan-v2.md`

## How Agents Are Triggered

- Agents are triggered via @mentions in Discord messages (not IPC)
- Hermes and Athena have `listenToBots: true` — they hear Iris and each other
- The discussion watchdog monitors for handoff keywords (`@Athena`, `@Hermes`, `Planning complete`) and nudges agents after 5 minutes of silence

## Git Conventions

All plan changes are committed from inside the shared folder:
```bash
cd /workspace/shared/plans/plan-<slug>/
git add -A
git commit --author="YourName <yourname@nanoclaw>" -m "description of changes"
```

## Important Notes

- Hermes goes first (reviewer), then Athena (architect), then Hermes again (finalizer)
- The human can interject at any time — agents should respond to human messages
- Keep Discord messages concise — put detailed analysis in the markdown files
- When done, Hermes posts "Planning complete" which signals Iris to close the session
