# Discord Project Setup

Trigger: user says `!create_project NAME` or asks to set up a new project workspace.

## What This Does

Creates a file-first project workspace under `/workspace/shared/` with a standardized directory structure for multi-agent collaboration.

## Workspace Structure

When `!create_project` runs, Iris creates this structure on the host at `groups/shared_project/active/<slug>/`:

```
active/<project-slug>/
├── control/                  # Human-managed planning artifacts
│   ├── draft-plan.md         # Human writes initial plan here
│   └── (planning artifacts added by !plan workflow)
├── coordination/             # Cross-team status and dependencies
│   ├── progress.md           # Auto-updated dashboard
│   ├── dependencies.md       # Blocking relationships
│   ├── integration-points.md # Cross-team handoffs
│   └── status-board.md       # Real-time status
├── workstreams/              # Empty — per-team folders created by !decompose
├── archive/                  # Completed work
└── lint-check.sh             # Mechanical validation script (customize per project)
```

After `!decompose`, each workstream gets its own subfolder:

```
workstreams/backend/
├── scope.md          # Deliverables and boundaries
├── tasks.md          # Checklist from plan decomposition
├── progress.md       # Agent-maintained progress log
├── handoffs.md       # Cross-team integration points
└── task-state.json   # Machine-readable task status (drives stream watcher)
```

Inside containers, this is mounted at `/workspace/shared/`.

## Discord Channel Structure

`!create_project` creates a Discord category with three core channels:

```
ProjectName (Category)
├── #control-room — Human + Athena + Argus | Oversight, decisions
├── #plan-room   — Athena + Hermes + Human | Planning sessions
└── #release-log — Human + Argus | Deliveries, sign-offs
```

Work stream channels (`#ws-backend`, `#ws-frontend`, etc.) are created later by `!decompose`.

## Agent Access

- All project-scoped agents mount the project directory at `/workspace/shared/`
- Each agent also has `/workspace/group/` for private notes
- The workspace is git-initialized — agents should commit their changes

## Notes

- Write your draft plan to `control/draft-plan.md` before running `!plan`
- `lint-check.sh` is a template — customize it per project for mechanical validation
- The workspace persists across container restarts (it's on the host filesystem)
