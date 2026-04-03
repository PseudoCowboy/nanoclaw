# Work Stream Execution Monitoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** After `!decompose` creates work stream channels, agents follow a structured task list from the plan, mark tasks done, report progress, and Iris monitors for silence/completion.

**Architecture:** `cmdDecompose()` triggers Hermes (via container @mention) to parse `plan-v2.md` into per-stream `tasks.md` files. A new `discord-workstream` container skill instructs agents to work through tasks one-at-a-time. `startStreamWatcher()` polls every 10 minutes for file changes, posts hourly status reports, detects silence (1 hour), re-triggers agents, and detects completion.

**Tech Stack:** TypeScript, Discord.js, Node.js `fs` (mtime polling), container agents triggered via @mentions

**Design doc:** `docs/plans/2026-03-25-workstream-execution-monitoring-design.md`

---

### Task 1: Add Stream Watcher Constants and Interface

**Files:**
- Modify: `src/channels/discord-commands.ts:55-69` (constants section)

**Step 1: Add the new constants after the existing ones (line ~61)**

After `const HUMAN_INPUT_TIMEOUT = 600_000;` add:

```typescript
// Stream watcher constants
const STREAM_POLL_INTERVAL = 600_000; // 10 minutes
const STREAM_SILENCE_THRESHOLD = 3_600_000; // 1 hour
const STREAM_STATUS_INTERVAL = 3_600_000; // 1 hour
const HERMES_DECOMPOSE_TIMEOUT = 300_000; // 5 minutes
```

**Step 2: Add the `StreamWatcherState` interface after the existing `WorkStream` interface (line ~43)**

```typescript
interface StreamWatcherState {
  interval: ReturnType<typeof setInterval>;
  listener: (...args: any[]) => void;
  projectSlug: string;
  streamType: string;
  channelId: string;
  categoryId: string;
  lastActivityTime: number;
  lastStatusReport: number;
  lastTasksMtime: number;
  completed: boolean;
}
```

**Step 3: Add the `activeStreamWatchers` Map after the existing `activeProjects` Map (line ~69)**

```typescript
const activeStreamWatchers = new Map<string, StreamWatcherState>();
```

**Step 4: Run build to verify**

Run: `cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion && npm run build`
Expected: Compiles with no errors (new code is just declarations, not referenced yet)

**Step 5: Commit**

```bash
cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion
git add src/channels/discord-commands.ts
git commit -m "feat: add stream watcher constants, interface, and map"
```

---

### Task 2: Add `countTasks()` Helper and Test It

**Files:**
- Modify: `src/channels/discord-commands.ts` (helpers section, around line 71)
- Modify: `src/channels/discord-commands.test.ts`

**Step 1: Write the failing test**

In `discord-commands.test.ts`, add a new describe block after the existing `slugify` tests (around line 443):

```typescript
describe('countTasks', () => {
  it('counts checked and total tasks from markdown', () => {
    const { countTasks } = require('./discord-commands.js');
    const content =
      '# Tasks\n\n' +
      '- [x] Done task 1\n' +
      '- [x] Done task 2\n' +
      '- [ ] Pending task 3\n' +
      '- [ ] Pending task 4\n' +
      '- [ ] Pending task 5\n';
    const result = countTasks(content);
    expect(result).toEqual({ done: 2, total: 5 });
  });

  it('returns zero for empty content', () => {
    const { countTasks } = require('./discord-commands.js');
    expect(countTasks('')).toEqual({ done: 0, total: 0 });
  });

  it('handles all checked tasks', () => {
    const { countTasks } = require('./discord-commands.js');
    const content = '- [x] A\n- [x] B\n';
    expect(countTasks(content)).toEqual({ done: 2, total: 2 });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion && npx vitest run src/channels/discord-commands.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — `countTasks` is not exported

**Step 3: Write the implementation in `discord-commands.ts`**

Add after the `slugify()` function (around line 81):

```typescript
/**
 * Count checked and total tasks in a markdown checklist.
 * Matches lines like `- [x] ...` and `- [ ] ...`.
 */
function countTasks(content: string): { done: number; total: number } {
  const all = content.match(/^- \[[ x]\] /gm) || [];
  const checked = content.match(/^- \[x\] /gm) || [];
  return { done: checked.length, total: all.length };
}
```

**Step 4: Export `countTasks` in the exports block at the bottom of the file**

Add `countTasks` to the export block (around line 2646):

```typescript
export {
  // ... existing exports ...
  countTasks,
  activeStreamWatchers,
  STREAM_POLL_INTERVAL,
  STREAM_SILENCE_THRESHOLD,
  STREAM_STATUS_INTERVAL,
  HERMES_DECOMPOSE_TIMEOUT,
};
```

**Step 5: Update the test import to include `countTasks`**

At the top of the test's import from `./discord-commands.js`, add `countTasks` to the destructured imports.

**Step 6: Run test to verify it passes**

Run: `cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion && npx vitest run src/channels/discord-commands.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: All `countTasks` tests PASS

**Step 7: Commit**

