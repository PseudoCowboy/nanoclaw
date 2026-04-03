/**
 * Agent Runner — Core module for NanoClaw agent bots.
 *
 * Each agent bot is a thin Discord.js wrapper that pipes messages into
 * NanoClaw containers via runContainerAgent(). This module provides the
 * shared logic for all agent bots.
 */
import {
  Client,
  GatewayIntentBits,
  TextChannel,
  EmbedBuilder,
  Partials,
  Message,
} from 'discord.js';
import { ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import pino from 'pino';

import {
  runContainerAgent,
  ContainerOutput,
} from '../../src/container-runner.js';
import { RegisteredGroup } from '../../src/types.js';
import { GROUPS_DIR } from '../../src/config.js';
import type { AgentBotOpts } from './types.js';

const MAX_DISCORD_LENGTH = 2000;
const MAX_CONTEXT_MESSAGES = 50;

export function createAgentBot(opts: AgentBotOpts): void {
  const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: { target: 'pino-pretty', options: { colorize: true } },
  }).child({ agent: opts.name });

  const token = process.env[opts.tokenEnvVar];
  if (!token) {
    logger.fatal(
      { envVar: opts.tokenEnvVar },
      `${opts.name}: Discord token not set`,
    );
    process.exit(1);
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  // Track active containers to prevent double-processing
  const activeChannels = new Set<string>();

  client.once('ready', (readyClient) => {
    logger.info(
      { username: readyClient.user.tag, id: readyClient.user.id },
      `${opts.name} bot connected`,
    );
  });

  client.on('messageCreate', async (message: Message) => {
    try {
      await handleMessage(message, client, opts, activeChannels, logger);
    } catch (err) {
      logger.error({ err }, `${opts.name}: Error handling message`);
    }
  });

  client.on('error', (err) => {
    logger.error({ err: err.message }, `${opts.name}: Discord client error`);
  });

  client.login(token).catch((err) => {
    logger.fatal({ err }, `${opts.name}: Failed to login`);
    process.exit(1);
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info(`${opts.name}: Shutting down`);
    client.destroy();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

/**
 * Check if a channel name matches a pattern (with wildcard support).
 */
function matchesChannelName(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith('-*')) {
      const prefix = pattern.slice(0, -1); // Remove trailing *
      return name.startsWith(prefix);
    }
    if (pattern.includes('*')) {
      const regex = new RegExp(
        '^' + pattern.replace(/\*/g, '.*') + '$',
        'i',
      );
      return regex.test(name);
    }
    return name === pattern;
  });
}

/**
 * Check if a message should trigger this agent.
 */
function shouldTrigger(
  message: Message,
  client: Client,
  opts: AgentBotOpts,
): boolean {
  // Check @mention
  const botId = client.user?.id;
  if (botId && message.mentions.has(botId)) return true;

  // Check trigger names in message content
  const content = message.content.toLowerCase();
  return opts.triggerNames.some((trigger) => {
    const pattern = new RegExp(`@${trigger}\\b`, 'i');
    return pattern.test(content);
  });
}

/**
 * Format recent messages from a Discord channel into XML for the container.
 */
async function getChannelContext(channel: TextChannel): Promise<string> {
  try {
    const fetched = await channel.messages.fetch({ limit: MAX_CONTEXT_MESSAGES });
    const messages = Array.from(fetched.values())
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const lines = messages.map((m) => {
      const name = m.member?.displayName || m.author.displayName || m.author.username;
      const time = m.createdAt.toISOString();
      const content = escapeXml(m.content);
      return `<message sender="${escapeXml(name)}" time="${time}">${content}</message>`;
    });

    return `<messages>\n${lines.join('\n')}\n</messages>`;
  } catch (err) {
    return '<messages>(failed to fetch channel context)</messages>';
  }
}

function escapeXml(s: string): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Extract agent branch name from a message string.
 * Matches Iris patterns like:
 *   `(branch: \`agent/atlas/backend\`)`
 *   `Fix on branch \`agent/atlas/backend\``
 */
function extractBranchFromMessage(content: string): string | null {
  // Pattern 1: (branch: `branchName`)
  const match1 = content.match(/\(branch:\s*`([^`]+)`\)/);
  if (match1) return match1[1];

  // Pattern 2: Fix on branch `branchName`
  const match2 = content.match(/branch\s*`([^`]+)`/);
  if (match2) return match2[1];

  return null;
}

/**
 * Search recent channel messages for branch info from Iris.
 * Falls back to scanning the last few messages when the trigger message itself
 * doesn't contain branch info.
 */
async function extractBranchFromRecentMessages(channel: TextChannel): Promise<string | null> {
  try {
    const fetched = await channel.messages.fetch({ limit: 10 });
    // Search from newest to oldest for branch info
    for (const msg of fetched.values()) {
      if (!msg.author.bot) continue;
      const branch = extractBranchFromMessage(msg.content);
      if (branch) return branch;
    }
  } catch {
    // Ignore fetch errors — branch isolation is best-effort
  }
  return null;
}

/**
 * Split a message into Discord-safe chunks.
 */
function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > maxLength) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      if (line.length > maxLength) {
        for (let i = 0; i < line.length; i += maxLength) {
          chunks.push(line.slice(i, i + maxLength));
        }
        continue;
      }
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) chunks.push(current);

  return chunks;
}

