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
  WORKSTREAM_DEFS,
  AGENT_COLORS,
  HERMES_DECOMPOSE_TIMEOUT,
} from './constants.js';
import {
  activeProjects,
  activeStreamWatchers,
  channelProjectMap,
  saveChannelProjectMap,
  planningSessions,
  getRegisterGroupCallback,
} from './state.js';
import {
  slugify,
  findProjectSlugForChannel,
  initWorkstreamFolder,
  countTasks,
} from './helpers.js';
import { startStreamWatcher, stopStreamWatcher } from './stream-watcher.js';
import { startWorkspaceWatcher } from './workspace-watcher.js';
import { parsePlanForStreams } from './planning.js';
import { withFileLock } from './file-lock.js';

/**
 * Decompose an approved plan into work stream channels.
 * Usage: !decompose backend frontend qa
 * Or: !decompose (auto-detects from plan)
 */
export async function cmdDecompose(
  message: Message,
  _client: Client,
): Promise<void> {
  const args = message.content.split(' ').slice(1);
  const channel = message.channel as TextChannel;

  if (!message.guild) {
    await message.reply(
      '\u26A0\u{FE0F} This command can only be used in a server.',
    );
    return;
  }

  if (channel.name !== 'plan-room' && channel.name !== 'control-room') {
    await message.reply(
      '\u26A0\u{FE0F} `!decompose` must be used in #plan-room or #control-room.',
    );
    return;
  }

  // Determine which work streams to create
  let streamTypes = args.filter((a) => a in WORKSTREAM_DEFS);
  if (streamTypes.length === 0) {
    // Try to parse approved-plan.md for work stream hints
    const projectSlugForPlan = findProjectSlugForChannel(channel);
    if (projectSlugForPlan) {
      streamTypes = parsePlanForStreams(projectSlugForPlan);
    }
    if (streamTypes.length === 0) {
      streamTypes = ['backend', 'frontend', 'qa'];
    }
    await channel.send(
      `\u{1F50D} Detected streams: ${streamTypes.join(', ')}\n` +
        `Available: ${Object.keys(WORKSTREAM_DEFS).join(', ')}`,
    );
  }

  const projectSlug = findProjectSlugForChannel(channel);
  if (!projectSlug) {
    await message.reply(
      '\u26A0\u{FE0F} Could not determine project context. Run this in a project channel.',
    );
    return;
  }

  const onRegisterGroup = getRegisterGroupCallback();

  try {
    await message.guild.channels.fetch();

    // --- Step 1: Find the plan file ---
    let planContent = '';
    const planSources = [
      // Planning session's shared folder (inside project)
      ...Array.from(planningSessions.entries())
        .filter(([, s]) => s.topic)
        .map(([, s]) => {
          const slug = `plan-${slugify(s.topic)}`;
          return path.resolve(
            process.cwd(),
            'groups',
            'shared_project',
            'active',
            projectSlug,
            'plans',
            slug,
            'plan-v2.md',
          );
        }),
      // Legacy location (top-level, for older plans)
      ...Array.from(planningSessions.entries())
        .filter(([, s]) => s.topic)
        .map(([, s]) => {
          const slug = `plan-${slugify(s.topic)}`;
          return path.resolve(
            process.cwd(),
            'groups',
            'shared_project',
            slug,
            'plan-v2.md',
          );
        }),
      // Project workspace
      path.resolve(
        process.cwd(),
        'groups',
        'shared_project',
        'active',
        projectSlug,
        'control',
        'approved-plan.md',
      ),
      path.resolve(
        process.cwd(),
        'groups',
        'shared_project',
        'active',
        projectSlug,
        'control',
        'draft-plan.md',
      ),
    ];

    for (const planPath of planSources) {
      try {
        if (fs.existsSync(planPath)) {
          planContent = fs.readFileSync(planPath, 'utf8');
          if (planContent.trim()) {
            await channel.send(
              `\u{1F4C4} Found plan: \`${path.basename(planPath)}\``,
            );
            break;
          }
        }
      } catch {
        /* skip */
      }
    }

    // --- Step 2: Create workspace folders first ---
    for (const streamType of streamTypes) {
      const def = WORKSTREAM_DEFS[streamType];
      if (!def) continue;
      initWorkstreamFolder(projectSlug, streamType, def.agents, [
        `${streamType} deliverables (TBD)`,
      ]);
    }

    // --- Step 3: Trigger Hermes to parse plan into per-stream tasks ---
    if (planContent.trim()) {
      await channel.send(
        '\u{1F527} Triggering Hermes to parse the plan into per-stream task lists...',
      );

      const controlDir = path.resolve(
        process.cwd(),
        'groups',
        'shared_project',
        'active',
        projectSlug,
        'control',
      );
      fs.writeFileSync(
        path.join(controlDir, 'plan-for-decompose.md'),
        planContent,
        'utf8',
      );

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
        `**IMPORTANT:** Write files for ALL streams listed above. Work from \`/workspace/shared/\`.`;

      fs.writeFileSync(
        path.join(controlDir, 'decompose-instructions.md'),
        decomposeInstruction,
        'utf8',
      );

      await channel.send(
        `@Hermes \u2014 Read \`/workspace/shared/control/decompose-instructions.md\` and ` +
          `\`/workspace/shared/control/plan-for-decompose.md\`. ` +
          `Extract tasks for each work stream and write tasks.md + scope.md files. ` +
          `Work from \`/workspace/shared/\`.`,
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
        await new Promise((resolve) => setTimeout(resolve, 10_000));

        for (const st of [...pendingStreams]) {
          const tasksPath = path.resolve(
            process.cwd(),
            'groups',
            'shared_project',
            'active',
            projectSlug,
            'workstreams',
            st,
            'tasks.md',
          );
          if (fs.existsSync(tasksPath)) {
            const content = fs.readFileSync(tasksPath, 'utf8');
            if (content.includes('- [ ]') || content.includes('- [x]')) {
              pendingStreams.delete(st);
              await channel.send(`\u2705 tasks.md ready for \`${st}\``);
            }
          }
        }
      }

      if (timedOut && pendingStreams.size > 0) {
        await channel.send(
          `\u26A0\u{FE0F} Hermes did not write tasks.md for: ${[...pendingStreams].join(', ')}. ` +
            'Proceeding with generic scope for those streams.',
        );
      }
    } else {
      await channel.send(
        '\u2139\u{FE0F} No plan file found. Creating streams with generic scope. ' +
          'Agents will need to read their scope and define tasks themselves.',
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
        await channel.send(`  \u23E9 #${def.channel} already exists, skipping`);
        continue;
      }

      const wsChan = await message.guild!.channels.create({
        name: def.channel,
        type: ChannelType.GuildText,
        parent: channel.parentId!,
        topic: `${def.emoji} ${def.topic}\n\n**Workspace**: \`active/${projectSlug}/workstreams/${streamType}/\``,
      });

      // Register work stream channel with NanoClaw so Iris receives messages
      if (onRegisterGroup) {
        onRegisterGroup(
          `dc:${wsChan.id}`,
          `${projectSlug} / #${def.channel}`,
          'iris',
          '@Iris',
        );
      }
      channelProjectMap.set(wsChan.id, projectSlug);
      saveChannelProjectMap();

      const tasksPath = path.resolve(
        process.cwd(),
        'groups',
        'shared_project',
        'active',
        projectSlug,
        'workstreams',
        streamType,
        'tasks.md',
      );
      const hasTasks = fs.existsSync(tasksPath);

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
            name: '\u{1F4C2} Workspace',
            value:
              `\`/workspace/shared/workstreams/${streamType}/\`\n\n` +
              (hasTasks
                ? '\u2022 `tasks.md` \u2014 Checklist of tasks from the plan\n'
                : '') +
              '\u2022 `scope.md` \u2014 Deliverables and boundaries\n' +
              '\u2022 `progress.md` \u2014 Status updates (agent-maintained)\n' +
              '\u2022 `handoffs.md` \u2014 Cross-team integration points',
          },
          {
            name: '\u{1F916} Assigned Agents',
            value: def.agents.join(', '),
            inline: true,
          },
          {
            name: '\u{1F4CB} Workflow',
            value: hasTasks
              ? '1. Read `tasks.md` \u2014 pick first unchecked task\n' +
                '2. Implement on your agent branch\n' +
                '3. Update tasks.md + task-state.json to `implemented`\n' +
                '4. Argus reviews \u2192 approved or changes requested\n' +
                '5. Iris advances to next task after approval'
              : '`!handoff from to "desc"` \u2014 Create handoff\n' +
                '`!stream_status` \u2014 Show progress\n' +
                '`!blocker "issue"` \u2014 Escalate',
            inline: true,
          },
        )
        .setTimestamp();

      await wsChan.send({ embeds: [wsEmbed] });

      if (hasTasks) {
        await wsChan.send(
          `@${def.agents[0]} \u2014 Read \`workstreams/${streamType}/tasks.md\` and begin with the first unchecked task. ` +
            `Follow the \`discord-workstream\` skill: implement, update task-state.json to \`implemented\`, commit, and post a summary. ` +
            `Argus will review before the next task starts. Work on your agent branch from \`/workspace/shared/workstreams/${streamType}/\`.`,
        );
      } else {
        await wsChan.send(
          `@${def.agents[0]} \u2014 Read your scope at \`workstreams/${streamType}/scope.md\` and begin work. ` +
            'Update `progress.md` as you go.',
        );
      }

      createdChannels.push(def.channel);

      const project = activeProjects.get(projectSlug);
      if (project) {
        project.workStreams.set(streamType, def);
      }

      // Start stream watcher for this channel
      startStreamWatcher(
        _client,
        message.guild,
        projectSlug,
        streamType,
        wsChan.id,
        channel.parentId!,
      );
    }

    // Write decomposition file
    const decompPath = path.resolve(
      process.cwd(),
      'groups',
      'shared_project',
      'active',
      projectSlug,
      'control',
      'decomposition.md',
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

    const summaryEmbed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('\u{1F527} Work Streams Created')
      .setDescription(
        `Decomposed plan into ${createdChannels.length} work streams.\n` +
          `Each agent works through \`workstreams/*/tasks.md\` one task at a time.\n` +
          'Iris monitors each stream for progress, silence, and completion.',
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

    const controlRoom = message.guild!.channels.cache.find(
      (c) => c.name === 'control-room' && c.parentId === channel.parentId,
    ) as TextChannel | undefined;
    if (controlRoom && controlRoom.id !== channel.id) {
      await controlRoom.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('\u{1F527} Plan Decomposed')
            .setDescription(
              `Work streams created: ${createdChannels.map((c) => `#${c}`).join(', ')}\n` +
                'Agents have been triggered with task lists. Iris is monitoring each stream.',
            )
            .setTimestamp(),
        ],
      });
    }
  } catch (err: any) {
    await message.reply(`\u274C Error decomposing plan: ${err.message}`);
  }
}

