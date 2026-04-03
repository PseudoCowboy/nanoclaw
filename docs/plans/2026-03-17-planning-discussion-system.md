# Planning Discussion System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add multi-agent planning debates (Athena/Hermes/Prometheus) to the Discord bot with `!plan`, `!create_discussion`, and updated `!create_project`.

**Architecture:** Iris (bot.js) gains planning moderation logic — it orchestrates 3-round discussions by mentioning each agent bot in turn and waiting for their responses. Two new agent bot files (hermes-bot.js, prometheus-bot.js) follow the existing athena-bot.js pattern. Discussion channels live under an auto-created DISCUSSIONS category.

**Tech Stack:** Node.js, discord.js v14, existing CLI tool wrappers (codex/claude/gemini)

**Base path for all file references:** `groups/telegram_main/discord-bot/`

---

### Task 1: Update agent-config.json with Hermes and Prometheus

**Files:**
- Modify: `agents/config/agent-config.json`

**Step 1: Add Hermes and Prometheus to agent config**

Open `agents/config/agent-config.json` and add two new entries to the `agents` object. Also update Athena's `channelNames` to include `plan-room`:

```json
{
  "global": {
    "maxContextMessages": 100,
    "toolTimeout": 120000,
    "workDir": "/workspace/group"
  },
  "agents": {
    "athena": {
      "name": "Athena",
      "role": "Plan Designer",
      "tool": "codex",
      "channelNames": ["control-room", "plan-room"],
      "color": "#9B59B6",
      "emoji": "🟣"
    },
    "hermes": {
      "name": "Hermes",
      "role": "Planning Collaborator",
      "tool": "claude",
      "channelNames": ["plan-room"],
      "color": "#2ECC71",
      "emoji": "🟢"
    },
    "prometheus": {
      "name": "Prometheus",
      "role": "Planning Collaborator",
      "tool": "gemini",
      "channelNames": ["plan-room"],
      "color": "#F1C40F",
      "emoji": "🟡"
    },
    "atlas": {
      "name": "Atlas",
      "role": "Backend Engineer",
      "tool": "claude",
      "channelNames": ["backend-dev"],
      "color": "#E74C3C",
      "emoji": "🔴"
    },
    "apollo": {
      "name": "Apollo",
      "role": "Frontend Engineer",
      "tool": "gemini",
      "channelNames": ["frontend-ui"],
      "color": "#3498DB",
      "emoji": "🔵"
    },
    "argus": {
      "name": "Argus",
      "role": "Monitor",
      "tool": "claude",
      "channelNames": ["qa-alerts", "control-room", "backend-dev", "frontend-ui"],
      "color": "#F39C12",
      "emoji": "🟠"
    }
  }
}
```

**Step 2: Commit**

```bash
cd groups/telegram_main/discord-bot
git add agents/config/agent-config.json
git commit -m "feat: add Hermes and Prometheus to agent config"
```

---

### Task 2: Update agent-utils.js with new agent colors and emojis

**Files:**
- Modify: `agents/shared/agent-utils.js`

**Step 1: Add Hermes and Prometheus to AGENT_COLORS (line 17-22)**

Replace the `AGENT_COLORS` object:

```javascript
const AGENT_COLORS = {
  Athena:     0x9B59B6, // Purple
  Hermes:     0x2ECC71, // Green
  Prometheus: 0xF1C40F, // Yellow
  Atlas:      0xE74C3C, // Red
  Apollo:     0x3498DB, // Blue
  Argus:      0xF39C12, // Orange
};
```

**Step 2: Add Hermes and Prometheus to getAgentEmoji (line 105-113)**

Replace the `emojis` object inside `getAgentEmoji`:

```javascript
function getAgentEmoji(agentName) {
  const emojis = {
    Athena:     '🟣',
    Hermes:     '🟢',
    Prometheus: '🟡',
    Atlas:      '🔴',
    Apollo:     '🔵',
    Argus:      '🟠',
  };
  return emojis[agentName] || '🤖';
}
```

**Step 3: Commit**

```bash
git add agents/shared/agent-utils.js
git commit -m "feat: add Hermes and Prometheus colors and emojis"
```

---

### Task 3: Update channel-manager.js to handle discuss-* channels

**Files:**
- Modify: `agents/shared/channel-manager.js`

The planning agents need to respond in both `plan-room` AND any `discuss-*` channel. Update `shouldHandle` to support wildcard matching.

**Step 1: Update shouldHandle to support prefix matching**

Replace lines 26-44 in `channel-manager.js`:

```javascript
  shouldHandle(channel) {
    // Only handle text channels inside categories
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.PublicThread) {
      return false;
    }

    // For threads, check the parent channel's name and category
    const targetChannel = channel.type === ChannelType.PublicThread
      ? channel.parent
      : channel;

    if (!targetChannel) return false;

    // Must be under a category
    if (!targetChannel.parent || targetChannel.parent.type !== ChannelType.GuildCategory) {
      return false;
    }

    const channelName = targetChannel.name.toLowerCase();

    return this.allowedChannelNames.some(allowed => {
      // Support wildcard prefix matching: "discuss-*" matches "discuss-api-design"
      if (allowed.endsWith('*')) {
        return channelName.startsWith(allowed.slice(0, -1));
      }
      return channelName === allowed;
    });
  }
```

**Step 2: Commit**

```bash
git add agents/shared/channel-manager.js
git commit -m "feat: add wildcard prefix matching to channel manager"
```

---

### Task 4: Create hermes-bot.js

**Files:**
- Create: `agents/hermes-bot.js`

