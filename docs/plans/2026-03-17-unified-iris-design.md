---
status: superseded
date: 2026-03-17
superseded_by: 2026-03-25-workstream-execution-monitoring-design.md
---

# Unified Iris Design

**Date:** 2026-03-17
**Status:** Approved

## Overview

Unify Iris into a single agent that works across both Telegram and Discord. One group folder (`iris`), one container, shared memory and session. Messages from either channel route to the same container; responses go back to the originating channel. Explicit cross-channel routing via `to_telegram` / `to_discord:#channel` directives.

## Architecture

### Current State (Two Isolated Irises)

```
Telegram msg → tg:123 → registeredGroups["tg:123"] → folder: telegram_main → container A
Discord msg  → dc:456 → registeredGroups["dc:456"] → folder: dc_iris       → container B
```

Two folders, two containers, two memories. No shared context.

### Target State (Unified Iris)

```
Telegram msg → tg:123 → registeredGroups["tg:123"] → folder: iris → container (shared session)
Discord msg  → dc:456 → registeredGroups["dc:456"] → folder: iris → container (shared session)
```

One folder, one session, shared memory. Response routing uses the originating `chatJid`.

## Database Schema Change

### Problem

```sql
CREATE TABLE registered_groups (
  jid TEXT PRIMARY KEY,
  folder TEXT NOT NULL UNIQUE,  -- prevents multiple JIDs per folder
  ...
);
```

### Solution

Drop the `UNIQUE` constraint on `folder`. Multiple JIDs can share one folder.

**Migration in `db.ts`:**
1. Create `registered_groups_new` without `UNIQUE` on folder
2. Copy all data from `registered_groups`
3. Drop `registered_groups`, rename new table

**Result:**

| jid | folder | name | trigger_pattern | is_main |
|-----|--------|------|-----------------|---------|
| `tg:{chatId}` | `iris` | Iris | `@Iris` | 1 |
| `dc:{channelId}` | `iris` | Iris | `@Iris` | 0 |

### isMain Per-JID

`isMain` is stored per-row. Telegram JID gets `is_main=1` (elevated privileges, no trigger required). Discord JID gets `is_main=0` (requires @mention trigger). The orchestrator reads `group.isMain` from the looked-up row — works naturally.

### Session Sharing

Sessions are keyed by `group.folder` in the `sessions` table. Both JIDs resolve to folder `iris` → same session ID → same Claude conversation context. No change needed.

## Orchestrator Impact (`src/index.ts`)

**Minimal changes.** The existing flow already works:

1. Message arrives → stored in DB with JID
2. `processGroupMessages(chatJid)` looks up `registeredGroups[chatJid]` → group with folder `iris`
3. `findChannel(channels, chatJid)` → returns the correct channel (Telegram or Discord)
4. `runContainerAgent()` with `group.folder = "iris"` and the originating `chatJid`
5. Container responds → `channel.sendMessage(chatJid, text)` → goes to originating channel

**Change needed:** `getAllRegisteredGroups()` returns `Record<string, RegisteredGroup>`. Multiple keys can now have the same folder value. This is fine — the map simply has more entries. No structural change to `registeredGroups` in memory.

## Cross-Channel Routing

### How It Works Today

The container has `mcp__nanoclaw__send_message(chatJid, text)` via IPC. It can send to any JID. The IPC authorization check allows it if the source group is main OR if the target JID's folder matches the source folder.

Since both Telegram and Discord JIDs share folder `iris`, and the Telegram JID is `isMain=true`, Iris can send to any JID from either channel.

### Channel JID Discovery

**New file:** `groups/iris/channel-jids.json`

Written by the orchestrator whenever group registration changes:

```json
{
  "telegram": ["tg:123456"],
  "discord": ["dc:789012345"]
}
```

The container reads this file to discover available channels for cross-channel messaging.

### User Directives

Users can include routing directives in their messages:

| Directive | Behavior |
|-----------|----------|
| (none) | Reply to originating channel (default) |
| `to_telegram` | Send response to Telegram via `mcp__nanoclaw__send_message` |
| `to_discord` | Send response to default Discord channel |
| `to_discord:#channel-name` | Send to specific Discord channel (looked up from available groups or channel-jids.json) |

These are instructions in CLAUDE.md, not code changes. Iris reads the directive, looks up the target JID from `channel-jids.json`, and calls `send_message` with it.

### Regeneration

The orchestrator regenerates `channel-jids.json` on:
- Startup (after loading registered groups)
- Group registration changes (new JID added to the folder)

## Group Folder Migration

### Steps

1. Create `groups/iris/` directory
2. Move contents from `groups/telegram_main/` → `groups/iris/` (preserves all memory, conversations, files)
3. Write unified `groups/iris/CLAUDE.md` (see below)
4. Delete `groups/telegram_main/` and `groups/dc_iris/`
5. Update DB: both registered group rows point to folder `iris`

### Unified CLAUDE.md

Key sections:
- "You are Iris, connected to both Telegram and Discord"
- Platform-aware formatting (Telegram: 4096 chars, Markdown; Discord: 2000 chars, Markdown)
- Cross-channel routing instructions (`to_telegram`, `to_discord:#channel`)
- `channel-jids.json` reference for discovering channel JIDs
- All existing capabilities (browser, code, scheduling, file send, agent orchestration)
- `<internal>` tag support (same as current)
- Memory/workspace instructions (same as current)

## Files Changed

### Modified

| File | Change |
|------|--------|
| `src/db.ts` | Migration to drop UNIQUE on folder column |
| `src/index.ts` | Write `channel-jids.json` on startup and registration changes |
| `groups/iris/CLAUDE.md` | New unified personality file (replaces telegram_main + dc_iris) |

### Deleted

| File | Reason |
|------|--------|
| `groups/telegram_main/` | Migrated to `groups/iris/` |
| `groups/dc_iris/` | Merged into `groups/iris/` |

### New

| File | Purpose |
|------|---------|
| `groups/iris/` | Unified Iris group folder |
| `groups/iris/channel-jids.json` | Auto-generated JID map for cross-channel routing |

### Unchanged

| File | Reason |
|------|--------|
| `src/channels/telegram.ts` | No changes — channel code is JID-agnostic |
| `src/channels/discord.ts` | No changes — channel code is JID-agnostic |
| `src/channels/registry.ts` | No changes — factory pattern unchanged |
| `src/router.ts` | No changes — routes by JID, channel-agnostic |
| `src/ipc.ts` | No changes — authorization already folder-based |
| `src/container-runner.ts` | No changes — already takes folder + chatJid |
| `agents/` | No changes — agent bots are separate Discord-only processes |

## Testing

### New Tests

1. **DB migration tests:** Multiple JIDs can share a folder, `getAllRegisteredGroups()` returns all JIDs correctly
2. **Routing tests:** Message from `tg:X` → iris folder → response to Telegram; `dc:Y` → iris folder → response to Discord
3. **IPC authorization:** Cross-channel send_message from iris folder succeeds for both JIDs

### Existing Tests

286 existing tests should pass unchanged — no channel interface or orchestrator API changes.

### Manual Verification

1. Telegram message → Iris responds on Telegram
2. Discord message → Iris responds on Discord
3. `to_telegram` from Discord → message arrives on Telegram
4. `to_discord:#channel` from Telegram → message arrives on Discord
5. Session continuity across channels (ask something on Telegram, reference it on Discord)

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| DB migration breaks existing groups | Migration copies data, validates before dropping old table |
| Concurrent access from both channels | GroupQueue already serializes per-folder — both JIDs queue into the same folder's queue |
| Cross-channel send fails silently | IPC already logs authorization failures; channel-jids.json provides discoverable JIDs |
| Telegram main privileges via Discord | Discord JID has `is_main=0` — no elevated privileges. Only Telegram JID is main |