```bash
cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion
git add src/channels/discord-commands.ts src/channels/discord-commands.test.ts
git commit -m "feat: add countTasks helper with tests"
```

---

### Task 3: Implement `startStreamWatcher()` and `stopStreamWatcher()`

**Files:**
- Modify: `src/channels/discord-commands.ts` (after the existing `stopWorkspaceWatcher()` at line ~1338)

**Step 1: Add `startStreamWatcher()` function**

Insert after `stopWorkspaceWatcher()` (line 1338):

```typescript
/**
 * Start a per-stream watcher that:
 * - Polls every 10 min for tasks.md / progress.md mtime changes
 * - Posts hourly status reports to control-room
 * - Detects silence (1 hour) and nudges the lead agent
 * - Re-triggers the agent when tasks.md updates and unchecked tasks remain
 * - Stops when all tasks are checked or agent posts "Work complete"
 */
function startStreamWatcher(
  client: Client,
  guild: { channels: { cache: { find: (fn: (c: any) => boolean) => any } } },
  projectSlug: string,
  streamType: string,
  channelId: string,
  categoryId: string,
): void {
  const watcherKey = `${projectSlug}:${streamType}`;
  if (activeStreamWatchers.has(watcherKey)) return;

  const now = Date.now();
  const def = WORKSTREAM_DEFS[streamType];
  if (!def) return;

  const leadAgent = def.agents[0]; // Atlas for backend, Apollo for frontend, etc.

  // Discord message listener — tracks activity from agents
  const listener = (msg: Message) => {
    if (msg.channelId !== channelId) return;
    if (!msg.author.bot) return; // Only track agent (bot) messages

    const watcher = activeStreamWatchers.get(watcherKey);
    if (!watcher || watcher.completed) return;

    watcher.lastActivityTime = Date.now();

    // Completion detection: agent says "Work complete"
    if (msg.content.toLowerCase().includes('work complete')) {
      completeStreamWatcher(client, guild, watcherKey);
    }
  };

  client.on('messageCreate', listener);

  const interval = setInterval(async () => {
    const watcher = activeStreamWatchers.get(watcherKey);
    if (!watcher || watcher.completed) return;

    try {
      const wsDir = path.resolve(
        process.cwd(), 'groups', 'shared_project', 'active',
        projectSlug, 'workstreams', streamType,
      );
      const tasksPath = path.join(wsDir, 'tasks.md');
      const progressPath = path.join(wsDir, 'progress.md');

      // 1. Check file mtime changes
      let tasksUpdated = false;
      try {
        const tasksStat = fs.statSync(tasksPath);
        if (tasksStat.mtimeMs > watcher.lastTasksMtime) {
          watcher.lastTasksMtime = tasksStat.mtimeMs;
          watcher.lastActivityTime = Date.now();
          tasksUpdated = true;
        }
      } catch { /* file may not exist yet */ }

      try {
        const progressStat = fs.statSync(progressPath);
        if (progressStat.mtimeMs > watcher.lastActivityTime) {
          watcher.lastActivityTime = Date.now();
        }
      } catch { /* file may not exist yet */ }

      // 2. Read tasks.md for status
      let tasksContent = '';
      try {
        tasksContent = fs.readFileSync(tasksPath, 'utf8');
      } catch { /* file may not exist */ }

      const { done, total } = countTasks(tasksContent);

      // 3. Completion detection — all tasks checked
      if (total > 0 && done === total) {
        completeStreamWatcher(client, guild, watcherKey);
        return;
      }

      const currentTime = Date.now();

      // 4. Hourly status report to control-room
      if (currentTime - watcher.lastStatusReport >= STREAM_STATUS_INTERVAL) {
        watcher.lastStatusReport = currentTime;
        const controlRoom = guild.channels.cache.find(
          (c: any) => c.name === 'control-room' && c.parentId === categoryId,
        ) as TextChannel | undefined;
        if (controlRoom) {
          const statusEmbed = new EmbedBuilder()
            .setColor(AGENT_COLORS[leadAgent] || 0x5865f2)
            .setTitle(`⚙️ ws-${streamType}: ${done}/${total} tasks done`)
            .setDescription(
              `**Lead:** ${leadAgent}\n` +
              `**Last activity:** ${new Date(watcher.lastActivityTime).toLocaleTimeString()}`,
            )
            .setTimestamp();
          await controlRoom.send({ embeds: [statusEmbed] });
        }
      }

      // 5. Silence detection — 1 hour no activity
      if (currentTime - watcher.lastActivityTime >= STREAM_SILENCE_THRESHOLD) {
        const wsChannel = guild.channels.cache.find(
          (c: any) => c.id === channelId,
        ) as TextChannel | undefined;
        if (wsChannel) {
          await wsChannel.send(
            `⏰ @${leadAgent} — no activity detected for 1 hour. Are you blocked?`,
          );
        }
        const controlRoom = guild.channels.cache.find(
          (c: any) => c.name === 'control-room' && c.parentId === categoryId,
        ) as TextChannel | undefined;
        if (controlRoom) {
          await controlRoom.send(
            `⚠️ **ws-${streamType}**: no activity for 1 hour. May need attention.`,
          );
        }
        // Reset to avoid spamming every 10 minutes
        watcher.lastActivityTime = currentTime;
      }

      // 6. Re-trigger agent if tasks.md was updated and unchecked tasks remain
      if (tasksUpdated && total > 0 && done < total) {
        const wsChannel = guild.channels.cache.find(
          (c: any) => c.id === channelId,
        ) as TextChannel | undefined;
        if (wsChannel) {
          await wsChannel.send(
            `@${leadAgent} — continue with the next unchecked task in tasks.md`,
          );
        }
      }
    } catch (err: any) {
      logger.error({ err: err.message, watcherKey }, 'Stream watcher error');
    }
  }, STREAM_POLL_INTERVAL);

  activeStreamWatchers.set(watcherKey, {
    interval,
    listener,
    projectSlug,
    streamType,
    channelId,
    categoryId,
    lastActivityTime: now,
    lastStatusReport: now,
    lastTasksMtime: 0,
    completed: false,
  });

  logger.info({ projectSlug, streamType }, 'Stream watcher started');
}

/**
 * Complete a stream watcher — posts completion to control-room and cleans up.
 */
function completeStreamWatcher(
  client: Client,
  guild: { channels: { cache: { find: (fn: (c: any) => boolean) => any } } },
  watcherKey: string,
): void {
  const watcher = activeStreamWatchers.get(watcherKey);
  if (!watcher || watcher.completed) return;

  watcher.completed = true;

  // Read final task count
  const wsDir = path.resolve(
    process.cwd(), 'groups', 'shared_project', 'active',
    watcher.projectSlug, 'workstreams', watcher.streamType,
  );
  let done = 0;
  let total = 0;
  try {
    const tasksContent = fs.readFileSync(path.join(wsDir, 'tasks.md'), 'utf8');
    const counts = countTasks(tasksContent);
    done = counts.done;
    total = counts.total;
  } catch { /* ignore */ }

  // Post completion to control-room
  const controlRoom = guild.channels.cache.find(
    (c: any) => c.name === 'control-room' && c.parentId === watcher.categoryId,
  ) as TextChannel | undefined;
  if (controlRoom) {
    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle(`✅ ws-${watcher.streamType} complete: ${done}/${total} tasks done`)
      .setTimestamp();
    controlRoom.send({ embeds: [embed] }).catch(() => {});
  }

  // Clean up
  stopStreamWatcher(watcherKey);
}

/**
 * Stop a stream watcher by its key (projectSlug:streamType).
 */
function stopStreamWatcher(watcherKey: string, client?: Client): void {
  const watcher = activeStreamWatchers.get(watcherKey);
  if (!watcher) return;

  clearInterval(watcher.interval);
  if (client) {
    client.removeListener('messageCreate', watcher.listener);
  }
  activeStreamWatchers.delete(watcherKey);
  logger.info({ watcherKey }, 'Stream watcher stopped');
}
```