**Step 1: Create hermes-bot.js**

Copy the pattern from `athena-bot.js` but configure for Hermes (Claude tool, plan-room + discuss-* channels):

```javascript
/**
 * Hermes Bot — Planning Collaborator Agent
 *
 * Tool: Claude
 * Primary channels: plan-room, discuss-* (under any category)
 * Responsibilities: Free debate on plans, strategy, architecture
 *
 * Single instance, category-aware: listens to all matching channels
 * but isolates context per parent category.
 */

const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { ChannelManager } = require('./shared/channel-manager');
const { ToolWrapper } = require('./shared/tool-wrapper');
const {
  buildContextString,
  extractFeatureIds,
  createAgentEmbed,
  sendLongReply,
  logActivity,
} = require('./shared/agent-utils');

// --- Configuration ---
const AGENT_NAME = 'Hermes';
const AGENT_TOOL = 'claude';
const CHANNEL_NAMES = (process.env.HERMES_CHANNEL_NAMES || 'plan-room,discuss-*').split(',');
const DISCORD_TOKEN = process.env.HERMES_DISCORD_TOKEN;

if (!DISCORD_TOKEN) {
  console.error(`[${AGENT_NAME}] Missing HERMES_DISCORD_TOKEN environment variable`);
  process.exit(1);
}

// --- Initialize ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const channelManager = new ChannelManager(CHANNEL_NAMES);
const toolWrapper = new ToolWrapper({ agentName: AGENT_NAME });

// Track in-flight requests to avoid double processing
const processing = new Set();

// --- System prompt for Hermes's role ---
const SYSTEM_PROMPT = `You are Hermes, a Planning Collaborator agent in an Agent Orchestration system.

You participate in multi-agent planning debates alongside Athena (Codex) and Prometheus (Gemini). Your role is to bring your own perspective to the discussion — challenge ideas, suggest alternatives, identify risks, and build on others' proposals.

Guidelines:
- Read the full discussion context before responding
- Build on or constructively challenge what other agents said
- Be specific and concrete — no vague agreements
- If you disagree, explain why with reasoning
- Suggest alternatives when you see issues
- Focus on actionable insights, not just commentary
- Keep responses focused and concise (under 500 words)

You use Claude as your underlying tool, which gives you strong reasoning and analysis capabilities.`;

// --- Message handler ---
client.on('messageCreate', async (message) => {
  // Ignore own messages
  if (message.author.id === client.user.id) return;

  // Check if this channel is one Hermes should handle
  if (!channelManager.shouldHandle(message.channel)) return;

  // Only respond when mentioned by name or @mentioned (Iris moderator will @mention)
  const isMentioned = message.mentions.has(client.user);
  const isNamedDirectly = /\bhermes\b/i.test(message.content);

  if (!isMentioned && !isNamedDirectly) return;

  // Deduplicate
  if (processing.has(message.id)) return;
  processing.add(message.id);

  const scope = channelManager.getScope(message.channel);
  logActivity(AGENT_NAME, scope, 'message_received', {
    author: message.author.username,
    content: message.content.slice(0, 200),
  });

  try {
    // Show typing indicator
    await message.channel.sendTyping();

    // Build context from recent messages (bounded by MAX_CONTEXT_MESSAGES)
    const context = await buildContextString(message.channel, scope);

    // Extract feature IDs
    const featureIds = extractFeatureIds(message.content);
    const featureContext = featureIds.length > 0
      ? `\nRelevant feature IDs: ${featureIds.join(', ')}`
      : '';

    // Clean the mention from the message
    const userPrompt = message.content
      .replace(/<@!?\d+>/g, '')
      .replace(/\bhermes\b/gi, '')
      .trim();

    if (!userPrompt) {
      await message.reply(
        createAgentEmbed(AGENT_NAME, 'Ready to Discuss', 'Mention me to participate in a planning discussion.')
      );
      return;
    }

    // Build the full prompt
    const fullPrompt = [
      SYSTEM_PROMPT,
      `\n--- Project Context ---`,
      `Project: ${scope.projectContext}`,
      `Channel: #${message.channel.name}`,
      featureContext,
      `\n--- Recent Discussion ---`,
      context,
      `\n--- Your Turn ---`,
      `From ${message.author.username}: ${userPrompt}`,
    ].join('\n');

    // Execute tool
    logActivity(AGENT_NAME, scope, 'tool_execute', { tool: AGENT_TOOL, promptLength: fullPrompt.length });
    const response = await toolWrapper.execute(AGENT_TOOL, fullPrompt, scope.projectContext);

    // Send response
    if (response.length > 1900) {
      const embed = createAgentEmbed(AGENT_NAME, `Discussion: ${featureIds[0] || 'Topic'}`, `Response for **${scope.projectContext}**`, [
        { name: 'Channel', value: `#${message.channel.name}`, inline: true },
        { name: 'Tool', value: 'Claude', inline: true },
      ]);
      await message.reply({ embeds: [embed] });
      await sendLongReply(message, response);
    } else {
      await message.reply(response);
    }

    logActivity(AGENT_NAME, scope, 'response_sent', { responseLength: response.length });

  } catch (error) {
    console.error(`[${AGENT_NAME}] Error:`, error);
    logActivity(AGENT_NAME, scope, 'error', { error: error.message });
    await message.reply(`❌ ${AGENT_NAME} encountered an error: ${error.message}`).catch(() => {});
  } finally {
    processing.delete(message.id);
  }
});

