---
status: superseded
date: 2026-03-17
superseded_by: 2026-03-25-workstream-execution-monitoring-plan.md
---

# Discord Orchestration Commands Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring back 15 orchestration commands from the legacy Discord bot as a command handler module in the NanoClaw Discord channel.

**Architecture:** New `src/channels/discord-commands.ts` module handles `!` prefixed commands directly via Discord.js (instant response, no container). The Discord channel's `handleMessage()` checks for `!` prefix before @mention processing. Planning sessions use an in-process Map for state tracking with event listener-based turn-taking.

**Tech Stack:** TypeScript, discord.js v14, vitest

---

### Task 1: Create discord-commands.ts — types, constants, and command router

**Files:**
- Create: `src/channels/discord-commands.ts`

**Step 1: Create the command handler module with types, constants, slugify helper, and the main `handleCommand()` router**

```typescript
// src/channels/discord-commands.ts
import {
  Client,
  Message,
  EmbedBuilder,
  TextChannel,
  ChannelType,
} from 'discord.js';
import { execSync } from 'child_process';
import { logger } from '../logger.js';

// --- Types ---

interface PlanningSession {
  topic: string;
  featureId: string | null;
  round: number;
}

type CommandHandler = (message: Message, client: Client) => Promise<void>;

// --- Constants ---

const PLANNING_ROUND_COUNT = 3;
const HUMAN_COMMENT_TIMEOUT = 60_000;
const AGENT_RESPONSE_TIMEOUT = 180_000;
const PLANNING_AGENTS = ['Athena', 'Hermes', 'Prometheus'];

const planningSessions = new Map<string, PlanningSession>();

// --- Helpers ---

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 90)
    .replace(/^-+|-+$/g, '');
}

// Agent config for status display
const AGENTS = [
  { name: 'Athena', role: 'Plan Designer', tool: 'codex', color: '🟣' },
  { name: 'Hermes', role: 'Planning Collaborator', tool: 'claude', color: '🟢' },
  { name: 'Prometheus', role: 'Planning Collaborator', tool: 'gemini', color: '🟡' },
  { name: 'Atlas', role: 'Backend Engineer', tool: 'claude', color: '🔴' },
  { name: 'Apollo', role: 'Frontend Engineer', tool: 'gemini', color: '🔵' },
  { name: 'Argus', role: 'Monitor', tool: 'claude', color: '🟠' },
];

const AGENT_COLORS: Record<string, number> = {
  Athena: 0x9b59b6,
  Hermes: 0x2ecc71,
  Prometheus: 0xf1c40f,
  Atlas: 0xe74c3c,
  Apollo: 0x3498db,
  Argus: 0xf39c12,
};

// Project channel definitions
const PROJECT_CHANNELS = [
  { name: 'control-room', topic: '🎯 Human, Athena, Argus | Requests, planning, approvals', emoji: '🎯' },
  { name: 'plan-room', topic: '🗣️ Athena, Hermes, Prometheus, Human | Planning debates', emoji: '💡' },
  { name: 'backend-dev', topic: '🔧 Atlas, Argus, Human | Backend implementation updates', emoji: '⚙️' },
  { name: 'frontend-ui', topic: '🎨 Apollo, Argus, Human | Frontend implementation updates', emoji: '🎨' },
  { name: 'qa-alerts', topic: '🚨 Argus, Human | Contract mismatches, critical issues', emoji: '🧪' },
  { name: 'release-log', topic: '📦 Human, Argus | Ready-for-test and shipped summaries', emoji: '🚀' },
];

// --- Command Registry ---

const commands: Record<string, CommandHandler> = {
  help: cmdHelp,
  help_orchestration: cmdHelpOrchestration,
  agent_status: cmdAgentStatus,
  create_project: cmdCreateProject,
  cleanup_server: cmdCleanupServer,
  plan: cmdPlan,
  create_discussion: cmdCreateDiscussion,
  close_discussion: cmdCloseDiscussion,
  next: cmdNoop,
  skip: cmdNoop,
  create_feature: cmdCreateFeature,
  create_spec: cmdCreateSpec,
  approve_spec: cmdApproveSpec,
  create_contract: cmdCreateContract,
  report_progress: cmdReportProgress,
  escalate_blocker: cmdEscalateBlocker,
  feature_status: cmdFeatureStatus,
};

// --- Main Entry Point ---

/**
 * Handle a `!` prefixed command. Returns true if a command was matched, false otherwise.
 */
export async function handleCommand(
  message: Message,
  client: Client,
): Promise<boolean> {
  const content = message.content.trim();
  if (!content.startsWith('!')) return false;

  const args = content.slice(1).trim().split(/\s+/);
  const commandName = args[0]?.toLowerCase();

  if (!commandName || !commands[commandName]) return false;

  try {
    await commands[commandName](message, client);
  } catch (err) {
    logger.error({ err, command: commandName }, 'Discord command error');
    await message.reply('❌ An error occurred while executing that command.').catch(() => {});
  }
  return true;
}

/** Expose for testing */
export { planningSessions, slugify, PLANNING_AGENTS, PLANNING_ROUND_COUNT };
```