**Step 2: Run build to verify**

Run: `cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion && npm run build`
Expected: Compiles with no errors

**Step 3: Commit**

```bash
cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion
git add src/channels/discord-commands.ts
git commit -m "feat: add startStreamWatcher, completeStreamWatcher, stopStreamWatcher"
```

---

### Task 4: Write Tests for Stream Watcher

**Files:**
- Modify: `src/channels/discord-commands.test.ts`

**Step 1: Add stream watcher test block**

Add after the existing `WorkspaceWatcher` describe block (around line ~828):

```typescript
describe('StreamWatcher', () => {
  it('STREAM_POLL_INTERVAL is 600000', () => {
    const { STREAM_POLL_INTERVAL } = require('./discord-commands.js');
    expect(STREAM_POLL_INTERVAL).toBe(600_000);
  });

  it('STREAM_SILENCE_THRESHOLD is 3600000', () => {
    const { STREAM_SILENCE_THRESHOLD } = require('./discord-commands.js');
    expect(STREAM_SILENCE_THRESHOLD).toBe(3_600_000);
  });

  it('STREAM_STATUS_INTERVAL is 3600000', () => {
    const { STREAM_STATUS_INTERVAL } = require('./discord-commands.js');
    expect(STREAM_STATUS_INTERVAL).toBe(3_600_000);
  });

  it('HERMES_DECOMPOSE_TIMEOUT is 180000', () => {
    const { HERMES_DECOMPOSE_TIMEOUT } = require('./discord-commands.js');
    expect(HERMES_DECOMPOSE_TIMEOUT).toBe(300_000);
  });

  it('activeStreamWatchers is a Map', () => {
    const { activeStreamWatchers } = require('./discord-commands.js');
    expect(activeStreamWatchers).toBeInstanceOf(Map);
  });

  it('countTasks counts checked and total', () => {
    const { countTasks } = require('./discord-commands.js');
    const content = '- [x] A\n- [ ] B\n- [x] C\n- [ ] D\n';
    expect(countTasks(content)).toEqual({ done: 2, total: 4 });
  });

  it('countTasks handles no tasks', () => {
    const { countTasks } = require('./discord-commands.js');
    expect(countTasks('Just some text')).toEqual({ done: 0, total: 0 });
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion && npx vitest run src/channels/discord-commands.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: All new `StreamWatcher` tests PASS

**Step 3: Commit**

```bash
cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion
git add src/channels/discord-commands.test.ts
git commit -m "test: add stream watcher constant and countTasks tests"
```

---

### Task 5: Rewrite `cmdDecompose()` to Trigger Hermes and Start Watchers

**Files:**
- Modify: `src/channels/discord-commands.ts:1345-1554` (the `cmdDecompose()` function)

The current `cmdDecompose()` creates channels and tells agents to "Read your scope and begin work." The new version:
1. Finds the plan file (plan-v2.md from planning session, or approved/draft plan from project workspace)
2. @Hermes in control-room to parse the plan into per-stream tasks.md files
3. Polls for tasks.md existence (timeout: 3 minutes)
4. Creates channels with enhanced context referencing tasks.md
5. Starts `startStreamWatcher()` for each stream

**Step 1: Replace the `cmdDecompose()` function body**

Replace the entire function from line 1345 to line 1554 with:

```typescript
async function cmdDecompose(
  message: Message,
  _client: Client,
): Promise<void> {
  const args = message.content.split(' ').slice(1);
  const channel = message.channel as TextChannel;

  if (!message.guild) {
    await message.reply(
      '⚠️ This command can only be used in a server.',
    );
    return;
  }

  if (channel.name !== 'plan-room' && channel.name !== 'control-room') {
    await message.reply(
      '⚠️ `!decompose` must be used in #plan-room or #control-room.',
    );
    return;
  }

  // Determine which work streams to create
  let streamTypes = args.filter((a) => a in WORKSTREAM_DEFS);
  if (streamTypes.length === 0) {
    const projectSlugForPlan = findProjectSlugForChannel(channel);
    if (projectSlugForPlan) {
      streamTypes = parsePlanForStreams(projectSlugForPlan);
    }
    if (streamTypes.length === 0) {
      streamTypes = ['backend', 'frontend', 'qa'];
    }
    await channel.send(
      `🔍 Detected streams: ${streamTypes.join(', ')}\n` +
      `Available: ${Object.keys(WORKSTREAM_DEFS).join(', ')}`,
    );
  }

  const projectSlug = findProjectSlugForChannel(channel);
  if (!projectSlug) {
    await message.reply(
      '⚠️ Could not determine project context. Run this in a project channel.',
    );
    return;
  }

  try {
    await message.guild.channels.fetch();

    // --- Step 1: Find the plan file ---
    let planContent = '';
    const planSources = [
      // Planning session's shared folder
      ...Array.from(planningSessions.entries())
        .filter(([, s]) => s.topic)
        .map(([, s]) => {
          const slug = `plan-${slugify(s.topic)}`;
          return path.resolve(process.cwd(), 'groups', 'shared_project', slug, 'plan-v2.md');
        }),
      // Project workspace
      path.resolve(process.cwd(), 'groups', 'shared_project', 'active', projectSlug, 'control', 'approved-plan.md'),
      path.resolve(process.cwd(), 'groups', 'shared_project', 'active', projectSlug, 'control', 'draft-plan.md'),
    ];

    for (const planPath of planSources) {
      try {
        if (fs.existsSync(planPath)) {
          planContent = fs.readFileSync(planPath, 'utf8');
          if (planContent.trim()) {
            await channel.send(`📄 Found plan: \`${path.basename(planPath)}\``);
            break;
          }
        }
      } catch { /* skip */ }
    }

    // --- Step 2: Create workspace folders first ---
    for (const streamType of streamTypes) {
      const def = WORKSTREAM_DEFS[streamType];
      if (!def) continue;
      initWorkstreamFolder(projectSlug, streamType, def.agents, [`${streamType} deliverables (TBD)`]);
    }

    // --- Step 3: Trigger Hermes to parse plan into per-stream tasks ---
    if (planContent.trim()) {
      await channel.send(
        `🔧 Triggering Hermes to parse the plan into per-stream task lists...`,
      );

      // Write plan content to a temp location Hermes can read
      const controlDir = path.resolve(
        process.cwd(), 'groups', 'shared_project', 'active', projectSlug, 'control',
      );
      fs.writeFileSync(path.join(controlDir, 'plan-for-decompose.md'), planContent, 'utf8');

      // Write a decompose instruction file for Hermes
      const decomposeInstruction =
        `# Decompose Instructions\n\n` +
        `Read the plan in \`control/plan-for-decompose.md\` and extract tasks for each work stream.\n\n` +
        `## Streams to decompose:\n${streamTypes.map((s) => `- ${s}`).join('\n')}\n\n` +
        `## Output:\nFor each stream, write a file at \`workstreams/<stream>/tasks.md\` with this format:\n\n` +
        '```markdown\n' +
        '# <Stream> Tasks\n\n' +
        `Extracted from plan on ${new Date().toISOString().split('T')[0]}\n\n` +
        '- [ ] First task\n' +
        '- [ ] Second task\n' +
        '```\n\n' +
        `Also update \`workstreams/<stream>/scope.md\` with a real description from the plan.\n\n` +
        `**IMPORTANT:** Write files for ALL streams listed above. Work from \`/workspace/shared/active/${projectSlug}/\`.`;

      fs.writeFileSync(path.join(controlDir, 'decompose-instructions.md'), decomposeInstruction, 'utf8');

      // @Hermes in the current channel to trigger the container
      await channel.send(
        `@Hermes — Read \`active/${projectSlug}/control/decompose-instructions.md\` and ` +
        `\`active/${projectSlug}/control/plan-for-decompose.md\`. ` +
        `Extract tasks for each work stream and write tasks.md + scope.md files. ` +
        `Work from \`/workspace/shared/active/${projectSlug}/\`.`,
      );

      // Poll for tasks.md in each stream folder (timeout: 5 minutes)
      const pollStart = Date.now();
      const pendingStreams = new Set(streamTypes);
      let timedOut = false;

      while (pendingStreams.size > 0 && !timedOut) {
        if (Date.now() - pollStart > HERMES_DECOMPOSE_TIMEOUT) {
          timedOut = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10_000)); // Check every 10 seconds

        for (const st of [...pendingStreams]) {
          const tasksPath = path.resolve(
            process.cwd(), 'groups', 'shared_project', 'active',
            projectSlug, 'workstreams', st, 'tasks.md',
          );
          if (fs.existsSync(tasksPath)) {
            const content = fs.readFileSync(tasksPath, 'utf8');
            if (content.includes('- [ ]') || content.includes('- [x]')) {
              pendingStreams.delete(st);
              await channel.send(`✅ tasks.md ready for \`${st}\``);
            }
          }
        }
      }

      if (timedOut && pendingStreams.size > 0) {
        await channel.send(
          `⚠️ Hermes did not write tasks.md for: ${[...pendingStreams].join(', ')}. ` +
          `Proceeding with generic scope for those streams.`,
        );
      }
    } else {
      await channel.send(
        `ℹ️ No plan file found. Creating streams with generic scope. ` +
        `Agents will need to read their scope and define tasks themselves.`,
      );
    }

    // --- Step 4: Create Discord channels ---
    const createdChannels: string[] = [];

    for (const streamType of streamTypes) {
      const def = WORKSTREAM_DEFS[streamType];
      if (!def) continue;

      const existing = message.guild.channels.cache.find(
        (c) => c.name === def.channel && c.parentId === channel.parentId,
      );
      if (existing) {
        await channel.send(`  ⏩ #${def.channel} already exists, skipping`);
        continue;
      }

      const wsChan = await message.guild!.channels.create({
        name: def.channel,
        type: ChannelType.GuildText,
        parent: channel.parentId!,
        topic: `${def.emoji} ${def.topic}\n\n**Workspace**: \`active/${projectSlug}/workstreams/${streamType}/\``,
      });

      // Check if tasks.md exists for this stream
      const tasksPath = path.resolve(
        process.cwd(), 'groups', 'shared_project', 'active',
        projectSlug, 'workstreams', streamType, 'tasks.md',
      );
      const hasTasks = fs.existsSync(tasksPath);

      // Welcome embed with workspace info
      const wsEmbed = new EmbedBuilder()
        .setColor(AGENT_COLORS[def.agents[0]] || 0x5865f2)
        .setTitle(`${def.emoji} ${streamType.toUpperCase()} Work Stream`)
        .setDescription(
          `${def.topic}\n\n` +
          (hasTasks
            ? 'Tasks have been extracted from the plan. Work through them one at a time.'
            : 'Read your scope and define your own task list.'),
        )
        .addFields(
          {
            name: '📂 Workspace',
            value:
              `\`/workspace/shared/active/${projectSlug}/workstreams/${streamType}/\`\n\n` +
              (hasTasks ? '• `tasks.md` — Checklist of tasks from the plan\n' : '') +
              '• `scope.md` — Deliverables and boundaries\n' +
              '• `progress.md` — Status updates (agent-maintained)\n' +
              '• `handoffs.md` — Cross-team integration points',
          },
          {
            name: '🤖 Assigned Agents',
            value: def.agents.join(', '),
            inline: true,
          },
          {
            name: '📋 Workflow',
            value: hasTasks
              ? '1. Read `tasks.md` — pick first unchecked task\n' +
                '2. Implement it\n' +
                '3. Mark `- [x]` in tasks.md, update progress.md\n' +
                '4. Post summary, then Iris re-triggers for next task'
              : '`!handoff from to "desc"` — Create handoff\n' +
                '`!stream_status` — Show progress\n' +
                '`!blocker "issue"` — Escalate',
            inline: true,
          },
        )
        .setTimestamp();

      await wsChan.send({ embeds: [wsEmbed] });

      // Trigger lead agent with task-aware instructions
      if (hasTasks) {
        await wsChan.send(
          `@${def.agents[0]} — Read \`workstreams/${streamType}/tasks.md\` and begin with the first unchecked task. ` +
          `After completing it, mark it \`- [x]\` in tasks.md, update progress.md, and post a summary here. ` +
          `Work from \`/workspace/shared/active/${projectSlug}/workstreams/${streamType}/\`.`,
        );
      } else {
        await wsChan.send(
          `@${def.agents[0]} — Read your scope at \`workstreams/${streamType}/scope.md\` and begin work. ` +
          'Update `progress.md` as you go.',
        );
      }

      createdChannels.push(def.channel);

      // Track in project state
      const project = activeProjects.get(projectSlug);
      if (project) {
        project.workStreams.set(streamType, def);
      }

      // --- Step 5: Start stream watcher ---
      startStreamWatcher(
        _client, message.guild, projectSlug, streamType,
        wsChan.id, channel.parentId!,
      );
    }

    // Write decomposition file
    const decompPath = path.resolve(
      process.cwd(), 'groups', 'shared_project', 'active',
      projectSlug, 'control', 'decomposition.md',
    );
    const decompContent =
      `# Plan Decomposition\n\n` +
      `*Generated: ${new Date().toISOString()}*\n\n` +
      `## Work Streams\n\n` +
      streamTypes
        .map((st) => {
          const def = WORKSTREAM_DEFS[st];
          return (
            `### ${st}\n` +
            `- **Channel**: #${def.channel}\n` +
            `- **Agents**: ${def.agents.join(', ')}\n` +
            `- **Scope**: See \`workstreams/${st}/scope.md\`\n` +
            `- **Tasks**: See \`workstreams/${st}/tasks.md\`\n`
          );
        })
        .join('\n');

    try {
      fs.writeFileSync(decompPath, decompContent, 'utf8');
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to write decomposition');
    }

    // Summary embed
    const summaryEmbed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('🔧 Work Streams Created')
      .setDescription(
        `Decomposed plan into ${createdChannels.length} work streams.\n` +
        `Each agent works through \`workstreams/*/tasks.md\` one task at a time.\n` +
        `Iris monitors each stream for progress, silence, and completion.`,
      )
      .addFields(
        {
          name: 'Channels',
          value: createdChannels.map((c) => `#${c}`).join('\n') || 'None new',
          inline: true,
        },
        {
          name: 'Workspace',
          value: `\`active/${projectSlug}/\``,
          inline: true,
        },
      )
      .setTimestamp();

    await channel.send({ embeds: [summaryEmbed] });

    // Cross-post to control-room
    const controlRoom = message.guild!.channels.cache.find(
      (c) => c.name === 'control-room' && c.parentId === channel.parentId,
    ) as TextChannel | undefined;
    if (controlRoom && controlRoom.id !== channel.id) {
      await controlRoom.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🔧 Plan Decomposed')
            .setDescription(
              `Work streams created: ${createdChannels.map((c) => `#${c}`).join(', ')}\n` +
              'Agents have been triggered with task lists. Iris is monitoring each stream.',
            )
            .setTimestamp(),
        ],
      });
    }
  } catch (err: any) {
    await message.reply(`❌ Error decomposing plan: ${err.message}`);
  }
}
```

**Step 2: Run build to verify**

Run: `cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion && npm run build`
Expected: Compiles with no errors

**Step 3: Run tests to verify no regressions**

Run: `cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion && npx vitest run src/channels/discord-commands.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: All tests pass (existing decompose tests check validation paths which still work the same)

