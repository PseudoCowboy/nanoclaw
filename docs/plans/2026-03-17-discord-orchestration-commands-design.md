---
status: superseded
date: 2026-03-17
superseded_by: 2026-03-25-workstream-execution-monitoring-design.md
---

# Discord Orchestration Commands Design

**Date:** 2026-03-17
**Status:** Approved

## Overview

Bring back the 15 orchestration commands from the legacy Discord bot (`bot.js`, archived at `backups/discord-bot-legacy-20260317.tar.gz`) as a command handler module in the NanoClaw Discord channel. Commands respond instantly (no container startup), with full Discord.js API access for creating channels, threads, and embeds.

## Architecture

New file `src/channels/discord-commands.ts` — self-contained command handler module that the Discord channel delegates to.

```
Discord message → handleMessage()
  ├─ starts with "!" → discord-commands.ts handles it → Discord reply (instant)
  └─ contains @mention → normal NanoClaw flow → container → response
```

The command handler receives the Discord.js `Message` and `Client` objects for full API access.

Planning session state is held in a `Map<string, PlanningSession>` in-process memory.

## Discord Client Changes

### New Intent

Add `GatewayIntentBits.ManageChannels` to the client intents in `discord.ts` (needed for `create_project`, `create_discussion`, `cleanup_server`).

**Note:** The bot's Discord application also needs "Manage Channels" permission in the Discord developer portal.

### Message Handler Change

In `handleMessage()`, add an early check before @mention processing:

```typescript
if (message.content.startsWith('!')) {
  await handleCommand(message, this.client!);
  return;
}
```

## Command List (15 commands)

### Help & Info
| Command | Description |
|---------|-------------|
| `!help` | Command overview embed |
| `!help_orchestration` | Full workflow guide embed |
| `!agent_status` | Check agent bot processes |

### Project Management
| Command | Description |
|---------|-------------|
| `!create_project NAME` | Create Discord category + 6 channels (control-room, plan-room, backend-dev, frontend-ui, qa-alerts, release-log) |
| `!cleanup_server` | Remove all orchestration categories/channels |

### Planning & Discussion
| Command | Description |
|---------|-------------|
| `!plan FEAT-XXX description` | 3-round planning debate (must be in #plan-room) |
| `!create_discussion "topic"` | Create #discuss-{slug} channel, auto-starts planning |
| `!close_discussion` | Delete current discuss-* channel |
| `!next` / `!skip` | Skip comment window during planning |

### Feature Workflow
| Command | Description |
|---------|-------------|
| `!create_feature FEAT-XXX name` | Create feature thread |
| `!create_spec FEAT-XXX` | Generate spec template thread |
| `!approve_spec FEAT-XXX` | Approve spec, notify agents |
| `!create_contract FEAT-XXX` | Generate API contract template |
| `!report_progress FEAT-XXX Agent "status"` | Log progress embed |
| `!escalate_blocker FEAT-XXX "issue"` | Escalate blocker with alert |
| `!feature_status FEAT-XXX` | Feature tracking info |

## Planning Session Engine

### State

```typescript
interface PlanningSession {
  topic: string;
  featureId: string | null;
  round: number;
}
const planningSessions = new Map<string, PlanningSession>();
```

### Constants

```typescript
const PLANNING_ROUND_COUNT = 3;
const HUMAN_COMMENT_TIMEOUT = 60_000;     // 60s
const AGENT_RESPONSE_TIMEOUT = 180_000;   // 180s
const PLANNING_AGENTS = ['Athena', 'Hermes', 'Prometheus'];
```

### Planning Loop

1. Post `@AgentName` turn prompt in plan-room
2. Wait up to 180s for that agent bot to respond (match by bot username)
3. After all 3 agents respond, wait 60s for human comments (`!next`/`!skip` to proceed)
4. Repeat for 3 rounds
5. Post summary embed, cross-post to control-room

### Agent Response Detection

The planning loop listens for `messageCreate` events from bot users whose username matches the agent name. The `Client` object is shared via the command handler's closure, so it can add/remove event listeners for turn-taking.

### Discussion Flow

`!create_discussion` creates a temporary channel and registers a one-shot listener. When the first non-bot, non-command message arrives, it auto-triggers `runPlanningSession()` in that channel. The listener self-removes after 30 minutes if unused.

## Files Changed

### New
| File | Purpose |
|------|---------|
| `src/channels/discord-commands.ts` | Command handler module (~600 lines) |
| `src/channels/discord-commands.test.ts` | Tests for command parsing, planning state, embed formatting |

### Modified
| File | Change |
|------|--------|
| `src/channels/discord.ts` | Add ManageChannels intent, add `!` prefix early-return in handleMessage, pass Client to command handler |

### Unchanged
| File | Reason |
|------|--------|
| `src/channels/telegram.ts` | Telegram has no `!` commands |
| `src/channels/registry.ts` | No interface changes |
| `src/index.ts` | No orchestrator changes |
| `agents/` | Agent bots unchanged — they respond to @mentions as before |

## Testing

New test file `src/channels/discord-commands.test.ts`:

1. Command parsing — extracting args, handling missing args, usage messages
2. Planning session state — start, round progression, concurrent session rejection, cleanup
3. Command routing — `!` prefix detection, unknown command passthrough
4. Embed formatting — help, agent_status, create_feature embeds
5. Argument validation — FEAT-XXX format, required arguments

Discord API calls (channel.create, thread.create, guild.channels) are mocked.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| ManageChannels permission not granted | Commands that need it will catch the error and reply with a permission error message |
| Planning session hangs if agent doesn't respond | 180s timeout per agent turn, session continues to next agent |
| Discussion listener leaks if channel deleted externally | 30-minute self-cleanup timeout on the listener |
| `!` commands intercepted before @mention processing | Intentional — commands are always handled locally, never forwarded to container |
