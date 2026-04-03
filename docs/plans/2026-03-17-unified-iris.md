# Unified Iris Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify Iris into a single agent across Telegram and Discord — one group folder (`iris`), shared session/memory, responses route back to originating channel, cross-channel routing via `to_telegram`/`to_discord:#channel` directives.

**Architecture:** Drop the `UNIQUE` constraint on `folder` in `registered_groups` so multiple JIDs share one folder. Add folder-level serialization to `GroupQueue` so two JIDs for the same folder can't run containers concurrently. Write `channel-jids.json` for cross-channel JID discovery. Migrate `telegram_main` → `iris`.

**Tech Stack:** Node.js, TypeScript, SQLite (better-sqlite3), Vitest

**Design doc:** `docs/plans/2026-03-17-unified-iris-design.md`

---

### Task 1: DB Migration — Drop UNIQUE Constraint on folder

**Files:**
- Modify: `src/db.ts:76-84` (createSchema) and add migration after line 141
- Test: `src/db.test.ts`

**Step 1: Write the failing test**

Add to `src/db.test.ts` at the end of the file:

```typescript
// --- Multi-JID per folder (Unified Iris) ---

describe('multi-JID per folder', () => {
  it('allows two JIDs to share the same folder', () => {
    setRegisteredGroup('tg:123', {
      name: 'Iris',
      folder: 'iris',
      trigger: '@Iris',
      added_at: '2024-01-01T00:00:00.000Z',
      isMain: true,
    });

    setRegisteredGroup('dc:456', {
      name: 'Iris',
      folder: 'iris',
      trigger: '@Iris',
      added_at: '2024-01-01T00:00:00.000Z',
    });

    const groups = getAllRegisteredGroups();
    expect(groups['tg:123']).toBeDefined();
    expect(groups['dc:456']).toBeDefined();
    expect(groups['tg:123'].folder).toBe('iris');
    expect(groups['dc:456'].folder).toBe('iris');
    expect(groups['tg:123'].isMain).toBe(true);
    expect(groups['dc:456'].isMain).toBeUndefined();
  });

  it('does not affect unrelated groups with unique folders', () => {
    setRegisteredGroup('tg:111', {
      name: 'GroupA',
      folder: 'group_a',
      trigger: '@Andy',
      added_at: '2024-01-01T00:00:00.000Z',
    });

    setRegisteredGroup('tg:222', {
      name: 'GroupB',
      folder: 'group_b',
      trigger: '@Andy',
      added_at: '2024-01-01T00:00:00.000Z',
    });

    const groups = getAllRegisteredGroups();
    expect(Object.keys(groups)).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db.test.ts --reporter=verbose`
Expected: FAIL — the second `setRegisteredGroup` with the same folder throws a UNIQUE constraint error.

**Step 3: Write the migration**

In `src/db.ts`, change the `createSchema` function. Replace the `registered_groups` CREATE TABLE (lines 76-84):

```typescript
    CREATE TABLE IF NOT EXISTS registered_groups (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder TEXT NOT NULL,
      trigger_pattern TEXT NOT NULL,
      added_at TEXT NOT NULL,
      container_config TEXT,
      requires_trigger INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_registered_groups_folder ON registered_groups(folder);
```

Then add the migration for existing databases. After the `chats` column migration block (after line 141), add:

```typescript
  // Drop UNIQUE constraint on folder column (allows multi-JID per folder for Unified Iris)
  // SQLite doesn't support ALTER TABLE DROP CONSTRAINT, so we recreate the table.
  try {
    // Check if the UNIQUE constraint still exists by inspecting the table SQL
    const tableInfo = database
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='registered_groups'")
      .get() as { sql: string } | undefined;

    if (tableInfo?.sql?.includes('UNIQUE')) {
      database.exec(`
        CREATE TABLE registered_groups_new (
          jid TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          folder TEXT NOT NULL,
          trigger_pattern TEXT NOT NULL,
          added_at TEXT NOT NULL,
          container_config TEXT,
          requires_trigger INTEGER DEFAULT 1,
          is_main INTEGER DEFAULT 0
        );
        INSERT INTO registered_groups_new SELECT * FROM registered_groups;
        DROP TABLE registered_groups;
        ALTER TABLE registered_groups_new RENAME TO registered_groups;
        CREATE INDEX IF NOT EXISTS idx_registered_groups_folder ON registered_groups(folder);
      `);
    }
  } catch {
    /* migration already applied or table doesn't need it */
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/db.test.ts --reporter=verbose`
Expected: PASS — all existing tests still pass + new multi-JID tests pass.