Place the command handler functions as stubs at the bottom (they'll be filled in subsequent tasks):

```typescript
// Stub handlers — implemented in subsequent tasks
async function cmdHelp(_message: Message, _client: Client): Promise<void> {}
async function cmdHelpOrchestration(_message: Message, _client: Client): Promise<void> {}
async function cmdAgentStatus(_message: Message, _client: Client): Promise<void> {}
async function cmdCreateProject(_message: Message, _client: Client): Promise<void> {}
async function cmdCleanupServer(_message: Message, _client: Client): Promise<void> {}
async function cmdPlan(_message: Message, _client: Client): Promise<void> {}
async function cmdCreateDiscussion(_message: Message, _client: Client): Promise<void> {}
async function cmdCloseDiscussion(_message: Message, _client: Client): Promise<void> {}
async function cmdNoop(_message: Message, _client: Client): Promise<void> {}
async function cmdCreateFeature(_message: Message, _client: Client): Promise<void> {}
async function cmdCreateSpec(_message: Message, _client: Client): Promise<void> {}
async function cmdApproveSpec(_message: Message, _client: Client): Promise<void> {}
async function cmdCreateContract(_message: Message, _client: Client): Promise<void> {}
async function cmdReportProgress(_message: Message, _client: Client): Promise<void> {}
async function cmdEscalateBlocker(_message: Message, _client: Client): Promise<void> {}
async function cmdFeatureStatus(_message: Message, _client: Client): Promise<void> {}
```

**Step 2: Wire it into discord.ts**

Modify `src/channels/discord.ts`:

1. Add import at line 16 (after `import { Channel } from '../types.js';`):
```typescript
import { handleCommand } from './discord-commands.js';
```

2. Add `GatewayIntentBits.ManageChannels` to the intents array at line 32-37 (for create_project/create_discussion):
```typescript
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.ManageChannels,
      ],
```

3. Add early command check in `handleMessage()` at line 73 (after `if (message.author.bot) return;`):
```typescript
    // Handle ! commands before normal message processing
    if (message.content.trim().startsWith('!') && this.client) {
      const handled = await handleCommand(message, this.client);
      if (handled) return;
    }
```

**Step 3: Build and verify no compile errors**

Run: `npm run build`
Expected: Clean compile, no errors

**Step 4: Commit**

```bash
git add src/channels/discord-commands.ts src/channels/discord.ts
git commit -m "feat(discord): add command handler scaffold with router and discord.ts wiring"
```

---

### Task 2: Implement help, help_orchestration, and agent_status commands

**Files:**
- Modify: `src/channels/discord-commands.ts` — replace the 3 stub functions

**Step 1: Replace `cmdHelp` stub**

```typescript
async function cmdHelp(message: Message, _client: Client): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🤖 Iris Discord Commands')
    .setDescription('Available commands for the Iris bot and Agent Orchestrator')
    .addFields(
      {
        name: '🏗️ Projects',
        value:
          '`!create_project Name` — Create project category with channels\n`!cleanup_server` — Remove all orchestration structures',
      },
      {
        name: '💡 Planning & Discussion',
        value:
          '`!plan FEAT-001 description` — 3-round planning debate (use in #plan-room)\n`!create_discussion "topic"` — Create temp discussion channel\n`!close_discussion` — Delete current discussion channel\n`!next` / `!skip` — Skip comment window during planning',
      },
      {
        name: '📋 Feature Workflow',
        value:
          '`!create_feature FEAT-001 name` — New feature thread\n`!create_spec FEAT-001` — Generate specification template\n`!approve_spec FEAT-001` — Approve spec, notify agents\n`!create_contract FEAT-001` — Generate API contract template',
      },
      {
        name: '📊 Monitoring',
        value:
          '`!agent_status` — Live status of agent bot processes\n`!feature_status FEAT-001` — Feature tracking info\n`!report_progress FEAT-001 Agent "status"` — Log progress\n`!escalate_blocker FEAT-001 "issue"` — Flag a blocker',
      },
      {
        name: '🤖 Info',
        value: '`!help_orchestration` — Full workflow guide',
      },
    )
    .setFooter({ text: 'Iris — NanoClaw Discord Bot' })
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}
```

**Step 2: Replace `cmdHelpOrchestration` stub**

```typescript
async function cmdHelpOrchestration(
  message: Message,
  _client: Client,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📋 Agent Orchestration Workflow')
    .setDescription('Complete guide to the Agent Orchestration system')
    .addFields(
      {
        name: '🎯 Core Workflow',
        value:
          '1. `!create_project` — set up project\n2. `!create_feature` — register feature\n3. `!plan` — 3-round planning debate\n4. `!create_spec` — formalize plan\n5. `!approve_spec` — start implementation\n6. Agents implement, Argus monitors\n7. Human signs off',
      },
      {
        name: '💡 Ad-hoc Discussions',
        value:
          '`!create_discussion "topic"` — debate without a feature\n`!close_discussion` — remove when done',
      },
      {
        name: '🤖 Planning Agents (3)',
        value:
          '• **Athena** (Codex): Plan design\n• **Hermes** (Claude): Strategy & analysis\n• **Prometheus** (Gemini): Innovation & alternatives',
      },
      {
        name: '🛠️ Implementation Agents (2)',
        value:
          '• **Atlas** (Claude): Backend engineering\n• **Apollo** (Gemini): Frontend engineering',
      },
      {
        name: '👁️ Monitor (1)',
        value: '• **Argus** (Claude): Validation & alerts',
      },
    )
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}
```

**Step 3: Replace `cmdAgentStatus` stub**

```typescript
async function cmdAgentStatus(
  message: Message,
  _client: Client,
): Promise<void> {
  const fields = [];
  let runningCount = 0;

  for (const agent of AGENTS) {
    let status = '❌ Offline';
    try {
      const result = execSync(
        `systemctl --user is-active nanoclaw-agents.service 2>/dev/null || echo inactive`,
        { encoding: 'utf8', timeout: 5000 },
      ).trim();
      if (result === 'active') {
        status = '✅ Running';
        runningCount++;
      }
    } catch {
      status = '❓ Unknown';
    }
    fields.push({
      name: `${agent.color} ${agent.name} (${agent.role})`,
      value: `${status} | Tool: ${agent.tool}`,
      inline: false,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(runningCount > 0 ? 0x27ae60 : 0xe74c3c)
    .setTitle('🤖 Agent Status Dashboard')
    .setDescription(`${runningCount}/${AGENTS.length} agents online`)
    .addFields(fields)
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}
```

**Step 4: Build**

Run: `npm run build`
Expected: Clean compile

**Step 5: Commit**

```bash
git add src/channels/discord-commands.ts
git commit -m "feat(discord): implement help, help_orchestration, agent_status commands"
```

---

### Task 3: Implement create_project and cleanup_server commands

**Files:**
- Modify: `src/channels/discord-commands.ts` — replace 2 stubs

**Step 1: Replace `cmdCreateProject` stub**

```typescript
async function cmdCreateProject(
  message: Message,
  _client: Client,
): Promise<void> {
  const args = message.content.split(' ').slice(1);
  const projectName = args[0];

  if (!projectName) {
    await message.reply(
      'Usage: `!create_project ProjectName`\nExample: `!create_project MyNewProject`',
    );
    return;
  }

  if (!message.guild) {
    await message.reply('⚠️ This command can only be used in a server.');
    return;
  }

  try {
    await message.guild.channels.fetch();
    const existing = message.guild.channels.cache.find(
      (c) =>
        c.name === projectName && c.type === ChannelType.GuildCategory,
    );
    if (existing) {
      await message.reply(`⚠️ Project ${projectName} already exists!`);
      return;
    }

    const category = await message.guild.channels.create({
      name: projectName,
      type: ChannelType.GuildCategory,
    });
    await message.channel.send(`✅ Category created: ${projectName}`);

    for (let i = 0; i < PROJECT_CHANNELS.length; i++) {
      const cfg = PROJECT_CHANNELS[i];
      try {
        const ch = await message.guild!.channels.create({
          name: cfg.name,
          type: ChannelType.GuildText,
          parent: category.id,
          topic: `${cfg.topic}\n\n**Project**: ${projectName}`,
        });

        const welcomeEmbed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(
            `${cfg.emoji} ${cfg.name.replace(/-/g, ' ').toUpperCase()}`,
          )
          .setDescription(`${cfg.topic}\n\n**Project**: ${projectName}`)
          .addFields({
            name: '📋 Thread Rules',
            value:
              '• Use format: `FEAT-XXX feature name`\n• One thread per feature\n• Follow Agent Orchestration workflow',
          })
          .setTimestamp();

        await ch.send({ embeds: [welcomeEmbed] });
        await message.channel.send(
          `  ✅ Created #${cfg.name} (${i + 1}/${PROJECT_CHANNELS.length})`,
        );
      } catch (err: any) {
        await message.channel.send(
          `  ⚠️ Could not create #${cfg.name}: ${err.message}`,
        );
      }
    }

    await message.channel.send(`🎉 **${projectName} setup complete!**`);
  } catch (err: any) {
    await message.reply(`❌ Error creating project: ${err.message}`);
  }
}
```

**Step 2: Replace `cmdCleanupServer` stub**

```typescript
async function cmdCleanupServer(
  message: Message,
  _client: Client,
): Promise<void> {
  if (!message.guild) {
    await message.reply('⚠️ This command can only be used in a server.');
    return;
  }

  try {
    await message.channel.send('🧹 **Starting cleanup process...**');
    await message.guild.channels.fetch();

    const orchestrationChannelNames = [
      'control-room',
      'plan-room',
      'backend-dev',
      'frontend-ui',
      'qa-alerts',
      'release-log',
    ];

    const allCategories = message.guild.channels.cache.filter(
      (c) => c.type === ChannelType.GuildCategory,
    );
    const categoriesToRemove = new Set<string>();

    for (const cat of allCategories.values()) {
      if (['AGENT-COORDINATION', 'DISCUSSIONS'].includes(cat.name)) {
        categoriesToRemove.add(cat.id);
      }
      const children = message.guild!.channels.cache.filter(
        (c) => c.parentId === cat.id,
      );
      const hasOrchChannels = children.some((c) =>
        orchestrationChannelNames.includes(c.name),
      );
      if (hasOrchChannels) {
        categoriesToRemove.add(cat.id);
      }
    }

    let removedCount = 0;

    for (const categoryId of categoriesToRemove) {
      const category = message.guild!.channels.cache.get(categoryId);
      if (!category) continue;

      try {
        const channelsInCategory = message.guild!.channels.cache.filter(
          (c) => c.parentId === category.id,
        );
        for (const [, channel] of channelsInCategory) {
          await channel.delete();
          removedCount++;
        }
        const categoryName = category.name;
        await category.delete();
        removedCount++;
        await message.channel.send(`✅ Removed category: ${categoryName}`);
      } catch (err: any) {
        await message.channel.send(
          `⚠️ Could not remove category: ${err.message}`,
        );
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('✅ Cleanup Complete!')
      .setDescription(
        'All Agent Orchestration structures have been removed',
      )
      .addFields(
        {
          name: 'Items Removed',
          value: `${removedCount} channels and categories`,
          inline: true,
        },
        {
          name: 'Status',
          value: 'Server ready for fresh setup',
          inline: true,
        },
      )
      .setTimestamp();

    await message.channel.send({ embeds: [embed] });
  } catch (err: any) {
    await message.reply(`❌ Cleanup error: ${err.message}`);
  }
}
```

**Step 3: Build**

Run: `npm run build`
Expected: Clean compile

**Step 4: Commit**

```bash
git add src/channels/discord-commands.ts
git commit -m "feat(discord): implement create_project and cleanup_server commands"
```

---

### Task 4: Implement feature workflow commands (6 commands)

**Files:**
- Modify: `src/channels/discord-commands.ts` — replace 6 stubs

**Step 1: Replace `cmdCreateFeature` stub**

```typescript
async function cmdCreateFeature(
  message: Message,
  _client: Client,
): Promise<void> {
  const args = message.content.split(' ').slice(1);
  const featureId = args[0];
  const featureName = args.slice(1).join(' ');

  if (!featureId || !featureName) {
    await message.reply(
      'Usage: `!create_feature FEAT-001 user authentication system`',
    );
    return;
  }

  try {
    const thread = await (message.channel as TextChannel).threads.create({
      name: `${featureId} ${featureName}`,
      type: ChannelType.PublicThread,
      reason: `Feature thread for ${featureId}`,
    });

    const embed = new EmbedBuilder()
      .setColor(0x00ae86)
      .setTitle(`🚀 Feature Created: ${featureId}`)
      .setDescription(`**${featureName}**`)
      .addFields(
        { name: 'Status', value: '📋 Specification Needed', inline: true },
        { name: 'Owner', value: '⏳ Unassigned', inline: true },
        { name: 'Priority', value: '🔸 Normal', inline: true },
      )
      .setFooter({ text: 'Use this thread for all feature discussions' })
      .setTimestamp();

    await thread.send({ embeds: [embed] });
    await message.reply(`✅ Feature thread created: ${thread.toString()}`);
  } catch (err: any) {
    await message.reply(`❌ Error creating feature: ${err.message}`);
  }
}
```

**Step 2: Replace `cmdCreateSpec` stub**

```typescript
async function cmdCreateSpec(
  message: Message,
  _client: Client,
): Promise<void> {
  const args = message.content.split(' ').slice(1);
  const featureId = args[0];

  if (!featureId || !featureId.startsWith('FEAT-')) {
    await message.reply(
      'Usage: `!create_spec FEAT-001`\nFeature ID must start with FEAT-',
    );
    return;
  }

  try {
    const specTemplate = `# Feature Specification: ${featureId}

## Goal
[Describe the high-level goal]

## User-facing Behavior
[Describe what the user will experience]

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Dependencies
- [ ] Dependency 1

## Assigned Role Owners
- **Athena (Plan Designer)**: @Athena
- **Atlas (Backend Engineer)**: TBD
- **Apollo (Frontend Engineer)**: TBD
- **Argus (Monitor)**: @Argus

## Risk Assessment
[Identify risks and unknowns]

---
*Created by Iris | Requires Human approval before implementation*`;

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(`📋 Specification Created: ${featureId}`)
      .setDescription(
        'Feature specification template ready for completion',
      )
      .addFields(
        { name: 'Status', value: '📝 Draft — Needs Athena input', inline: true },
        { name: 'Next Step', value: 'Athena to complete specification', inline: true },
      )
      .setFooter({ text: 'Assign to Athena to complete' })
      .setTimestamp();

    await message.reply({ embeds: [embed] });

    const thread = await (message.channel as TextChannel).threads.create({
      name: `${featureId} specification`,
      type: ChannelType.PublicThread,
    });
    await thread.send(
      `📋 **Specification Thread for ${featureId}**\n\`\`\`markdown\n${specTemplate}\n\`\`\``,
    );
  } catch (err: any) {
    await message.reply(`❌ Error creating spec: ${err.message}`);
  }
}
```

**Step 3: Replace `cmdApproveSpec` stub**

```typescript
async function cmdApproveSpec(
  message: Message,
  _client: Client,
): Promise<void> {
  const args = message.content.split(' ').slice(1);
  const featureId = args[0];

  if (!featureId) {
    await message.reply('Usage: `!approve_spec FEAT-001`');
    return;
  }

  try {
    const embed = new EmbedBuilder()
      .setColor(0x27ae60)
      .setTitle(`✅ Specification Approved: ${featureId}`)
      .setDescription(
        'Feature specification has been approved for implementation',
      )
      .addFields(
        {
          name: 'Status',
          value: '✅ Approved — Ready for implementation',
          inline: true,
        },
        {
          name: 'Next Steps',
          value:
            '• Atlas: Backend implementation\n• Apollo: Frontend implementation\n• Argus: Monitor progress',
          inline: false,
        },
      )
      .setFooter({ text: 'Human approval granted' })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
    await message.channel.send(
      `🚨 **Implementation Phase Started for ${featureId}**\n\n@Atlas @Apollo — Specification approved, begin implementation\n@Argus — Begin monitoring progress`,
    );
  } catch (err: any) {
    await message.reply(`❌ Error approving spec: ${err.message}`);
  }
}
```

**Step 4: Replace `cmdCreateContract` stub**

```typescript
async function cmdCreateContract(
  message: Message,
  _client: Client,
): Promise<void> {
  const args = message.content.split(' ').slice(1);
  const featureId = args[0];

  if (!featureId) {
    await message.reply('Usage: `!create_contract FEAT-001`');
    return;
  }

  try {
    const contractTemplate = `# API Contract: ${featureId}

## Endpoints

### POST /api/endpoint
- **Description**: [Endpoint purpose]
- **Request Body**:
\`\`\`json
{
  "field1": "string",
  "field2": "number"
}
\`\`\`

## Status
📝 Draft — Needs Atlas review`;

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle(`🔗 Contract Created: ${featureId}`)
      .setDescription(
        'API contract template ready for Atlas to complete',
      )
      .addFields(
        { name: 'Status', value: '📝 Draft — Atlas review needed', inline: true },
        { name: 'Blocking', value: 'Frontend implementation', inline: true },
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });
    await message.channel.send(
      `**Contract Template for ${featureId}:**\n\`\`\`yaml\n${contractTemplate}\n\`\`\``,
    );
  } catch (err: any) {
    await message.reply(`❌ Error creating contract: ${err.message}`);
  }
}
```

**Step 5: Replace `cmdReportProgress`, `cmdEscalateBlocker`, `cmdFeatureStatus` stubs**

```typescript
async function cmdReportProgress(
  message: Message,
  _client: Client,
): Promise<void> {
  const args = message.content.split(' ').slice(1);
  const featureId = args[0];
  const agent = args[1];
  const status = args.slice(2).join(' ').replace(/^"|"$/g, '');

  if (!featureId || !agent || !status) {
    await message.reply(
      'Usage: `!report_progress FEAT-001 Atlas "Backend API endpoints completed"`',
    );
    return;
  }

  try {
    const embed = new EmbedBuilder()
      .setColor(AGENT_COLORS[agent] || 0x95a5a6)
      .setTitle(`📈 Progress Report: ${featureId}`)
      .setDescription(`**${agent} Update**`)
      .addFields(
        { name: 'Status', value: status, inline: false },
        { name: 'Agent', value: agent, inline: true },
        { name: 'Feature', value: featureId, inline: true },
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });

    if (agent !== 'Argus') {
      await message.channel.send(
        `@Argus — Progress update for ${featureId} requires monitoring`,
      );
    }
  } catch (err: any) {
    await message.reply(`❌ Error reporting progress: ${err.message}`);
  }
}

