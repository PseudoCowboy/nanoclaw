import { Client, Message, EmbedBuilder, TextChannel } from 'discord.js';
import { getAllOrchestrationState } from '../../db.js';
import {
  activeStreamWatchers,
  activeProjects,
  planningSessions,
  discussionSessions,
  channelBranchMap,
} from './state.js';
import { readTaskState } from './stream-watcher.js';

/**
 * Diagnostic command that exposes live orchestration state for debugging.
 * Shows in-memory vs SQLite counts, active watchers, and consistency checks.
 *
 * Usage: !doctor_workflow
 */
export async function cmdDoctorWorkflow(
  message: Message,
  _client: Client,
): Promise<void> {
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];
  const issues: string[] = [];

  // 1. In-memory state counts
  fields.push({
    name: '\u{1F4BE} In-Memory State',
    value:
      `Projects: ${activeProjects.size}\n` +
      `Stream watchers: ${activeStreamWatchers.size}\n` +
      `Planning sessions: ${planningSessions.size}\n` +
      `Discussion sessions: ${discussionSessions.size}\n` +
      `Branch mappings: ${channelBranchMap.size}`,
    inline: true,
  });

  // 2. SQLite state counts
  const dbWatchers = getAllOrchestrationState('stream_watcher');
  const dbProjects = getAllOrchestrationState('project');
  const dbPlanning = getAllOrchestrationState('planning_session');
  const dbDiscussion = getAllOrchestrationState('discussion_session');

  // Count active (non-completed) watchers in SQLite
  let activeDbWatcherCount = 0;
  for (const row of dbWatchers) {
    try {
      const meta = JSON.parse(row.data);
      if (!meta.completed) activeDbWatcherCount++;
    } catch {
      /* skip corrupt rows */
    }
  }

  fields.push({
    name: '\u{1F4C0} SQLite State',
    value:
      `Watchers: ${activeDbWatcherCount} active (${dbWatchers.length} total)\n` +
      `Projects: ${dbProjects.length}\n` +
      `Planning: ${dbPlanning.length}\n` +
      `Discussion: ${dbDiscussion.length}`,
    inline: true,
  });

  // 3. Consistency checks
  if (activeStreamWatchers.size !== activeDbWatcherCount) {
    issues.push(
      `Watcher count mismatch: ${activeStreamWatchers.size} in-memory vs ${activeDbWatcherCount} active in SQLite`,
    );
  }

  if (activeProjects.size !== dbProjects.length) {
    issues.push(
      `Project count mismatch: ${activeProjects.size} in-memory vs ${dbProjects.length} in SQLite`,
    );
  }

  // Check for orphaned SQLite sessions (channel no longer exists in guild)
  if (message.guild) {
    for (const row of dbPlanning) {
      try {
        const meta = JSON.parse(row.data);
        const channelId = meta.channelId || row.key.replace(/^plan:/, '');
        const ch = message.guild.channels.cache.get(channelId);
        if (!ch) {
          issues.push(
            `Orphaned planning session: ${channelId} (${meta.topic || 'unknown'})`,
          );
        }
      } catch {
        /* skip corrupt rows */
      }
    }
    for (const row of dbDiscussion) {
      try {
        const meta = JSON.parse(row.data);
        const channelId = meta.channelId || row.key.replace(/^disc:/, '');
        const ch = message.guild.channels.cache.get(channelId);
        if (!ch) {
          issues.push(
            `Orphaned discussion session: ${channelId} (${meta.topic || 'unknown'})`,
          );
        }
      } catch {
        /* skip corrupt rows */
      }
    }
  }

  // 4. Per-watcher status
  const watcherLines: string[] = [];
  for (const [key, watcher] of activeStreamWatchers) {
    const taskResult = readTaskState(watcher.projectSlug, watcher.streamType);
    let taskInfo: string;
    if (taskResult.state) {
      const approved = taskResult.state.tasks.filter(
        (t) => t.status === 'approved',
      ).length;
      taskInfo = `${approved}/${taskResult.state.tasks.length} approved`;
    } else if (taskResult.corrupt) {
      taskInfo = '\u274C CORRUPT task-state.json';
      issues.push(`${key}: task-state.json is corrupt`);
    } else {
      taskInfo = 'no task-state.json';
    }
    const silenceMin = Math.round(
      (Date.now() - watcher.lastActivityTime) / 60000,
    );
    watcherLines.push(
      `**${key}**: ${taskInfo} | silent ${silenceMin}m | branch: \`${watcher.currentBranch || 'none'}\``,
    );
  }

  if (watcherLines.length > 0) {
    fields.push({
      name: '\u{1F440} Active Watchers',
      value: watcherLines.join('\n').slice(0, 1024),
      inline: false,
    });
  }

  // 5. Issues summary
  const color = issues.length === 0 ? 0x00ff00 : 0xff9900;
  const statusText =
    issues.length === 0
      ? '\u2705 All checks passed'
      : `\u26A0\uFE0F ${issues.length} issue(s) detected`;

  if (issues.length > 0) {
    fields.push({
      name: '\u{1F6A8} Issues',
      value: issues
        .map((i) => `\u2022 ${i}`)
        .join('\n')
        .slice(0, 1024),
      inline: false,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('\u{1FA7A} Workflow Diagnostic Report')
    .setDescription(statusText)
    .addFields(fields)
    .setFooter({ text: '!doctor_workflow' })
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}