**Step 4: Commit**

```bash
cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion
git add src/channels/discord-commands.ts
git commit -m "feat: rewrite cmdDecompose to trigger Hermes for task extraction and start stream watchers"
```

---

### Task 6: Wire Stream Watcher Cleanup into Existing Cleanup Paths

**Files:**
- Modify: `src/channels/discord-commands.ts`

The stream watchers need to be stopped when:
1. `!close_discussion` is used on a `ws-*` channel
2. `!cleanup_server` runs

**Step 1: Update `cmdCleanupServer()` to stop stream watchers**

In `cmdCleanupServer()`, around line 772 where it already calls `stopWorkspaceWatcher`, add after that loop:

```typescript
    // Also stop all stream watchers
    for (const key of activeStreamWatchers.keys()) {
      stopStreamWatcher(key, _client);
    }
```

**Step 2: Update `cmdCloseDiscussion()` to handle ws-* channels**

In `cmdCloseDiscussion()`, update the channel name check to also accept `ws-*` channels. Currently (line 2549):

```typescript
if (!channel.name.startsWith('discuss-') && !channel.name.startsWith('plan-') || channel.name === 'plan-room') {
```

Change to:

```typescript
if (
  !channel.name.startsWith('discuss-') &&
  !channel.name.startsWith('plan-') &&
  !channel.name.startsWith('ws-') ||
  channel.name === 'plan-room'
) {
```

