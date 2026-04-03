import { Client, Message, EmbedBuilder, TextChannel } from 'discord.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '../../logger.js';
import { AGENTS, AGENT_COLORS, WORKSTREAM_DEFS } from './constants.js';
import { activeProjects, activeStreamWatchers } from './state.js';
import { findProjectSlugForChannel } from './helpers.js';
import { withFileLock } from './file-lock.js';

export async function cmdAgentStatus(
  message: Message,
  _client: Client,
): Promise<void> {
  const fields = [];
  let runningCount = 0;

  for (const agent of AGENTS) {
    const agentName = agent.name.toLowerCase();
    let status = '\u274C Offline';
    let lastLog = '';

    try {
      // Check per-agent PID file
      const pidPath = path.resolve(
        process.cwd(),
        'agents',
        'pids',
        `${agentName}.pid`,
      );
      if (fs.existsSync(pidPath)) {
        const pid = fs.readFileSync(pidPath, 'utf8').trim();
        try {
          // Check if process is alive
          execSync(`kill -0 ${pid} 2>/dev/null`, { timeout: 3000 });
          status = '\u2705 Running';
          runningCount++;
        } catch {
          status = '\u{1F4A4} Dead (stale PID)';
        }
      }
    } catch {
      // PID check failed
    }

    try {
      // Get last log line timestamp to detect frozen agents
      const logPath = path.resolve(
        process.cwd(),
        'agents',
        'logs',
        `${agentName}.log`,
      );
      if (fs.existsSync(logPath)) {
        const logStat = fs.statSync(logPath);
        const ageMinutes = Math.round((Date.now() - logStat.mtimeMs) / 60000);
        lastLog = ageMinutes < 1 ? 'just now' : `${ageMinutes}m ago`;
      }
    } catch {
      // Log check failed
    }

    const logInfo = lastLog ? ` | Last log: ${lastLog}` : '';
    fields.push({
      name: `${agent.color} ${agent.name} (${agent.role})`,
      value: `${status} | Tool: ${agent.tool}${logInfo}`,
      inline: false,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(runningCount > 0 ? 0x27ae60 : 0xe74c3c)
    .setTitle('\u{1F916} Agent Status Dashboard')
    .setDescription(`${runningCount}/${AGENTS.length} agents online`)
    .addFields(fields)
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

export async function cmdDashboard(
  message: Message,
  _client: Client,
): Promise<void> {
  const channel = message.channel as TextChannel;
  const projectSlug = findProjectSlugForChannel(channel);

  if (!projectSlug) {
    await message.reply('\u26A0\u{FE0F} Could not determine project context.');
    return;
  }

  const coordDir = path.resolve(
    process.cwd(),
    'groups',
    'shared_project',
    'active',
    projectSlug,
    'coordination',
  );

  try {
    const fields = [];

    // Read status-board.md
    const statusPath = path.join(coordDir, 'status-board.md');
    if (fs.existsSync(statusPath)) {
      const content = fs.readFileSync(statusPath, 'utf8');
      const statusMatch = content.match(/## Overall Status:\s*(.+)/);
      fields.push({
        name: '\u{1F3AF} Overall Status',
        value: statusMatch ? statusMatch[1].trim() : 'Unknown',
        inline: true,
      });
    }

    // Read dependencies.md for blockers
    const depsPath = path.join(coordDir, 'dependencies.md');
    if (fs.existsSync(depsPath)) {
      const content = fs.readFileSync(depsPath, 'utf8');
      const blockedCount = (content.match(/\| blocked \|/gi) || []).length;
      const pendingCount = (content.match(/\| pending \|/gi) || []).length;
      fields.push({
        name: '\u{1F517} Dependencies',
        value: `${blockedCount} blocked, ${pendingCount} pending`,
        inline: true,
      });
    }

    // Read integration-points.md
    const intPath = path.join(coordDir, 'integration-points.md');
    if (fs.existsSync(intPath)) {
      const content = fs.readFileSync(intPath, 'utf8');
      const handoffCount = (content.match(/###\s/g) || []).length;
      fields.push({
        name: '\u{1F504} Handoffs',
        value: `${handoffCount} integration points`,
        inline: true,
      });
    }

    // Count work streams
    const wsDir = path.resolve(
      process.cwd(),
      'groups',
      'shared_project',
      'active',
      projectSlug,
      'workstreams',
    );
    if (fs.existsSync(wsDir)) {
      const streams = fs
        .readdirSync(wsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory());
      fields.push({
        name: '\u{1F527} Work Streams',
        value: `${streams.length} active`,
        inline: true,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`\u{1F4CA} Project Dashboard: ${projectSlug}`)
      .setDescription(
        `Workspace: \`active/${projectSlug}/\`\n` +
          `Use \`!stream_status\` for detailed per-stream progress.`,
      )
      .addFields(fields)
      .setFooter({ text: 'Data from coordination/ files' })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  } catch (err: any) {
    await message.reply(`\u274C Error reading dashboard: ${err.message}`);
  }
}

export async function cmdBlocker(
  message: Message,
  _client: Client,
): Promise<void> {
  const raw = message.content.slice('!blocker'.length).trim();
  const description = raw.replace(/^"|"$/g, '');

  if (!description) {
    await message.reply(
      'Usage: `!blocker "API contract mismatch blocking frontend"`',
    );
    return;
  }

  const channel = message.channel as TextChannel;
  const projectSlug = findProjectSlugForChannel(channel);

  // Write to dependencies.md
  if (projectSlug) {
    const depsPath = path.resolve(
      process.cwd(),
      'groups',
      'shared_project',
      'active',
      projectSlug,
      'coordination',
      'dependencies.md',
    );

    try {
      if (fs.existsSync(depsPath)) {
        await withFileLock(depsPath, () => {
          let content = fs.readFileSync(depsPath, 'utf8');
          const id = `BLK-${Date.now().toString(36).slice(-4).toUpperCase()}`;
          content += `| ${id} | ${channel.name} | TBD | blocked | ${description} |\n`;
          fs.writeFileSync(depsPath, content, 'utf8');
        });
      }
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to write blocker');
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0xe91e63)
    .setTitle('\u{1F6A8} BLOCKER ESCALATION')
    .setDescription('**Requires human decision**')
    .addFields(
      { name: 'Issue', value: description, inline: false },
      {
        name: 'Source',
        value: `#${channel.name}`,
        inline: true,
      },
      {
        name: 'Raised By',
        value: message.author.username,
        inline: true,
      },
    )
    .setTimestamp();

  await message.reply({ embeds: [embed] });

  // Cross-post to control-room
  if (message.guild && channel.parentId) {
    const controlRoom = message.guild.channels.cache.find(
      (c) => c.name === 'control-room' && c.parentId === channel.parentId,
    ) as TextChannel | undefined;
    if (controlRoom && controlRoom.id !== channel.id) {
      await controlRoom.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe91e63)
            .setTitle(`\u{1F6A8} Blocker from #${channel.name}`)
            .setDescription(
              `**${description}**\n\nRaised by ${message.author.username}. Needs resolution.`,
            )
            .setTimestamp(),
        ],
      });
    }
  }
}

export async function cmdLogs(
  message: Message,
  _client: Client,
): Promise<void> {
  const args = message.content.split(' ').slice(1);
  const agentName = args[0]?.toLowerCase();

  if (!agentName) {
    const validNames = AGENTS.map((a) => a.name.toLowerCase()).join(', ');
    await message.reply(
      `Usage: \`!logs <agent>\`\nValid agents: ${validNames}`,
    );
    return;
  }

  const agent = AGENTS.find((a) => a.name.toLowerCase() === agentName);
  if (!agent) {
    const validNames = AGENTS.map((a) => a.name.toLowerCase()).join(', ');
    await message.reply(
      `Unknown agent "${agentName}". Valid agents: ${validNames}`,
    );
    return;
  }

  const logPath = path.resolve(
    process.cwd(),
    'agents',
    'logs',
    `${agentName}.log`,
  );
  if (!fs.existsSync(logPath)) {
    await message.reply(`No log file found for ${agent.name}.`);
    return;
  }

  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n');
    const last30 = lines.slice(-31).join('\n').trim(); // -31 to account for trailing newline
    const truncated = last30.length > 1800 ? last30.slice(-1800) : last30;

    const embed = new EmbedBuilder()
      .setColor(AGENT_COLORS[agent.name] || 0x5865f2)
      .setTitle(`\u{1F4CB} ${agent.name} \u2014 Recent Logs`)
      .setDescription(`\`\`\`\n${truncated || '(empty)'}\n\`\`\``)
      .setFooter({ text: `Log file: agents/logs/${agentName}.log` })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  } catch (err: any) {
    await message.reply(
      `Failed to read logs for ${agent.name}: ${err.message}`,
    );
  }
}