// --- Ready ---
client.once('ready', () => {
  console.log(`🟢 ${AGENT_NAME} Bot online as ${client.user.tag}`);
  console.log(`   Channels: ${CHANNEL_NAMES.join(', ')}`);
  console.log(`   Tool: ${AGENT_TOOL}`);
  client.user.setActivity('Debating plans', { type: 3 }); // WATCHING
});

client.on('error', (err) => console.error(`[${AGENT_NAME}] Discord error:`, err));

client.login(DISCORD_TOKEN);
```

**Step 2: Commit**

```bash
git add agents/hermes-bot.js
git commit -m "feat: add Hermes bot (Claude planning collaborator)"
```

---

### Task 5: Create prometheus-bot.js

**Files:**
- Create: `agents/prometheus-bot.js`

**Step 1: Create prometheus-bot.js**

Same pattern as hermes-bot.js but with Gemini tool:

```javascript
/**
 * Prometheus Bot — Planning Collaborator Agent
 *
 * Tool: Gemini
 * Primary channels: plan-room, discuss-* (under any category)
 * Responsibilities: Free debate on plans, strategy, innovation
 *
 * Single instance, category-aware: listens to all matching channels
 * but isolates context per parent category.
 */

const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { ChannelManager } = require('./shared/channel-manager');
const { ToolWrapper } = require('./shared/tool-wrapper');
const {
  buildContextString,
  extractFeatureIds,
  createAgentEmbed,
  sendLongReply,
  logActivity,
} = require('./shared/agent-utils');

// --- Configuration ---
const AGENT_NAME = 'Prometheus';
const AGENT_TOOL = 'gemini';
const CHANNEL_NAMES = (process.env.PROMETHEUS_CHANNEL_NAMES || 'plan-room,discuss-*').split(',');
const DISCORD_TOKEN = process.env.PROMETHEUS_DISCORD_TOKEN;

if (!DISCORD_TOKEN) {
  console.error(`[${AGENT_NAME}] Missing PROMETHEUS_DISCORD_TOKEN environment variable`);
  process.exit(1);
}

// --- Initialize ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const channelManager = new ChannelManager(CHANNEL_NAMES);
const toolWrapper = new ToolWrapper({ agentName: AGENT_NAME });

// Track in-flight requests to avoid double processing
const processing = new Set();

// --- System prompt for Prometheus's role ---
const SYSTEM_PROMPT = `You are Prometheus, a Planning Collaborator agent in an Agent Orchestration system.

You participate in multi-agent planning debates alongside Athena (Codex) and Hermes (Claude). Your role is to bring fresh perspectives, creative alternatives, and practical insights to the discussion.

Guidelines:
- Read the full discussion context before responding
- Build on or constructively challenge what other agents said
- Be specific and concrete — no vague agreements
- If you disagree, explain why with reasoning
- Suggest alternatives when you see issues
- Think about scalability, user experience, and innovation
- Keep responses focused and concise (under 500 words)

You use Gemini as your underlying tool, which gives you broad knowledge and creative thinking capabilities.`;

// --- Message handler ---
client.on('messageCreate', async (message) => {
  // Ignore own messages
  if (message.author.id === client.user.id) return;

  // Check if this channel is one Prometheus should handle
  if (!channelManager.shouldHandle(message.channel)) return;

  // Only respond when mentioned by name or @mentioned (Iris moderator will @mention)
  const isMentioned = message.mentions.has(client.user);
  const isNamedDirectly = /\bprometheus\b/i.test(message.content);

  if (!isMentioned && !isNamedDirectly) return;

  // Deduplicate
  if (processing.has(message.id)) return;
  processing.add(message.id);

  const scope = channelManager.getScope(message.channel);
  logActivity(AGENT_NAME, scope, 'message_received', {
    author: message.author.username,
    content: message.content.slice(0, 200),
  });

  try {
    // Show typing indicator
    await message.channel.sendTyping();

    // Build context from recent messages (bounded by MAX_CONTEXT_MESSAGES)
    const context = await buildContextString(message.channel, scope);

    // Extract feature IDs
    const featureIds = extractFeatureIds(message.content);
    const featureContext = featureIds.length > 0
      ? `\nRelevant feature IDs: ${featureIds.join(', ')}`
      : '';

    // Clean the mention from the message
    const userPrompt = message.content
      .replace(/<@!?\d+>/g, '')
      .replace(/\bprometheus\b/gi, '')
      .trim();

    if (!userPrompt) {
      await message.reply(
        createAgentEmbed(AGENT_NAME, 'Ready to Discuss', 'Mention me to participate in a planning discussion.')
      );
      return;
    }

    // Build the full prompt
    const fullPrompt = [
      SYSTEM_PROMPT,
      `\n--- Project Context ---`,
      `Project: ${scope.projectContext}`,
      `Channel: #${message.channel.name}`,
      featureContext,
      `\n--- Recent Discussion ---`,
      context,
      `\n--- Your Turn ---`,
      `From ${message.author.username}: ${userPrompt}`,
    ].join('\n');

    // Execute tool
    logActivity(AGENT_NAME, scope, 'tool_execute', { tool: AGENT_TOOL, promptLength: fullPrompt.length });
    const response = await toolWrapper.execute(AGENT_TOOL, fullPrompt, scope.projectContext);

    // Send response
    if (response.length > 1900) {
      const embed = createAgentEmbed(AGENT_NAME, `Discussion: ${featureIds[0] || 'Topic'}`, `Response for **${scope.projectContext}**`, [
        { name: 'Channel', value: `#${message.channel.name}`, inline: true },
        { name: 'Tool', value: 'Gemini', inline: true },
      ]);
      await message.reply({ embeds: [embed] });
      await sendLongReply(message, response);
    } else {
      await message.reply(response);
    }

    logActivity(AGENT_NAME, scope, 'response_sent', { responseLength: response.length });

  } catch (error) {
    console.error(`[${AGENT_NAME}] Error:`, error);
    logActivity(AGENT_NAME, scope, 'error', { error: error.message });
    await message.reply(`❌ ${AGENT_NAME} encountered an error: ${error.message}`).catch(() => {});
  } finally {
    processing.delete(message.id);
  }
});