Also add stream watcher cleanup before channel deletion. After the existing discussion cleanup (around line 2573), add:

```typescript
    // Clean up stream watcher if this is a ws-* channel
    if (channel.name.startsWith('ws-')) {
      for (const [key, watcher] of activeStreamWatchers.entries()) {
        if (watcher.channelId === channel.id) {
          stopStreamWatcher(key, client);
          break;
        }
      }
    }
```

**Step 3: Run build and tests**

Run: `cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion && npm run build && npx vitest run src/channels/discord-commands.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: Build succeeds, all tests pass

**Step 4: Commit**

```bash
cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion
git add src/channels/discord-commands.ts
git commit -m "feat: wire stream watcher cleanup into close_discussion and cleanup_server"
```

---

### Task 7: Update Exports

**Files:**
- Modify: `src/channels/discord-commands.ts` (exports block at end of file)

**Step 1: Add new exports to the export block**

Add these to the existing export block:

```typescript
  countTasks,
  activeStreamWatchers,
  startStreamWatcher,
  stopStreamWatcher,
  STREAM_POLL_INTERVAL,
  STREAM_SILENCE_THRESHOLD,
  STREAM_STATUS_INTERVAL,
  HERMES_DECOMPOSE_TIMEOUT,
```

**Step 2: Run build**

Run: `cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion && npm run build`
Expected: Compiles

**Step 3: Commit**

```bash
cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion
git add src/channels/discord-commands.ts
git commit -m "feat: export stream watcher functions and constants"
```

---

### Task 8: Create the `discord-workstream` Container Skill

**Files:**
- Create: `container/skills/discord-workstream/SKILL.md`

**Step 1: Create the skill directory and file**

```bash
mkdir -p /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion/container/skills/discord-workstream
```

**Step 2: Write the SKILL.md**

Create `container/skills/discord-workstream/SKILL.md`:

```markdown
---
name: discord-workstream
description: Protocol for work stream agents (Atlas, Apollo) in ws-* channels. Work through tasks.md one at a time, mark done, update progress, commit, post summary.
---

