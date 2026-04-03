import {
  Client,
  Message,
  EmbedBuilder,
  TextChannel,
  ChannelType,
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { logger } from '../../logger.js';
import { CORE_CHANNELS, WORKSTREAM_DEFS } from './constants.js';
import {
  activeProjects,
  activeStreamWatchers,
  channelProjectMap,
  saveChannelProjectMap,
  getRegisterGroupCallback,
} from './state.js';
import { slugify, initProjectWorkspace } from './helpers.js';
import type { ProjectState } from './types.js';
import {
  startWorkspaceWatcher,
  stopWorkspaceWatcher,
} from './workspace-watcher.js';
import { stopStreamWatcher, saveProjectState } from './stream-watcher.js';
import {
  deleteOrchestrationState,
  getAllOrchestrationState,
} from '../../db.js';

export async function cmdCreateProject(
  message: Message,
  client: Client,
): Promise<void> {
  const args = message.content.split(' ').slice(1);
  const projectName = args.join(' ').trim();

  if (!projectName) {
    await message.reply(
      'Usage: `!create_project ProjectName`\nExample: `!create_project UserAuth`',
    );
    return;
  }

  if (!message.guild) {
    await message.reply(
      '\u26A0\u{FE0F} This command can only be used in a server.',
    );
    return;
  }

  const projectSlug = slugify(projectName);
  const onRegisterGroup = getRegisterGroupCallback();

  try {
    await message.guild.channels.fetch();
    const existing = message.guild.channels.cache.find(
      (c) => c.name === projectName && c.type === ChannelType.GuildCategory,
    );
    if (existing) {
      await message.reply(
        `\u26A0\u{FE0F} Project ${projectName} already exists!`,
      );
      return;
    }

    // 1. Create file-first workspace
    const workspacePath = initProjectWorkspace(projectSlug);
    await (message.channel as TextChannel).send(
      `\u{1F4C2} Workspace initialized: \`groups/shared_project/active/${projectSlug}/\``,
    );

    // 2. Create Discord category
    const category = await message.guild.channels.create({
      name: projectName,
      type: ChannelType.GuildCategory,
    });

    // 3. Create core channels
    let controlRoomId = '';
    let planRoomId = '';

    for (let i = 0; i < CORE_CHANNELS.length; i++) {
      const cfg = CORE_CHANNELS[i];
      try {
        const ch = await message.guild!.channels.create({
          name: cfg.name,
          type: ChannelType.GuildText,
          parent: category.id,
          topic: `${cfg.topic}\n\n**Project**: ${projectName} | Workspace: \`active/${projectSlug}/\``,
        });

        if (cfg.name === 'control-room') controlRoomId = ch.id;
        if (cfg.name === 'plan-room') planRoomId = ch.id;

        // Register with NanoClaw so Iris receives messages from this channel
        if (onRegisterGroup) {
          onRegisterGroup(
            `dc:${ch.id}`,
            `${projectName} / #${cfg.name}`,
            'iris',
            '@Iris',
          );
        }
        channelProjectMap.set(ch.id, projectSlug);
        saveChannelProjectMap();

        const welcomeEmbed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${cfg.emoji} ${cfg.name.replace(/-/g, ' ').toUpperCase()}`)
          .setDescription(
            `${cfg.topic}\n\n**Project**: ${projectName}\n**Workspace**: \`/workspace/shared/\` (project root)`,
          )
          .setTimestamp();

        if (cfg.name === 'control-room') {
          welcomeEmbed.addFields(
            {
              name: '\u{1F4C2} Workspace Structure',
              value:
                '```\n' +
                `active/${projectSlug}/\n` +
                '\u251C\u2500 control/          draft-plan.md\n' +
                '\u251C\u2500 coordination/     progress, deps, status-board\n' +
                '\u251C\u2500 workstreams/      per-team scope + handoffs\n' +
                '\u2514\u2500 archive/          completed work\n' +
                '```',
            },
            {
              name: '\u{1F680} Getting Started',
              value:
                '1. Write your draft plan to `control/draft-plan.md`\n' +
                '2. Go to #plan-room and run `!plan <topic>`\n' +
                '3. After planning, run `!decompose` to create work streams',
            },
          );
        }

        if (cfg.name === 'plan-room') {
          welcomeEmbed.addFields({
            name: '\u{1F4CB} Planning Commands',
            value:
              '`!plan topic` \u2014 Start agent-driven planning (Athena + Hermes)\n' +
              '`!decompose backend frontend` \u2014 Create work stream channels\n' +
              'Post your draft plan here or in #control-room. Iris will save it and start the planning process.',
          });
        }

        await ch.send({ embeds: [welcomeEmbed] });
        await (message.channel as TextChannel).send(
          `  \u2705 Created #${cfg.name} (${i + 1}/${CORE_CHANNELS.length})`,
        );
      } catch (err: any) {
        await (message.channel as TextChannel).send(
          `  \u26A0\u{FE0F} Could not create #${cfg.name}: ${err.message}`,
        );
      }
    }

    // 4. Track project state
    activeProjects.set(projectSlug, {
      name: projectName,
      categoryId: category.id,
      workStreams: new Map(),
      controlRoomId,
      planRoomId,
    });

    // Persist project state for restart recovery
    saveProjectState(projectSlug, activeProjects.get(projectSlug)!);

    // 5. Start workspace watcher
    startWorkspaceWatcher(client, message.guild!, projectSlug, category.id);

    const completeEmbed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle(`\u{1F389} Project ${projectName} Ready`)
      .setDescription(
        'File-first workspace and core channels created.\n\n' +
          'Write your draft plan, then head to #plan-room to start planning.',
      )
      .addFields(
        {
          name: 'Workspace',
          value: `\`active/${projectSlug}/\``,
          inline: true,
        },
        {
          name: 'Channels',
          value: CORE_CHANNELS.map((c) => `#${c.name}`).join(', '),
          inline: true,
        },
        {
          name: 'Work Streams',
          value: 'Created on-demand via `!decompose` or `!add_stream`',
          inline: true,
        },
      )
      .setTimestamp();

    await (message.channel as TextChannel).send({ embeds: [completeEmbed] });
  } catch (err: any) {
    await message.reply(`\u274C Error creating project: ${err.message}`);
  }
}

