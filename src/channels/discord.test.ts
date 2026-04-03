import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// --- Mocks ---

vi.mock('./registry.js', () => ({ registerChannel: vi.fn() }));
vi.mock('../env.js', () => ({ readEnvFile: vi.fn(() => ({})) }));
vi.mock('../config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  TRIGGER_PATTERN: /^@Andy\b/i,
}));
vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// --- discord.js mock ---

type Handler = (...args: any[]) => any;

const clientRef = vi.hoisted(() => ({ current: null as any }));

const mockSend = vi.fn().mockResolvedValue(undefined);
const mockSendTyping = vi.fn().mockResolvedValue(undefined);

const mockTextChannel = {
  send: mockSend,
  sendTyping: mockSendTyping,
  name: 'general',
};

vi.mock('discord.js', () => ({
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    MessageContent: 4,
    DirectMessages: 8,
  },
  Partials: { Channel: 0 },
  Client: class MockClient {
    user = { id: 'bot123', tag: 'Andy#0001', username: 'Andy' };
    eventHandlers = new Map<string, Handler[]>();
    loginCalled = false;

    constructor() {
      clientRef.current = this;
    }

    once(event: string, handler: Handler) {
      const existing = this.eventHandlers.get(event) || [];
      existing.push(handler);
      this.eventHandlers.set(event, existing);
    }

    on(event: string, handler: Handler) {
      const existing = this.eventHandlers.get(event) || [];
      existing.push(handler);
      this.eventHandlers.set(event, existing);
    }

    async login(_token: string) {
      this.loginCalled = true;
      // Trigger the 'ready' event
      const readyHandlers = this.eventHandlers.get('ready') || [];
      for (const h of readyHandlers) h(this);
    }

    guilds = {
      cache: {
        first: () => undefined,
      },
    };

    channels = {
      fetch: vi.fn().mockResolvedValue(mockTextChannel),
    };

    isReady() {
      return this.loginCalled;
    }

    destroy() {
      this.loginCalled = false;
    }
  },
  TextChannel: class {},
  AttachmentBuilder: class MockAttachmentBuilder {
    stream: any;
    opts: any;
    constructor(stream: any, opts: any) {
      this.stream = stream;
      this.opts = opts;
    }
  },
  Message: class {},
}));

// Mock fs for sendDocument
vi.mock('fs', () => ({
  default: { createReadStream: vi.fn(() => 'mock-stream') },
}));

import { DiscordChannel } from './discord.js';
import { ChannelOpts } from './registry.js';

// --- Test helpers ---

function createTestOpts(overrides?: Partial<ChannelOpts>): ChannelOpts {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups: vi.fn(() => ({
      'dc:100200300': {
        name: 'Test Server / #general',
        folder: 'dc_test',
        trigger: '@Andy',
        added_at: '2024-01-01T00:00:00.000Z',
      },
    })),
    clearSession: vi.fn(() => true),
    registerGroup: vi.fn(),
    ...overrides,
  };
}

function currentClient() {
  return clientRef.current;
}

function createMessage(overrides: {
  channelId?: string;
  content?: string;
  authorId?: string;
  authorBot?: boolean;
  authorUsername?: string;
  authorDisplayName?: string;
  memberDisplayName?: string;
  messageId?: string;
  guildName?: string;
  channelName?: string;
  isDM?: boolean;
  attachments?: Array<{ name?: string }>;
}) {
  const channelId = overrides.channelId ?? '100200300';
  const attachmentMap = new Map(
    (overrides.attachments ?? []).map((a, i) => [String(i), a]),
  );
  (attachmentMap as any).map = function (fn: any) {
    return [...this.values()].map(fn);
  };

  return {
    author: {
      id: overrides.authorId ?? 'user456',
      bot: overrides.authorBot ?? false,
      username: overrides.authorUsername ?? 'alice',
      displayName: overrides.authorDisplayName ?? 'Alice',
    },
    member: overrides.memberDisplayName
      ? { displayName: overrides.memberDisplayName }
      : null,
    channelId,
    id: overrides.messageId ?? 'msg1',
    content: overrides.content ?? 'Hello everyone',
    createdAt: new Date('2024-01-15T12:00:00.000Z'),
    guild: overrides.isDM
      ? null
      : { name: overrides.guildName ?? 'Test Server' },
    channel: { name: overrides.channelName ?? 'general' },
    attachments: attachmentMap,
  };
}

async function triggerMessage(message: any) {
  const handlers = currentClient().eventHandlers.get('messageCreate') || [];
  for (const h of handlers) await h(message);
}

// --- Tests ---