# Discord Work Stream Protocol

When you are triggered in a `ws-*` Discord channel, follow this protocol. Your identity (name, role, preferred tool) comes from your CLAUDE.md.

## Overview

You work through a structured task list in `tasks.md`, implementing one task per trigger. After completing a task, you mark it done, update progress, commit, and post a summary. Then your container exits. Iris will re-trigger you for the next task.

## Workspace

Your files are at `/workspace/shared/active/<project>/workstreams/<stream>/`:

- `tasks.md` — Checklist of tasks from the plan. **This is your work queue.**
- `scope.md` — Deliverables and boundaries for this stream
- `progress.md` — Running log of what you've done (you maintain this)
- `handoffs.md` — Cross-team integration points

The `<project>` and `<stream>` values come from the channel topic or the @mention that triggered you.

## Workflow

### 1. Read Your Tasks

```bash
cat /workspace/shared/active/<project>/workstreams/<stream>/tasks.md
```

Find the first unchecked task (`- [ ]`).

### 2. Implement the Task

Use your preferred tool to implement the task. Write code, tests, configs — whatever the task requires.

### 3. Mark the Task Done

Edit `tasks.md` and change the task from `- [ ]` to `- [x]`:

```bash
# Example: mark the first unchecked task as done
sed -i '0,/- \[ \]/{s/- \[ \]/- [x]/}' /workspace/shared/active/<project>/workstreams/<stream>/tasks.md
```