// --- Ready ---
client.once('ready', () => {
  console.log(`🟡 ${AGENT_NAME} Bot online as ${client.user.tag}`);
  console.log(`   Channels: ${CHANNEL_NAMES.join(', ')}`);
  console.log(`   Tool: ${AGENT_TOOL}`);
  client.user.setActivity('Exploring ideas', { type: 3 }); // WATCHING
});

client.on('error', (err) => console.error(`[${AGENT_NAME}] Discord error:`, err));

client.login(DISCORD_TOKEN);
```

**Step 2: Commit**

```bash
git add agents/prometheus-bot.js
git commit -m "feat: add Prometheus bot (Gemini planning collaborator)"
```

---

### Task 6: Update Athena's channel config to include plan-room and discuss-*

**Files:**
- Modify: `agents/athena-bot.js` (line 26)

**Step 1: Update CHANNEL_NAMES default**

Change line 26 from:
```javascript
const CHANNEL_NAMES = (process.env.ATHENA_CHANNEL_NAMES || 'control-room').split(',');
```
to:
```javascript
const CHANNEL_NAMES = (process.env.ATHENA_CHANNEL_NAMES || 'control-room,plan-room,discuss-*').split(',');
```

**Step 2: Commit**

```bash
git add agents/athena-bot.js
git commit -m "feat: add plan-room and discuss-* to Athena's channels"
```

---

### Task 7: Update start-all-agents.sh and package.json

**Files:**
- Modify: `agents/start-all-agents.sh` (line 11-12)
- Modify: `agents/package.json`

**Step 1: Add Hermes and Prometheus to AGENTS arrays (lines 11-12)**

Replace:
```bash
AGENTS=("athena" "atlas" "apollo" "argus")
AGENT_FILES=("athena-bot.js" "atlas-bot.js" "apollo-bot.js" "argus-bot.js")
```
with:
```bash
AGENTS=("athena" "hermes" "prometheus" "atlas" "apollo" "argus")
AGENT_FILES=("athena-bot.js" "hermes-bot.js" "prometheus-bot.js" "atlas-bot.js" "apollo-bot.js" "argus-bot.js")
```

**Step 2: Update the .env warning (lines 26-30)**

Replace:
```bash
  echo "   Required variables:"
  echo "     ATHENA_DISCORD_TOKEN=..."
  echo "     ATLAS_DISCORD_TOKEN=..."
  echo "     APOLLO_DISCORD_TOKEN=..."
  echo "     ARGUS_DISCORD_TOKEN=..."
```
with:
```bash
  echo "   Required variables:"
  echo "     ATHENA_DISCORD_TOKEN=..."
  echo "     HERMES_DISCORD_TOKEN=..."
  echo "     PROMETHEUS_DISCORD_TOKEN=..."
  echo "     ATLAS_DISCORD_TOKEN=..."
  echo "     APOLLO_DISCORD_TOKEN=..."
  echo "     ARGUS_DISCORD_TOKEN=..."
```

**Step 3: Add npm scripts to package.json**

Add to `scripts`:
```json
{
  "scripts": {
    "start": "./start-all-agents.sh start",
    "stop": "./start-all-agents.sh stop",
    "restart": "./start-all-agents.sh restart",
    "status": "./start-all-agents.sh status",
    "athena": "node athena-bot.js",
    "hermes": "node hermes-bot.js",
    "prometheus": "node prometheus-bot.js",
    "atlas": "node atlas-bot.js",
    "apollo": "node apollo-bot.js",
    "argus": "node argus-bot.js"
  }
}
```

Update description:
```json
"description": "Category-aware agent bots for Discord Agent Orchestration (Athena, Hermes, Prometheus, Atlas, Apollo, Argus)"
```

**Step 4: Commit**

```bash
git add agents/start-all-agents.sh agents/package.json
git commit -m "feat: add Hermes and Prometheus to startup scripts"
```

---

### Task 8: Update bot.js — Remove setup_orchestration, setup_test_project, and related functions

**Files:**
- Modify: `bot.js`

**Step 1: Delete the `setup_orchestration` command handler (lines 103-126)**

Remove the entire `async setup_orchestration(message)` function from the `commands` object.

**Step 2: Delete the `setup_test_project` command handler (lines 460-483)**

Remove the entire `async setup_test_project(message)` function from the `commands` object.

**Step 3: Delete the `createOrchestrationStructure` function (lines 611-756)**

Remove the entire function.

**Step 4: Delete the `createTestProject` function (lines 835-910)**

Remove the entire function.

**Step 5: Delete the `requestAgentCredentials` function (lines 912-953)**

Remove the entire function.

**Step 6: Commit**

```bash
git add bot.js
git commit -m "refactor: remove setup_orchestration, setup_test_project, and related functions"
```

---

### Task 9: Update bot.js — Add #plan-room to createSingleProject

**Files:**
- Modify: `bot.js`

**Step 1: Add plan-room to the projectChannels array in createSingleProject**

Find the `projectChannels` array inside `createSingleProject` (around line 781) and add plan-room as the second entry:

```javascript
        const projectChannels = [
            { name: 'control-room', topic: '🎯 Human, Argus | Requests, approvals, status', emoji: '🎯' },
            { name: 'plan-room', topic: '🗣️ Athena, Hermes, Prometheus, Human | Planning debates', emoji: '💡' },
            { name: 'backend-dev', topic: '🔧 Atlas, Argus, Human | Backend implementation updates', emoji: '⚙️' },
            { name: 'frontend-ui', topic: '🎨 Apollo, Argus, Human | Frontend implementation updates', emoji: '🎨' },
            { name: 'qa-alerts', topic: '🚨 Argus, Human | Contract mismatches, critical issues', emoji: '🧪' },
            { name: 'release-log', topic: '📦 Human, Argus | Ready-for-test and shipped summaries', emoji: '🚀' }
        ];
