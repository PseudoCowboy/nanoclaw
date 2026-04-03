# [Project Name] Architecture

## Overview

[2-3 sentences: what this project does and its core approach]

## Directory Map

    src/
      api/         — HTTP handlers (depends on: services)
      services/    — Business logic (depends on: models, utils)
      models/      — Data types and validation (depends on: nothing)
      utils/       — Shared utilities (depends on: nothing)
    tests/
      api/         — API integration tests
      services/    — Service unit tests
      models/      — Model/validation tests

## Dependency Rules

Arrow = "depends on". No reverse dependencies allowed.

    api → services → models
                  ↘ utils ↙

**Invariants:**
- `api/` never imports from `api/` (no handler-to-handler calls)
- `models/` never imports from `services/` or `api/`
- All external input validated at API boundary (parse, don't validate)
- All errors are structured (no raw string throws)

## Workspace Model

Each agent has an isolated git worktree. No agent touches another agent's folder or main directly.

    projects/my-app/              ← main branch (merged code only)
    projects/my-app-athena/       ← Athena's worktree (branch: athena/my-app)
    projects/my-app-hermes/       ← Hermes's worktree (branch: hermes/my-app)
    projects/my-app-atlas/        ← Atlas's worktree (branch: atlas/my-app)
    projects/my-app-apollo/       ← Apollo's worktree (branch: apollo/my-app)
    projects/my-app-argus/        ← Argus's worktree (branch: argus/my-app)

**Setup:** `bash init-project.sh <repo-url> <your-name>` — clones repo, sets git identity, creates your worktree.

**Workflow:** work in your worktree → push branch → `gh pr create` → Argus reviews → `gh pr merge` → all agents `git pull origin main`

## Agents

| Agent | Worktree | Branch | Role |
|-------|----------|--------|------|
| Athena | `my-app-athena/` | `athena/my-app` | Plans features, writes docs, improves plans |
| Hermes | `my-app-hermes/` | `hermes/my-app` | Collaborates on plans, writes docs, refactors |
| Atlas | `my-app-atlas/` | `atlas/my-app` | Backend implementation (`src/api/`, `src/services/`, `src/models/`) |
| Apollo | `my-app-apollo/` | `apollo/my-app` | Frontend implementation (`src/ui/`, `src/components/`) |
| Argus | `my-app-argus/` | `argus/my-app` | Reviews PRs, runs quality checks, enforces standards |

## Conventions

- Structured logging (use project logger, not console.log)
- Validate at boundaries, trust internally
- Shared utilities over hand-rolled helpers
- Tests mirror src/ structure