/**
 * Add a single work stream channel to the current project.
 */
export async function cmdAddStream(
  message: Message,
  _client: Client,
): Promise<void> {
  const args = message.content.split(' ').slice(1);
  const streamType = args[0]?.toLowerCase();

  if (!streamType || !(streamType in WORKSTREAM_DEFS)) {
    await message.reply(
      `Usage: \`!add_stream <type>\`\nAvailable: ${Object.keys(WORKSTREAM_DEFS).join(', ')}`,
    );
    return;
  }

  // Delegate to decompose with a single stream
  message.content = `!decompose ${streamType}`;
  await cmdDecompose(message, _client);
}

/**
 * Create a cross-team handoff between work streams.
 */
export async function cmdHandoff(
  message: Message,
  _client: Client,
): Promise<void> {
  const raw = message.content.slice('!handoff'.length).trim();
  const match = raw.match(/^(\w+)\s+(\w+)\s+"(.+?)"|^(\w+)\s+(\w+)\s+(.+)$/);

  if (!match) {
    await message.reply(
      'Usage: `!handoff backend frontend "API contract for user endpoints"`',
    );
    return;
  }

  const from = match[1] || match[4];
  const to = match[2] || match[5];
  const description = match[3] || match[6];

  const channel = message.channel as TextChannel;
  const projectSlug = findProjectSlugForChannel(channel);

  if (!projectSlug) {
    await message.reply('\u26A0\u{FE0F} Could not determine project context.');
    return;
  }

  // Write to coordination/integration-points.md
  const intPath = path.resolve(
    process.cwd(),
    'groups',
    'shared_project',
    'active',
    projectSlug,
    'coordination',
    'integration-points.md',
  );

  try {
    await withFileLock(intPath, () => {
      let content = '';
      if (fs.existsSync(intPath)) {
        content = fs.readFileSync(intPath, 'utf8');
      }

      const handoffEntry =
        `\n### ${from} \u2192 ${to}\n` +
        `- **Description**: ${description}\n` +
        `- **Status**: Pending\n` +
        `- **Created**: ${new Date().toISOString()}\n` +
        `- **Created by**: ${message.author.username}\n`;

      content = content.replace('*None yet.*', '');
      content += handoffEntry;

      fs.writeFileSync(intPath, content, 'utf8');
    });

    // Also append to both work stream handoffs.md files
    for (const ws of [from, to]) {
      const handoffsPath = path.resolve(
        process.cwd(),
        'groups',
        'shared_project',
        'active',
        projectSlug,
        'workstreams',
        ws,
        'handoffs.md',
      );
      if (fs.existsSync(handoffsPath)) {
        await withFileLock(handoffsPath, () => {
          let wsContent = fs.readFileSync(handoffsPath, 'utf8');
          const section =
            ws === from
              ? '## Outgoing (this stream provides)'
              : '## Incoming (this stream needs)';
          wsContent = wsContent.replace(
            `${section}\n\n*None defined yet.*`,
            `${section}\n\n- ${description} (${ws === from ? `\u2192 ${to}` : `\u2190 ${from}`}) [Pending]`,
          );
          fs.writeFileSync(handoffsPath, wsContent, 'utf8');
        });
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`\u{1F517} Handoff Created: ${from} \u2192 ${to}`)
      .setDescription(description)
      .addFields(
        { name: 'From', value: from, inline: true },
        { name: 'To', value: to, inline: true },
        { name: 'Status', value: 'Pending', inline: true },
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });

    // Notify target work stream channel
    if (message.guild && channel.parentId) {
      const targetDef = WORKSTREAM_DEFS[to];
      if (targetDef) {
        const targetChan = message.guild.channels.cache.find(
          (c) =>
            c.name === targetDef.channel && c.parentId === channel.parentId,
        ) as TextChannel | undefined;
        if (targetChan) {
          await targetChan.send(
            `\u{1F517} **Incoming handoff from ${from}**: ${description}\n` +
              `@${targetDef.agents[0]} \u2014 Check \`workstreams/${to}/handoffs.md\` for details.`,
          );
        }
      }
    }
  } catch (err: any) {
    await message.reply(`\u274C Error creating handoff: ${err.message}`);
  }
}