```

**Step 2: Commit**

```bash
git add bot.js
git commit -m "feat: add #plan-room to project channel structure"
```

---

### Task 10: Update bot.js — Add cleanup_server support for DISCUSSIONS category

**Files:**
- Modify: `bot.js`

**Step 1: Add 'DISCUSSIONS' to categoriesToRemove in cleanupOrchestrationStructures**

Find the `categoriesToRemove` array (around line 561) and add `'DISCUSSIONS'`:

```javascript
        const categoriesToRemove = [
            'Project-Alpha', 'Project-Beta', 'Project-Gamma',
            'AGENT-COORDINATION', 'TEST-DEMO', 'DISCUSSIONS'
        ];
```

**Step 2: Make cleanup dynamic — find ALL categories, not just hardcoded names**

Replace the hardcoded list with a smarter approach. Replace the entire `cleanupOrchestrationStructures` function:

```javascript
async function cleanupOrchestrationStructures(guild, message) {
    try {
        await message.channel.send('🧹 **Starting cleanup process...**');
        await guild.channels.fetch();

        // Find categories that are orchestration-related:
        // - Known names (AGENT-COORDINATION, DISCUSSIONS)
        // - Any category that contains orchestration channels (control-room, plan-room, etc.)
        const orchestrationChannelNames = ['control-room', 'plan-room', 'backend-dev', 'frontend-ui', 'qa-alerts', 'release-log'];

        const allCategories = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory);
        const categoriesToRemove = new Set();

        // Always include known global categories
        for (const cat of allCategories.values()) {
            if (['AGENT-COORDINATION', 'DISCUSSIONS'].includes(cat.name)) {
                categoriesToRemove.add(cat.id);
            }
            // Check if category contains orchestration channels
            const children = guild.channels.cache.filter(c => c.parentId === cat.id);
            const hasOrchChannels = children.some(c => orchestrationChannelNames.includes(c.name));
            if (hasOrchChannels) {
                categoriesToRemove.add(cat.id);
            }
        }

        let removedCount = 0;

        for (const categoryId of categoriesToRemove) {
            const category = guild.channels.cache.get(categoryId);
            if (!category) continue;

            try {
                const channelsInCategory = guild.channels.cache.filter(c => c.parentId === category.id);
                for (const [, channel] of channelsInCategory) {
                    await channel.delete();
                    removedCount++;
                }
                const categoryName = category.name;
                await category.delete();
                removedCount++;
                await message.channel.send(`✅ Removed category: ${categoryName}`);
            } catch (error) {
                await message.channel.send(`⚠️ Could not remove category: ${error.message}`);
            }
        }

        const cleanupCompleteEmbed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Cleanup Complete!')
            .setDescription('All Agent Orchestration structures have been removed')
            .addFields(
                { name: 'Items Removed', value: `${removedCount} channels and categories`, inline: true },
                { name: 'Status', value: 'Server ready for fresh setup', inline: true }
            )
            .setTimestamp();

        await message.channel.send({ embeds: [cleanupCompleteEmbed] });

    } catch (error) {
        await message.channel.send(`❌ Cleanup error: ${error.message}`);
    }
}
```

**Step 3: Commit**

```bash
git add bot.js
git commit -m "feat: make cleanup_server dynamic, include DISCUSSIONS category"
```

---

### Task 11: Add !plan command to bot.js

**Files:**
- Modify: `bot.js`

This is the core planning moderation logic. Iris mentions each agent bot in turn and waits for their response.

**Step 1: Add planning session state tracking**

Add this near the top of `bot.js`, after the `GROUP_DIR` constant (line 20):

```javascript
// Planning session state: tracks active sessions per channel
// Key: channelId, Value: { featureId, topic, round, phase, timeout }
const planningSessions = new Map();
const PLANNING_ROUND_COUNT = 3;
const HUMAN_COMMENT_TIMEOUT = 60_000; // 60 seconds
const AGENT_RESPONSE_TIMEOUT = 180_000; // 3 minutes

// Planning agent order: Athena -> Hermes -> Prometheus
const PLANNING_AGENTS = ['Athena', 'Hermes', 'Prometheus'];

/**
 * Slugify a string for use as a Discord channel name.
 * Lowercase, spaces to hyphens, remove special chars, truncate to 90 chars.
 */
function slugify(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 90)
        .replace(/^-+|-+$/g, '');
}

/**
 * Wait for a specific bot to reply in a channel.
 * Returns the bot's message or null on timeout.
 */