async function cmdEscalateBlocker(
  message: Message,
  _client: Client,
): Promise<void> {
  const args = message.content.split(' ').slice(1);
  const featureId = args[0];
  const blocker = args.slice(1).join(' ').replace(/^"|"$/g, '');

  if (!featureId || !blocker) {
    await message.reply(
      'Usage: `!escalate_blocker FEAT-001 "Contract mismatch in user authentication endpoint"`',
    );
    return;
  }

  try {
    const embed = new EmbedBuilder()
      .setColor(0xe91e63)
      .setTitle(`🚨 BLOCKER ESCALATION: ${featureId}`)
      .setDescription('**URGENT: Human intervention required**')
      .addFields(
        { name: 'Blocker Details', value: blocker, inline: false },
        { name: 'Feature Affected', value: featureId, inline: true },
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });
    await message.channel.send(
      `🚨 **ESCALATION ALERT** 🚨\n\n@Human — Urgent blocker requires your decision on ${featureId}\n\n**Issue**: ${blocker}`,
    );
  } catch (err: any) {
    await message.reply(`❌ Error escalating blocker: ${err.message}`);
  }
}

async function cmdFeatureStatus(
  message: Message,
  _client: Client,
): Promise<void> {
  const args = message.content.split(' ').slice(1);
  const featureId = args[0];

  if (!featureId) {
    await message.reply('Usage: `!feature_status FEAT-001`');
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`📊 Feature Status: ${featureId}`)
    .setDescription(
      'Feature tracking is thread-based.\n\nTo track progress on this feature, use:\n• Discord threads (`!create_feature`)\n• Specification docs (`!create_spec`)\n• Progress reports (`!report_progress`)\n\nCheck the relevant thread or spec document for current status.',
    )
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}
```

**Step 6: Build**

Run: `npm run build`
Expected: Clean compile

**Step 7: Commit**

```bash
git add src/channels/discord-commands.ts
git commit -m "feat(discord): implement feature workflow commands (create_feature, create_spec, approve_spec, create_contract, report_progress, escalate_blocker, feature_status)"
```

---

### Task 5: Implement planning session engine (plan, create_discussion, close_discussion)

**Files:**
- Modify: `src/channels/discord-commands.ts` — replace 3 stubs, add helper functions

**Step 1: Add planning helper functions before the command functions**

```typescript
// --- Planning Helpers ---

