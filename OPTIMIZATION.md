# NanoClaw Optimization Project

Master tracking document for the 5-part optimization initiative.

## Status

| Part | Domain | Risk | Effort | Status |
|------|--------|------|--------|--------|
| **1** | Dead Code & Cleanup | None | Low | ✅ Completed |
| **2** | Unified Bot Architecture | None | Low | ✅ Completed |
| **3** | System Infrastructure | Medium | Medium | ✅ Completed |
| **4** | Channels | Low | Medium | ✅ Completed |
| **5** | NanoClaw Core | High | High | ⏳ Next |

---

## Part 1: Dead Code & Cleanup ✅

**Completed in session 287b6bc2 (2026-03-17)**

- Deleted `skills-engine/` — 34 files, ~5,500 lines of dead code
- Deleted 6 scripts that only depended on the deleted skills-engine
- Deleted `AGENT_BOT_IMPLEMENTATION_PLAN.md` stray file
- Deleted `groups/telegram_main/migration-backups/` — -2.6MB, redundant with daily checkpoints
- Moved `plan/` (5 files) → `docs/plans/` — design docs consolidated
- Updated `.gitignore` — added `.work-sessions/`
- Consolidated `settings.local.json` — 67 one-off rules → 24 pattern-based rules
- Verified: build clean, 240/240 tests passing

---

## Part 2: Unified Bot Architecture ✅

**Planned in session 287b6bc2, implemented in same session (2026-03-17)**

Added Discord as a second channel to NanoClaw (Iris) and created a container-backed agent bot framework for 6 Discord agents.

### What was built:
- `src/channels/discord.ts` — Discord channel for Iris (Channel interface)
- `agents/` directory — Full agent bot framework
  - `shared/agent-runner.ts` — Core: Discord message → NanoClaw container → Discord response
  - 6 agent entry points (athena, hermes, prometheus, atlas, apollo, argus)
  - `config.json` — Agent roster and routing config
  - `start-all.sh` — Process manager
- `groups/dc_{iris,athena,hermes,prometheus,atlas,apollo,argus}/CLAUDE.md` — Agent personalities
- `groups/shared_project/` — Shared collaboration workspace mounted at `/workspace/shared/`
- `container/skills/discord-{plan,status,project}/SKILL.md` — Orchestration skills
- `nanoclaw-agents.service` — systemd service for agent bots
- Cleaned up old discord-bot code (archived to `backups/`)

### Known limitation:
Agent bots don't persist Claude sessions — fresh session per invocation. Memory comes from Discord history + group folder files.

---

## Part 3: System Infrastructure ✅

**Implemented in session 2cab29a2 (2026-03-17)**

Centralized all host infrastructure into `scripts/` and `logs/`, eliminated scattered files from `~/`, added log rotation.

### What was done:
- Moved 4 copilot proxy log files from `~/` → `logs/` (updated both `.service` files)
- Created `scripts/rotate-logs.sh` — size-based rotation (>10MB), keeps 2 rotated copies
- Copied `~/copilot-stealth-patch/copilot_stealth_patch.py` → `scripts/copilot-stealth-patch.py`
- Created `scripts/reapply-copilot-patches.sh` — replaces `.work-sessions/` version, logs to `logs/copilot-patch.log`
- Created `scripts/check-copilot-credentials.sh` — replaces `~/check-copilot-credentials.sh`, reads tokens from `.env` (no hardcoded secrets)
- Added `TELEGRAM_NOTIFY_CHAT_ID` to `.env`
- Updated `copilot-patch.service` and `copilot-check.service` to point to new script locations
- Updated `checkpoint.sh` — removed stale `data/home-scripts` sync, added log rotation before backup
- Deleted: `~/check-copilot-credentials.sh`, `~/output.log`, `.work-sessions/2026-03-11/`, 4 stray log files from `~/`

### Untouched (out of scope):
- `~/copilot-stealth-patch/` — separate git repo, kept as upstream reference
- `financial-*.service/timer` — separate project, not NanoClaw

---

## Part 4: Channels ✅

**Implemented in session 2cab29a2 (2026-03-17)**

Made channel dependencies optional, eliminated code duplication, added Discord test coverage.

