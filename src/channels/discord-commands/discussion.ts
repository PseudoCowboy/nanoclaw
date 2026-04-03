import {
  Client,
  Message,
  EmbedBuilder,
  TextChannel,
  ChannelType,
} from 'discord.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '../../logger.js';
import {
  DISCUSSION_CHAIN,
  AGENT_COLORS,
  AGENT_HANDOFF_TIMEOUT,
  HUMAN_INPUT_TIMEOUT,
} from './constants.js';
import {
  discussionSessions,
  discussionListeners,
  planningSessions,
  activeStreamWatchers,
  getRegisterGroupCallback,
} from './state.js';
import {
  slugify,
  initDiscussionFolder,
  findProjectSlugForChannel,
} from './helpers.js';
import {
  stopStreamWatcher,
  saveDiscussionSession,
  deleteDiscussionSession,
  savePlanningSession,
  deletePlanningSession,
} from './stream-watcher.js';
import { trackPlanInIndex, completePlanInIndex } from './planning.js';

/**
 * Iris watchdog — monitors a discussion channel for agent handoffs and round completions.
 * Handles round transitions and the Round 3 orchestration flow.
 */
export function startDiscussionWatchdog(
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
        `\u23F0 @${agentName} \u2014 please wrap up and hand off to the next agent.`,
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

      // Step 2 handoff: Hermes hands off to Athena
      if (
        (content.includes('@Athena') || content.includes('your turn')) &&
        session.round <= 2
      ) {
        if (nudgeTimer) clearTimeout(nudgeTimer);
        session.round = 3;
        session.currentAgent = 'Athena';
        resetNudgeTimer('Athena');
        return;
      }

      // Step 3 handoff: Athena hands off to Hermes
      if (
        (content.includes('@Hermes') || content.includes('your turn')) &&
        session.round === 3
      ) {
        if (nudgeTimer) clearTimeout(nudgeTimer);
        session.round = 4;
        session.currentAgent = 'Hermes';
        resetNudgeTimer('Hermes');
        return;
      }

      // Discussion complete (from Hermes in Step 4)
      if (
        (content.includes('Planning complete') ||
          content.includes('Discussion complete')) &&
        session.round === 4
      ) {
        if (nudgeTimer) clearTimeout(nudgeTimer);
        client.removeListener('messageCreate', onMessage);
        completePlanInIndex(slug);
        discussionSessions.delete(channel.id);
        deleteDiscussionSession(channel.id);
        // Also clean up the planning session created alongside the discussion
        planningSessions.delete(channel.id);
        deletePlanningSession(channel.id);

        const completeEmbed = new EmbedBuilder()
          .setColor(0x00ff00)
          .setTitle('\u{1F4CB} Discussion Complete')
          .setDescription(
            `**${session.topic}**\n\n` +
              `4 steps completed. Final plan is in the \`${slug}/\` folder.\n` +
              '`!close_discussion` to delete this channel when done.',
          )
          .setTimestamp();
        await channel.send({ embeds: [completeEmbed] });

        // Read and post the full plan content
        try {
          // Try project-scoped location first, then legacy top-level
          const projectSlug = findProjectSlugForChannel(channel);
          const candidatePaths = [
            ...(projectSlug
              ? [
                  path.resolve(
                    process.cwd(),
                    'groups',
                    'shared_project',
                    'active',
                    projectSlug,
                    'plans',
                    slug,
                    'plan-v2.md',
                  ),
                ]
              : []),
            path.resolve(
              process.cwd(),
              'groups',
              'shared_project',
              slug,
              'plan-v2.md',
            ),
          ];
          const planPath = candidatePaths.find((p) => fs.existsSync(p));
          if (planPath) {
            const planContent = fs.readFileSync(planPath, 'utf8').trim();
            if (planContent) {
              await channel.send('**\u{1F4C4} Final Plan:**');
              // Split into chunks respecting Discord's 2000 char limit
              const MAX_CHUNK = 1900; // leave margin for formatting
              const lines = planContent.split('\n');
              let chunk = '';
              for (const line of lines) {
                if (chunk.length + line.length + 1 > MAX_CHUNK) {
                  if (chunk) await channel.send(chunk);
                  chunk = line;
                } else {
                  chunk += (chunk ? '\n' : '') + line;
                }
              }
              if (chunk) await channel.send(chunk);
            }
          } else {
            await channel.send(
              '\u26A0\u{FE0F} Could not find plan-v2.md to display. Check the shared folder manually.',
            );
          }
        } catch (readErr: any) {
          logger.warn(
            { err: readErr, slug },
            'Failed to read plan-v2.md for posting',
          );
          await channel.send(
            '\u26A0\u{FE0F} Could not read plan-v2.md: ' + readErr.message,
          );
        }

        return;
      }

      // Track agent handoffs (any bot mentioning another agent)
      for (const agent of DISCUSSION_CHAIN) {
        if (
          content.includes(`@${agent}`) &&
          msg.author.username.toLowerCase() !== agent.toLowerCase()
        ) {
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

export async function cmdCreateDiscussion(
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
      '\u26A0\u{FE0F} This command can only be used in a server.',
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
        '\u{1F4C1} Created DISCUSSIONS category',
      );
    }

    // Check for existing channel
    const existing = message.guild.channels.cache.find(
      (c) => c.name === channelName && c.parentId === discussCategory!.id,
    );

    if (existing) {
      await message.reply(
        `\u26A0\u{FE0F} Discussion channel ${existing.toString()} already exists!`,
      );
      return;
    }

    // Create Discord channel
    const discussChannel = (await message.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: discussCategory.id,
      topic: `\u{1F4A1} Discussion: ${topic} | Hermes, Athena, Human`,
    })) as TextChannel;

    // Create shared folder with git init
    const folderPath = initDiscussionFolder(channelName);

    // Track this discussion session
    discussionSessions.set(discussChannel.id, {
      topic,
      slug: channelName,
      round: 0,
      currentAgent: null,
      channelId: discussChannel.id,
    });
    saveDiscussionSession(discussChannel.id, {
      topic,
      slug: channelName,
      round: 0,
      currentAgent: null,
      channelId: discussChannel.id,
    });

    // Track in plan index
    trackPlanInIndex(
      channelName,
      topic,
      message.author.username,
      discussChannel.id,
      'discussion',
    );

    // Post welcome embed
    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`\u{1F4A1} Discussion: ${topic}`)
      .setDescription(
        'File-based collaborative discussion with the planning agents.\n\n' +
          '**Paste your draft plan or describe what you want to discuss.** Iris will save it and start the agent workflow.',
      )
      .addFields(
        {
          name: '\u{1F4C2} Shared Folder',
          value: `\`${channelName}/\` under shared project\nContainer path: \`/workspace/shared/${channelName}/\``,
        },
        {
          name: '\u{1F680} How It Works',
          value:
            '1. Paste your draft plan or content below\n' +
            '2. Iris saves it as plan.md and triggers @Hermes\n' +
            '3. Agents: Hermes \u2194 Athena (4 steps)',
        },
        {
          name: '\u{1F504} 4 Steps',
          value:
            '**Step 1 \u2014 Human Input:** Paste your content below\n' +
            '**Step 2 \u2014 Hermes Reviews:** Asks questions, creates plan-v2.md\n' +
            '**Step 3 \u2014 Athena Architects:** Edits plan-v2.md, refines architecture\n' +
            '**Step 4 \u2014 Hermes Finalizes:** Resolves disagreements with human, finalizes',
        },
        {
          name: '\u{1F64B} Commands',
          value: '`!close_discussion` \u2014 Delete this channel',
        },
      )
      .setTimestamp();

    await discussChannel.send({ embeds: [welcomeEmbed] });

    // Start Iris watchdog — monitors for agent handoffs and round transitions
    startDiscussionWatchdog(client, discussChannel, channelName);

    // Ask human to paste their draft plan content
    await discussChannel.send(
      '\u{1F4DD} **Paste your draft plan or content below.** Iris will save it as `plan.md` and trigger Hermes to start.\n\n' +
        'You can also place files directly in `' +
        channelName +
        '/` under shared project, then type **yes** to start.',
    );

    const contentHandler = (readyMsg: Message) => {
      if (readyMsg.channelId !== discussChannel.id) return;
      if (readyMsg.author.bot) return;

      const content = readyMsg.content.trim();
      // Skip commands
      if (content.startsWith('!')) return;

      client.removeListener('messageCreate', contentHandler);
      if (contentTimer) clearTimeout(contentTimer);

      const session = discussionSessions.get(discussChannel.id);

      // Check if user typed "yes" (files already placed) or pasted content
      const isReady =
        content.toLowerCase() === 'yes' ||
        content.toLowerCase() === 'y' ||
        content.toLowerCase() === 'ready';

      if (!isReady) {
        // User pasted content — save as plan.md
        const planContent =
          `# Draft Plan: ${topic}\n\n` +
          `*Saved by Iris from ${readyMsg.author.username}'s message on ${new Date().toISOString()}*\n\n` +
          content;

        fs.writeFileSync(path.join(folderPath, 'plan.md'), planContent, 'utf8');

        // Git commit
        try {
          execSync(
            'git add -A && git commit --author="Iris <iris@nanoclaw>" -m "Save draft plan from human"',
            {
              cwd: folderPath,
              encoding: 'utf8',
              timeout: 10000,
              shell: '/bin/bash',
            },
          );
        } catch {
          /* git commit may fail if nothing to commit */
        }

        discussChannel.send(
          `\u2705 Saved your content as \`plan.md\` in \`${channelName}/\`. Starting the planning workflow...`,
        );
      }

      if (session) {
        session.round = 1;
        session.currentAgent = 'Hermes';
      }

      // Track as planning session too
      planningSessions.set(discussChannel.id, {
        topic,
        featureId: null,
        round: 1,
      });
      savePlanningSession(discussChannel.id, {
        topic,
        featureId: null,
        round: 1,
      });

      discussChannel.send(
        '\n**\u2501\u2501\u2501 Step 2 \u2014 Hermes Reviews \u2501\u2501\u2501**\n' +
          `@Hermes read the files under ${channelName}/ and review the plan. ` +
          'Ask the human questions to gather details, then create plan-v2.md. ' +
          'Commit and hand off to @Athena when done.',
      );
    };

    client.on('messageCreate', contentHandler);

    // Timeout — remind after 10 minutes if no response
    const contentTimer = setTimeout(() => {
      client.removeListener('messageCreate', contentHandler);
      discussChannel.send(
        '\u23F0 No content received. Paste your draft plan below, or `@Hermes` directly to start without a draft.',
      );
    }, HUMAN_INPUT_TIMEOUT);

    await message.reply(
      `\u2705 Discussion channel created: ${discussChannel.toString()}\n\u{1F4C2} Shared folder: \`groups/shared_project/${channelName}/\``,
    );
  } catch (err: any) {
    await message.reply(`\u274C Error creating discussion: ${err.message}`);
  }
}