/**
 * Show work stream progress from the file-based coordination files.
 */
export async function cmdStreamStatus(
  message: Message,
  _client: Client,
): Promise<void> {
  const channel = message.channel as TextChannel;
  const projectSlug = findProjectSlugForChannel(channel);

  if (!projectSlug) {
    await message.reply(
      '\u26A0\u{FE0F} Could not determine project context. Use this in a project channel.',
    );
    return;
  }

  const wsDir = path.resolve(
    process.cwd(),
    'groups',
    'shared_project',
    'active',
    projectSlug,
    'workstreams',
  );

  if (!fs.existsSync(wsDir)) {
    await message.reply(
      'No work streams found. Use `!decompose` to create them.',
    );
    return;
  }

  try {
    const streams = fs
      .readdirSync(wsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    if (streams.length === 0) {
      await message.reply(
        'No work streams found. Use `!decompose` to create them.',
      );
      return;
    }

    const fields = [];
    for (const stream of streams) {
      const progressPath = path.join(wsDir, stream, 'progress.md');
      let summary = 'No progress file';
      if (fs.existsSync(progressPath)) {
        const content = fs.readFileSync(progressPath, 'utf8');
        // Extract the first few meaningful lines
        const lines = content
          .split('\n')
          .filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('*'))
          .slice(0, 3);
        summary = lines.length > 0 ? lines.join('\n') : 'No updates yet';
      }

      const def = WORKSTREAM_DEFS[stream];
      const emoji = def?.emoji || '\u{1F4C1}';
      const agents = def?.agents.join(', ') || 'Unassigned';

      fields.push({
        name: `${emoji} ${stream}`,
        value: `**Agents**: ${agents}\n${summary}`,
        inline: false,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('\u{1F4CA} Work Stream Status')
      .setDescription(`Project: \`active/${projectSlug}/\``)
      .addFields(fields)
      .setFooter({
        text: 'Status read from workstreams/*/progress.md',
      })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  } catch (err: any) {
    await message.reply(`\u274C Error reading stream status: ${err.message}`);
  }
}
