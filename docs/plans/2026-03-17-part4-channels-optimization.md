---
status: completed
date: 2026-03-17
---

# Part 4: Channels — Implementation Plan

## Context

OPTIMIZATION.md Part 4 targets the channel system in `src/channels/`. The current state:

- **2 active channels**: `telegram.ts` (313 lines, grammy) + `discord.ts` (305 lines, discord.js)
- **5 channel skills** in `.claude/skills/`: add-telegram, add-discord, add-whatsapp, add-slack, add-gmail — each is a code package that can be applied to add a channel
- **Clean architecture**: Channels self-register via `registerChannel()` factory pattern, orchestrator iterates `getRegisteredChannelNames()`, factories return `null` when credentials missing → skip gracefully
- **Problem 1 — Hardcoded imports**: `src/channels/index.ts` has `import './telegram.js'` and `import './discord.js'` at the top level. If `grammy` or `discord.js` aren't installed, the import crashes the entire process at startup — even though the factory would return `null`
- **Problem 2 — Duplicate interfaces**: Both `TelegramChannelOpts` and `DiscordChannelOpts` are identical copies of `ChannelOpts` from `registry.ts`. The channel classes should use `ChannelOpts` directly
- **Problem 3 — Duplicated message splitting**: Both channels implement their own message splitting logic (Telegram at 4096 chars, Discord at 2000 chars with line-boundary splitting). The line-boundary splitter in Discord is the better implementation and should be shared
- **Problem 4 — No discord tests**: `discord.ts` was added manually in Part 2 without a test file. `telegram.test.ts` has 46 tests; discord has 0

### Current files
```
src/channels/
├── discord.ts          # 305 lines — Discord channel (no tests)
├── index.ts            # 15 lines — barrel imports
├── registry.ts         # 30 lines — registry (clean)
├── registry.test.ts    # 42 lines — 4 tests (clean)
├── telegram.ts         # 313 lines — Telegram channel
└── telegram.test.ts    # 700+ lines — 46 tests
```

### Goals
1. **Make grammy and discord.js optional** — dynamic imports with try/catch so missing deps don't crash the process
2. **Eliminate duplicate interfaces** — use `ChannelOpts` from registry.ts directly
3. **Extract shared message splitting** — reusable utility for all channels
4. **Add discord tests** — match telegram test coverage pattern
5. **Clean up channel skills** — update to reflect new architecture

---

## Phase 1: Dynamic Imports — Make Dependencies Optional

### Step 1.1 — Convert `src/channels/index.ts` to dynamic imports

**Modify:** `src/channels/index.ts`

Replace static imports with dynamic try/catch:

```typescript
// Channel self-registration barrel file.
// Each import triggers the channel module's registerChannel() call.
// Dynamic imports ensure missing optional dependencies (grammy, discord.js)
// don't crash the process — the channel is simply skipped.

async function loadChannels(): Promise<void> {
  // discord
  try { await import('./discord.js'); } catch {}

  // gmail

  // slack

  // telegram
  try { await import('./telegram.js'); } catch {}

  // whatsapp
}

export { loadChannels };
```

### Step 1.2 — Update orchestrator to call `loadChannels()`

**Modify:** `src/index.ts`

Change:
```typescript
import './channels/index.js';
```
To:
```typescript
import { loadChannels } from './channels/index.js';
```

And before the channel initialization loop (around line 529), add:
```typescript
await loadChannels();
```

### Step 1.3 — Verify graceful degradation

After implementation: temporarily rename `discord.ts` → verify NanoClaw starts with just Telegram. Then restore.

---

## Phase 2: Eliminate Duplicate Interfaces

### Step 2.1 — Remove `TelegramChannelOpts`

**Modify:** `src/channels/telegram.ts`