export async function cmdCleanupServer(
  message: Message,
  _client: Client,
): Promise<void> {
  if (!message.guild) {
    await message.reply(
      '\u26A0\u{FE0F} This command can only be used in a server.',
    );
    return;
  }

  try {
    await (message.channel as TextChannel).send(
      '\u{1F9F9} **Starting cleanup process...**',
    );
    await message.guild.channels.fetch();

    const orchestrationChannelNames = [
      'control-room',
      'plan-room',
      'release-log',
      // Legacy channels
      'backend-dev',
      'frontend-ui',
      'qa-alerts',
    ];

    // Also match dynamic work stream channels
    const wsPattern = /^ws-/;

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
      const hasOrchChannels = children.some(
        (c) =>
          orchestrationChannelNames.includes(c.name) || wsPattern.test(c.name),
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
          if (channel.id === message.channelId) continue;
          await channel.delete();
          removedCount++;
        }
        const categoryName = category.name;
        await category.delete();
        removedCount++;
        await (message.channel as TextChannel).send(
          `\u2705 Removed category: ${categoryName}`,
        );
      } catch (err: any) {
        await (message.channel as TextChannel).send(
          `\u26A0\u{FE0F} Could not remove category: ${err.message}`,
        );
      }
    }

    // Clear in-memory project state and stop watchers
    for (const slug of activeProjects.keys()) {
      stopWorkspaceWatcher(slug);
    }
    // Also stop all stream watchers
    for (const key of activeStreamWatchers.keys()) {
      stopStreamWatcher(key, _client);
    }
    activeProjects.clear();

    // Delete all persisted orchestration state from SQLite
    for (const type of [
      'project',
      'stream_watcher',
      'planning_session',
      'discussion_session',
      'plan_index',
    ]) {
      const rows = getAllOrchestrationState(type);
      for (const row of rows) {
        deleteOrchestrationState(row.key);
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('\u2705 Cleanup Complete!')
      .setDescription('All orchestration structures have been removed')
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
        {
          name: 'Note',
          value:
            'File workspace in `groups/shared_project/active/` is preserved. Delete manually if needed.',
          inline: false,
        },
      )
      .setTimestamp();

    await (message.channel as TextChannel).send({ embeds: [embed] });
  } catch (err: any) {
    await message.reply(`\u274C Cleanup error: ${err.message}`);
  }
}