describe('DiscordChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue(undefined);
    mockSendTyping.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Connection lifecycle ---

  describe('connection lifecycle', () => {
    it('resolves connect() when client is ready', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);

      await channel.connect();

      expect(channel.isConnected()).toBe(true);
    });

    it('registers messageCreate and error handlers on connect', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);

      await channel.connect();

      expect(currentClient().eventHandlers.has('messageCreate')).toBe(true);
      expect(currentClient().eventHandlers.has('error')).toBe(true);
    });

    it('disconnects cleanly', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);

      await channel.connect();
      expect(channel.isConnected()).toBe(true);

      await channel.disconnect();
      expect(channel.isConnected()).toBe(false);
    });

    it('isConnected() returns false before connect', () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);

      expect(channel.isConnected()).toBe(false);
    });
  });

  // --- Message handling ---

  describe('message handling', () => {
    it('delivers message for registered channel', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({ content: 'Hello everyone' });
      await triggerMessage(msg);

      expect(opts.onChatMetadata).toHaveBeenCalledWith(
        'dc:100200300',
        '2024-01-15T12:00:00.000Z',
        'Test Server / #general',
        'discord',
        true,
      );
      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:100200300',
        expect.objectContaining({
          id: 'msg1',
          chat_jid: 'dc:100200300',
          sender: 'user456',
          sender_name: 'Alice',
          content: 'Hello everyone',
          is_from_me: false,
        }),
      );
    });

    it('skips own bot messages', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({ authorId: 'bot123' });
      await triggerMessage(msg);

      expect(opts.onMessage).not.toHaveBeenCalled();
      expect(opts.onChatMetadata).not.toHaveBeenCalled();
    });

    it('skips other bot messages', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({ authorBot: true, authorId: 'otherbot' });
      await triggerMessage(msg);

      expect(opts.onMessage).not.toHaveBeenCalled();
      expect(opts.onChatMetadata).not.toHaveBeenCalled();
    });

    it('only emits metadata for unregistered channels', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({ channelId: '999999' });
      await triggerMessage(msg);

      expect(opts.onChatMetadata).toHaveBeenCalledWith(
        'dc:999999',
        expect.any(String),
        'Test Server / #general',
        'discord',
        true,
      );
      expect(opts.onMessage).not.toHaveBeenCalled();
    });

    it('uses member displayName when available', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({
        memberDisplayName: 'Alice Nickname',
        authorDisplayName: 'Alice',
      });
      await triggerMessage(msg);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:100200300',
        expect.objectContaining({ sender_name: 'Alice Nickname' }),
      );
    });

    it('falls back to author displayName without member', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({
        authorDisplayName: 'AuthorDisplay',
      });
      await triggerMessage(msg);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:100200300',
        expect.objectContaining({ sender_name: 'AuthorDisplay' }),
      );
    });

    it('identifies DMs correctly', async () => {
      const opts = createTestOpts({
        registeredGroups: vi.fn(() => ({
          'dc:100200300': {
            name: 'DM',
            folder: 'dc_dm',
            trigger: '@Andy',
            added_at: '2024-01-01T00:00:00.000Z',
          },
        })),
      });
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({ isDM: true, authorDisplayName: 'Bob' });
      await triggerMessage(msg);

      expect(opts.onChatMetadata).toHaveBeenCalledWith(
        'dc:100200300',
        expect.any(String),
        'Bob',
        'discord',
        false,
      );
    });

    it('skips empty messages', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({ content: '' });
      await triggerMessage(msg);

      expect(opts.onMessage).not.toHaveBeenCalled();
    });

    it('handles attachments as placeholders', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({
        content: 'Check this',
        attachments: [{ name: 'report.pdf' }],
      });
      await triggerMessage(msg);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:100200300',
        expect.objectContaining({
          content: 'Check this\n[Attachment: report.pdf]',
        }),
      );
    });

    it('handles attachment-only messages', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({
        content: '',
        attachments: [{ name: 'image.png' }],
      });
      await triggerMessage(msg);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:100200300',
        expect.objectContaining({
          content: '[Attachment: image.png]',
        }),
      );
    });

    it('handles attachments with missing name', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({
        content: '',
        attachments: [{}],
      });
      await triggerMessage(msg);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:100200300',
        expect.objectContaining({
          content: '[Attachment: file]',
        }),
      );
    });
  });

  // --- @mention translation ---

  describe('@mention translation', () => {
    it('translates <@botId> mention to trigger format', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({ content: '<@bot123> what time is it?' });
      await triggerMessage(msg);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:100200300',
        expect.objectContaining({
          content: '@Andy what time is it?',
        }),
      );
    });

    it('does not prepend trigger if already matches', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({ content: '@Andy <@bot123> hello' });
      await triggerMessage(msg);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:100200300',
        expect.objectContaining({
          content: '@Andy @Andy hello',
        }),
      );
    });

    it('does not translate mentions of other bots', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({ content: '<@otherbot999> hi' });
      await triggerMessage(msg);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:100200300',
        expect.objectContaining({
          content: '<@otherbot999> hi',
        }),
      );
    });

    it('handles mention in middle of message', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const msg = createMessage({ content: 'hey <@bot123> check this' });
      await triggerMessage(msg);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'dc:100200300',
        expect.objectContaining({
          content: '@Andy hey @Andy check this',
        }),
      );
    });
  });

  // --- sendMessage ---

  describe('sendMessage', () => {
    it('sends message to text channel', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      await channel.sendMessage('dc:100200300', 'Hello');

      expect(currentClient().channels.fetch).toHaveBeenCalledWith('100200300');
      expect(mockSend).toHaveBeenCalledWith('Hello');
    });

    it('strips dc: prefix from JID', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      await channel.sendMessage('dc:987654321', 'Test');

      expect(currentClient().channels.fetch).toHaveBeenCalledWith('987654321');
    });

    it('splits messages exceeding 2000 characters', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const longText = 'x'.repeat(3000);
      await channel.sendMessage('dc:100200300', longText);

      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('sends exactly one message at 2000 characters', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      const exactText = 'y'.repeat(2000);
      await channel.sendMessage('dc:100200300', exactText);

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('handles send failure gracefully', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      mockSend.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        channel.sendMessage('dc:100200300', 'Will fail'),
      ).resolves.toBeUndefined();
    });

    it('does nothing when client is not initialized', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);

      await channel.sendMessage('dc:100200300', 'No client');
      // No error
    });

    it('handles channel not found', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      currentClient().channels.fetch.mockResolvedValueOnce(null);

      await expect(
        channel.sendMessage('dc:100200300', 'Missing channel'),
      ).resolves.toBeUndefined();
    });
  });

  // --- sendDocument ---

  describe('sendDocument', () => {
    it('sends attachment with caption', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      await channel.sendDocument('dc:100200300', '/tmp/report.pdf', 'Report');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Report',
          files: expect.any(Array),
        }),
      );
    });

    it('sends attachment without caption', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      await channel.sendDocument('dc:100200300', '/tmp/file.txt');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          content: undefined,
          files: expect.any(Array),
        }),
      );
    });

    it('does nothing when client is not initialized', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);

      await channel.sendDocument('dc:100200300', '/tmp/file.txt');
      // No error
    });

    it('handles send failure gracefully', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      mockSend.mockRejectedValueOnce(new Error('Upload failed'));

      await expect(
        channel.sendDocument('dc:100200300', '/tmp/file.txt'),
      ).resolves.toBeUndefined();
    });
  });

  // --- ownsJid ---

  describe('ownsJid', () => {
    it('owns dc: JIDs', () => {
      const channel = new DiscordChannel('test-token', createTestOpts());
      expect(channel.ownsJid('dc:123456')).toBe(true);
    });

    it('does not own tg: JIDs', () => {
      const channel = new DiscordChannel('test-token', createTestOpts());
      expect(channel.ownsJid('tg:123456')).toBe(false);
    });

    it('does not own WhatsApp JIDs', () => {
      const channel = new DiscordChannel('test-token', createTestOpts());
      expect(channel.ownsJid('12345@g.us')).toBe(false);
    });

    it('does not own unknown JID formats', () => {
      const channel = new DiscordChannel('test-token', createTestOpts());
      expect(channel.ownsJid('random-string')).toBe(false);
    });
  });

  // --- setTyping ---

  describe('setTyping', () => {
    it('sends typing indicator when isTyping is true', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      await channel.setTyping('dc:100200300', true);

      expect(mockSendTyping).toHaveBeenCalled();
    });

    it('does nothing when isTyping is false', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      await channel.setTyping('dc:100200300', false);

      expect(mockSendTyping).not.toHaveBeenCalled();
    });

    it('does nothing when client is not initialized', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);

      await channel.setTyping('dc:100200300', true);
      // No error
    });

    it('handles typing indicator failure gracefully', async () => {
      const opts = createTestOpts();
      const channel = new DiscordChannel('test-token', opts);
      await channel.connect();

      mockSendTyping.mockRejectedValueOnce(new Error('Rate limited'));

      await expect(
        channel.setTyping('dc:100200300', true),
      ).resolves.toBeUndefined();
    });
  });

  // --- Channel properties ---

  describe('channel properties', () => {
    it('has name "discord"', () => {
      const channel = new DiscordChannel('test-token', createTestOpts());
      expect(channel.name).toBe('discord');
    });
  });
});