**Step 5: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All 286+ tests pass.

**Step 6: Commit**

```bash
git add src/db.ts src/db.test.ts
git commit -m "feat: allow multiple JIDs per folder in registered_groups

Drop UNIQUE constraint on folder column. Adds migration for existing
databases. Enables Unified Iris (Telegram + Discord sharing one folder)."
```

---

### Task 2: GroupQueue Folder-Level Serialization

The `GroupQueue` is keyed by JID. Two JIDs sharing the same folder would allow **two concurrent containers** writing to the same filesystem — a race condition. Fix by adding folder-level awareness.

**Files:**
- Modify: `src/group-queue.ts`
- Modify: `src/index.ts` (pass folder lookup function to queue)
- Test: `src/group-queue.test.ts`

**Step 1: Write the failing test**

Add to `src/group-queue.test.ts`:

```typescript
  it('serializes containers for JIDs that share the same folder', async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;

    const processMessages = vi.fn(async (_groupJid: string) => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await new Promise((resolve) => setTimeout(resolve, 100));
      concurrentCount--;
      return true;
    });

    queue.setProcessMessagesFn(processMessages);

    // Tell the queue that both JIDs share a folder
    queue.setFolderLookup((jid: string) => {
      if (jid === 'tg:123' || jid === 'dc:456') return 'iris';
      return undefined;
    });

    // Enqueue messages for two JIDs sharing the same folder
    queue.enqueueMessageCheck('tg:123');
    queue.enqueueMessageCheck('dc:456');

    // Let both process
    await vi.advanceTimersByTimeAsync(300);

    // Should never have run concurrently
    expect(maxConcurrent).toBe(1);
    // But both should have run
    expect(processMessages).toHaveBeenCalledTimes(2);
  });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/group-queue.test.ts --reporter=verbose`
Expected: FAIL — `maxConcurrent` is 2 because both JIDs run independently.

**Step 3: Implement folder-level locking in GroupQueue**

In `src/group-queue.ts`, add:

1. A `folderLookup` function and `activeFolders` set:

```typescript
  private folderLookup: ((jid: string) => string | undefined) | null = null;
  private activeFolders = new Set<string>();

  setFolderLookup(fn: (jid: string) => string | undefined): void {
    this.folderLookup = fn;
  }
```

2. A helper to get the folder for a JID:

```typescript
  private getFolder(groupJid: string): string | undefined {
    return this.folderLookup?.(groupJid);
  }
```

3. In `enqueueMessageCheck()`, after checking `state.active`, add a folder-level check:

```typescript
    // Folder-level serialization: if another JID for the same folder is active, queue
    const folder = this.getFolder(groupJid);
    if (folder && this.activeFolders.has(folder)) {
      state.pendingMessages = true;
      if (!this.waitingGroups.includes(groupJid)) {
        this.waitingGroups.push(groupJid);
      }
      logger.debug({ groupJid, folder }, 'Folder busy, message queued');
      return;
    }
```

4. In `runForGroup()`, add folder tracking:

```typescript
    const folder = this.getFolder(groupJid);
    if (folder) this.activeFolders.add(folder);
    // ... existing try/catch/finally ...
    // In the finally block, add:
    if (folder) this.activeFolders.delete(folder);
```

5. Same pattern in `runTask()`.

**Step 4: Wire up the folder lookup in `src/index.ts`**

After loading state (after line 468 in `main()`), add:

```typescript
  queue.setFolderLookup((jid: string) => registeredGroups[jid]?.folder);
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run src/group-queue.test.ts --reporter=verbose`
Expected: PASS — serialization test passes, all existing tests still pass.

**Step 6: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add src/group-queue.ts src/group-queue.test.ts src/index.ts
git commit -m "feat: add folder-level serialization to GroupQueue