export async function cmdCloseDiscussion(
  message: Message,
  client: Client,
): Promise<void> {
  const channel = message.channel as TextChannel;
  if (
    (!channel.name.startsWith('discuss-') &&
      !channel.name.startsWith('plan-') &&
      !channel.name.startsWith('ws-')) ||
    channel.name === 'plan-room'
  ) {
    await message.reply(
      '\u26A0\u{FE0F} `!close_discussion` must be used inside a `#discuss-*`, `#plan-*`, or `#ws-*` channel (not #plan-room).',
    );
    return;
  }

  if (planningSessions.has(channel.id)) {
    await message.reply(
      '\u26A0\u{FE0F} A planning session is still running. Wait for it to finish first.',
    );
    return;
  }

  try {
    // Clean up discussion session
    discussionSessions.delete(channel.id);
    deleteDiscussionSession(channel.id);
    // Clean up paired planning session
    planningSessions.delete(channel.id);
    deletePlanningSession(channel.id);

    // Clean up watchdog listener
    const listenerInfo = discussionListeners.get(channel.id);
    if (listenerInfo) {
      client.removeListener('messageCreate', listenerInfo.listener);
      if (listenerInfo.timer) clearTimeout(listenerInfo.timer);
      discussionListeners.delete(channel.id);
    }

    // Clean up stream watcher if this is a ws-* channel
    if (channel.name.startsWith('ws-')) {
      for (const [key, watcher] of activeStreamWatchers.entries()) {
        if (watcher.channelId === channel.id) {
          stopStreamWatcher(key, client);
          break;
        }
      }
    }

    await channel.send('\u{1F5D1}\u{FE0F} Closing discussion channel...');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await channel.delete(`Discussion closed by ${message.author.username}`);
  } catch (err: any) {
    await message.reply(`\u274C Error closing discussion: ${err.message}`);
  }
}
