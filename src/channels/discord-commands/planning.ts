import { Client, Message, EmbedBuilder, TextChannel } from 'discord.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '../../logger.js';
import {
  PLANNING_AGENTS,
  AGENT_COLORS,
  AGENT_HANDOFF_TIMEOUT,
  HUMAN_INPUT_TIMEOUT,
} from './constants.js';
import { planningSessions, discussionSessions } from './state.js';
import {
  findProjectSlugForChannel,
  slugify,
  initDiscussionFolder,
} from './helpers.js';
import { startDiscussionWatchdog } from './discussion.js';
import { setOrchestrationState, getAllOrchestrationState } from '../../db.js';
import {
  savePlanningSession,
  saveDiscussionSession,
  deletePlanningSession,
} from './stream-watcher.js';

export async function cmdPlan(message: Message, client: Client): Promise<void> {
  const args = message.content.split(' ').slice(1);
  const topic = args.join(' ').trim();

  if (!topic) {
    await message.reply('Usage: `!plan user dashboard with real-time updates`');
    return;
  }

  const channel = message.channel as TextChannel;

  // Allow from plan-room or control-room
  if (channel.name !== 'plan-room' && channel.name !== 'control-room') {
    await message.reply(
      '\u26A0\u{FE0F} `!plan` must be used in a `#plan-room` or `#control-room` channel.',
    );
    return;
  }

  if (!message.guild) {
    await message.reply(
      '\u26A0\u{FE0F} This command can only be used in a server.',
    );
    return;
  }

  const slug = `plan-${slugify(topic)}`;

  // Check for existing session
  if (planningSessions.has(channel.id)) {
    await message.reply(
      '\u26A0\u{FE0F} A planning session is already running in this channel. Wait for it to finish.',
    );
    return;
  }

  try {
    // 1. Resolve project context early — needed for folder placement
    const projectSlug = findProjectSlugForChannel(channel);

    // 2. Create shared folder INSIDE the project so agents can see it
    const folderPath = initDiscussionFolder(slug, projectSlug || undefined);

    // Container path depends on whether this is project-scoped
    const containerPlanPath = projectSlug
      ? `/workspace/shared/plans/${slug}/`
      : `/workspace/shared/${slug}/`;

    // 3. Save the topic as plan.md (Iris as intake)
    const planContent =
      `# Draft Plan: ${topic}\n\n` +
      `*Created by ${message.author.username} via !plan on ${new Date().toISOString()}*\n\n` +
      `## Topic\n\n${topic}\n`;

    // Check if there's a draft plan file in the project workspace
    let draftContent = '';
    if (projectSlug) {
      const draftPath = path.resolve(
        process.cwd(),
        'groups',
        'shared_project',
        'active',
        projectSlug,
        'control',
        'draft-plan.md',
      );
      if (fs.existsSync(draftPath)) {
        draftContent = fs.readFileSync(draftPath, 'utf8');
      }
    }

    const fullPlanContent = draftContent
      ? `${planContent}\n## Draft Plan (from workspace)\n\n${draftContent}`
      : planContent;

    fs.writeFileSync(path.join(folderPath, 'plan.md'), fullPlanContent, 'utf8');

    // Git commit the initial plan
    try {
      execSync(
        'git add -A && git commit --author="Iris <iris@nanoclaw>" -m "Initial plan: ' +
          topic.replace(/"/g, '\\"') +
          '"',
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

    // 3. Track session
    planningSessions.set(channel.id, { topic, featureId: null, round: 0 });
    savePlanningSession(channel.id, { topic, featureId: null, round: 0 });

    // Track in plan index
    trackPlanInIndex(slug, topic, message.author.username, channel.id, 'plan');

    discussionSessions.set(channel.id, {
      topic,
      slug,
      round: 0,
      currentAgent: null,
      channelId: channel.id,
    });
    saveDiscussionSession(channel.id, {
      topic,
      slug,
      round: 0,
      currentAgent: null,
      channelId: channel.id,
    });

    // 4. Determine where to post — if called from control-room, post in plan-room
    let targetChannel = channel;
    if (channel.name === 'control-room' && channel.parentId) {
      const planRoom = message.guild!.channels.cache.find(
        (c) => c.name === 'plan-room' && c.parentId === channel.parentId,
      ) as TextChannel | undefined;
      if (planRoom) {
        targetChannel = planRoom;
        // Track session on plan-room too
        planningSessions.set(planRoom.id, { topic, featureId: null, round: 0 });
        savePlanningSession(planRoom.id, { topic, featureId: null, round: 0 });
        discussionSessions.set(planRoom.id, {
          topic,
          slug,
          round: 0,
          currentAgent: null,
          channelId: planRoom.id,
          // Track the control-room as source so cleanup can remove both entries
          sourceChannelId: channel.id,
        });
        saveDiscussionSession(planRoom.id, {
          topic,
          slug,
          round: 0,
          currentAgent: null,
          channelId: planRoom.id,
          sourceChannelId: channel.id,
        });
        await channel.send(
          `\u{1F4CB} Planning session started in ${planRoom.toString()} for: **${topic}**`,
        );
      }
    }

    // 5. Post welcome embed in target channel
    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`\u{1F5E3}\u{FE0F} Planning: ${topic}`)
      .setDescription(
        'Iris has saved the draft plan and will trigger the 4-step agent workflow.\n\n' +
          '**Agents:** Hermes (reviewer) \u2194 Athena (architect)',
      )
      .addFields(
        {
          name: '\u{1F4C2} Shared Folder',
          value: `\`${slug}/\` under shared project\nContainer path: \`${containerPlanPath}\``,
        },
        {
          name: '\u{1F504} 4 Steps',
          value:
            '**Step 1 \u2014 Human Input:** Draft saved as plan.md\n' +
            '**Step 2 \u2014 Hermes Reviews:** Reads plan, asks questions, creates plan-v2.md\n' +
            '**Step 3 \u2014 Athena Architects:** Edits plan-v2.md, refines architecture\n' +
            '**Step 4 \u2014 Hermes Finalizes:** Resolves disagreements with human, finalizes',
        },
        {
          name: '\u{1F4CB} Commands',
          value: '`!decompose` \u2014 Break into work streams after planning',
        },
      )
      .setTimestamp();

    await targetChannel.send({ embeds: [welcomeEmbed] });

    // 6. Start the discussion watchdog
    startDiscussionWatchdog(client, targetChannel, slug);

    // 7. @Hermes to start the 4-step flow
    const session = discussionSessions.get(targetChannel.id);
    if (session) {
      session.round = 1;
      session.currentAgent = 'Hermes';
      saveDiscussionSession(targetChannel.id, session);
    }

    await targetChannel.send(
      `\n**\u2501\u2501\u2501 Step 2 \u2014 Hermes Reviews \u2501\u2501\u2501**\n` +
        `@Hermes read the plan at \`${containerPlanPath}plan.md\` and review it. ` +
        'Ask the human questions to gather details, then create plan-v2.md in the same folder. ' +
        'Commit and hand off to @Athena when done.',
    );

    if (draftContent) {
      await targetChannel.send(
        `\u{1F4C4} Found draft plan from workspace \`control/draft-plan.md\`. It has been included in \`${slug}/plan.md\`.`,
      );
    }
  } catch (err: any) {
    planningSessions.delete(channel.id);
    deletePlanningSession(channel.id);
    await message.reply(
      `\u274C Error starting planning session: ${err.message}`,
    );
  }
}

// --- Plan Parsing ---

const STREAM_KEYWORDS: Record<string, RegExp> = {
  backend: /backend|api|server|database|endpoint/,
  frontend: /frontend|ui|component|css|page|react/,
  qa: /test|qa|quality|validation|acceptance/,
  design: /design|ux|wireframe|mockup|figma/,
  devops: /devops|deploy|ci|docker|infra|pipeline/,
  research: /research|explore|spike|prototype|poc/,
};

/**
 * Read approved-plan.md (or draft-plan.md) and scan for keywords to auto-detect work streams.
 * Returns deduplicated array of matched stream types, or empty array if nothing matches.
 */
export function parsePlanForStreams(projectSlug: string): string[] {
  const basePath = path.resolve(
    process.cwd(),
    'groups',
    'shared_project',
    'active',
    projectSlug,
    'control',
  );

  let content = '';
  const approvedPath = path.join(basePath, 'approved-plan.md');
  const draftPath = path.join(basePath, 'draft-plan.md');

  if (fs.existsSync(approvedPath)) {
    content = fs.readFileSync(approvedPath, 'utf8');
  } else if (fs.existsSync(draftPath)) {
    content = fs.readFileSync(draftPath, 'utf8');
  }

  if (!content) return [];

  const lower = content.toLowerCase();
  const matched: string[] = [];

  for (const [streamType, pattern] of Object.entries(STREAM_KEYWORDS)) {
    if (pattern.test(lower)) {
      matched.push(streamType);
    }
  }

  return matched;
}

/**
 * Append a plan entry to the plan index in SQLite.
 * Called from cmdPlan() and cmdCreateDiscussion().
 */
export function trackPlanInIndex(
  slug: string,
  topic: string,
  creator: string,
  channelId: string,
  type: 'plan' | 'discussion',
): void {
  const entry = {
    slug,
    topic,
    creator,
    channelId,
    type,
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  setOrchestrationState(`planidx:${slug}`, 'plan_index', JSON.stringify(entry));
}

/**
 * Mark a plan as completed in the index.
 */
export function completePlanInIndex(slug: string): void {
  const existing = getAllOrchestrationState('plan_index').find(
    (r) => r.key === `planidx:${slug}`,
  );
  if (existing) {
    const data = JSON.parse(existing.data);
    data.status = 'completed';
    data.completedAt = new Date().toISOString();
    setOrchestrationState(
      `planidx:${slug}`,
      'plan_index',
      JSON.stringify(data),
    );
  }
}

/**
 * !plans command — show all tracked plans with their lifecycle status.
 */
export async function cmdPlans(
  message: Message,
  _client: Client,
): Promise<void> {
  const rows = getAllOrchestrationState('plan_index');

  if (rows.length === 0) {
    await message.reply(
      'No plans tracked yet. Use `!plan` or `!create_discussion` to start one.',
    );
    return;
  }

  const entries = rows
    .map((r) => {
      try {
        return JSON.parse(r.data);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort(
      (a: any, b: any) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  const statusIcons: Record<string, string> = {
    active: '\u{1F7E2}',
    completed: '\u2705',
    abandoned: '\u26AA',
  };

  const lines = entries.map((e: any) => {
    const icon = statusIcons[e.status] || '\u2753';
    const typeTag = e.type === 'discussion' ? 'discuss' : 'plan';
    const age = Math.round(
      (Date.now() - new Date(e.createdAt).getTime()) / 86400000,
    );
    const ageStr = age === 0 ? 'today' : `${age}d ago`;
    return `${icon} **${e.topic}** (${typeTag}) — ${e.status} — ${ageStr}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('\u{1F4CB} Plan Index')
    .setDescription(lines.join('\n') || 'No plans found.')
    .setFooter({ text: `${entries.length} plan(s) tracked` })
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}