function waitForAgentResponse(
  client: Client,
  channel: TextChannel,
  agentName: string,
  timeout = AGENT_RESPONSE_TIMEOUT,
): Promise<Message | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      client.removeListener('messageCreate', handler);
      resolve(null);
    }, timeout);

    function handler(msg: Message) {
      if (
        msg.channelId === channel.id &&
        msg.author.bot &&
        msg.author.username.toLowerCase().includes(agentName.toLowerCase())
      ) {
        clearTimeout(timer);
        client.removeListener('messageCreate', handler);
        resolve(msg);
      }
    }

    client.on('messageCreate', handler);
  });
}

function waitForHumanComment(
  client: Client,
  channel: TextChannel,
  timeout = HUMAN_COMMENT_TIMEOUT,
): Promise<Message | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      client.removeListener('messageCreate', handler);
      resolve(null);
    }, timeout);

    function handler(msg: Message) {
      if (msg.channelId === channel.id && !msg.author.bot) {
        const content = msg.content.trim().toLowerCase();
        if (content === '!next' || content === '!skip') {
          clearTimeout(timer);
          client.removeListener('messageCreate', handler);
          resolve(null);
        } else if (!content.startsWith('!')) {
          clearTimeout(timer);
          client.removeListener('messageCreate', handler);
          resolve(msg);
        }
      }
    }

    client.on('messageCreate', handler);
  });
}