### 4. Update Progress

Append to `progress.md` with what you did:

```markdown
## [Task Name] — Completed [date]

- What was implemented
- Files created/modified
- Tests added
- Any notes or issues
```

### 5. Commit

```bash
cd /workspace/shared/active/<project>/workstreams/<stream>/
git add -A
git commit --author="YourName <yourname@nanoclaw>" -m "Complete: [task description]"
```

Replace `YourName` and `yourname` with your actual name (e.g., Atlas, Apollo).

### 6. Post Summary in Discord

Post a brief summary of what you did:

```
✅ **Completed:** [task name]
- [key changes]
- [files modified]
- Tasks: X/Y done
```

If this was the **last task** (all items are `- [x]`), also post:

```
🎉 **Work complete** — all tasks in tasks.md are done.
```

### 7. Exit

Your container exits after posting the summary. Iris's stream watcher detects the update and re-triggers you if tasks remain.

## Important Rules

- **One task per trigger** — complete exactly one task, then exit
- **Always update tasks.md AND progress.md** — both files must reflect your work
- **Always commit after completing a task** — Iris monitors file changes
- **Say "Work complete"** when all tasks are done — this stops the watcher
- **Don't skip tasks** — work through them in order unless blocked
- **If blocked** — post the blocker in the channel, update progress.md with what's blocking you, and exit. Iris will alert the control room.

## Git Conventions

