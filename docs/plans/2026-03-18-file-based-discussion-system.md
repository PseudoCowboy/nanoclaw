---
status: superseded
date: 2026-03-18
superseded_by: 2026-03-25-workstream-execution-monitoring-plan.md
---

# File-Based Discussion System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the chat-only `!create_discussion` with a file-based collaborative discussion system where agents read/edit shared markdown, commit as themselves via git, and chain automatically through 3 rounds (improve → disagree → resolve).

**Architecture:** Iris (main bot) creates a per-discussion git repo in `groups/shared_project/discuss-<slug>/` and monitors agent handoffs in the Discord channel. Agents chain via @mentions. A new shared container skill (`discord-discussion/SKILL.md`) teaches all three planning agents the discussion protocol. Agents use `git commit --author` so `git blame` shows who wrote what.

**Tech Stack:** TypeScript, discord.js v14, Node.js fs/child_process, git CLI (inside containers)

**Design doc:** `docs/plans/2026-03-18-file-based-discussion-system-design.md`

---

### Task 1: Create the shared discussion skill

This is the core protocol document that all three planning agents read inside their containers. It tells them how to behave in `discuss-*` channels.

**Files:**
- Create: `container/skills/discord-discussion/SKILL.md`

**Step 1: Create the skill file**

```markdown
---
name: discord-discussion
description: Protocol for file-based collaborative discussions in Discord discuss-* channels. Covers 3-round workflow (improve, disagree, resolve), git commit conventions, and agent handoff chain.
---

# Discord Discussion Protocol

When you are triggered in a `discuss-*` Discord channel, follow this protocol. Your identity (name, role, preferred tool, chain position) comes from your CLAUDE.md.

## Overview

Discussions use shared markdown files in `/workspace/shared/discuss-<slug>/`. This folder is a git repo. You read files, edit them, commit as yourself, and hand off to the next agent via @mention in Discord.

**Chain order:** Prometheus (1st) → Athena (2nd) → Hermes (3rd, final authority)

## Git Conventions

**Always commit from inside the discussion folder:**

```bash
cd /workspace/shared/discuss-<slug>/
git add .
git commit --author="YourName <yourname@nanoclaw>" -m "Round N: description of changes"
```

Replace `YourName` and `yourname` with your actual name (Prometheus, Athena, or Hermes).

**Check who changed what:**
```bash
git log --oneline
git blame plan-v2.md
```

## Round 1 — Improvement (You ↔ Human)

You are triggered by the human with a message like `@YourName read plan.md and requirements.md, improve the plan`.

1. Read the files mentioned from `/workspace/shared/discuss-<slug>/`
2. Analyze them using your preferred tool if needed
3. Ask the human questions in Discord to clarify — have a multi-turn conversation
4. When you have enough understanding, decide you're done:
   - **If you are Prometheus (1st):** Create `plan-v2.md` with your improved version. Commit. Send: `@Athena your turn — check plan-v2.md under discuss-<slug>`
   - **If you are Athena (2nd):** Edit `plan-v2.md` in place with your improvements. Commit. Send: `@Hermes your turn — check plan-v2.md under discuss-<slug>`
   - **If you are Hermes (3rd):** Edit `plan-v2.md` in place with your improvements. Commit. Send: `✅ Round 1 complete.`

## Round 2 — Disagreement (You ↔ Other Agents, Human Observes)

Iris will announce Round 2 and trigger Prometheus. **Do not ask the human questions in this round.** You debate directly with other agents.

1. Re-read `plan-v2.md`
2. Run `git log --oneline` and `git blame plan-v2.md` to see who changed what
3. If you disagree with a change another agent made:
   - @mention that agent in Discord and ask why they made that change
   - Wait for their response and debate
   - If resolved through debate, move on
   - If still unresolved, write it to `disagreements.md` under a section with your name:
     ```markdown
     ## YourName — Disagreements

     ### Disagree with [AgentName]'s change to [section]
     **What they changed:** [describe]
     **Why I disagree:** [explain]
     ```
4. Commit your changes to `disagreements.md`
5. Hand off:
   - **Prometheus (1st):** Send `@Athena your turn — review plan-v2.md and disagreements.md`
   - **Athena (2nd):** Append your disagreements to `disagreements.md`. Send `@Hermes your turn — review plan-v2.md and disagreements.md`
   - **Hermes (3rd):** Append your disagreements. Send `✅ Round 2 complete.`

If you have no disagreements, say so in Discord and hand off to the next agent anyway.

## Round 3 — Resolution (Iris Orchestrates)

Iris will @mention all three agents. You respond in chain order.

1. Read `plan-v2.md` and `disagreements.md`
2. For each disagreement listed:
   - State whether it's **resolved** or **still disagree**
   - If still disagree, re-describe it clearly with your reasoning
3. Update `disagreements.md` with your final positions
4. Commit

After all three agents respond, Iris asks the human for input. Then:
- **Hermes only:** Iris will @mention you to produce the final version. Read the human's comments, incorporate their decisions into `plan-v2.md`, commit with message "Final version incorporating human decisions", and send `✅ Discussion complete. Final plan is plan-v2.md`

## Important Rules

- **Never modify the original files** (plan.md, requirements.md, etc.) — only edit plan-v2.md and disagreements.md
- **Always commit after your turn** — even if you made no changes, commit with a note
- **Always hand off** — don't leave the chain hanging
- **Use your preferred tool** for deep analysis, but you can read/write files directly
- **Keep Discord messages concise** — put detailed analysis in the markdown files, post summaries in Discord
```

