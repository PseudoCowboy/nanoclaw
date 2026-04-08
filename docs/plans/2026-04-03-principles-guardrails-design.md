---
status: active
date: 2026-04-03
---

# Principles-Driven Guardrails — Design Document

> **Generated:** 2026-04-03
> **Source:** Claude + Codex (GPT-5.4) independent analyses, then merged

## Problem Statement

The multi-agent Discord workflow went through 4 development rounds (March 17 → April 3) involving multiple AI agents and planning sessions. Despite having Agent-First Development Principles documented in `docs/AGENT-FIRST-PRINCIPLES.md`, the same failure modes kept recurring:

1. **Stale docs survived across rounds** — old design docs (Prometheus agent, 3-round debates, wrong paths) lived in the repo unchallenged for weeks
2. **Impossible states occurred at runtime** — Argus reviewed Argus, orphaned sessions after restart, dual-channel cleanup missed
3. **Plans superseded silently** — March 17 docs stayed "active" while March 25 designs replaced them
4. **No agent could self-diagnose** — when things went wrong, humans had to manually inspect SQLite and in-memory maps

## Root Cause

Both Claude and Codex independently converged on the same meta-problem:

> The system is good at **generating** artifacts, weak at **declaring which is authoritative**, and weakest at **detecting divergence**.

The principles document (P1–P8) describes what should be true. But nothing in the codebase **enforces** or **detects violations of** those principles. The gap between "principle written" and "principle active" is the root cause.

## Proposed Guardrails

### G1. Workflow Manifest — `scripts/verify-workflow-manifest.sh`

**Principle:** P1 (Repo as Source of Truth), P3 (Enforce Architecture Mechanically)

Generate a canonical manifest from code (agent names from `constants.ts`, commands from `index.ts`, workstream types from `constants.ts`) and compare against doc claims. Fail if docs reference agents, commands, or streams that don't exist in code.

**Detects:** Prometheus-style phantom agents, stale command lists, wrong channel names

### G2. Workflow Invariants — `src/channels/discord-commands/workflow-invariants.ts`

**Principle:** P3 (Enforce Architecture Mechanically), P4 (Build Feedback Loops)

Runtime assertions that throw/log when the orchestration state machine enters an impossible state. Called from existing state transitions in `stream-watcher.ts`, `planning.ts`, and `discussion.ts`.

**Detects:** Argus self-review, orphaned sessions, review without prior implementation, task advancing past approved without merge

### G3. Scheduled Drift Scan — added to `src/maintenance.ts`

**Principle:** P6 (Continuous Garbage Collection)

Daily maintenance task that scans the workspace for stale patterns: old agent names in files, wrong path patterns, orphaned workstream folders, zombie discussion sessions.

**Detects:** Accumulated drift between code and workspace files

### G4. Plan Front Matter — schema + linting in `scripts/lint-plan-frontmatter.sh`

**Principle:** P5 (Plans as First-Class Artifacts)

Every plan `.md` file must have YAML front matter with `status:` (draft/active/completed/superseded), `superseded_by:` (when applicable), and `date:`. A lint script validates this.

**Detects:** Plans that were never marked superseded, missing lifecycle metadata

### G5. `!doctor_workflow` — Discord diagnostic command

**Principle:** P2 (Agent Legibility), P4 (Build Feedback Loops)

Exposes live orchestration state to both humans and agents: active sessions, stream watchers, branch maps, SQLite vs in-memory consistency.

**Detects:** State divergence between SQLite and in-memory maps, orphaned watchers, stale sessions

## Implementation Files

| File | Change |
|------|--------|
| `scripts/verify-workflow-manifest.sh` | New — CI-friendly manifest generation + doc comparison |
| `src/channels/discord-commands/workflow-invariants.ts` | New — runtime assertion functions |
| `src/channels/discord-commands/stream-watcher.ts` | Call invariant checks at state transitions |
| `src/maintenance.ts` | Add `scanWorkflowDrift()` function |
| `scripts/lint-plan-frontmatter.sh` | New — validates plan YAML front matter |
| `src/channels/discord-commands/doctor.ts` | New — `!doctor_workflow` command handler |
| `src/channels/discord-commands/index.ts` | Register `doctor_workflow` command |
| `docs/plans/*.md` | Add front matter to existing plans |

## What's Explicitly Out of Scope

- Automated CI pipeline (no GitHub Actions exist yet)
- Automated fix-forward (these are detection-only guardrails)
- Changes to the planning workflow itself
- New agent capabilities