async function runPlanningSession(
  client: Client,
  channel: TextChannel,
  topic: string,
  featureId: string | null,
): Promise<void> {
  const sessionKey = channel.id;

  if (planningSessions.has(sessionKey)) {
    await channel.send(
      '⚠️ A planning session is already running in this channel. Wait for it to finish.',
    );
    return;
  }

  planningSessions.set(sessionKey, { topic, featureId, round: 0 });

  try {
    const label = featureId ? `${featureId}: ${topic}` : topic;

    const startEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🗣️ Planning Session Started')
      .setDescription(`**${label}**`)
      .addFields(
        { name: 'Rounds', value: `${PLANNING_ROUND_COUNT}`, inline: true },
        {
          name: 'Agents',
          value: PLANNING_AGENTS.join(', '),
          inline: true,
        },
        {
          name: 'Comment Window',
          value: '60s between rounds',
          inline: true,
        },
      )
      .setTimestamp();

    await channel.send({ embeds: [startEmbed] });

    const roundLabels = ['Initial Proposals', 'Refinement', 'Convergence'];

    for (let round = 1; round <= PLANNING_ROUND_COUNT; round++) {
      const session = planningSessions.get(sessionKey);
      if (session) session.round = round;

      await channel.send(
        `\n**━━━ Round ${round}/${PLANNING_ROUND_COUNT} — ${roundLabels[round - 1]} ━━━**`,
      );

      for (const agentName of PLANNING_AGENTS) {
        const turnPrompt = featureId
          ? `@${agentName} your turn — Round ${round}, ${featureId}: ${topic}`
          : `@${agentName} your turn — Round ${round}: ${topic}`;

        await channel.send(turnPrompt);

        const agentResponse = await waitForAgentResponse(
          client,
          channel,
          agentName,
        );
        if (!agentResponse) {
          await channel.send(
            `⏰ ${agentName} did not respond within ${AGENT_RESPONSE_TIMEOUT / 1000}s. Continuing...`,
          );
        }
      }

      if (round < PLANNING_ROUND_COUNT) {
        await channel.send(
          `💬 **Round ${round} complete.** Any comments? (${HUMAN_COMMENT_TIMEOUT / 1000}s window, or \`!next\` to skip)`,
        );

        const humanComment = await waitForHumanComment(client, channel);
        if (humanComment) {
          await channel.send(
            `📝 Comment noted. Proceeding to Round ${round + 1}...`,
          );
        } else {
          await channel.send(`⏩ Proceeding to Round ${round + 1}...`);
        }
      }
    }

    const summaryEmbed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('📋 Planning Session Complete')
      .setDescription(
        `**${label}**\n\n${PLANNING_ROUND_COUNT} rounds completed with ${PLANNING_AGENTS.join(', ')}.`,
      )
      .addFields({
        name: 'Next Steps',
        value: featureId
          ? `Use \`!create_spec ${featureId}\` to formalize the plan, then \`!approve_spec ${featureId}\` to start implementation.`
          : 'Review the discussion above. Start a new topic or `!close_discussion` when done.',
      })
      .setTimestamp();

    await channel.send({ embeds: [summaryEmbed] });

    // Cross-post to control-room if in a project category
    if (featureId && channel.parent) {
      const controlRoom = channel.guild?.channels.cache.find(
        (c) =>
          c.name === 'control-room' && c.parentId === channel.parentId,
      ) as TextChannel | undefined;
      if (controlRoom) {
        const crossPostEmbed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`📋 Planning Complete: ${featureId}`)
          .setDescription(
            `Planning session for **${topic}** completed in ${channel.toString()}.`,
          )
          .addFields({
            name: 'Next Step',
            value: `\`!create_spec ${featureId}\` to formalize`,
          })
          .setTimestamp();
        await controlRoom.send({ embeds: [crossPostEmbed] });
      }
    }
  } catch (err: any) {
    await channel.send(`❌ Planning session error: ${err.message}`);
  } finally {
    planningSessions.delete(sessionKey);
  }
}
```

**Step 2: Replace `cmdPlan` stub**

```typescript
async function cmdPlan(message: Message, client: Client): Promise<void> {
  const args = message.content.split(' ').slice(1);
  const featureId = args[0];
  const description = args.slice(1).join(' ');

  if (!featureId) {
    await message.reply(
      'Usage: `!plan FEAT-001 user dashboard with real-time updates`',
    );
    return;
  }

  const channel = message.channel as TextChannel;
  if (channel.name !== 'plan-room') {
    await message.reply(
      '⚠️ `!plan` must be used in a `#plan-room` channel.',
    );
    return;
  }

  await runPlanningSession(
    client,
    channel,
    description || featureId,
    featureId,
  );
}
```

**Step 3: Replace `cmdCreateDiscussion` stub**

```typescript
async function cmdCreateDiscussion(
  message: Message,
  client: Client,
): Promise<void> {
  const raw = message.content
    .slice('!create_discussion'.length)
    .trim();
  const topicMatch = raw.match(/^"(.+?)"|^'(.+?)'|^(.+)$/);
  const topic = (
    (topicMatch && (topicMatch[1] || topicMatch[2] || topicMatch[3])) ||
    ''
  ).trim();

  if (!topic) {
    await message.reply(
      'Usage: `!create_discussion "API design patterns"`',
    );
    return;
  }

  if (!message.guild) {
    await message.reply('⚠️ This command can only be used in a server.');
    return;
  }

  const slug = slugify(topic);
  const channelName = `discuss-${slug}`;

  try {
    await message.guild.channels.fetch();

    let discussCategory = message.guild.channels.cache.find(
      (c) =>
        c.name === 'DISCUSSIONS' && c.type === ChannelType.GuildCategory,
    );

    if (!discussCategory) {
      discussCategory = await message.guild.channels.create({
        name: 'DISCUSSIONS',
        type: ChannelType.GuildCategory,
      });
      await message.channel.send('📁 Created DISCUSSIONS category');
    }

    const existing = message.guild.channels.cache.find(
      (c) =>
        c.name === channelName && c.parentId === discussCategory!.id,
    );

    if (existing) {
      await message.reply(
        `⚠️ Discussion channel ${existing.toString()} already exists!`,
      );
      return;
    }

    const discussChannel = (await message.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: discussCategory.id,
      topic: `💡 Discussion: ${topic} | Athena, Hermes, Prometheus, Human`,
    })) as TextChannel;

    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`💡 Discussion: ${topic}`)
      .setDescription(
        'Post your question or paste a plan to start a 3-round debate with the planning agents.',
      )
      .addFields(
        {
          name: '🤖 Agents',
          value:
            'Athena (Codex), Hermes (Claude), Prometheus (Gemini)',
        },
        {
          name: '💬 How it works',
          value:
            '1. Post your question or plan\n2. 3 rounds of agent discussion\n3. Summary at the end\n4. Ask more questions or `!close_discussion` when done',
        },
      )
      .setTimestamp();

    await discussChannel.send({ embeds: [welcomeEmbed] });

    // Auto-start planning on first human message
    const startListener = async (msg: Message) => {
      if (msg.channelId !== discussChannel.id) return;
      if (msg.author.bot) return;
      if (msg.content.startsWith('!')) return;

      client.removeListener('messageCreate', startListener);
      await runPlanningSession(client, discussChannel, msg.content, null);
    };
    client.on('messageCreate', startListener);

    // Self-cleanup after 30 minutes
    setTimeout(() => {
      client.removeListener('messageCreate', startListener);
    }, 30 * 60 * 1000);

    await message.reply(
      `✅ Discussion channel created: ${discussChannel.toString()}`,
    );
  } catch (err: any) {
    await message.reply(`❌ Error creating discussion: ${err.message}`);
  }
}
```

**Step 4: Replace `cmdCloseDiscussion` stub**

```typescript
async function cmdCloseDiscussion(
  message: Message,
  _client: Client,
): Promise<void> {
  const channel = message.channel as TextChannel;
  if (!channel.name.startsWith('discuss-')) {
    await message.reply(
      '⚠️ `!close_discussion` must be used inside a `#discuss-*` channel.',
    );
    return;
  }

  if (planningSessions.has(channel.id)) {
    await message.reply(
      '⚠️ A planning session is still running. Wait for it to finish first.',
    );
    return;
  }

  try {
    await channel.send('🗑️ Closing discussion channel...');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await channel.delete(
      `Discussion closed by ${message.author.username}`,
    );
  } catch (err: any) {
    await message.reply(`❌ Error closing discussion: ${err.message}`);
  }
}
```

**Step 5: Build**

Run: `npm run build`
Expected: Clean compile

**Step 6: Commit**

```bash
git add src/channels/discord-commands.ts
git commit -m "feat(discord): implement planning session engine (plan, create_discussion, close_discussion)"
```

---

### Task 6: Write tests for discord-commands

**Files:**
- Create: `src/channels/discord-commands.test.ts`

**Step 1: Write tests**

```typescript
// src/channels/discord-commands.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before imports
vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(() => 'active'),
}));