- Delete the `TelegramChannelOpts` interface (lines 15-20)
- Change `private opts: TelegramChannelOpts` → `private opts: ChannelOpts`
- Change constructor param type: `opts: TelegramChannelOpts` → `opts: ChannelOpts`
- Remove unused import of `OnChatMetadata`, `OnInboundMessage`, `RegisteredGroup` from `../types.js` (they're re-exported via `ChannelOpts`)

### Step 2.2 — Remove `DiscordChannelOpts`

**Modify:** `src/channels/discord.ts`

Same treatment:
- Delete the `DiscordChannelOpts` interface (lines 22-27)
- Change `private opts: DiscordChannelOpts` → `private opts: ChannelOpts`
- Change constructor param type: `opts: DiscordChannelOpts` → `opts: ChannelOpts`
- Remove unused imports from `../types.js`

---

## Phase 3: Extract Shared Message Splitting

### Step 3.1 — Create `src/channels/utils.ts`

**New file:** `src/channels/utils.ts` (~30 lines)

```typescript
/**
 * Split a message into chunks at line boundaries, respecting a character limit.
 * Falls back to hard splits if individual lines exceed the limit.
 */
export function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let current = '';

  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > maxLength) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      if (line.length > maxLength) {
        for (let i = 0; i < line.length; i += maxLength) {
          chunks.push(line.slice(i, i + maxLength));
        }
        continue;
      }
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) chunks.push(current);

  return chunks;
}
```

### Step 3.2 — Create `src/channels/utils.test.ts`

**New file:** `src/channels/utils.test.ts` (~40 lines)

Test cases:
- Short message returns single-element array
- Long message splits at line boundaries
- Single line longer than limit gets hard-split
- Empty string returns `['']`
- Exact-boundary edge case

### Step 3.3 — Update Discord to use shared splitter

**Modify:** `src/channels/discord.ts`

- Import `splitMessage` from `./utils.js`
- Remove the local `splitMessage()` function (lines 269-292)
- `sendMessage()` already calls `splitMessage(text, MAX_LENGTH)` — just needs the import

### Step 3.4 — Update Telegram to use shared splitter

**Modify:** `src/channels/telegram.ts`

- Import `splitMessage` from `./utils.js`
- Replace the naive character-boundary split in `sendMessage()` (lines 238-246) with:
  ```typescript
  const chunks = splitMessage(text, MAX_LENGTH);
  for (const chunk of chunks) {
    await this.bot.api.sendMessage(numericId, chunk);
  }
  ```

---

## Phase 4: Add Discord Tests

### Step 4.1 — Create `src/channels/discord.test.ts`

**New file:** `src/channels/discord.test.ts` (~500 lines)

Mirror the structure of `telegram.test.ts`:

- Mock `discord.js` (Client, TextChannel, Message, AttachmentBuilder)
- Mock `registry.js`, `env.js`, `config.js`, `logger.js`
- Test groups:
  1. **Registration** — factory is called, returns null without token, returns DiscordChannel with token
  2. **connect()** — creates Client with correct intents, registers messageCreate handler, calls login
  3. **handleMessage()** — skips own messages, skips bot messages, constructs JID as `dc:{channelId}`, translates `<@botId>` to trigger, stores metadata, skips unregistered chats, delivers to registered chats, handles attachments
  4. **sendMessage()** — sends short messages, splits long messages, handles missing channel
  5. **sendDocument()** — sends attachment with caption, handles errors
  6. **ownsJid()** — returns true for `dc:` prefix, false for `tg:`
  7. **setTyping()** — calls sendTyping when isTyping true, does nothing when false
  8. **disconnect()** — calls client.destroy()

---

## Phase 5: Clean Up Channel Skills

### Step 5.1 — Update add-discord skill to note it's already applied

**Modify:** `.nanoclaw/state.yaml`

Add discord to applied_skills so the skills engine knows it's installed (it was applied manually in Part 2, not via the engine).

### Step 5.2 — Update skill SKILL.md references

The skill files reference `scripts/apply-skill.ts` which was deleted in Part 1 (skills-engine removal). The skills are now documentation-only guides for how to add channels manually. This is fine — no code change needed, but note in OPTIMIZATION.md that the skills engine was removed and skills are now guide-only.

---

## File Summary

### New Files

| File | Est. Lines | Purpose |
|------|-----------|---------|
| `src/channels/utils.ts` | 30 | Shared `splitMessage()` utility |
| `src/channels/utils.test.ts` | 40 | Tests for splitMessage |
| `src/channels/discord.test.ts` | 500 | Discord channel unit tests (mirrors telegram.test.ts) |

### Modified Files

| File | Change |
|------|--------|
| `src/channels/index.ts` | Static imports → dynamic `loadChannels()` with try/catch |
| `src/index.ts` | Import and call `loadChannels()` before channel init loop |
| `src/channels/telegram.ts` | Remove `TelegramChannelOpts`, use `ChannelOpts`, use shared `splitMessage` |
| `src/channels/discord.ts` | Remove `DiscordChannelOpts`, use `ChannelOpts`, remove local `splitMessage`, import from utils |
| `.nanoclaw/state.yaml` | Add discord to applied_skills |
| `OPTIMIZATION.md` | Mark Part 4 complete |

### Unchanged

| File | Reason |
|------|--------|
| `src/channels/registry.ts` | Already clean |
| `src/channels/registry.test.ts` | Already clean |
| `src/channels/telegram.test.ts` | May need minor update if TelegramChannelOpts removal affects mocks |

---

## Implementation Order

1. **Phase 3** — Extract shared splitter first (no existing code breaks, just add new files)
2. **Phase 2** — Eliminate duplicate interfaces (simple rename, tests still pass)
3. **Phase 1** — Dynamic imports (changes initialization flow)
4. **Phase 4** — Add discord tests (independent, but benefits from phases 2-3)
5. **Phase 5** — Cleanup (state.yaml, OPTIMIZATION.md)

---

## Verification

1. `npm run build` — clean compile
2. `npm test` — all existing 240 tests pass + new utils tests + new discord tests
3. Start NanoClaw — both Telegram and Discord connect
4. Temporarily uninstall discord.js (`npm uninstall discord.js`) → NanoClaw starts with Telegram only, no crash. Reinstall after.
5. Message on Telegram → responds. Message on Discord → responds.
6. `OPTIMIZATION.md` shows Part 4 ✅

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Dynamic import changes initialization order | `await loadChannels()` called before channel loop — same effective order |
| Telegram tests rely on TelegramChannelOpts | Check if tests import the type; update mocks if needed |
| Discord mock complexity | Follow telegram.test.ts pattern exactly — proven approach |
| Skills engine state.yaml drift | Only adding discord entry — no destructive changes |
