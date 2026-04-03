import { Client, Message, EmbedBuilder, TextChannel } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { logger } from '../../logger.js';
import { WORKSTREAM_DEFS } from './constants.js';
import { findProjectSlugForChannel, parseHandoffs } from './helpers.js';
import { withFileLock } from './file-lock.js';

/**
 * !checkpoint from to — verify handoff completeness between two streams.
 */
export async function cmdCheckpoint(
  message: Message,
  _client: Client,
): Promise<void> {
  const args = message.content.split(' ').slice(1);
  const from = args[0]?.toLowerCase();
  const to = args[1]?.toLowerCase();

  if (!from || !to) {
    await message.reply(
      'Usage: `!checkpoint backend frontend` \u2014 verify handoff completeness from \u2192 to',
    );
    return;
  }

  const channel = message.channel as TextChannel;
  const projectSlug = findProjectSlugForChannel(channel);

  if (!projectSlug) {
    await message.reply('\u26A0\u{FE0F} Could not determine project context.');
    return;
  }

  const handoffsPath = path.resolve(
    process.cwd(),
    'groups',
    'shared_project',
    'active',
    projectSlug,
    'workstreams',
    from,
    'handoffs.md',
  );

  if (!fs.existsSync(handoffsPath)) {
    await message.reply(
      `\u26A0\u{FE0F} No handoffs file found for \`${from}\`. Run \`!decompose\` or \`!handoff\` first.`,
    );
    return;
  }

  const content = fs.readFileSync(handoffsPath, 'utf8');
  const outgoing = parseHandoffs(content, 'Outgoing');
  const toTarget = outgoing.filter((h) => h.target.toLowerCase() === to);

  if (toTarget.length === 0) {
    await message.reply(
      `\u{1F4AD} No handoffs found from \`${from}\` to \`${to}\`.`,
    );
    return;
  }

  const delivered = toTarget.filter((h) => h.status === 'Delivered');
  const pending = toTarget.filter((h) => h.status !== 'Delivered');

  if (pending.length === 0) {
    // All delivered — update integration-points.md
    const intPath = path.resolve(
      process.cwd(),
      'groups',
      'shared_project',
      'active',
      projectSlug,
      'coordination',
      'integration-points.md',
    );

    if (fs.existsSync(intPath)) {
      try {
        await withFileLock(intPath, () => {
          let intContent = fs.readFileSync(intPath, 'utf8');
          // Update the status for this from→to handoff
          intContent = intContent.replace(
            new RegExp(
              `(### ${from} \\u2192 ${to}[\\s\\S]*?- \\*\\*Status\\*\\*: )\\w+`,
            ),
            '$1ready',
          );
          fs.writeFileSync(intPath, intContent, 'utf8');
        });
      } catch (err: any) {
        logger.error(
          { err: err.message },
          'Failed to update integration points',
        );
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x27ae60)
      .setTitle(`\u2705 Checkpoint Passed: ${from} \u2192 ${to}`)
      .setDescription(
        `All ${delivered.length} handoff(s) from \`${from}\` to \`${to}\` are delivered.`,
      )
      .addFields(
        delivered.map((h) => ({
          name: `\u2705 ${h.description}`,
          value: `Status: ${h.status}`,
          inline: false,
        })),
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  } else {
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle(`\u{1F7E1} Checkpoint Pending: ${from} \u2192 ${to}`)
      .setDescription(
        `${delivered.length}/${toTarget.length} handoffs delivered. ${pending.length} still pending.`,
      )
      .addFields(
        ...pending.map((h) => ({
          name: `\u23F3 ${h.description}`,
          value: `Status: ${h.status}`,
          inline: false,
        })),
        ...delivered.map((h) => ({
          name: `\u2705 ${h.description}`,
          value: `Status: ${h.status}`,
          inline: false,
        })),
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }
}

/**
 * !checkpoints — list all handoff statuses across all streams.
 */
export async function cmdCheckpoints(
  message: Message,
  _client: Client,
): Promise<void> {
  const channel = message.channel as TextChannel;
  const projectSlug = findProjectSlugForChannel(channel);

  if (!projectSlug) {
    await message.reply('\u26A0\u{FE0F} Could not determine project context.');
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

    const allHandoffs: Array<{
      from: string;
      description: string;
      target: string;
      status: string;
    }> = [];

    for (const stream of streams) {
      const handoffsPath = path.join(wsDir, stream, 'handoffs.md');
      if (!fs.existsSync(handoffsPath)) continue;
      const content = fs.readFileSync(handoffsPath, 'utf8');
      const outgoing = parseHandoffs(content, 'Outgoing');
      for (const h of outgoing) {
        allHandoffs.push({ from: stream, ...h });
      }
    }

    if (allHandoffs.length === 0) {
      await message.reply(
        '\u{1F4AD} No handoffs defined yet. Use `!handoff from to "description"` to create one.',
      );
      return;
    }

    const statusEmoji: Record<string, string> = {
      Delivered: '\u2705',
      'In Progress': '\u{1F504}',
      Pending: '\u23F3',
    };

    const fields = allHandoffs.map((h) => ({
      name: `${statusEmoji[h.status] || '\u2753'} ${h.from} \u2192 ${h.target}`,
      value: `${h.description} [${h.status}]`,
      inline: false,
    }));

    const deliveredCount = allHandoffs.filter(
      (h) => h.status === 'Delivered',
    ).length;

    const embed = new EmbedBuilder()
      .setColor(deliveredCount === allHandoffs.length ? 0x27ae60 : 0xf1c40f)
      .setTitle('\u{1F4CB} All Handoff Checkpoints')
      .setDescription(
        `${deliveredCount}/${allHandoffs.length} handoffs delivered across ${streams.length} streams.`,
      )
      .addFields(fields)
      .setFooter({ text: 'Data from workstreams/*/handoffs.md' })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  } catch (err: any) {
    await message.reply(`\u274C Error reading checkpoints: ${err.message}`);
  }
}