```bash
cd /workspace/shared/active/<project>/workstreams/<stream>/
git add -A
git commit --author="YourName <yourname@nanoclaw>" -m "Complete: [task summary]"
```
```

**Step 3: Verify the file exists**

Run: `ls -la /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion/container/skills/discord-workstream/SKILL.md`
Expected: File exists

**Step 4: Commit**

```bash
cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion
git add container/skills/discord-workstream/SKILL.md
git commit -m "feat: add discord-workstream container skill for work stream agents"
```

---

### Task 9: Update `agents/config.json` — Add `ws-*` to Atlas and Apollo

**Files:**
- Modify: `agents/config.json`

**Step 1: Add `ws-*` to Atlas channelNames**

Current (line 36): `"channelNames": ["backend-dev"]`
Change to: `"channelNames": ["backend-dev", "ws-*"]`

**Step 2: Add `ws-*` to Apollo channelNames**

Current (line 49): `"channelNames": ["frontend-ui"]`
Change to: `"channelNames": ["frontend-ui", "ws-*"]`

**Step 3: Also add `ws-*` to Hermes channelNames (for decompose trigger)**

Current (line 22): `"channelNames": ["plan-room", "plan-*", "discuss-*"]`
Change to: `"channelNames": ["plan-room", "plan-*", "discuss-*", "control-room"]`

Note: Hermes is triggered in `control-room` or `plan-room` by `cmdDecompose()`, and Hermes already has `plan-room` in its channels. But if `!decompose` runs from `control-room`, Hermes needs `control-room` too. (Alternatively, the @mention in control-room might suffice since agent-runner checks channel names.)

**Step 4: Verify JSON is valid**

Run: `cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion && node -e "JSON.parse(require('fs').readFileSync('agents/config.json','utf8')); console.log('Valid JSON')"`
Expected: `Valid JSON`

**Step 5: Commit**

```bash
cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion
git add agents/config.json
git commit -m "feat: add ws-* to Atlas/Apollo channels, control-room to Hermes"
```

---

### Task 10: Update Agent CLAUDE.md Files

**Files:**
- Modify: `groups/dc_atlas/CLAUDE.md`
- Modify: `groups/dc_apollo/CLAUDE.md`

**Step 1: Update Atlas CLAUDE.md**

Add a section after "## Workspaces" → "### Conventions":

```markdown
### Work Stream Protocol

When triggered in a `ws-*` channel, follow the `discord-workstream` skill:
1. Read `tasks.md` for your task list
2. Implement the first unchecked task
3. Mark it `- [x]` in tasks.md, update progress.md
4. Commit and post a summary
5. Say "Work complete" when all tasks are done
```

**Step 2: Update Apollo CLAUDE.md**

Add the same section after "### Conventions":

```markdown
### Work Stream Protocol

When triggered in a `ws-*` channel, follow the `discord-workstream` skill:
1. Read `tasks.md` for your task list
2. Implement the first unchecked task
3. Mark it `- [x]` in tasks.md, update progress.md
4. Commit and post a summary
5. Say "Work complete" when all tasks are done
```

**Step 3: Commit**

```bash
cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion
git add groups/dc_atlas/CLAUDE.md groups/dc_apollo/CLAUDE.md
git commit -m "docs: add work stream protocol reference to Atlas and Apollo CLAUDE.md"
```

---

### Task 11: Final Verification

**Step 1: Full build**

Run: `cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion && npm run build`
Expected: Compiles with no errors

**Step 2: Full test suite**

Run: `cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion && npx vitest run src/channels/discord-commands.test.ts --reporter=verbose 2>&1 | tail -40`
Expected: All tests pass (including new stream watcher tests)

**Step 3: Container build**

Run: `cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion && ./container/build.sh`
Expected: Container builds successfully, includes new `discord-workstream` skill

**Step 4: Review all changes**

Run: `cd /home/pseudo/nanoclaw/.worktrees/unify-plan-discussion && git log --oneline feature/unify-plan-discussion --not main`
Expected: See all commits from both Phase 1 (unified plan/discussion) and Phase 2 (stream monitoring)

---

## File Summary

| File | Action | Task |
|------|--------|------|
| `src/channels/discord-commands.ts` | Modify | Tasks 1-3, 5-7 |
| `src/channels/discord-commands.test.ts` | Modify | Tasks 2, 4 |
| `container/skills/discord-workstream/SKILL.md` | **Create** | Task 8 |
| `agents/config.json` | Modify | Task 9 |
| `groups/dc_atlas/CLAUDE.md` | Modify | Task 10 |
| `groups/dc_apollo/CLAUDE.md` | Modify | Task 10 |

## Verification Checklist

- [ ] `npm run build` passes
- [ ] `npm test` — discord-commands tests pass
- [ ] `./container/build.sh` — container rebuilds with new skill
- [ ] New constants: STREAM_POLL_INTERVAL, STREAM_SILENCE_THRESHOLD, STREAM_STATUS_INTERVAL, HERMES_DECOMPOSE_TIMEOUT
- [ ] `countTasks()` helper works correctly
- [ ] `startStreamWatcher()` / `stopStreamWatcher()` implemented
- [ ] `cmdDecompose()` triggers Hermes, polls for tasks.md, starts watchers
- [ ] `cmdCleanupServer()` stops stream watchers
- [ ] `cmdCloseDiscussion()` handles ws-* channels
- [ ] `discord-workstream` SKILL.md exists
- [ ] Atlas and Apollo config includes `ws-*`
- [ ] Atlas and Apollo CLAUDE.md reference work stream protocol