Prevents two JIDs sharing the same folder from running concurrent
containers. Required for Unified Iris (tg: and dc: JIDs sharing
the 'iris' folder)."
```

---

### Task 3: Channel JID Map File

Write `channel-jids.json` into group folders so containers can discover cross-channel JIDs.

**Files:**
- Modify: `src/index.ts`
- Test: manual verification (the file is a simple JSON write, tested via integration)

**Step 1: Add the `writeChannelJids` helper function**

In `src/index.ts`, add after the `registerGroup` function (after line 111):

```typescript
/**
 * Write channel-jids.json for groups that span multiple JIDs.
 * Container agents read this to discover cross-channel destinations.
 */
function writeChannelJidsMap(): void {
  // Group JIDs by folder
  const folderToJids = new Map<string, string[]>();
  for (const [jid, group] of Object.entries(registeredGroups)) {
    const existing = folderToJids.get(group.folder) || [];
    existing.push(jid);
    folderToJids.set(group.folder, existing);
  }

  // Only write for folders with multiple JIDs
  for (const [folder, jids] of folderToJids) {
    if (jids.length < 2) continue;

    const channelMap: Record<string, string[]> = {};
    for (const jid of jids) {
      const prefix = jid.split(':')[0]; // 'tg', 'dc', etc.
      const channelName =
        prefix === 'tg' ? 'telegram' :
        prefix === 'dc' ? 'discord' :
        prefix;
      if (!channelMap[channelName]) channelMap[channelName] = [];
      channelMap[channelName].push(jid);
    }

    try {
      const groupDir = resolveGroupFolderPath(folder);
      const filePath = path.join(groupDir, 'channel-jids.json');
      fs.writeFileSync(filePath, JSON.stringify(channelMap, null, 2) + '\n');
      logger.debug({ folder, channels: Object.keys(channelMap) }, 'Channel JIDs map written');
    } catch (err) {
      logger.warn({ folder, err }, 'Failed to write channel-jids.json');
    }
  }
}
```

**Step 2: Call it on startup and after group registration**

In `main()`, after `loadState()` (after line 468), add:

```typescript
  writeChannelJidsMap();
```

In `registerGroup()`, after the `logger.info` call (after line 110), add:

```typescript
  writeChannelJidsMap();
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Clean compile, no errors.

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: write channel-jids.json for multi-JID groups

Containers can read this file to discover cross-channel JIDs for
routing messages between Telegram and Discord."
```

---

### Task 4: Migrate Group Folder

Move `telegram_main` → `iris`, write unified CLAUDE.md, delete old folders.

**Files:**
- Move: `groups/telegram_main/` → `groups/iris/`
- Delete: `groups/dc_iris/`
- Create: `groups/iris/CLAUDE.md` (new unified version)

**Step 1: Move the folder**

```bash
mv groups/telegram_main groups/iris
```

**Step 2: Delete the old Discord Iris folder**

```bash
rm -rf groups/dc_iris
```

**Step 3: Write the unified CLAUDE.md**

Create `groups/iris/CLAUDE.md` with the content below. This merges the Telegram-specific CLAUDE.md with Discord capabilities and adds cross-channel routing instructions:

```markdown
# Iris

You are Iris, a personal assistant connected to both Telegram and Discord. You help with tasks, answer questions, write code, and can schedule reminders.

## What You Can Do