import {
  handleCommand,
  planningSessions,
  slugify,
  PLANNING_AGENTS,
  PLANNING_ROUND_COUNT,
} from './discord-commands.js';

// --- Mock factories ---

function mockMessage(content: string, overrides: Record<string, any> = {}): any {
  return {
    content,
    author: { id: 'user123', bot: false, username: 'testuser' },
    channel: {
      id: 'channel123',
      name: 'general',
      send: vi.fn().mockResolvedValue(undefined),
      threads: { create: vi.fn().mockResolvedValue({ send: vi.fn(), toString: () => '#thread' }) },
    },
    channelId: 'channel123',
    guild: {
      channels: {
        fetch: vi.fn().mockResolvedValue(undefined),
        cache: { find: vi.fn(), filter: vi.fn(() => ({ values: () => [], some: () => false })) },
        create: vi.fn().mockResolvedValue({ id: 'cat1', send: vi.fn() }),
      },
    },
    reply: vi.fn().mockResolvedValue(undefined),
    member: { displayName: 'Test User' },
    ...overrides,
  };
}

function mockClient(): any {
  return {
    on: vi.fn(),
    removeListener: vi.fn(),
    user: { id: 'bot123' },
  };
}

// --- Tests ---

describe('handleCommand', () => {
  it('returns false for non-command messages', async () => {
    const msg = mockMessage('hello world');
    const result = await handleCommand(msg, mockClient());
    expect(result).toBe(false);
  });

  it('returns false for unknown commands', async () => {
    const msg = mockMessage('!unknowncommand');
    const result = await handleCommand(msg, mockClient());
    expect(result).toBe(false);
  });

  it('returns true and replies for !help', async () => {
    const msg = mockMessage('!help');
    const result = await handleCommand(msg, mockClient());
    expect(result).toBe(true);
    expect(msg.reply).toHaveBeenCalledTimes(1);
    // Check embed was sent
    const call = msg.reply.mock.calls[0][0];
    expect(call.embeds).toBeDefined();
    expect(call.embeds[0].data.title).toContain('Commands');
  });

  it('returns true for !help_orchestration', async () => {
    const msg = mockMessage('!help_orchestration');
    const result = await handleCommand(msg, mockClient());
    expect(result).toBe(true);
    expect(msg.reply).toHaveBeenCalledTimes(1);
  });

  it('returns true for !agent_status', async () => {
    const msg = mockMessage('!agent_status');
    const result = await handleCommand(msg, mockClient());
    expect(result).toBe(true);
    expect(msg.reply).toHaveBeenCalledTimes(1);
  });
});

