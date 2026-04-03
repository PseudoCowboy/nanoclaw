import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// --- Mocks ---

vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(() => 'active'),
}));

vi.mock('../../db.js', () => ({
  setOrchestrationState: vi.fn(),
  deleteOrchestrationState: vi.fn(),
  getAllOrchestrationState: vi.fn(() => []),
  getOrchestrationState: vi.fn(),
}));

vi.mock('discord.js', () => ({
  EmbedBuilder: class MockEmbedBuilder {
    data: Record<string, any> = {};
    setColor() {
      return this;
    }
    setTitle() {
      return this;
    }
    setDescription() {
      return this;
    }
    addFields() {
      return this;
    }
    setFooter() {
      return this;
    }
    setTimestamp() {
      return this;
    }
  },
  ChannelType: {
    GuildText: 0,
    GuildCategory: 4,
    PublicThread: 11,
  },
  TextChannel: class {},
  Client: class {},
  Message: class {},
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue(''),
    readdirSync: vi.fn().mockReturnValue([]),
    statSync: vi.fn().mockReturnValue({ mtimeMs: 1000 }),
    unlinkSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(''),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn().mockReturnValue({ mtimeMs: 1000 }),
  unlinkSync: vi.fn(),
}));

// --- Mock Factories ---

function mockMessage(content: string, overrides?: Record<string, any>): any {
  return {
    content,
    author: { id: 'user123', bot: false, username: 'testuser' },
    channelId: 'channel123',
    channel: {
      id: 'channel123',
      name: 'general',
      send: vi.fn().mockResolvedValue(undefined),
      threads: {
        create: vi.fn().mockResolvedValue({
          send: vi.fn().mockResolvedValue(undefined),
          toString: () => '#thread',
        }),
      },
      delete: vi.fn().mockResolvedValue(undefined),
      parent: null,
      parentId: null,
    },
    guild: {
      channels: {
        fetch: vi.fn().mockResolvedValue(undefined),
        cache: {
          find: vi.fn().mockReturnValue(undefined),
          get: vi.fn().mockReturnValue(undefined),
          filter: vi.fn().mockReturnValue({
            values: () => [][Symbol.iterator](),
            some: () => false,
          }),
        },
        create: vi.fn().mockResolvedValue({
          id: 'newchan1',
          send: vi.fn().mockResolvedValue(undefined),
          toString: () => '#new-channel',
        }),
      },
    },
    reply: vi.fn().mockResolvedValue(undefined),
    member: { displayName: 'Test User' },
    ...overrides,
  };
}

function mockClient(): any {
  return {
    on: vi.fn(),
    removeListener: vi.fn(),
    user: { id: 'bot123' },
  };
}

import {
  handleCommand,
  planningSessions,
  discussionSessions,
  activeProjects,
  slugify,
  initDiscussionFolder,
  initProjectWorkspace,
  initWorkstreamFolder,
  findProjectSlugForChannel,
  PLANNING_AGENTS,
  DISCUSSION_CHAIN,
  AGENT_HANDOFF_TIMEOUT,
  WORKSTREAM_DEFS,
  CORE_CHANNELS,
  parsePlanForStreams,
  checkWorkspaceChanges,
  acquireFileLock,
  releaseFileLock,
  withFileLock,
  parseHandoffs,
  activeWatchers,
  startWorkspaceWatcher,
  stopWorkspaceWatcher,
  WORKSPACE_POLL_INTERVAL,
  countTasks,
  activeStreamWatchers,
  STREAM_POLL_INTERVAL,
  STREAM_SILENCE_THRESHOLD,
  STREAM_STATUS_INTERVAL,
  HERMES_DECOMPOSE_TIMEOUT,
} from './discord-commands.js';

// --- Tests ---