function waitForAgentResponse(channel, agentName, timeout = AGENT_RESPONSE_TIMEOUT) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            client.removeListener('messageCreate', handler);
            resolve(null);
        }, timeout);

        function handler(msg) {
            // Check if the message is from a bot whose username contains the agent name
            if (msg.channelId === channel.id &&
                msg.author.bot &&
                msg.author.username.toLowerCase().includes(agentName.toLowerCase())) {
                clearTimeout(timer);
                client.removeListener('messageCreate', handler);
                resolve(msg);
            }
        }

        client.on('messageCreate', handler);
    });
}

/**
 * Wait for a human message in a channel (non-bot), or timeout.
 * !next and !skip immediately resolve with null (skip).
 */
function waitForHumanComment(channel, timeout = HUMAN_COMMENT_TIMEOUT) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            client.removeListener('messageCreate', handler);
            resolve(null);
        }, timeout);

        function handler(msg) {
            if (msg.channelId === channel.id && !msg.author.bot) {
                clearTimeout(timer);
                client.removeListener('messageCreate', handler);

                const content = msg.content.trim().toLowerCase();
                if (content === '!next' || content === '!skip') {
                    resolve(null); // skip
                } else {
                    resolve(msg);
                }
            }
        }

        client.on('messageCreate', handler);
    });
}

/**
 * Run a full planning session: 3 rounds of 3 agents with human comment windows.
 * @param {object} channel - Discord text channel
 * @param {string} topic - What to discuss
 * @param {string|null} featureId - FEAT-XXX or null for discussions
 */
async function runPlanningSession(channel, topic, featureId) {
    const sessionKey = channel.id;

    // Prevent overlapping sessions
    if (planningSessions.has(sessionKey)) {
        await channel.send('⚠️ A planning session is already running in this channel. Wait for it to finish.');
        return;
    }

    planningSessions.set(sessionKey, { topic, featureId, round: 0 });

    try {
        const label = featureId ? `${featureId}: ${topic}` : topic;

        const startEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`🗣️ Planning Session Started`)
            .setDescription(`**${label}**`)
            .addFields(
                { name: 'Rounds', value: `${PLANNING_ROUND_COUNT}`, inline: true },
                { name: 'Agents', value: PLANNING_AGENTS.join(', '), inline: true },
                { name: 'Comment Window', value: '60s between rounds', inline: true }
            )
            .setTimestamp();

        await channel.send({ embeds: [startEmbed] });

        for (let round = 1; round <= PLANNING_ROUND_COUNT; round++) {
            planningSessions.get(sessionKey).round = round;

            const roundLabels = ['Initial Proposals', 'Refinement', 'Convergence'];
            await channel.send(`\n**━━━ Round ${round}/${PLANNING_ROUND_COUNT} — ${roundLabels[round - 1]} ━━━**`);

            // Mention each agent in turn and wait for their response
            for (const agentName of PLANNING_AGENTS) {
                const turnPrompt = featureId
                    ? `@${agentName} your turn — Round ${round}, ${featureId}: ${topic}`
                    : `@${agentName} your turn — Round ${round}: ${topic}`;

                await channel.send(turnPrompt);

                // Wait for the agent bot to reply
                const agentResponse = await waitForAgentResponse(channel, agentName);

                if (!agentResponse) {
                    await channel.send(`⏰ ${agentName} did not respond within ${AGENT_RESPONSE_TIMEOUT / 1000}s. Continuing...`);
                }
            }

            // Human comment window (not after last round)
            if (round < PLANNING_ROUND_COUNT) {
                await channel.send(`💬 **Round ${round} complete.** Any comments? (${HUMAN_COMMENT_TIMEOUT / 1000}s window, or \`!next\` to skip)`);

                const humanComment = await waitForHumanComment(channel);
                if (humanComment) {
                    await channel.send(`📝 Comment noted. Proceeding to Round ${round + 1}...`);
                } else {
                    await channel.send(`⏩ Proceeding to Round ${round + 1}...`);
                }
            }
        }

        // Final summary
        const summaryEmbed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle(`📋 Planning Session Complete`)
            .setDescription(`**${label}**\n\n${PLANNING_ROUND_COUNT} rounds completed with ${PLANNING_AGENTS.join(', ')}.`)
            .addFields(
                { name: 'Next Steps', value: featureId
                    ? `Use \`!create_spec ${featureId}\` to formalize the plan, then \`!approve_spec ${featureId}\` to start implementation.`
                    : 'Review the discussion above. Start a new topic or `!close_discussion` when done.'
                }
            )
            .setTimestamp();

        await channel.send({ embeds: [summaryEmbed] });

        // If this was a feature plan, also post summary to control-room in the same category
        if (featureId && channel.parent) {
            const controlRoom = channel.guild.channels.cache.find(c =>
                c.name === 'control-room' && c.parentId === channel.parentId
            );
            if (controlRoom) {
                const crossPostEmbed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle(`📋 Planning Complete: ${featureId}`)
                    .setDescription(`Planning session for **${topic}** completed in ${channel.toString()}.\n\n${PLANNING_ROUND_COUNT} rounds with ${PLANNING_AGENTS.join(', ')}.`)
                    .addFields(
                        { name: 'Next Step', value: `\`!create_spec ${featureId}\` to formalize` }
                    )
                    .setTimestamp();

                await controlRoom.send({ embeds: [crossPostEmbed] });
            }
        }

    } catch (error) {
        await channel.send(`❌ Planning session error: ${error.message}`);
    } finally {
        planningSessions.delete(sessionKey);
    }
}
```

**Step 2: Add the `plan` command to the `commands` object**

Add inside the `commands` object:

```javascript
    async plan(message) {
        const args = message.content.split(' ').slice(1);
        const featureId = args[0];
        const description = args.slice(1).join(' ');

        if (!featureId) {
            await message.reply('Usage: `!plan FEAT-001 user dashboard with real-time updates`');
            return;
        }

        // Verify we're in a plan-room channel
        if (message.channel.name !== 'plan-room') {
            await message.reply('⚠️ `!plan` must be used in a `#plan-room` channel.');
            return;
        }

        await runPlanningSession(message.channel, description || featureId, featureId);
    },

    async next(message) {
        // Handled by waitForHumanComment — this is just to prevent "unknown command" errors
    },

    async skip(message) {
        // Handled by waitForHumanComment — this is just to prevent "unknown command" errors
    },