describe('!create_feature', () => {
  it('shows usage when no args', async () => {
    const msg = mockMessage('!create_feature');
    await handleCommand(msg, mockClient());
    expect(msg.reply).toHaveBeenCalledWith(
      expect.stringContaining('Usage:'),
    );
  });

  it('shows usage when missing feature name', async () => {
    const msg = mockMessage('!create_feature FEAT-001');
    await handleCommand(msg, mockClient());
    expect(msg.reply).toHaveBeenCalledWith(
      expect.stringContaining('Usage:'),
    );
  });

  it('creates thread when args are valid', async () => {
    const msg = mockMessage('!create_feature FEAT-001 user auth system');
    await handleCommand(msg, mockClient());
    expect(msg.channel.threads.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'FEAT-001 user auth system' }),
    );
  });
});

describe('!create_spec', () => {
  it('rejects non-FEAT IDs', async () => {
    const msg = mockMessage('!create_spec BUG-001');
    await handleCommand(msg, mockClient());
    expect(msg.reply).toHaveBeenCalledWith(
      expect.stringContaining('FEAT-'),
    );
  });
});

describe('!plan', () => {
  it('rejects if not in plan-room', async () => {
    const msg = mockMessage('!plan FEAT-001 some topic');
    msg.channel.name = 'general';
    await handleCommand(msg, mockClient());
    expect(msg.reply).toHaveBeenCalledWith(
      expect.stringContaining('plan-room'),
    );
  });

  it('shows usage when no args', async () => {
    const msg = mockMessage('!plan');
    msg.channel.name = 'plan-room';
    await handleCommand(msg, mockClient());
    expect(msg.reply).toHaveBeenCalledWith(
      expect.stringContaining('Usage:'),
    );
  });
});