/**
 * Resolve project slug from a Discord channel's category name.
 */
function resolveProjectSlug(channel: TextChannel): string | null {
  if (!channel.parent) return null;
  return channel.parent.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Handle an incoming Discord message.
 */
async function handleMessage(
  message: Message,
  client: Client,
  opts: AgentBotOpts,
  activeChannels: Set<string>,
  logger: pino.Logger,
): Promise<void> {
  // Skip own messages
  if (message.author.id === client.user?.id) return;

  // Skip bot messages based on listenToBots config:
  // - false: ignore all bot messages
  // - true: listen to all bot messages (for planning agents that debate each other)
  // - "iris-only": only listen to Iris (the orchestrator bot), ignore other agent bots
  if (message.author.bot) {
    if (!opts.listenToBots) return;
    if (opts.listenToBots === 'iris-only') {
      // Check against known Iris bot ID (stable identifier) or fall back to name match
      const irisBotId = process.env.IRIS_BOT_ID;
      let isIris = false;
      if (irisBotId) {
        isIris = message.author.id === irisBotId;
      } else {
        // Fallback: name-based detection (less robust, but works without config)
        const authorName = (message.member?.displayName || message.author.displayName || message.author.username).toLowerCase();
        isIris = authorName.includes('iris');
      }
      if (!isIris) return;
    }
  }

  // Must be in a guild text channel
  if (!message.guild) return;
  const channel = message.channel as TextChannel;
  const projectSlug = resolveProjectSlug(channel);

  // Check channel name matches configured channels
  if (!matchesChannelName(channel.name, opts.channelNames)) return;

  // Check if this message triggers the agent
  if (!shouldTrigger(message, client, opts)) return;

  // Avoid double-processing if already active on this channel
  if (activeChannels.has(channel.id)) {
    logger.debug({ channel: channel.name }, 'Already processing in this channel');
    return;
  }

  logger.info(
    {
      channel: channel.name,
      author: message.author.username,
      content: message.content.slice(0, 100),
    },
    `${opts.name}: Triggered`,
  );

  activeChannels.add(channel.id);

  try {
    // Send typing indicator
    await channel.sendTyping();

    // Build context from recent channel messages
    const prompt = await getChannelContext(channel);

    // Extract agent branch name from Iris trigger messages in channel.
    // Iris includes `(branch: \`agent/...\`)` or `Fix on branch \`agent/...\``
    // in workstream trigger messages. Parse the most recent one.
    const branchName = extractBranchFromMessage(message.content)
      || await extractBranchFromRecentMessages(channel);

    // Build the RegisteredGroup for container-runner
    const groupDir = path.resolve(GROUPS_DIR, opts.groupFolder);
    fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

    const group: RegisteredGroup = {
      name: opts.name,
      folder: opts.groupFolder,
      trigger: `@${opts.triggerNames[0]}`,
      added_at: new Date().toISOString(),
      requiresTrigger: true,
      isMain: false,
    };

    // Keep typing indicator alive during processing
    const typingInterval = setInterval(() => {
      channel.sendTyping().catch(() => {});
    }, 8000);

    let responseText = '';

    const output = await runContainerAgent(
      group,
      {
        prompt,
        groupFolder: opts.groupFolder,
        chatJid: `dc:${channel.id}`,
        isMain: false,
        assistantName: opts.name,
        projectSlug: projectSlug || undefined,
        branchName: branchName || undefined,
      },
      (_proc: ChildProcess, _containerName: string) => {
        // Container registered — no special handling needed for agent bots
      },
      async (result: ContainerOutput) => {
        // Streaming callback — send results to Discord as they arrive
        if (result.result) {
          const raw =
            typeof result.result === 'string'
              ? result.result
              : JSON.stringify(result.result);
          // Strip <internal>...</internal> blocks
          const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
          if (text) {
            responseText += text;
            await sendAgentResponse(channel, opts, text);
          }
        }
      },
    );

    clearInterval(typingInterval);

    // If no streaming output was sent and container had an error, send error message
    if (!responseText && output.status === 'error') {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle(`${opts.emoji} ${opts.name} — Error`)
        .setDescription(
          output.error?.slice(0, 500) || 'Container execution failed',
        )
        .setFooter({ text: `${opts.name} Agent` })
        .setTimestamp();
      await channel.send({ embeds: [errorEmbed] });
    }
  } finally {
    activeChannels.delete(channel.id);
  }
}

/**
 * Send agent response to Discord with branding.
 */
async function sendAgentResponse(
  channel: TextChannel,
  opts: AgentBotOpts,
  text: string,
): Promise<void> {
  // For short messages, use embeds for branding
  if (text.length <= 4000) {
    const embed = new EmbedBuilder()
      .setColor(opts.color)
      .setDescription(text)
      .setFooter({ text: `${opts.emoji} ${opts.name} — ${opts.role}` })
      .setTimestamp();
    await channel.send({ embeds: [embed] });
  } else {
    // For long messages, split into plain text with header
    const chunks = splitMessage(text, MAX_DISCORD_LENGTH - 50);
    for (let i = 0; i < chunks.length; i++) {
      const prefix = i === 0 ? `**${opts.emoji} ${opts.name}:**\n` : '';
      await channel.send(`${prefix}${chunks[i]}`);
    }
  }
}