```

**Step 3: Commit**

```bash
git add bot.js
git commit -m "feat: add !plan command with 3-round moderated planning sessions"
```

---

### Task 12: Add !create_discussion and !close_discussion commands to bot.js

**Files:**
- Modify: `bot.js`

**Step 1: Add create_discussion command to the commands object**

```javascript
    async create_discussion(message) {
        // Extract topic from quotes or remaining args
        const raw = message.content.slice('!create_discussion'.length).trim();
        const topicMatch = raw.match(/^"(.+)"|^'(.+)'|^(.+)$/);
        const topic = (topicMatch[1] || topicMatch[2] || topicMatch[3] || '').trim();

        if (!topic) {
            await message.reply('Usage: `!create_discussion "API design patterns"`');
            return;
        }

        const guild = message.guild;
        const slug = slugify(topic);
        const channelName = `discuss-${slug}`;

        try {
            await guild.channels.fetch();

            // Find or create DISCUSSIONS category
            let discussCategory = guild.channels.cache.find(c =>
                c.name === 'DISCUSSIONS' && c.type === ChannelType.GuildCategory
            );

            if (!discussCategory) {
                discussCategory = await guild.channels.create({
                    name: 'DISCUSSIONS',
                    type: ChannelType.GuildCategory
                });
                await message.channel.send('📁 Created DISCUSSIONS category');
            }

            // Check for duplicate channel name
            const existing = guild.channels.cache.find(c =>
                c.name === channelName && c.parentId === discussCategory.id
            );

            if (existing) {
                await message.reply(`⚠️ Discussion channel ${existing.toString()} already exists!`);
                return;
            }

            // Create the discussion channel
            const discussChannel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: discussCategory.id,
                topic: `💡 Discussion: ${topic} | Athena, Hermes, Prometheus, Human`
            });

            // Send welcome message
            const welcomeEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle(`💡 Discussion: ${topic}`)
                .setDescription('Post your question or paste a plan to start a 3-round debate with the planning agents.')
                .addFields(
                    { name: '🤖 Agents', value: 'Athena (Codex), Hermes (Claude), Prometheus (Gemini)', inline: false },
                    { name: '💬 How it works', value: '1. Post your question or plan\n2. 3 rounds of agent discussion\n3. Summary at the end\n4. Ask more questions or `!close_discussion` when done', inline: false }
                )
                .setTimestamp();

            await discussChannel.send({ embeds: [welcomeEmbed] });

            // Set up a listener for the first human message in the channel to start a session
            const startListener = async (msg) => {
                if (msg.channelId !== discussChannel.id) return;
                if (msg.author.bot) return;
                if (msg.content.startsWith('!')) return; // Don't trigger on commands

                client.removeListener('messageCreate', startListener);
                await runPlanningSession(discussChannel, msg.content, null);
            };
            client.on('messageCreate', startListener);

            // Auto-remove listener after 30 minutes if no message
            setTimeout(() => {
                client.removeListener('messageCreate', startListener);
            }, 30 * 60 * 1000);

            await message.reply(`✅ Discussion channel created: ${discussChannel.toString()}`);

        } catch (error) {
            await message.reply(`❌ Error creating discussion: ${error.message}`);
        }
    },

    async close_discussion(message) {
        // Must be in a discuss-* channel
        if (!message.channel.name.startsWith('discuss-')) {
            await message.reply('⚠️ `!close_discussion` must be used inside a `#discuss-*` channel.');
            return;
        }

        // Check no active planning session
        if (planningSessions.has(message.channel.id)) {
            await message.reply('⚠️ A planning session is still running. Wait for it to finish first.');
            return;
        }

        try {
            const channelName = message.channel.name;
            await message.channel.send('🗑️ Closing discussion channel...');
            await new Promise(resolve => setTimeout(resolve, 2000)); // Brief pause so message is visible
            await message.channel.delete(`Discussion closed by ${message.author.username}`);
            console.log(`Discussion channel #${channelName} deleted by ${message.author.username}`);
        } catch (error) {
            await message.reply(`❌ Error closing discussion: ${error.message}`);
        }
    },
