import {
  Client,
  GatewayIntentBits,
  TextChannel,
  AttachmentBuilder,
  Partials,
  Message,
} from 'discord.js';
import fs from 'fs';

import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import { splitMessage } from './utils.js';
import { Channel } from '../types.js';
import {
  handleCommand,
  setRegisterGroupCallback,
  getProjectSlugForChannel,
  getBranchForChannel,
  rehydrateOrchestrationState,
} from './discord-commands.js';

export class DiscordChannel implements Channel {
  name = 'discord';

  private client: Client | null = null;
  private opts: ChannelOpts;
  private botToken: string;

  constructor(botToken: string, opts: ChannelOpts) {
    this.botToken = botToken;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel], // Required for DMs
    });

    return new Promise<void>((resolve, reject) => {
      this.client!.once('ready', (readyClient) => {
        logger.info(
          { username: readyClient.user.tag, id: readyClient.user.id },
          'Discord bot connected',
        );
        console.log(`\n  Discord bot: ${readyClient.user.tag}`);
        console.log(
          `  Mention @${readyClient.user.username} or use @${ASSISTANT_NAME} to trigger\n`,
        );
        setRegisterGroupCallback((jid, name, folder, trigger) => {
          this.opts.registerGroup(jid, name, folder, trigger);
        });

        // Rehydrate persisted stream watchers after Discord is ready
        const guild = readyClient.guilds.cache.first();
        if (guild) {
          rehydrateOrchestrationState(readyClient, guild).catch((err: any) => {
            logger.error({ err }, 'Error rehydrating orchestration state');
          });
        }

        resolve();
      });

      this.client!.on('messageCreate', (message) => {
        this.handleMessage(message).catch((err) => {
          logger.error({ err }, 'Error handling Discord message');
        });
      });

      this.client!.on('error', (err) => {
        logger.error({ err: err.message }, 'Discord client error');
      });

      this.client!.login(this.botToken).catch(reject);
    });
  }

  private async handleMessage(message: Message): Promise<void> {
    // Skip own messages
    if (message.author.id === this.client?.user?.id) return;

    // Skip other bot messages
    if (message.author.bot) return;

    // Handle ! commands before normal message processing
    if (message.content.trim().startsWith('!') && this.client) {
      const handled = await handleCommand(message, this.client);
      if (handled) return;
    }

    const chatJid = `dc:${message.channelId}`;
    const timestamp = message.createdAt.toISOString();
    const senderName =
      message.member?.displayName ||
      message.author.displayName ||
      message.author.username;
    const sender = message.author.id;
    const msgId = message.id;

    // Determine chat name
    let chatName: string;
    let isGroup: boolean;
    if (message.guild) {
      // Server channel
      const channel = message.channel as TextChannel;
      chatName = `${message.guild.name} / #${channel.name}`;
      isGroup = true;
    } else {
      // DM
      chatName = senderName;
      isGroup = false;
    }

    // Build content - translate @bot mentions into trigger format
    let content = message.content;
    const botId = this.client?.user?.id;
    if (botId && content.includes(`<@${botId}>`)) {
      // Replace Discord mention with trigger pattern
      content = content.replace(
        new RegExp(`<@${botId}>`, 'g'),
        `@${ASSISTANT_NAME}`,
      );
      // Ensure trigger pattern is at start if not already
      if (!TRIGGER_PATTERN.test(content.trim())) {
        content = `@${ASSISTANT_NAME} ${content.trim()}`;
      }
    }

    // Handle attachments as placeholders
    if (message.attachments.size > 0) {
      const attachmentNames = message.attachments.map(
        (a) => `[Attachment: ${a.name || 'file'}]`,
      );
      if (content) {
        content = `${content}\n${attachmentNames.join('\n')}`;
      } else {
        content = attachmentNames.join('\n');
      }
    }

    // Skip empty messages
    if (!content.trim()) return;

    // Store chat metadata for discovery
    this.opts.onChatMetadata(chatJid, timestamp, chatName, 'discord', isGroup);

    // Only deliver full message for registered groups
    const group = this.opts.registeredGroups()[chatJid];
    if (!group) {
      logger.debug(
        { chatJid, chatName },
        'Message from unregistered Discord channel',
      );
      return;
    }

    // Resolve project context for this channel
    const projectSlug =
      getProjectSlugForChannel(message.channelId) || undefined;
    const branchName = getBranchForChannel(message.channelId) || undefined;

    // Deliver message — startMessageLoop() will pick it up
    this.opts.onMessage(chatJid, {
      id: msgId,
      chat_jid: chatJid,
      sender,
      sender_name: senderName,
      content,
      timestamp,
      is_from_me: false,
      projectSlug,
      branchName,
    });

    logger.info(
      { chatJid, chatName, sender: senderName },
      'Discord message stored',
    );
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.client) {
      logger.warn('Discord client not initialized');
      return;
    }

    try {
      const channelId = jid.replace(/^dc:/, '');
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !('send' in channel)) {
        logger.warn({ jid }, 'Discord channel not found or not text channel');
        return;
      }

      const textChannel = channel as TextChannel;

      // Discord has a 2000 character limit per message — split if needed
      const MAX_LENGTH = 2000;
      if (text.length <= MAX_LENGTH) {
        await textChannel.send(text);
      } else {
        // Split at line boundaries when possible
        const chunks = splitMessage(text, MAX_LENGTH);
        for (const chunk of chunks) {
          await textChannel.send(chunk);
        }
      }
      logger.info({ jid, length: text.length }, 'Discord message sent');
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Discord message');
    }
  }

  async sendDocument(
    jid: string,
    filePath: string,
    caption?: string,
  ): Promise<void> {
    if (!this.client) {
      logger.warn('Discord client not initialized');
      return;
    }

    try {
      const channelId = jid.replace(/^dc:/, '');
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !('send' in channel)) {
        logger.warn({ jid }, 'Discord channel not found or not text channel');
        return;
      }

      const textChannel = channel as TextChannel;
      const attachment = new AttachmentBuilder(fs.createReadStream(filePath), {
        name: filePath.split('/').pop(),
      });

      await textChannel.send({
        content: caption || undefined,
        files: [attachment],
      });
      logger.info({ jid, filePath }, 'Discord document sent');
    } catch (err) {
      logger.error({ jid, filePath, err }, 'Failed to send Discord document');
    }
  }

  isConnected(): boolean {
    return this.client !== null && this.client.isReady();
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('dc:');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      logger.info('Discord bot stopped');
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.client || !isTyping) return;
    try {
      const channelId = jid.replace(/^dc:/, '');
      const channel = await this.client.channels.fetch(channelId);
      if (channel && 'sendTyping' in channel) {
        await (channel as TextChannel).sendTyping();
      }
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Discord typing indicator');
    }
  }

  async validateJid(jid: string): Promise<boolean> {
    if (!this.client || !this.client.isReady()) return true; // Can't validate without connection, allow it
    const channelId = jid.replace(/^dc:/, '');
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel) {
        logger.warn(
          { jid },
          'Discord JID validation failed: channel not found (may be a bot/application ID, not a channel ID)',
        );
        return false;
      }
      return true;
    } catch {
      logger.warn(
        { jid },
        'Discord JID validation failed: unable to fetch channel (may be a bot/application ID, not a channel ID)',
      );
      return false;
    }
  }
}

// Self-register at module scope
registerChannel('discord', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['DISCORD_BOT_TOKEN']);
  const token =
    process.env.DISCORD_BOT_TOKEN || envVars.DISCORD_BOT_TOKEN || '';
  if (!token) {
    logger.warn('Discord: DISCORD_BOT_TOKEN not set');
    return null;
  }
  return new DiscordChannel(token, opts);
});