### What was done:
- **Dynamic imports**: Converted `src/channels/index.ts` from static imports to `async loadChannels()` with try/catch — missing `grammy` or `discord.js` no longer crashes the process
- **Updated orchestrator**: `src/index.ts` calls `await loadChannels()` before channel initialization loop
- **Eliminated duplicate interfaces**: Removed `TelegramChannelOpts` and `DiscordChannelOpts` (both identical to `ChannelOpts`), channels now use `ChannelOpts` from `registry.ts` directly
- **Shared message splitting**: Extracted `splitMessage()` to `src/channels/utils.ts` — line-boundary-aware splitting used by both Discord (2000 char) and Telegram (4096 char)
- **Discord test suite**: Created `src/channels/discord.test.ts` — 39 tests covering connection lifecycle, message handling, bot filtering, mention translation, sendMessage/sendDocument, typing indicators, ownsJid
- **Utils test suite**: Created `src/channels/utils.test.ts` — 7 tests for splitMessage edge cases
- **State tracking**: Added discord to `.nanoclaw/state.yaml` applied_skills

### Test results:
- 286/286 tests passing (was 247 before Part 4)
- 39 new Discord tests + 7 new utils tests + 4 additional Telegram tests (from /ping /chatid)

### Files added:
- `src/channels/utils.ts` — shared splitMessage utility
- `src/channels/utils.test.ts` — 7 tests
- `src/channels/discord.test.ts` — 39 tests

### Files modified:
- `src/channels/index.ts` — static → dynamic imports
- `src/index.ts` — import and call `loadChannels()`
- `src/channels/telegram.ts` — removed TelegramChannelOpts, use shared splitMessage
- `src/channels/discord.ts` — removed DiscordChannelOpts, removed local splitMessage, import from utils
- `src/channels/telegram.test.ts` — updated to use ChannelOpts instead of TelegramChannelOpts

---

## Unified Iris (Cross-Channel)

**Implemented (2026-03-17)**

Unified Iris into a single agent across Telegram and Discord — one group folder, shared session and memory.

### What was done:
- **DB schema migration**: Dropped `UNIQUE` constraint on `folder` in `registered_groups`, allowing multiple JIDs per folder
- **GroupQueue folder serialization**: Added `setFolderLookup()` and `activeFolders` tracking so JIDs sharing a folder can't run concurrent containers
- **Channel JID map**: Orchestrator writes `channel-jids.json` into multi-JID group folders on startup and registration changes
- **Group migration**: Moved `groups/telegram_main/` → `groups/iris/`, deleted `groups/dc_iris/`
- **Unified CLAUDE.md**: Single personality file covering both Telegram and Discord, with cross-channel routing instructions (`to_telegram`, `to_discord:#channel`)

### Architecture:
```
tg:{chatId}    ──→ registeredGroups["tg:X"] ──→ folder: iris ──→ container (shared session)
dc:{channelId} ──→ registeredGroups["dc:Y"] ──→ folder: iris ──→ container (shared session)
```

### Key decisions:
- Telegram JID stays `isMain=true` (elevated privileges, no trigger required)
- Discord JID requires @mention trigger (`isMain=false`)
- GroupQueue serializes by folder, not JID — prevents concurrent containers on shared filesystem
- Cross-channel routing via `channel-jids.json` + CLAUDE.md instructions (no code changes to IPC)

### Test results:
- All 289 tests passing (was 286 before Unified Iris)
- 2 new DB tests (multi-JID per folder) + 1 new GroupQueue test (folder serialization)

### Files added:
- `groups/iris/CLAUDE.md` — unified personality file

### Files modified:
- `src/db.ts` — migration to drop UNIQUE on folder, add folder index
- `src/group-queue.ts` — folder-level serialization
- `src/index.ts` — `writeChannelJidsMap()`, `queue.setFolderLookup()` wiring
- `.gitignore` — updated dc_iris → iris references

### Files deleted:
- `groups/telegram_main/` — migrated to `groups/iris/`
- `groups/dc_iris/` — merged into `groups/iris/`

---

## Part 5: NanoClaw Core ⏳

**Scope:**
- `src/index.ts` (orchestrator, 620 lines) + the 10 modules it pulls in
- `container/` (agent-runner — already isolated)
- `store/`, `backups/`, `scripts/`
- `db.ts` (691 lines), `container-runner.ts` (727 lines)

**Goal:** Break `index.ts` into smaller modules, split DB by domain, modularize the orchestrator, clean up mount security.