```

**Step 2: Commit**

```bash
git add bot.js
git commit -m "feat: add !create_discussion and !close_discussion commands"
```

---

### Task 13: Update bot.js — Update !help, !help_orchestration, and !agent_status

**Files:**
- Modify: `bot.js`

**Step 1: Replace the `help` command handler**

```javascript
    async help(message) {
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🤖 Iris Discord Commands')
            .setDescription('Available commands for your personal assistant & Agent Orchestrator')
            .addFields(
                { name: '💼 System Commands', value: '`!token_report` - Usage statistics\n`!backup` - Create migration backup\n`!status` - System health check', inline: false },
                { name: '🏗️ Setup & Management', value: '`!create_project ProjectName` - Create project structure\n`!cleanup_server` - Remove all structures', inline: false },
                { name: '💡 Planning & Discussion', value: '`!plan FEAT-001 description` - 3-round planning debate in #plan-room\n`!create_discussion "topic"` - Create temp discussion channel\n`!close_discussion` - Delete current discussion channel\n`!next` / `!skip` - Skip comment window', inline: false },
                { name: '📋 Feature Workflow', value: '`!create_feature FEAT-001 name` - New feature thread\n`!create_spec FEAT-001` - Create specification\n`!approve_spec FEAT-001` - Approve for implementation\n`!create_contract FEAT-001` - Create API contract', inline: false },
                { name: '📊 Progress & Monitoring', value: '`!report_progress FEAT-001 Agent "status"`\n`!escalate_blocker FEAT-001 "issue"`\n`!feature_status FEAT-001` - Check progress\n`!agent_status` - Show agent assignments', inline: false },
                { name: '🤖 Agent Management', value: '`!register_agent AgentName "credential"`\n`!help_orchestration` - Complete workflow guide', inline: false }
            )
            .setFooter({ text: 'Iris - Your Personal Assistant & Agent Orchestrator' })
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    },
```

**Step 2: Replace the `agent_status` command handler**

```javascript
    async agent_status(message) {
        const statusEmbed = new EmbedBuilder()
            .setColor(0xF39C12)
            .setTitle('🤖 Agent Status Dashboard')
            .setDescription('Current agent assignments and availability')
            .addFields(
                { name: '🟣 Athena (Plan Designer)', value: 'Available | Tools: codex\nChannels: control-room, plan-room, discuss-*', inline: false },
                { name: '🟢 Hermes (Planning Collaborator)', value: 'Available | Tools: claude\nChannels: plan-room, discuss-*', inline: false },
                { name: '🟡 Prometheus (Planning Collaborator)', value: 'Available | Tools: gemini\nChannels: plan-room, discuss-*', inline: false },
                { name: '🔴 Atlas (Backend Engineer)', value: 'Available | Tools: claude\nChannels: backend-dev', inline: false },
                { name: '🔵 Apollo (Frontend Engineer)', value: 'Available | Tools: gemini\nChannels: frontend-ui', inline: false },
                { name: '🟠 Argus (Monitor)', value: 'Available | Tools: claude\nChannels: qa-alerts, control-room, backend-dev, frontend-ui', inline: false }
            )
            .setTimestamp();

        await message.reply({ embeds: [statusEmbed] });
    },
```

**Step 3: Replace the `help_orchestration` command handler**

```javascript
    async help_orchestration(message) {
        const helpEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📋 Agent Orchestration Workflow')
            .setDescription('Complete guide to the Agent Orchestration system')
            .addFields(
                { name: '🎯 Core Workflow', value: '1. `!create_project` — set up project\n2. `!create_feature` — register feature\n3. `!plan` — 3-round planning debate\n4. `!create_spec` — formalize plan\n5. `!approve_spec` — start implementation\n6. Agents implement, Argus monitors\n7. Human signs off', inline: false },
                { name: '💡 Ad-hoc Discussions', value: '`!create_discussion "topic"` — debate without a feature\n`!close_discussion` — remove when done', inline: false },
                { name: '🤖 Planning Agents (3)', value: '• **Athena** (Codex): Plan design\n• **Hermes** (Claude): Strategy & analysis\n• **Prometheus** (Gemini): Innovation & alternatives', inline: false },
                { name: '🛠️ Implementation Agents (2)', value: '• **Atlas** (Claude): Backend engineering\n• **Apollo** (Gemini): Frontend engineering', inline: false },
                { name: '👁️ Monitor (1)', value: '• **Argus** (Claude): Validation & alerts', inline: false }
            )
            .setTimestamp();

        await message.reply({ embeds: [helpEmbed] });
    },
```

**Step 4: Commit**

```bash
git add bot.js
git commit -m "feat: update help, agent_status, and help_orchestration for new agents"
```

---

### Task 14: Manual testing checklist

This is not a code task — it's a verification checklist to run after all code changes.

**Step 1: Start Iris bot**

```bash
cd groups/telegram_main/discord-bot
node bot.js
```

Expected: `🤖 Iris Discord Bot is online!`

**Step 2: Test !create_project**

In Discord, type: `!create_project TestProject`

Expected: Category `TestProject` created with 6 channels (control-room, plan-room, backend-dev, frontend-ui, qa-alerts, release-log)

**Step 3: Test !help**

Type: `!help`

Expected: Updated help embed showing Planning & Discussion section with !plan, !create_discussion, !close_discussion

**Step 4: Test !agent_status**

Type: `!agent_status`

Expected: Shows all 6 agents including Hermes and Prometheus

**Step 5: Test !create_discussion**

Type: `!create_discussion "API design patterns"`

Expected: DISCUSSIONS category auto-created, #discuss-api-design-patterns channel created with welcome embed

**Step 6: Test !close_discussion**

In the discuss channel, type: `!close_discussion`

Expected: Channel deleted

**Step 7: Test !cleanup_server**

Type: `!cleanup_server`

Expected: TestProject and DISCUSSIONS categories removed

**Step 8: Start agent bots (requires tokens)**

```bash
cd agents
# Set tokens in .env first
./start-all-agents.sh start
./start-all-agents.sh status
```

Expected: All 6 bots show as running

**Step 9: Test !plan (requires agent bots running)**

In a project's #plan-room: `!plan FEAT-001 user authentication system`

Expected: 3 rounds, each agent responds when mentioned, human comment windows between rounds, summary at end

**Step 10: Commit verification results**

```bash
git add -A
git commit -m "docs: verify planning discussion system implementation"
```