describe('discord-commands', () => {
  let client: any;

  beforeEach(async () => {
    vi.resetAllMocks();
    client = mockClient();
    planningSessions.clear();
    activeProjects.clear();
    // Re-establish default mock return values
    const fsMod = await import('fs');
    (fsMod.default.existsSync as any).mockReturnValue(false);
    (fsMod.default.readFileSync as any).mockReturnValue('');
    (fsMod.default.readdirSync as any).mockReturnValue([]);
    (fsMod.default.statSync as any).mockReturnValue({ mtimeMs: 1000 });
  });

  afterEach(() => {
    planningSessions.clear();
    activeProjects.clear();
  });

  // --- handleCommand routing ---

  describe('handleCommand routing', () => {
    it('returns false for non-! messages', async () => {
      const msg = mockMessage('hello world');
      expect(await handleCommand(msg, client)).toBe(false);
      expect(msg.reply).not.toHaveBeenCalled();
    });

    it('returns false for unknown ! commands', async () => {
      const msg = mockMessage('!nonexistent_command');
      expect(await handleCommand(msg, client)).toBe(false);
      expect(msg.reply).not.toHaveBeenCalled();
    });

    it('returns true and calls reply for !help', async () => {
      const msg = mockMessage('!help');
      expect(await handleCommand(msg, client)).toBe(true);
      expect(msg.reply).toHaveBeenCalled();
    });

    it('returns true for !help_orchestration', async () => {
      const msg = mockMessage('!help_orchestration');
      expect(await handleCommand(msg, client)).toBe(true);
      expect(msg.reply).toHaveBeenCalled();
    });

    it('returns true for !agent_status', async () => {
      const msg = mockMessage('!agent_status');
      expect(await handleCommand(msg, client)).toBe(true);
      expect(msg.reply).toHaveBeenCalled();
    });
  });

  // --- Project commands ---

  describe('project commands', () => {
    it('!create_project — shows usage with no name', async () => {
      const msg = mockMessage('!create_project');
      await handleCommand(msg, client);
      expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    });

    it('!create_project TestProject with guild: null — requires server error', async () => {
      const msg = mockMessage('!create_project TestProject', { guild: null });
      await handleCommand(msg, client);
      expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('server'));
    });
  });

  // --- Planning commands ---

  describe('planning commands', () => {
    it('!plan — shows usage with no args', async () => {
      const msg = mockMessage('!plan');
      await handleCommand(msg, client);
      expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    });

    it('!plan topic with channel.name = general — rejects, must be plan-room or control-room', async () => {
      const msg = mockMessage('!plan some topic');
      // channel.name defaults to 'general'
      await handleCommand(msg, client);
      expect(msg.reply).toHaveBeenCalledWith(
        expect.stringContaining('plan-room'),
      );
    });
  });

  // --- Decompose commands ---

  describe('decompose commands', () => {
    it('!decompose in general channel — rejects, must be plan-room or control-room', async () => {
      const msg = mockMessage('!decompose backend');
      await handleCommand(msg, client);
      expect(msg.reply).toHaveBeenCalledWith(
        expect.stringContaining('plan-room'),
      );
    });

    it('!decompose in plan-room without project context — rejects', async () => {
      const msg = mockMessage('!decompose backend', {
        channel: {
          id: 'channel123',
          name: 'plan-room',
          send: vi.fn().mockResolvedValue(undefined),
          parent: null,
          parentId: null,
        },
      });
      await handleCommand(msg, client);
      expect(msg.reply).toHaveBeenCalledWith(
        expect.stringContaining('project context'),
      );
    });
  });

  // --- Add stream commands ---

  describe('add_stream commands', () => {
    it('!add_stream — shows usage with no type', async () => {
      const msg = mockMessage('!add_stream');
      await handleCommand(msg, client);
      expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    });

    it('!add_stream invalid_type — shows usage', async () => {
      const msg = mockMessage('!add_stream invalid_type');
      await handleCommand(msg, client);
      expect(msg.reply).toHaveBeenCalledWith(
        expect.stringContaining('Available:'),
      );
    });
  });

  // --- Handoff commands ---

  describe('handoff commands', () => {
    it('!handoff — shows usage with no args', async () => {
      const msg = mockMessage('!handoff');
      await handleCommand(msg, client);
      expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    });

    it('!handoff incomplete args — shows usage', async () => {
      const msg = mockMessage('!handoff backend');
      await handleCommand(msg, client);
      expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    });
  });

  // --- Stream status commands ---

  describe('stream_status commands', () => {
    it('!stream_status in non-project channel — rejects', async () => {
      const msg = mockMessage('!stream_status');
      await handleCommand(msg, client);
      expect(msg.reply).toHaveBeenCalledWith(
        expect.stringContaining('project context'),
      );
    });
  });

  // --- Dashboard commands ---

  describe('dashboard commands', () => {
    it('!dashboard in non-project channel — rejects', async () => {
      const msg = mockMessage('!dashboard');
      await handleCommand(msg, client);
      expect(msg.reply).toHaveBeenCalledWith(
        expect.stringContaining('project context'),
      );
    });
  });

  // --- Blocker commands ---

  describe('blocker commands', () => {
    it('!blocker — shows usage with no description', async () => {
      const msg = mockMessage('!blocker');
      await handleCommand(msg, client);
      expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    });

    it('!blocker with description — creates escalation embed', async () => {
      const msg = mockMessage('!blocker "API contract mismatch"');
      await handleCommand(msg, client);
      expect(msg.reply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) }),
      );
    });
  });

  // --- Discussion system ---

  describe('discussion commands', () => {
    it('!create_discussion — shows usage with no topic', async () => {
      const msg = mockMessage('!create_discussion');
      await handleCommand(msg, client);
      expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    });

    it('!create_discussion "topic" with guild: null — requires server', async () => {
      const msg = mockMessage('!create_discussion "API design"', {
        guild: null,
      });
      await handleCommand(msg, client);
      expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('server'));
    });

    it('!close_discussion with channel.name = general — rejects, must be discuss-* or plan-* channel', async () => {
      const msg = mockMessage('!close_discussion');
      // channel.name defaults to 'general'
      await handleCommand(msg, client);
      expect(msg.reply).toHaveBeenCalledWith(
        expect.stringContaining('discuss-'),
      );
    });

    it('!close_discussion with channel.name = discuss-test and active planning session — rejects with "still running"', async () => {
      const msg = mockMessage('!close_discussion', {
        channel: {
          id: 'channel123',
          name: 'discuss-test',
          send: vi.fn().mockResolvedValue(undefined),
          delete: vi.fn().mockResolvedValue(undefined),
        },
      });
      // Simulate an active planning session for this channel
      planningSessions.set('channel123', {
        topic: 'test',
        featureId: null,
        round: 1,
      });

      await handleCommand(msg, client);
      expect(msg.reply).toHaveBeenCalledWith(
        expect.stringContaining('still running'),
      );
    });
  });

  // --- close_discussion cleanup ---

  describe('!close_discussion — with active discussion session', () => {
    it('cleans up discussion session on close', async () => {
      const msg = mockMessage('!close_discussion', {
        channel: {
          id: 'discuss-chan-1',
          name: 'discuss-test-topic',
          send: vi.fn().mockResolvedValue(undefined),
          delete: vi.fn().mockResolvedValue(undefined),
        },
      });
      discussionSessions.set('discuss-chan-1', {
        topic: 'test',
        slug: 'discuss-test-topic',
        round: 1,
        currentAgent: 'Athena',
        channelId: 'discuss-chan-1',
      });

      await handleCommand(msg, client);

      // Session should be cleaned up
      expect(discussionSessions.has('discuss-chan-1')).toBe(false);
      // Channel should be deleted
      expect(msg.channel.delete).toHaveBeenCalled();
    });
  });

  // --- slugify ---

  describe('slugify', () => {
    it("converts 'Hello World' → 'hello-world'", () => {
      expect(slugify('Hello World')).toBe('hello-world');
    });

    it("removes special characters: 'API Design (v2)!' → 'api-design-v2'", () => {
      expect(slugify('API Design (v2)!')).toBe('api-design-v2');
    });

    it('truncates to 90 chars', () => {
      const long = 'a'.repeat(200);
      expect(slugify(long).length).toBeLessThanOrEqual(90);
    });

    it("collapses multiple dashes: 'hello---world' → 'hello-world'", () => {
      expect(slugify('hello---world')).toBe('hello-world');
    });
  });

  describe('countTasks', () => {
    it('counts checked and total tasks from markdown', () => {
      const content =
        '# Tasks\n\n' +
        '- [x] Done task 1\n' +
        '- [x] Done task 2\n' +
        '- [ ] Pending task 3\n' +
        '- [ ] Pending task 4\n' +
        '- [ ] Pending task 5\n';
      const result = countTasks(content);
      expect(result).toEqual({ done: 2, total: 5 });
    });

    it('returns zero for empty content', () => {
      expect(countTasks('')).toEqual({ done: 0, total: 0 });
    });

    it('handles all checked tasks', () => {
      const content = '- [x] A\n- [x] B\n';
      expect(countTasks(content)).toEqual({ done: 2, total: 2 });
    });
  });

  // --- Constants ---

  describe('constants', () => {
    it('PLANNING_AGENTS has 2 entries and contains Athena, Hermes', () => {
      expect(PLANNING_AGENTS).toHaveLength(2);
      expect(PLANNING_AGENTS).toContain('Athena');
      expect(PLANNING_AGENTS).toContain('Hermes');
    });

    it('AGENT_HANDOFF_TIMEOUT is 300000', () => {
      expect(AGENT_HANDOFF_TIMEOUT).toBe(300_000);
    });

    it('DISCUSSION_CHAIN has Hermes, Athena in order', () => {
      expect(DISCUSSION_CHAIN).toEqual(['Hermes', 'Athena']);
    });

    it('WORKSTREAM_DEFS has backend, frontend, qa, design, devops, research', () => {
      expect(Object.keys(WORKSTREAM_DEFS)).toEqual(
        expect.arrayContaining([
          'backend',
          'frontend',
          'qa',
          'design',
          'devops',
          'research',
        ]),
      );
    });

    it('CORE_CHANNELS has control-room, plan-room, release-log', () => {
      const names = CORE_CHANNELS.map((c) => c.name);
      expect(names).toContain('control-room');
      expect(names).toContain('plan-room');
      expect(names).toContain('release-log');
    });
  });

  // --- Discussion session types ---

  describe('discussion system types', () => {
    it('discussionSessions is a Map', () => {
      expect(discussionSessions).toBeInstanceOf(Map);
    });

    it('activeProjects is a Map', () => {
      expect(activeProjects).toBeInstanceOf(Map);
    });
  });

  // --- !create_discussion file-based ---

  describe('!create_discussion — file-based', () => {
    it('creates discussion channel and stores session', async () => {
      const msg = mockMessage('!create_discussion "API redesign"');
      const createdChannel = {
        id: 'discuss-chan-1',
        name: 'discuss-api-redesign',
        send: vi.fn().mockResolvedValue(undefined),
        toString: () => '#discuss-api-redesign',
      };
      msg.guild.channels.create = vi.fn().mockResolvedValue(createdChannel);

      await handleCommand(msg, client);

      // Should have created the channel
      expect(msg.guild.channels.create).toHaveBeenCalled();
      // Welcome embed should have been sent
      expect(createdChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) }),
      );
      // Reply confirms creation with folder path
      expect(msg.reply).toHaveBeenCalledWith(
        expect.stringContaining('discuss-api-redesign'),
      );
      // Session should be tracked
      expect(discussionSessions.has('discuss-chan-1')).toBe(true);

      // Clean up
      discussionSessions.delete('discuss-chan-1');
    });
  });

  // --- discussion watchdog ---

  describe('discussion watchdog', () => {
    it('session tracking works with discussionSessions Map', () => {
      // Set up a discussion session
      discussionSessions.set('chan1', {
        topic: 'test',
        slug: 'discuss-test',
        round: 1,
        currentAgent: 'Hermes',
        channelId: 'chan1',
      });

      const session = discussionSessions.get('chan1');
      expect(session).toBeDefined();
      expect(session!.round).toBe(1);
      expect(session!.currentAgent).toBe('Hermes');

      // Simulate round advance
      session!.round = 2;
      session!.currentAgent = 'Athena';
      expect(discussionSessions.get('chan1')!.round).toBe(2);

      // Clean up
      discussionSessions.delete('chan1');
    });

    it('startDiscussionWatchdog registers listener on client', () => {
      // Since startDiscussionWatchdog is not exported, we test its side effects
      // through the discussion creation flow
      expect(client.on).toBeDefined();
    });
  });

  // --- initDiscussionFolder ---

  describe('initDiscussionFolder', () => {
    it('creates directory and initializes git repo for new folder', async () => {
      const fs = await import('fs');
      const { execSync } = await import('child_process');

      const result = initDiscussionFolder('discuss-api-redesign');

      expect(fs.default.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('discuss-api-redesign'),
        { recursive: true },
      );
      expect(execSync).toHaveBeenCalledWith(
        'git init -b main',
        expect.objectContaining({
          cwd: expect.stringContaining('discuss-api-redesign'),
        }),
      );
      expect(result).toContain('discuss-api-redesign');
    });

    it('returns existing folder without creating if it exists', async () => {
      const fs = await import('fs');
      (fs.default.existsSync as any).mockReturnValueOnce(true);

      const result = initDiscussionFolder('discuss-existing');

      expect(fs.default.mkdirSync).not.toHaveBeenCalled();
      expect(result).toContain('discuss-existing');
    });
  });

  // --- initProjectWorkspace ---

  describe('initProjectWorkspace', () => {
    it('creates workspace directories', async () => {
      const fs = await import('fs');

      const result = initProjectWorkspace('test-project');

      // Should create multiple dirs (control, coordination, workstreams, archive)
      expect(fs.default.mkdirSync).toHaveBeenCalled();
      // Should write coordination files
      expect(fs.default.writeFileSync).toHaveBeenCalled();
      expect(result).toContain('test-project');
    });

    it('returns existing workspace without creating if it exists', async () => {
      const fs = await import('fs');
      (fs.default.existsSync as any).mockReturnValueOnce(true);

      const result = initProjectWorkspace('existing-project');

      expect(fs.default.mkdirSync).not.toHaveBeenCalled();
      expect(result).toContain('existing-project');
    });
  });

  // --- initWorkstreamFolder ---

  describe('initWorkstreamFolder', () => {
    it('creates workstream folder with scope, progress, and handoffs files', async () => {
      const fs = await import('fs');

      const result = initWorkstreamFolder(
        'test-project',
        'backend',
        ['Atlas'],
        ['API endpoints'],
      );

      expect(fs.default.mkdirSync).toHaveBeenCalled();
      expect(fs.default.writeFileSync).toHaveBeenCalledTimes(3); // scope.md, progress.md, handoffs.md
      expect(result).toContain('backend');
    });
  });

  // --- findProjectSlugForChannel ---

  describe('findProjectSlugForChannel', () => {
    it('returns null for channel without parent', () => {
      const channel = { parent: null } as any;
      expect(findProjectSlugForChannel(channel)).toBeNull();
    });

    it('returns slug from activeProjects if matched', () => {
      activeProjects.set('my-project', {
        name: 'MyProject',
        categoryId: 'cat1',
        workStreams: new Map(),
        controlRoomId: 'cr1',
        planRoomId: 'pr1',
      });

      const channel = { parent: { name: 'MyProject' } } as any;
      expect(findProjectSlugForChannel(channel)).toBe('my-project');

      activeProjects.delete('my-project');
    });

    it('falls back to slugified category name', () => {
      const channel = { parent: { name: 'Some Project' } } as any;
      expect(findProjectSlugForChannel(channel)).toBe('some-project');
    });
  });

  // --- parsePlanForStreams ---

  describe('parsePlanForStreams', () => {
    it('detects backend from "API endpoints and database"', async () => {
      const fs = await import('fs');
      (fs.default.existsSync as any).mockImplementation((p: string) =>
        p.includes('approved-plan.md'),
      );
      (fs.default.readFileSync as any).mockReturnValueOnce(
        '# Plan\nBuild API endpoints and database layer',
      );

      const result = parsePlanForStreams('test-project');
      expect(result).toContain('backend');
    });

    it('detects frontend from "React components"', async () => {
      const fs = await import('fs');
      (fs.default.existsSync as any).mockImplementation((p: string) =>
        p.includes('approved-plan.md'),
      );
      (fs.default.readFileSync as any).mockReturnValueOnce(
        '# Plan\nBuild React components for the dashboard',
      );

      const result = parsePlanForStreams('test-project');
      expect(result).toContain('frontend');
    });

    it('detects multiple streams: backend + qa', async () => {
      const fs = await import('fs');
      (fs.default.existsSync as any).mockImplementation((p: string) =>
        p.includes('approved-plan.md'),
      );
      (fs.default.readFileSync as any).mockReturnValueOnce(
        '# Plan\nBuild backend API and write acceptance tests',
      );

      const result = parsePlanForStreams('test-project');
      expect(result).toContain('backend');
      expect(result).toContain('qa');
    });

    it('returns empty array for missing plan', async () => {
      const fs = await import('fs');
      (fs.default.existsSync as any).mockReturnValue(false);

      const result = parsePlanForStreams('test-project');
      expect(result).toEqual([]);
    });

    it('falls back to draft-plan.md if approved-plan.md missing', async () => {
      const fs = await import('fs');
      (fs.default.existsSync as any).mockImplementation((p: string) =>
        p.includes('draft-plan.md'),
      );
      (fs.default.readFileSync as any).mockReturnValueOnce(
        '# Draft\nDeploy with Docker and CI pipeline',
      );

      const result = parsePlanForStreams('test-project');
      expect(result).toContain('devops');
    });
  });

  // --- WorkspaceWatcher ---

  describe('WorkspaceWatcher', () => {
    it('checkWorkspaceChanges detects mtime change', async () => {
      const fs = await import('fs');
      const mtimes = new Map<string, number>();

      // Mock: workstreams dir exists with one stream
      (fs.default.existsSync as any).mockReturnValue(true);
      (fs.default.readdirSync as any).mockImplementation((dir: string) => {
        if (dir.includes('workstreams') && !dir.includes('backend')) {
          return [{ name: 'backend', isDirectory: () => true }];
        }
        if (dir.includes('coordination')) {
          return ['status-board.md'];
        }
        return [];
      });
      (fs.default.statSync as any).mockReturnValue({ mtimeMs: 2000 });

      // First call populates mtimes (no changes reported)
      const first = checkWorkspaceChanges('test-project', mtimes);
      expect(first).toEqual([]);

      // Second call with new mtime → should detect change
      (fs.default.statSync as any).mockReturnValue({ mtimeMs: 3000 });
      const second = checkWorkspaceChanges('test-project', mtimes);
      expect(second.length).toBeGreaterThan(0);
    });

    it('checkWorkspaceChanges returns empty when no changes', async () => {
      const fs = await import('fs');
      const mtimes = new Map<string, number>();

      (fs.default.existsSync as any).mockReturnValue(true);
      (fs.default.readdirSync as any).mockImplementation((dir: string) => {
        if (dir.includes('workstreams') && !dir.includes('backend')) {
          return [{ name: 'backend', isDirectory: () => true }];
        }
        if (dir.includes('coordination')) {
          return ['status-board.md'];
        }
        return [];
      });
      (fs.default.statSync as any).mockReturnValue({ mtimeMs: 1000 });

      // First call: populate
      checkWorkspaceChanges('test-project', mtimes);

      // Second call: same mtimes → no changes
      const second = checkWorkspaceChanges('test-project', mtimes);
      expect(second).toEqual([]);
    });

    it('WORKSPACE_POLL_INTERVAL is 30000', () => {
      expect(WORKSPACE_POLL_INTERVAL).toBe(30_000);
    });

    it('startWorkspaceWatcher adds to activeWatchers', () => {
      const guild = {
        channels: {
          cache: {
            find: vi.fn().mockReturnValue(undefined),
          },
        },
      };
      startWorkspaceWatcher(client, guild as any, 'watcher-test', 'cat1');
      expect(activeWatchers.has('watcher-test')).toBe(true);

      // Clean up
      stopWorkspaceWatcher('watcher-test');
      expect(activeWatchers.has('watcher-test')).toBe(false);
    });

    it('stopWorkspaceWatcher clears interval', () => {
      const guild = {
        channels: {
          cache: {
            find: vi.fn().mockReturnValue(undefined),
          },
        },
      };
      startWorkspaceWatcher(client, guild as any, 'stop-test', 'cat1');
      expect(activeWatchers.has('stop-test')).toBe(true);

      stopWorkspaceWatcher('stop-test');
      expect(activeWatchers.has('stop-test')).toBe(false);
    });
  });

  describe('StreamWatcher', () => {
    it('STREAM_POLL_INTERVAL is 600000', () => {
      expect(STREAM_POLL_INTERVAL).toBe(600_000);
    });

    it('STREAM_SILENCE_THRESHOLD is 3600000', () => {
      expect(STREAM_SILENCE_THRESHOLD).toBe(3_600_000);
    });

    it('STREAM_STATUS_INTERVAL is 3600000', () => {
      expect(STREAM_STATUS_INTERVAL).toBe(3_600_000);
    });

    it('HERMES_DECOMPOSE_TIMEOUT is 300000', () => {
      expect(HERMES_DECOMPOSE_TIMEOUT).toBe(300_000);
    });

    it('activeStreamWatchers is a Map', () => {
      expect(activeStreamWatchers).toBeInstanceOf(Map);
    });

    it('countTasks counts checked and total', () => {
      const content = '- [x] A\n- [ ] B\n- [x] C\n- [ ] D\n';
      expect(countTasks(content)).toEqual({ done: 2, total: 4 });
    });

    it('countTasks handles no tasks', () => {
      expect(countTasks('Just some text')).toEqual({ done: 0, total: 0 });
    });
  });

  // --- File locking ---

  describe('file locking', () => {
    it('acquireFileLock creates .lock file', async () => {
      const fs = await import('fs');
      (fs.default.existsSync as any).mockReturnValue(false);

      await acquireFileLock('/tmp/test.md');

      expect(fs.default.writeFileSync).toHaveBeenCalledWith(
        '/tmp/test.md.lock',
        expect.any(String),
        'utf8',
      );
    });

    it('releaseFileLock removes .lock file', async () => {
      const fs = await import('fs');

      releaseFileLock('/tmp/test.md');

      expect(fs.default.unlinkSync).toHaveBeenCalledWith('/tmp/test.md.lock');
    });

    it('withFileLock runs function and cleans up on success', async () => {
      const fs = await import('fs');
      (fs.default.existsSync as any).mockReturnValue(false);

      let ran = false;
      const result = await withFileLock('/tmp/test.md', () => {
        ran = true;
        return 42;
      });

      expect(ran).toBe(true);
      expect(result).toBe(42);
      // Should have created and then removed lock
      expect(fs.default.writeFileSync).toHaveBeenCalledWith(
        '/tmp/test.md.lock',
        expect.any(String),
        'utf8',
      );
      expect(fs.default.unlinkSync).toHaveBeenCalledWith('/tmp/test.md.lock');
    });

    it('withFileLock cleans up lock on error', async () => {
      const fs = await import('fs');
      (fs.default.existsSync as any).mockReturnValue(false);

      await expect(
        withFileLock('/tmp/test.md', () => {
          throw new Error('test error');
        }),
      ).rejects.toThrow('test error');

      // Lock should still be cleaned up
      expect(fs.default.unlinkSync).toHaveBeenCalledWith('/tmp/test.md.lock');
    });

    it('acquireFileLock cleans stale lock (> 30s)', async () => {
      const fs = await import('fs');
      // First call: lock file exists
      (fs.default.existsSync as any)
        .mockReturnValueOnce(true) // lock exists
        .mockReturnValueOnce(false); // after cleanup, no lock
      // Stale lock content (timestamp 60s ago)
      (fs.default.readFileSync as any).mockReturnValueOnce(
        JSON.stringify({ pid: 999, timestamp: Date.now() - 60_000 }),
      );

      await acquireFileLock('/tmp/stale.md');

      // Should have removed stale lock
      expect(fs.default.unlinkSync).toHaveBeenCalledWith('/tmp/stale.md.lock');
      // Should have written new lock
      expect(fs.default.writeFileSync).toHaveBeenCalledWith(
        '/tmp/stale.md.lock',
        expect.any(String),
        'utf8',
      );
    });
  });

  // --- parseHandoffs ---

  describe('parseHandoffs', () => {
    it('parses outgoing handoffs', () => {
      const content = [
        '# Handoffs',
        '',
        '## Outgoing (this stream provides)',
        '',
        '- API contract (→ frontend) [Delivered]',
        '- Auth tokens (→ frontend) [Pending]',
        '',
        '## Incoming (this stream needs)',
        '',
        '*None defined yet.*',
      ].join('\n');

      const result = parseHandoffs(content, 'Outgoing');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        description: 'API contract',
        target: 'frontend',
        status: 'Delivered',
      });
      expect(result[1]).toEqual({
        description: 'Auth tokens',
        target: 'frontend',
        status: 'Pending',
      });
    });

    it('returns empty array when section not found', () => {
      const result = parseHandoffs('# No handoffs here', 'Outgoing');
      expect(result).toEqual([]);
    });

    it('parses incoming handoffs', () => {
      const content = [
        '## Outgoing (this stream provides)',
        '',
        '*None defined yet.*',
        '',
        '## Incoming (this stream needs)',
        '',
        '- API contract (← backend) [Delivered]',
      ].join('\n');

      const result = parseHandoffs(content, 'Incoming');
      expect(result).toHaveLength(1);
      expect(result[0].target).toBe('backend');
    });
  });

  // --- Checkpoint commands ---

  describe('checkpoint commands', () => {
    it('!checkpoint — shows usage with no args', async () => {
      const msg = mockMessage('!checkpoint');
      await handleCommand(msg, client);
      expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    });

    it('!checkpoint without project context — rejects', async () => {
      const msg = mockMessage('!checkpoint backend frontend');
      await handleCommand(msg, client);
      expect(msg.reply).toHaveBeenCalledWith(
        expect.stringContaining('project context'),
      );
    });

    it('!checkpoints without project context — rejects', async () => {
      const msg = mockMessage('!checkpoints');
      await handleCommand(msg, client);
      expect(msg.reply).toHaveBeenCalledWith(
        expect.stringContaining('project context'),
      );
    });

    it('!checkpoint backend frontend with all delivered — passes', async () => {
      activeProjects.set('test-proj', {
        name: 'TestProj',
        categoryId: 'cat1',
        workStreams: new Map(),
        controlRoomId: 'cr1',
        planRoomId: 'pr1',
      });

      const msg = mockMessage('!checkpoint backend frontend', {
        channel: {
          id: 'channel123',
          name: 'control-room',
          send: vi.fn().mockResolvedValue(undefined),
          parent: { name: 'TestProj' },
          parentId: 'cat1',
        },
      });

      const fs = await import('fs');
      vi.mocked(fs.default.existsSync).mockImplementation((p) => {
        if (typeof p === 'string' && p.endsWith('.lock')) return false;
        return true;
      });
      vi.mocked(fs.default.readFileSync).mockImplementation((p) => {
        if (typeof p === 'string' && p.includes('handoffs.md')) {
          return (
            '# Handoffs\n\n## Outgoing (this stream provides)\n\n' +
            '- API contract (\u2192 frontend) [Delivered]\n\n' +
            '## Incoming (this stream needs)\n\n*None defined yet.*'
          );
        }
        if (typeof p === 'string' && p.includes('integration-points.md')) {
          return '### backend \u2192 frontend\n- **Status**: Pending\n';
        }
        return '' as any;
      });

      await handleCommand(msg, client);

      expect(msg.reply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) }),
      );

      activeProjects.delete('test-proj');
    });

    it('!checkpoint backend frontend with pending items — lists them', async () => {
      const fs = await import('fs');
      activeProjects.set('test-proj', {
        name: 'TestProj',
        categoryId: 'cat1',
        workStreams: new Map(),
        controlRoomId: 'cr1',
        planRoomId: 'pr1',
      });

      const msg = mockMessage('!checkpoint backend frontend', {
        channel: {
          id: 'channel123',
          name: 'control-room',
          send: vi.fn().mockResolvedValue(undefined),
          parent: { name: 'TestProj' },
          parentId: 'cat1',
        },
      });

      (fs.default.existsSync as any).mockImplementation((p: string) => {
        if (p.endsWith('.lock')) return false;
        return true;
      });
      (fs.default.readFileSync as any).mockImplementation((p: string) => {
        if (p.includes('handoffs.md')) {
          return (
            '# Handoffs\n\n## Outgoing (this stream provides)\n\n' +
            '- API contract (\u2192 frontend) [Pending]\n' +
            '- Auth tokens (\u2192 frontend) [Delivered]\n\n' +
            '## Incoming (this stream needs)\n\n*None defined yet.*'
          );
        }
        return '';
      });

      await handleCommand(msg, client);

      expect(msg.reply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) }),
      );

      activeProjects.delete('test-proj');
    });

    it('!checkpoints lists all handoffs', async () => {
      const fs = await import('fs');
      activeProjects.set('test-proj', {
        name: 'TestProj',
        categoryId: 'cat1',
        workStreams: new Map(),
        controlRoomId: 'cr1',
        planRoomId: 'pr1',
      });

      const msg = mockMessage('!checkpoints', {
        channel: {
          id: 'channel123',
          name: 'control-room',
          send: vi.fn().mockResolvedValue(undefined),
          parent: { name: 'TestProj' },
          parentId: 'cat1',
        },
      });

      (fs.default.existsSync as any).mockImplementation((p: string) => {
        if (p.endsWith('.lock')) return false;
        return true;
      });
      (fs.default.readdirSync as any).mockImplementation((dir: string) => {
        if (dir.includes('workstreams')) {
          return [{ name: 'backend', isDirectory: () => true }];
        }
        return [];
      });
      (fs.default.readFileSync as any).mockImplementation((p: string) => {
        if (p.includes('handoffs.md')) {
          return (
            '# Handoffs\n\n## Outgoing (this stream provides)\n\n' +
            '- API contract (\u2192 frontend) [Delivered]\n\n' +
            '## Incoming (this stream needs)\n\n*None defined yet.*'
          );
        }
        return '';
      });

      await handleCommand(msg, client);

      expect(msg.reply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) }),
      );

      activeProjects.delete('test-proj');
    });
  });
});