- Answer questions and have conversations
- Search the web and fetch content from URLs
- **Browse the web** with `agent-browser` — open pages, click, fill forms, take screenshots, extract data (run `agent-browser open <url>` to start, then `agent-browser snapshot -i` to see interactive elements)
- Read and write files (you have access to the user's home directory)
- **Write and edit code** — you can create projects, edit source files, run builds and tests
- Run bash commands in your sandbox
- Schedule tasks to run later or on a recurring basis
- Send messages to any registered channel (Telegram or Discord)
- **Orchestrate agent bots** — coordinate Athena, Hermes, Prometheus, Atlas, Apollo, and Argus on Discord

## Communication

Your output is sent back to whichever channel the message came from (Telegram or Discord). You don't need to do anything special — just respond normally.

### Cross-Channel Messaging

You're connected to multiple channels. Check `/workspace/group/channel-jids.json` for available channel JIDs:

```json
{
  "telegram": ["tg:CHAT_ID"],
  "discord": ["dc:CHANNEL_ID", "dc:OTHER_CHANNEL_ID"]
}
```

**Default:** Reply goes to the originating channel automatically.

**Explicit routing:** When the user includes a routing directive in their message:
- `to_telegram` — Send your response to the Telegram chat. Use `mcp__nanoclaw__send_message` with the `tg:` JID from channel-jids.json.
- `to_discord` — Send your response to the default Discord channel. Use the first `dc:` JID from channel-jids.json.
- `to_discord:#channel-name` — Send to a specific Discord channel. Look up the JID from channel-jids.json or from the available groups list.

When you see a routing directive, use `mcp__nanoclaw__send_message` to send to the target JID. Your normal output still goes to the originating channel, so wrap your acknowledgment in `<internal>` tags if you don't want to send a duplicate.

### Sending Files

Use `mcp__nanoclaw__send_document` to send a file as an attachment. The file must be under `/workspace/group/` (e.g., `/workspace/group/outbox/myfile.tar.gz`). Max file size: 50MB.

### Internal thoughts

If part of your output is internal reasoning rather than something for the user, wrap it in `<internal>` tags:

```
<internal>Compiled all three reports, ready to summarize.</internal>

Here are the key findings from the research...
```

Text inside `<internal>` tags is logged but not sent to the user. If you've already sent the key information via `send_message`, you can wrap the recap in `<internal>` to avoid sending it again.

### Sub-agents and teammates

When working as a sub-agent or teammate, only use `send_message` if instructed to by the main agent.

## Your Workspace & Backup

Files you create are saved in `/workspace/group/`. Use this for notes, research, or anything that should persist.

**Important:** Only `/workspace/group/` is included in the daily backup. Everything else inside the container is ephemeral and will be lost when the container stops. When setting up projects, bots, services, or anything that should survive restarts:

- **Configuration, scripts, and small files** → store in `/workspace/group/` (e.g., `/workspace/group/projects/discord-bot/`)
- **Notes, plans, documentation** → store in `/workspace/group/`
- **Large code projects** that need their own git repo → tell the user you need an additional mount set up so the project lives on the host filesystem. You cannot do this yourself — the user or main agent needs to configure it via `containerConfig.additionalMounts`

If you create something important outside `/workspace/group/`, always save a copy or reference in `/workspace/group/` so it's not lost.

## Memory

The `conversations/` folder contains searchable history of past conversations. Use this to recall context from previous sessions.

When you learn something important:
- Create files for structured data (e.g., `customers.md`, `preferences.md`)
- Split files larger than 500 lines into folders
- Keep an index in your memory for the files you create

## Platform-Aware Formatting

You're connected to both Telegram and Discord. Each has different formatting rules. Since you don't always know which channel the user is on, **use the safer Telegram formatting** for your normal output — it works on both platforms:

- *Bold* (single asterisks)
- _Italic_ (underscores)
- • Bullets (bullet points)
- ```Code blocks``` (triple backticks)

When explicitly sending to Discord (via `to_discord`), you can use richer Discord Markdown:
- **Bold** (double asterisks)
- ## Headings
- > Blockquotes

**Message length limits:**
- Telegram: 4096 characters
- Discord: 2000 characters

When in doubt, keep messages under 2000 characters.

## Financial Data Collector

A background service collects Chinese A-share stock data via AKShare into Parquet files. When the user asks about it (e.g. "financial data status", "collector status", "how's the data collection going"), run this command:

```bash
/home/pseudo/financial-data/venv/bin/python3 /home/pseudo/financial-data/scripts/collector.py --status
```

This shows task counts by status (pending/done/failed/skipped) and recent failures. You can also check:

```bash
# Service status
systemctl --user status financial-collector --no-pager
# Disk usage
du -sh /home/pseudo/financial-data/akshare/
# Recent log entries
tail -20 /home/pseudo/financial-data/logs/collector.log
# Count parquet files
find /home/pseudo/financial-data/akshare -name "*.parquet" | wc -l
```

Key facts:
- SQLite task registry: `/home/pseudo/financial-data/db/tasks.db`
- Parquet output: `/home/pseudo/financial-data/akshare/stock/stock_zh_a_hist/*.parquet` (one per symbol)
- ~5,500 tasks total (5,489 A-share symbols + market/macro/bond/index)
- Daily scraper runs at 4:30 PM CST via `financial-daily.timer`
- To restart collection: `systemctl --user restart financial-collector`
- To reset failed tasks: `/home/pseudo/financial-data/venv/bin/python3 /home/pseudo/financial-data/scripts/collector.py --reset-failed`
```

**Step 4: Update .gitignore if needed**

Check if `groups/telegram_main` or `groups/dc_iris` are referenced in `.gitignore`. If so, update references to `groups/iris`.

**Step 5: Build to verify no path references break**

Run: `npm run build`
Expected: Clean compile. No code references `telegram_main` or `dc_iris` directly — the folder names are in the database, not hardcoded.

**Step 6: Commit**

```bash
git add -A groups/
git commit -m "feat: migrate telegram_main and dc_iris to unified iris folder

Moves all Telegram Iris memory/files to groups/iris/. Deletes dc_iris.
New CLAUDE.md covers both platforms with cross-channel routing instructions."
```

---

### Task 5: Update OPTIMIZATION.md

Track this work in the optimization document.

**Files:**
- Modify: `OPTIMIZATION.md`

**Step 1: Add a section for Unified Iris**

After Part 4 section and before Part 5 section, add:

```markdown
## Unified Iris (Cross-Channel)

**Implemented in session XXXX (2026-03-17)**

Unified Iris into a single agent across Telegram and Discord — one group folder, shared session and memory.

### What was done:
- **DB schema migration**: Dropped `UNIQUE` constraint on `folder` in `registered_groups`, allowing multiple JIDs per folder
- **GroupQueue folder serialization**: Added `setFolderLookup()` and `activeFolders` tracking so JIDs sharing a folder can't run concurrent containers
- **Channel JID map**: Orchestrator writes `channel-jids.json` into multi-JID group folders on startup and registration changes
- **Group migration**: Moved `groups/telegram_main/` → `groups/iris/`, deleted `groups/dc_iris/`
- **Unified CLAUDE.md**: Single personality file covering both Telegram and Discord, with cross-channel routing instructions (`to_telegram`, `to_discord:#channel`)

### Architecture:
```
tg:{chatId}  ──→ registeredGroups["tg:X"] ──→ folder: iris ──→ container (shared session)
dc:{channelId} → registeredGroups["dc:Y"] ──→ folder: iris ──→ container (shared session)
```

### Key decisions:
- Telegram JID stays `isMain=true` (elevated privileges, no trigger required)
- Discord JID requires @mention trigger (`isMain=false`)
- GroupQueue serializes by folder, not JID — prevents concurrent containers on shared filesystem
- Cross-channel routing via `channel-jids.json` + CLAUDE.md instructions (no code changes to IPC)
```

**Step 2: Commit**

```bash
git add OPTIMIZATION.md
git commit -m "docs: add Unified Iris section to OPTIMIZATION.md"
```

---

### Task 6: Integration Verification

Verify everything works end-to-end.

**Step 1: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All tests pass (286+ existing + new tests from Tasks 1-2).

**Step 2: Build**

Run: `npm run build`
Expected: Clean compile.

**Step 3: Manual verification checklist**

These must be verified on the running system (not automated):

1. [ ] Start NanoClaw — both Telegram and Discord channels connect
2. [ ] Send message on Telegram → Iris responds on Telegram
3. [ ] Send message on Discord → Iris responds on Discord
4. [ ] Verify `groups/iris/channel-jids.json` exists with correct JIDs
5. [ ] Session continuity: ask something on Telegram, then reference it on Discord
6. [ ] Cross-channel: send `to_telegram` from Discord, message arrives on Telegram
7. [ ] Cross-channel: send `to_discord` from Telegram, message arrives on Discord
8. [ ] DB check: `SELECT * FROM registered_groups` shows two rows with `folder = 'iris'`

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: integration fixes for unified iris"
```