describe('!create_discussion', () => {
  it('shows usage when no topic', async () => {
    const msg = mockMessage('!create_discussion');
    await handleCommand(msg, mockClient());
    expect(msg.reply).toHaveBeenCalledWith(
      expect.stringContaining('Usage:'),
    );
  });

  it('requires guild', async () => {
    const msg = mockMessage('!create_discussion "test topic"', {
      guild: null,
    });
    await handleCommand(msg, mockClient());
    expect(msg.reply).toHaveBeenCalledWith(
      expect.stringContaining('server'),
    );
  });
});

describe('!close_discussion', () => {
  it('rejects outside discuss channels', async () => {
    const msg = mockMessage('!close_discussion');
    msg.channel.name = 'general';
    await handleCommand(msg, mockClient());
    expect(msg.reply).toHaveBeenCalledWith(
      expect.stringContaining('discuss-'),
    );
  });

  it('rejects if planning session active', async () => {
    const msg = mockMessage('!close_discussion');
    msg.channel.name = 'discuss-test';
    planningSessions.set('channel123', {
      topic: 'test',
      featureId: null,
      round: 1,
    });
    await handleCommand(msg, mockClient());
    expect(msg.reply).toHaveBeenCalledWith(
      expect.stringContaining('still running'),
    );
    planningSessions.delete('channel123');
  });
});

describe('!create_project', () => {
  it('shows usage when no name', async () => {
    const msg = mockMessage('!create_project');
    await handleCommand(msg, mockClient());
    expect(msg.reply).toHaveBeenCalledWith(
      expect.stringContaining('Usage:'),
    );
  });

  it('requires guild', async () => {
    const msg = mockMessage('!create_project TestProject', {
      guild: null,
    });
    await handleCommand(msg, mockClient());
    expect(msg.reply).toHaveBeenCalledWith(
      expect.stringContaining('server'),
    );
  });
});

describe('!report_progress', () => {
  it('shows usage with missing args', async () => {
    const msg = mockMessage('!report_progress FEAT-001');
    await handleCommand(msg, mockClient());
    expect(msg.reply).toHaveBeenCalledWith(
      expect.stringContaining('Usage:'),
    );
  });
});

describe('!escalate_blocker', () => {
  it('shows usage with missing args', async () => {
    const msg = mockMessage('!escalate_blocker');
    await handleCommand(msg, mockClient());
    expect(msg.reply).toHaveBeenCalledWith(
      expect.stringContaining('Usage:'),
    );
  });
});

describe('!feature_status', () => {
  it('shows usage with no feature ID', async () => {
    const msg = mockMessage('!feature_status');
    await handleCommand(msg, mockClient());
    expect(msg.reply).toHaveBeenCalledWith(
      expect.stringContaining('Usage:'),
    );
  });
});

describe('slugify', () => {
  it('converts text to slug', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('removes special characters', () => {
    expect(slugify('API Design (v2)!')).toBe('api-design-v2');
  });

  it('truncates to 90 chars', () => {
    const long = 'a'.repeat(200);
    expect(slugify(long).length).toBeLessThanOrEqual(90);
  });

  it('collapses multiple dashes', () => {
    expect(slugify('hello---world')).toBe('hello-world');
  });
});

describe('planning session constants', () => {
  it('has 3 planning agents', () => {
    expect(PLANNING_AGENTS).toHaveLength(3);
    expect(PLANNING_AGENTS).toContain('Athena');
    expect(PLANNING_AGENTS).toContain('Hermes');
    expect(PLANNING_AGENTS).toContain('Prometheus');
  });

  it('runs 3 rounds', () => {
    expect(PLANNING_ROUND_COUNT).toBe(3);
  });
});
```

**Step 2: Run tests**

Run: `npx vitest run src/channels/discord-commands.test.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/channels/discord-commands.test.ts
git commit -m "test(discord): add tests for orchestration commands"
```

---

### Task 7: Build, run full test suite, restart service

**Step 1: Build**

Run: `npm run build`
Expected: Clean compile

**Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (289+ existing + new command tests)

**Step 3: Restart NanoClaw service**

Run: `systemctl --user restart nanoclaw`

**Step 4: Verify both channels connected**

Run: `sleep 3 && tail -15 logs/nanoclaw.log`
Expected: Both `Discord bot connected` and `Telegram bot connected` appear

**Step 5: Commit any remaining changes**

```bash
git add -A
git commit -m "feat(discord): bring back 15 orchestration commands from legacy bot

Adds discord-commands.ts module with instant ! command handling:
- Help: !help, !help_orchestration
- Agents: !agent_status
- Projects: !create_project, !cleanup_server
- Planning: !plan (3-round debate), !create_discussion, !close_discussion
- Features: !create_feature, !create_spec, !approve_spec, !create_contract
- Monitoring: !report_progress, !escalate_blocker, !feature_status

Commands respond instantly via Discord.js (no container startup).
Planning sessions use in-process state with event-based turn-taking."
```