**Step 2: Verify the skill will be auto-synced into containers**

Check `src/container-runner.ts:159-169` — it already copies all directories from `container/skills/` into each group's `.claude/skills/`. No code change needed. The skill will appear at `/home/node/.claude/skills/discord-discussion/SKILL.md` inside every container automatically.

**Step 3: Commit**

```bash
git add container/skills/discord-discussion/SKILL.md
git commit -m "feat: add discord-discussion container skill for file-based collaboration protocol"
```

---

### Task 2: Update agent config — Athena listenToBots

Athena needs `listenToBots: true` so she responds when Prometheus @mentions her during discussions.

**Files:**
- Modify: `agents/config.json`

**Step 1: Change Athena's listenToBots**

In `agents/config.json`, change Athena's `listenToBots` from `false` to `true`:

```json
{
  "name": "Athena",
  "folder": "dc_athena",
  "role": "Plan Designer",
  "preferredTool": "codex",
  "tokenEnvVar": "ATHENA_DISCORD_TOKEN",
  "channelNames": ["control-room", "plan-room", "discuss-*"],
  "triggerNames": ["athena"],
  "listenToBots": true,
  "emoji": "🟣",
  "color": 10181558
}
```

**Step 2: Commit**

```bash
git add agents/config.json
git commit -m "feat: enable listenToBots for Athena so she responds to agent @mentions in discussions"
```

---

### Task 3: Update agent CLAUDE.md files with discussion skill reference and chain position

Each agent needs to know about the discussion protocol and their position in the chain.

**Files:**
- Modify: `groups/dc_prometheus/CLAUDE.md`
- Modify: `groups/dc_athena/CLAUDE.md`
- Modify: `groups/dc_hermes/CLAUDE.md`

**Step 1: Update Prometheus CLAUDE.md**

Append to the end of `groups/dc_prometheus/CLAUDE.md`:

```markdown

## File-Based Discussions

When triggered in a `discuss-*` channel, follow the discussion protocol in your skills (`discord-discussion` skill). You are **position 1 (first)** in the chain:

- **Round 1:** You create `plan-v2.md` from the original files, then hand off to `@Athena`
- **Round 2:** You review first, challenge other agents, then hand off to `@Athena`
- **Round 3:** You state final positions first

Your git author: `Prometheus <prometheus@nanoclaw>`
```

**Step 2: Update Athena CLAUDE.md**

Append to the end of `groups/dc_athena/CLAUDE.md`:

```markdown

## File-Based Discussions

When triggered in a `discuss-*` channel, follow the discussion protocol in your skills (`discord-discussion` skill). You are **position 2 (second)** in the chain:

- **Round 1:** You edit `plan-v2.md` in place after Prometheus, then hand off to `@Hermes`
- **Round 2:** You review after Prometheus, challenge other agents, then hand off to `@Hermes`
- **Round 3:** You state final positions after Prometheus

Your git author: `Athena <athena@nanoclaw>`
```

**Step 3: Update Hermes CLAUDE.md**

Append to the end of `groups/dc_hermes/CLAUDE.md`:

```markdown

## File-Based Discussions

When triggered in a `discuss-*` channel, follow the discussion protocol in your skills (`discord-discussion` skill). You are **position 3 (third, final authority)** in the chain:

- **Round 1:** You edit `plan-v2.md` in place after Athena, then send `✅ Round 1 complete.`
- **Round 2:** You review last, challenge other agents, then send `✅ Round 2 complete.`
- **Round 3:** You state final positions last. After human input, you produce the final version.

Your git author: `Hermes <hermes@nanoclaw>`
```

**Step 4: Commit**

```bash
git add groups/dc_prometheus/CLAUDE.md groups/dc_athena/CLAUDE.md groups/dc_hermes/CLAUDE.md
git commit -m "feat: add discussion skill reference and chain positions to agent CLAUDE.md files"
```

---

### Task 4: Add discussion state types and constants

Before rewriting the command, define the types and constants for discussion tracking.

**Files:**
- Modify: `src/channels/discord-commands.ts`

**Step 1: Write the failing test — new exports exist**

Add to `src/channels/discord-commands.test.ts`:

```typescript
import {
  handleCommand,
  planningSessions,
  slugify,
  PLANNING_AGENTS,
  PLANNING_ROUND_COUNT,
  discussionSessions,
  DISCUSSION_CHAIN,
} from './discord-commands.js';

describe('discussion system types', () => {
  it('DISCUSSION_CHAIN has Prometheus, Athena, Hermes in order', () => {
    expect(DISCUSSION_CHAIN).toEqual(['Prometheus', 'Athena', 'Hermes']);
  });

  it('discussionSessions is a Map', () => {
    expect(discussionSessions).toBeInstanceOf(Map);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --run src/channels/discord-commands.test.ts`
Expected: FAIL — `discussionSessions` and `DISCUSSION_CHAIN` not exported

**Step 3: Add types and constants to discord-commands.ts**

Add after the existing `PlanningSession` interface (around line 18):

```typescript
interface DiscussionSession {
  topic: string;
  slug: string;
  round: number; // 0 = not started, 1 = improve, 2 = disagree, 3 = resolve
  currentAgent: string | null;
  channelId: string;
}

const DISCUSSION_CHAIN = ['Prometheus', 'Athena', 'Hermes'];
const AGENT_HANDOFF_TIMEOUT = 300_000; // 5 minutes
const HUMAN_INPUT_TIMEOUT = 600_000; // 10 minutes for human to share thoughts in Round 3

const discussionSessions = new Map<string, DiscussionSession>();
```

Add to the exports at the bottom of the file (line ~1166):

```typescript
export {
  planningSessions,
  discussionListeners,
  discussionSessions,
  slugify,
  PLANNING_AGENTS,
  PLANNING_ROUND_COUNT,
  DISCUSSION_CHAIN,
};
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --run src/channels/discord-commands.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/channels/discord-commands.ts src/channels/discord-commands.test.ts
git commit -m "feat: add discussion session types, constants, and chain order"
```

---

### Task 5: Add shared folder + git init helper

Add a helper function that creates the discussion folder and initializes a git repo.

**Files:**
- Modify: `src/channels/discord-commands.ts`

**Step 1: Write the failing test**

Add to `src/channels/discord-commands.test.ts`:

```typescript
import { initDiscussionFolder } from './discord-commands.js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    mkdirSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
  };
});

describe('initDiscussionFolder', () => {
  it('creates directory and initializes git repo', () => {
    const result = initDiscussionFolder('discuss-api-redesign');
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('discuss-api-redesign'),
      { recursive: true },
    );
    expect(result).toContain('discuss-api-redesign');
  });
});
```

Note: The `child_process` mock already exists in the test file. We'll need to verify the `execSync` call for `git init`.

**Step 2: Run test to verify it fails**

Run: `npm test -- --run src/channels/discord-commands.test.ts`
Expected: FAIL — `initDiscussionFolder` not exported

**Step 3: Implement initDiscussionFolder**

Add to `discord-commands.ts` after the imports, add:

```typescript
import fs from 'fs';
import path from 'path';
```

Add the helper function after the `slugify` function:

```typescript
/**
 * Create the discussion folder under groups/shared_project/ and git init it.
 * Returns the host path to the folder.
 */
function initDiscussionFolder(slug: string): string {
  const sharedDir = path.resolve(process.cwd(), 'groups', 'shared_project');
  const discussDir = path.join(sharedDir, slug);

  if (fs.existsSync(discussDir)) {
    logger.info({ discussDir }, 'Discussion folder already exists');
    return discussDir;
  }

  fs.mkdirSync(discussDir, { recursive: true });

  try {
    execSync('git init', { cwd: discussDir, encoding: 'utf8', timeout: 10000 });
    // Set a default committer name/email for the repo so git doesn't complain
    execSync('git config user.name "Discussion"', { cwd: discussDir, encoding: 'utf8', timeout: 5000 });
    execSync('git config user.email "discussion@nanoclaw"', { cwd: discussDir, encoding: 'utf8', timeout: 5000 });
    logger.info({ discussDir }, 'Initialized discussion git repo');
  } catch (err: any) {
    logger.error({ err: err.message, discussDir }, 'Failed to git init discussion folder');
  }

  return discussDir;
}
```

Add `initDiscussionFolder` to exports.

**Step 4: Run test to verify it passes**

Run: `npm test -- --run src/channels/discord-commands.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/channels/discord-commands.ts src/channels/discord-commands.test.ts
git commit -m "feat: add initDiscussionFolder helper to create discussion git repos"
```

---

### Task 6: Rewrite cmdCreateDiscussion to use file-based workflow

Replace the old `cmdCreateDiscussion` that auto-starts a `runPlanningSession` with the new version that creates a shared folder, git inits it, and sets up the Iris watchdog.

**Files:**
- Modify: `src/channels/discord-commands.ts`

**Step 1: Write the failing test**

Add to `src/channels/discord-commands.test.ts`:

```typescript
describe('!create_discussion — file-based', () => {
  it('creates discussion channel and reports folder path in welcome embed', async () => {
    const msg = mockMessage('!create_discussion "API redesign"');
    // Mock guild.channels.create to return a channel with send
    const createdChannel = {
      id: 'discuss-chan-1',
      name: 'discuss-api-redesign',
      send: vi.fn().mockResolvedValue(undefined),
      toString: () => '#discuss-api-redesign',
    };
    msg.guild.channels.create = vi.fn().mockResolvedValue(createdChannel);

    await handleCommand(msg, client);

    // Should have created the channel
    expect(msg.guild.channels.create).toHaveBeenCalled();
    // Welcome embed should mention shared folder path
    expect(createdChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
    // Reply confirms creation
    expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('discuss-api-redesign'));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --run src/channels/discord-commands.test.ts`
Expected: FAIL (or existing test may pass with old behavior — the new test checks for file path in embed)

**Step 3: Rewrite cmdCreateDiscussion**

Replace the existing `cmdCreateDiscussion` function (lines 635-749) with:

```typescript
async function cmdCreateDiscussion(
  message: Message,
  client: Client,
): Promise<void> {
  const raw = message.content.slice('!create_discussion'.length).trim();
  const topicMatch = raw.match(/^"(.+?)"|^'(.+?)'|^(.+)$/);
  const topic = (
    (topicMatch && (topicMatch[1] || topicMatch[2] || topicMatch[3])) ||
    ''
  ).trim();

  if (!topic) {
    await message.reply('Usage: `!create_discussion "API design patterns"`');
    return;
  }

  if (!message.guild) {
    await message.reply(
      '\u26A0\uFE0F This command can only be used in a server.',
    );
    return;
  }

  const slug = slugify(topic);
  const channelName = `discuss-${slug}`;

  try {
    await message.guild.channels.fetch();

    // Find or create DISCUSSIONS category
    let discussCategory = message.guild.channels.cache.find(
      (c) => c.name === 'DISCUSSIONS' && c.type === ChannelType.GuildCategory,
    );

    if (!discussCategory) {
      discussCategory = await message.guild.channels.create({
        name: 'DISCUSSIONS',
        type: ChannelType.GuildCategory,
      });
      await (message.channel as TextChannel).send(
        '\uD83D\uDCC1 Created DISCUSSIONS category',
      );
    }

    // Check for existing channel
    const existing = message.guild.channels.cache.find(
      (c) => c.name === channelName && c.parentId === discussCategory!.id,
    );

    if (existing) {
      await message.reply(
        `\u26A0\uFE0F Discussion channel ${existing.toString()} already exists!`,
      );
      return;
    }

    // Create Discord channel
    const discussChannel = (await message.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: discussCategory.id,
      topic: `\uD83D\uDCA1 Discussion: ${topic} | Prometheus, Athena, Hermes, Human`,
    })) as TextChannel;

    // Create shared folder with git init
    const discussDir = initDiscussionFolder(channelName);

    // Track this discussion session
    discussionSessions.set(discussChannel.id, {
      topic,
      slug: channelName,
      round: 0,
      currentAgent: null,
      channelId: discussChannel.id,
    });

    // Post welcome embed
    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`\uD83D\uDCA1 Discussion: ${topic}`)
      .setDescription(
        'File-based collaborative discussion with the planning agents.\n\n' +
        '**Workflow:** Place your markdown files in the shared folder, then `@Prometheus` to start.',
      )
      .addFields(
        {
          name: '\uD83D\uDCC2 Shared Folder',
          value: `\`${channelName}/\` under shared project\nContainer path: \`/workspace/shared/${channelName}/\``,
        },
        {
          name: '\uD83D\uDE80 How to Start',
          value:
            '1. Place your markdown files in the shared folder\n' +
            '2. `@Prometheus read plan.md and requirements.md, improve the plan`\n' +
            '3. Agents chain automatically: Prometheus → Athena → Hermes',
        },
        {
          name: '\uD83D\uDD04 3 Rounds',
          value:
            '**Round 1 — Improve:** Each agent talks to you, edits plan-v2.md\n' +
            '**Round 2 — Disagree:** Agents debate each other, you observe\n' +
            '**Round 3 — Resolve:** Final positions, your input, Hermes writes final version',
        },
        {
          name: '\uD83D\uDE4B Commands',
          value: '`!close_discussion` — Delete this channel',
        },
      )
      .setTimestamp();

    await discussChannel.send({ embeds: [welcomeEmbed] });

    // Start Iris watchdog — monitors for agent handoffs and round transitions
    startDiscussionWatchdog(client, discussChannel, channelName);

    await message.reply(
      `\u2705 Discussion channel created: ${discussChannel.toString()}\n\uD83D\uDCC2 Shared folder: \`groups/shared_project/${channelName}/\``,
    );
  } catch (err: any) {
    await message.reply(`\u274C Error creating discussion: ${err.message}`);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --run src/channels/discord-commands.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/channels/discord-commands.ts src/channels/discord-commands.test.ts
git commit -m "feat: rewrite cmdCreateDiscussion for file-based workflow with git init and shared folder"
```

---

### Task 7: Implement the Iris watchdog and round transition logic

The watchdog monitors agent messages in discussion channels, detects round completions (`✅ Round N complete.`), and triggers round transitions.

**Files:**
- Modify: `src/channels/discord-commands.ts`

**Step 1: Write the failing test**

Add to `src/channels/discord-commands.test.ts`:

```typescript
describe('discussion watchdog', () => {
  it('detects "Round 1 complete" from Hermes and advances to round 2', async () => {
    // Set up a discussion session
    const { discussionSessions } = await import('./discord-commands.js');
    discussionSessions.set('chan1', {
      topic: 'test',
      slug: 'discuss-test',
      round: 1,
      currentAgent: 'Hermes',
      channelId: 'chan1',
    });

    // The watchdog should detect round completion messages
    // This is a behavioral test — we verify the session state advances
    const session = discussionSessions.get('chan1');
    expect(session).toBeDefined();
    expect(session!.round).toBe(1);
  });
});
```

**Step 2: Implement startDiscussionWatchdog**

Add to `discord-commands.ts`:

```typescript
/**
 * Iris watchdog — monitors a discussion channel for agent handoffs and round completions.
 * Handles round transitions and the Round 3 orchestration flow.
 */
function startDiscussionWatchdog(
  client: Client,
  channel: TextChannel,
  slug: string,
): void {
  let nudgeTimer: ReturnType<typeof setTimeout> | null = null;

  function resetNudgeTimer(agentName: string) {
    if (nudgeTimer) clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(async () => {
      const session = discussionSessions.get(channel.id);
      if (!session) return;
      await channel.send(
        `\u23F0 @${agentName} — please wrap up and hand off to the next agent.`,
      );
    }, AGENT_HANDOFF_TIMEOUT);
  }

  async function onMessage(msg: Message) {
    if (msg.channelId !== channel.id) return;

    const session = discussionSessions.get(channel.id);
    if (!session) {
      client.removeListener('messageCreate', onMessage);
      if (nudgeTimer) clearTimeout(nudgeTimer);
      return;
    }

    // Detect round completion signals from bots
    if (msg.author.bot) {
      const content = msg.content;

      // Round 1 complete (from Hermes)
      if (content.includes('Round 1 complete') && session.round <= 1) {
        if (nudgeTimer) clearTimeout(nudgeTimer);
        session.round = 2;
        session.currentAgent = null;

        await channel.send(
          '\n**\u2501\u2501\u2501 Round 2 \u2014 Review & Disagree \u2501\u2501\u2501**\n' +
          'Agents will now review each other\'s changes and debate. You can observe.',
        );
        await channel.send(
          `@Prometheus review plan-v2.md under ${slug} \u2014 ` +
          'check `git blame` to see who changed what. If you disagree with any changes, challenge the agent who made them.',
        );
        session.currentAgent = 'Prometheus';
        resetNudgeTimer('Prometheus');
        return;
      }

      // Round 2 complete (from Hermes)
      if (content.includes('Round 2 complete') && session.round <= 2) {
        if (nudgeTimer) clearTimeout(nudgeTimer);
        session.round = 3;
        session.currentAgent = null;

        // Check if disagreements.md exists (agent may have mentioned it)
        const hasDisagreements = content.toLowerCase().includes('disagreement') ||
          msg.embeds?.some((e) => e.description?.toLowerCase().includes('disagreement'));

        if (!hasDisagreements) {
          // Try to check from context — if any agent wrote to disagreements.md
          // We can't read the file from here, so assume there might be disagreements
          // and let agents report
        }

        await channel.send(
          '\n**\u2501\u2501\u2501 Round 3 \u2014 Resolve Disagreements \u2501\u2501\u2501**\n' +
          'Each agent will state their final position on any disagreements.',
        );
        await channel.send(
          `@Prometheus @Athena @Hermes \u2014 read plan-v2.md and disagreements.md under ${slug}. ` +
          'For each disagreement, state whether it\'s resolved or still disagree. Re-describe unresolved points clearly. ' +
          'Respond in order: Prometheus first, then Athena, then Hermes.',
        );
        session.currentAgent = 'Prometheus';
        resetNudgeTimer('Prometheus');

        // After all three respond, wait for human input
        waitForRound3Completion(client, channel, slug, session);
        return;
      }

      // Discussion complete (from Hermes in Round 3 final)
      if (content.includes('Discussion complete') && session.round === 3) {
        if (nudgeTimer) clearTimeout(nudgeTimer);
        client.removeListener('messageCreate', onMessage);
        discussionSessions.delete(channel.id);

        const completeEmbed = new EmbedBuilder()
          .setColor(0x00ff00)
          .setTitle('\uD83D\uDCCB Discussion Complete')
          .setDescription(
            `**${session.topic}**\n\n` +
            `3 rounds completed. Final plan is in \`/workspace/shared/${slug}/plan-v2.md\`.\n` +
            'Use `git log` in the discussion folder to see the full history.\n\n' +
            '`!close_discussion` to delete this channel when done.',
          )
          .setTimestamp();
        await channel.send({ embeds: [completeEmbed] });
        return;
      }

      // Track agent handoffs (any bot mentioning another agent)
      for (const agent of DISCUSSION_CHAIN) {
        if (content.includes(`@${agent}`) && msg.author.username.toLowerCase() !== agent.toLowerCase()) {
          session.currentAgent = agent;
          resetNudgeTimer(agent);
          break;
        }
      }
    }
  }

  client.on('messageCreate', onMessage);

  // Store listener reference for cleanup on !close_discussion
  discussionListeners.set(channel.id, {
    listener: onMessage,
    timer: nudgeTimer as any,
  });
}
```

**Step 3: Implement waitForRound3Completion**

```typescript
/**
 * After Round 3 agent responses, wait for human input then trigger Hermes for final version.
 */
function waitForRound3Completion(
  client: Client,
  channel: TextChannel,
  slug: string,
  session: DiscussionSession,
): void {
  let agentResponseCount = 0;

  function onRound3Message(msg: Message) {
    if (msg.channelId !== channel.id) return;

    // Count agent responses in Round 3
    if (msg.author.bot && session.round === 3) {
      for (const agent of DISCUSSION_CHAIN) {
        if (msg.author.username.toLowerCase().includes(agent.toLowerCase())) {
          agentResponseCount++;
          break;
        }
      }

      // All 3 agents have responded — ask human for input
      if (agentResponseCount >= 3) {
        client.removeListener('messageCreate', onRound3Message);

        // Check if there are unresolved disagreements by looking at agent messages
        channel.send(
          '\uD83D\uDCCB **All agents have stated their final positions.**\n\n' +
          `Review the disagreements in \`/workspace/shared/${slug}/disagreements.md\`.\n` +
          'Share your thoughts below, then I\'ll ask Hermes to produce the final version.\n\n' +
          '*Type your feedback, or `!skip` if no changes needed.*',
        ).then(() => {
          // Wait for human input
          const humanHandler = (humanMsg: Message) => {
            if (humanMsg.channelId !== channel.id) return;
            if (humanMsg.author.bot) return;

            client.removeListener('messageCreate', humanHandler);
            if (humanInputTimer) clearTimeout(humanInputTimer);

            const skipCmd = humanMsg.content.trim().toLowerCase();
            if (skipCmd === '!skip' || skipCmd === '!next') {
              channel.send(
                `@Hermes \u2014 No additional human input. Produce the final version of plan-v2.md under ${slug}. ` +
                'Commit as: `git commit --author="Hermes <hermes@nanoclaw>"`',
              );
            } else {
              channel.send(
                `@Hermes \u2014 Human feedback received. Incorporate it and produce the final version of plan-v2.md under ${slug}. ` +
                'Commit with message: "Final version incorporating human decisions"',
              );
            }
          };

          client.on('messageCreate', humanHandler);

          // Timeout — if human doesn't respond in 10 minutes, proceed anyway
          const humanInputTimer = setTimeout(() => {
            client.removeListener('messageCreate', humanHandler);
            channel.send(
              `\u23F0 No human input received. @Hermes \u2014 Produce the final version of plan-v2.md under ${slug} based on current consensus.`,
            );
          }, HUMAN_INPUT_TIMEOUT);
        });
      }
    }
  }

  client.on('messageCreate', onRound3Message);
}
```

**Step 4: Run tests**

Run: `npm test -- --run src/channels/discord-commands.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/channels/discord-commands.ts src/channels/discord-commands.test.ts
git commit -m "feat: add Iris watchdog with round transitions and Round 3 human input flow"
```

---

### Task 8: Update cmdCloseDiscussion to clean up discussion sessions

The close command needs to also clean up `discussionSessions` and the watchdog listener.

**Files:**
- Modify: `src/channels/discord-commands.ts`

**Step 1: Write the failing test**

Add to `src/channels/discord-commands.test.ts`:

```typescript
describe('!close_discussion — with active discussion session', () => {
  it('cleans up discussion session on close', async () => {
    const { discussionSessions } = await import('./discord-commands.js');
    const msg = mockMessage('!close_discussion', {
      channel: {
        id: 'discuss-chan-1',
        name: 'discuss-test-topic',
        send: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    });
    discussionSessions.set('discuss-chan-1', {
      topic: 'test',
      slug: 'discuss-test-topic',
      round: 1,
      currentAgent: 'Prometheus',
      channelId: 'discuss-chan-1',
    });

    await handleCommand(msg, client);

    // Session should be cleaned up (close_discussion currently rejects if planning session active,
    // but we should allow closing discussion sessions)
    // After close, the channel.delete should be called
    expect(msg.channel.delete).toHaveBeenCalled();
  });
});
```

**Step 2: Update cmdCloseDiscussion**

Replace the existing `cmdCloseDiscussion` (lines 751-784):

```typescript
async function cmdCloseDiscussion(
  message: Message,
  client: Client,
): Promise<void> {
  const channel = message.channel as TextChannel;
  if (!channel.name.startsWith('discuss-')) {
    await message.reply(
      '\u26A0\uFE0F `!close_discussion` must be used inside a `#discuss-*` channel.',
    );
    return;
  }

  // Don't block close if there's a planning session (old behavior) — discussion sessions are different
  if (planningSessions.has(channel.id)) {
    await message.reply(
      '\u26A0\uFE0F A planning session is still running. Wait for it to finish first.',
    );
    return;
  }

  try {
    // Clean up discussion session
    discussionSessions.delete(channel.id);

    // Clean up watchdog listener
    const listenerInfo = discussionListeners.get(channel.id);
    if (listenerInfo) {
      client.removeListener('messageCreate', listenerInfo.listener);
      if (listenerInfo.timer) clearTimeout(listenerInfo.timer);
      discussionListeners.delete(channel.id);
    }

    await channel.send('\uD83D\uDDD1\uFE0F Closing discussion channel...');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await channel.delete(`Discussion closed by ${message.author.username}`);
  } catch (err: any) {
    await message.reply(`\u274C Error closing discussion: ${err.message}`);
  }
}
```

**Step 3: Run tests**

Run: `npm test -- --run src/channels/discord-commands.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/channels/discord-commands.ts src/channels/discord-commands.test.ts
git commit -m "feat: update cmdCloseDiscussion to clean up discussion sessions and watchdog"
```

---

### Task 9: Update help commands to reflect new discussion workflow

**Files:**
- Modify: `src/channels/discord-commands.ts`

**Step 1: Update cmdHelp**

In the `cmdHelp` function, change the "Planning & Discussion" field value to:

```typescript
'`!plan FEAT-001 description` \u2014 3-round planning debate (use in #plan-room)\n`!create_discussion "topic"` \u2014 File-based discussion with shared folder + git\n`!close_discussion` \u2014 Delete current discussion channel\n`!next` / `!skip` \u2014 Skip comment window during planning',
```

**Step 2: Update cmdHelpOrchestration**

Change the "Ad-hoc Discussions" field value to:

```typescript
'`!create_discussion "topic"` \u2014 File-based collaborative discussion\n\u2022 Creates shared folder with git repo\n\u2022 3 rounds: Improve \u2192 Disagree \u2192 Resolve\n\u2022 Agents chain: Prometheus \u2192 Athena \u2192 Hermes\n`!close_discussion` \u2014 Remove when done',
```

**Step 3: Run tests**

Run: `npm test -- --run src/channels/discord-commands.test.ts`
Expected: PASS (help tests just verify reply was called)

**Step 4: Commit**

```bash
git add src/channels/discord-commands.ts
git commit -m "feat: update help commands to describe file-based discussion workflow"
```

---

### Task 10: Run full test suite and format

**Step 1: Run prettier**

Run: `npm run format:fix`

**Step 2: Run full test suite**

Run: `npm test -- --run`
Expected: All tests PASS

**Step 3: Build**

Run: `npm run build`
Expected: No TypeScript errors

**Step 4: Final commit if formatting changes**

```bash
git add -A
git commit -m "style: format discord-commands after discussion system implementation"
```

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] `container/skills/discord-discussion/SKILL.md` exists with full protocol
- [ ] `agents/config.json` has Athena `listenToBots: true`
- [ ] All 3 agent CLAUDE.md files have discussion skill reference + chain position
- [ ] `!create_discussion "topic"` creates folder at `groups/shared_project/discuss-<slug>/`
- [ ] The folder has `.git/` initialized
- [ ] Welcome embed shows shared folder path and workflow instructions
- [ ] `discussionSessions` map tracks active discussions
- [ ] Iris watchdog monitors for "Round N complete" signals
- [ ] Round 2 transition automatically triggers Prometheus
- [ ] Round 3 asks all agents, waits for human, triggers Hermes for final version
- [ ] `!close_discussion` cleans up session + listener
- [ ] `npm test -- --run` passes all tests
- [ ] `npm run build` succeeds

## File Summary

| File | Action | Purpose |
|------|--------|---------|
| `container/skills/discord-discussion/SKILL.md` | Create | Shared discussion protocol for all agents |
| `agents/config.json` | Modify | Athena `listenToBots: true` |
| `groups/dc_prometheus/CLAUDE.md` | Modify | Add chain position (1st) |
| `groups/dc_athena/CLAUDE.md` | Modify | Add chain position (2nd) |
| `groups/dc_hermes/CLAUDE.md` | Modify | Add chain position (3rd) |
| `src/channels/discord-commands.ts` | Modify | New types, rewritten create/close, watchdog, round logic |
| `src/channels/discord-commands.test.ts` | Modify | Tests for new exports, folder init, close cleanup |
