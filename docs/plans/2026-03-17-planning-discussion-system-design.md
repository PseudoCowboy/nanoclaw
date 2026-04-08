---
status: superseded
date: 2026-03-17
superseded_by: 2026-03-18-file-based-discussion-system-design.md
---

# Planning Discussion System Design

**Date:** 2026-03-17
**Status:** Approved

## Overview

Update the Discord bot (Iris) to support multi-agent planning debates. Add two new agent bots (Hermes/Claude, Prometheus/Gemini) that join Athena in `#plan-room` and ad-hoc discussion channels. Remove `setup_orchestration` and `setup_test_project` commands. `create_project` becomes the sole project setup command.

## Agent Roster (6 total, was 4)

| Agent | Tool | Role | Channels |
|-------|------|------|----------|
| Athena (purple) | Codex | Planning | `plan-room`, `discuss-*` |
| Hermes (green) | Claude | Planning | `plan-room`, `discuss-*` |
| Prometheus (yellow) | Gemini | Planning | `plan-room`, `discuss-*` |
| Atlas (red) | Claude | Backend Engineer | `backend-dev` |
| Apollo (blue) | Gemini | Frontend Engineer | `frontend-ui` |
| Argus (orange) | Claude | Monitor | `qa-alerts`, `control-room`, `backend-dev`, `frontend-ui` |

All three planning agents participate in free debate with no fixed perspective roles. Each brings the natural strengths of their underlying AI model.

## Discord Server Structure

```
Project-Alpha/                    (created by !create_project)
+-- #control-room                 Human, Argus -- management, approvals, status
+-- #plan-room                    Athena, Hermes, Prometheus, Human -- feature planning
+-- #backend-dev                  Atlas, Argus, Human
+-- #frontend-ui                  Apollo, Argus, Human
+-- #qa-alerts                    Argus, Human
+-- #release-log                  Human, Argus

DISCUSSIONS/                      (auto-created on first !create_discussion)
+-- #discuss-api-design-patterns  Athena, Hermes, Prometheus, Human
+-- #discuss-redis-vs-postgres    Athena, Hermes, Prometheus, Human
+-- ...
```

### Isolation

- Project categories are fully isolated. Same channel name under different categories = independent context.
- Discussion channels live under a global `DISCUSSIONS` category, not tied to any project.
- Category-aware scoping from `category-scope.js` still applies.

## Planning Session Flow (!plan in #plan-room)

Triggered by `!plan FEAT-XXX description` in `#plan-room` of a project category.

### Round structure (3 rounds)

1. **Round 1 -- Initial proposals**: Each agent gives their take on the feature.
2. **Round 2 -- Refinement**: Agents build on each other's ideas and human feedback.
3. **Round 3 -- Convergence**: Agents work toward a consolidated approach.

### Moderation

- Iris (main bot) moderates by mentioning each agent in turn: `@Hermes your turn`
- Each agent bot detects the mention, reads channel context (bounded by MAX_CONTEXT_MESSAGES), calls its CLI tool, and posts the response.
- After each round, Iris waits 60 seconds for human comments (or `!next`/`!skip` to proceed).
- Final consolidated plan is posted as an embed to both `#plan-room` and `#control-room`.

### Turn order per round

Athena (Codex) -> Hermes (Claude) -> Prometheus (Gemini)

## Discussion Flow (!create_discussion)

For ad-hoc questions, plan reviews, or debates that don't require code implementation.

### Lifecycle

1. Human runs `!create_discussion "topic"` from any channel.
2. Iris auto-creates `DISCUSSIONS` category if it doesn't exist.
3. Iris creates `#discuss-<slugified-topic>` under `DISCUSSIONS`.
4. Iris invites Athena, Hermes, Prometheus and posts a welcome message.
5. Human posts a question or pastes a plan in the channel.
6. Iris detects the message and starts a 3-round debate (same flow as !plan).
7. Summary is posted at the end.
8. Human can ask more questions in the same channel, each triggering a new 3-round session.
9. Human runs `!close_discussion` inside the channel to delete it.

### Channel naming

`!create_discussion "API design patterns"` -> `#discuss-api-design-patterns`

Topic is slugified: lowercased, spaces to hyphens, special chars removed, truncated to Discord's 100-char channel name limit.

## Commands

### Removed

- `!setup_orchestration` -- replaced by `!create_project`
- `!setup_test_project` -- removed

### New

| Command | Where | Description |
|---------|-------|-------------|
| `!plan FEAT-XXX description` | `#plan-room` | Start 3-round planning debate for a feature |
| `!create_discussion "topic"` | Anywhere | Create temp discussion channel under DISCUSSIONS |
| `!close_discussion` | `#discuss-*` | Delete current discussion channel |
| `!next` / `!skip` | During debate | Skip human comment window, proceed to next round |

### Updated

| Command | Change |
|---------|--------|
| `!create_project ProjectName` | Now creates 6 channels (adds `#plan-room`) |
| `!help` | Reflects new agents and commands |
| `!help_orchestration` | Updated workflow guide |
| `!agent_status` | Includes Hermes and Prometheus |
| `!cleanup_server` | Also cleans up DISCUSSIONS category |

### Unchanged

- `!create_feature`, `!create_spec`, `!approve_spec`, `!create_contract`
- `!report_progress`, `!escalate_blocker`, `!feature_status`
- `!register_agent`, `!cleanup_server`
- `!token_report`, `!backup`, `!status`

## Updated Workflow

```
1. !create_project MyProject       -> creates category + 6 channels
2. !create_feature FEAT-001 name   -> creates feature in #control-room
3. !plan FEAT-001 description      -> 3-round debate in #plan-room
4. !create_spec FEAT-001           -> formal spec (can reference plan output)
5. !approve_spec FEAT-001          -> triggers implementation agents
6. ... existing implementation workflow continues
```

For non-feature discussions:
```
1. !create_discussion "topic"      -> creates #discuss-<topic> under DISCUSSIONS
2. Post question or plan           -> triggers 3-round debate
3. (repeat as needed)
4. !close_discussion               -> deletes channel
```

## New Files

```
agents/
+-- hermes-bot.js              # New -- Claude planning agent
+-- prometheus-bot.js          # New -- Gemini planning agent
+-- shared/agent-utils.js      # Updated -- add Hermes/Prometheus colors/emojis
+-- config/agent-config.json   # Updated -- add Hermes/Prometheus entries
```

## Implementation Approach

Separate bot processes for Hermes and Prometheus (matching existing agent bot architecture). Each has its own Discord token. Iris acts as moderator, controlling turn order during planning sessions.

## Requirements

- 2 new Discord bot tokens (Hermes, Prometheus)
- Bot permissions: Read Messages, Send Messages, Read History, View Channels, Create Public Threads
- Environment variables: `HERMES_DISCORD_TOKEN`, `PROMETHEUS_DISCORD_TOKEN`
- Existing tools available: Claude CLI, Gemini CLI, Codex CLI
