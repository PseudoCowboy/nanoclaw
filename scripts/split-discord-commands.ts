/**
 * Module split script: Converts discord-commands.ts monolith into a directory module.
 * Run with: npx tsx scripts/split-discord-commands.ts
 *
 * Strategy: Rather than manually extracting line ranges (error-prone at 3,835 lines),
 * this script:
 * 1. Reads the monolith
 * 2. Creates new module files with proper imports
 * 3. Creates the barrel index.ts that re-exports everything
 * 4. Removes the old monolith
 *
 * The split files (types.ts, constants.ts, state.ts, helpers.ts, file-lock.ts)
 * were already created manually. This script creates the remaining command-handler
 * modules and the barrel index.
 */

import fs from 'fs';
import path from 'path';

const SRC = path.resolve('src/channels/discord-commands.ts');
const DEST_DIR = path.resolve('src/channels/discord-commands');
const source = fs.readFileSync(SRC, 'utf8');
const lines = source.split('\n');

// Helper to extract a function block by name
function extractFunction(name: string, prefix = ''): string {
  const funcPatterns = [
    new RegExp(`^${prefix}(export )?async function ${name}\\b`),
    new RegExp(`^${prefix}(export )?function ${name}\\b`),
  ];

  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (funcPatterns.some(p => p.test(lines[i]))) {
      startLine = i;
      break;
    }
  }

  if (startLine === -1) {
    console.warn(`  WARNING: Could not find function ${name}`);
    return `// TODO: Function ${name} not found during extraction\n`;
  }

  // Find the end of the function by brace counting
  let braceCount = 0;
  let endLine = startLine;
  let foundFirstBrace = false;

  for (let i = startLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') {
        braceCount++;
        foundFirstBrace = true;
      }
      if (ch === '}') braceCount--;
    }
    if (foundFirstBrace && braceCount === 0) {
      endLine = i;
      break;
    }
  }

  return lines.slice(startLine, endLine + 1).join('\n');
}

// Extract line range
function extractLines(start: number, end: number): string {
  return lines.slice(start - 1, end).join('\n');
}

console.log('Creating remaining module files...');

// --- workspace-watcher.ts ---
const workspaceWatcherContent = `import { Client, TextChannel } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { logger } from '../../logger.js';
import { WORKSTREAM_DEFS, WORKSPACE_POLL_INTERVAL } from './constants.js';
import { activeWatchers } from './state.js';
import { withFileLock } from './file-lock.js';

${extractFunction('checkWorkspaceChanges')}

${extractFunction('syncStatusBoard')}

${extractFunction('startWorkspaceWatcher')}

${extractFunction('stopWorkspaceWatcher')}
`;
fs.writeFileSync(path.join(DEST_DIR, 'workspace-watcher.ts'), workspaceWatcherContent);
console.log('  ✓ workspace-watcher.ts');

// --- stream-watcher.ts ---
const streamWatcherContent = `import { Client, EmbedBuilder, Message, TextChannel } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { logger } from '../../logger.js';
import {
  setOrchestrationState,
  deleteOrchestrationState,
  getAllOrchestrationState,
} from '../../db.js';
import {
  WORKSTREAM_DEFS,
  AGENT_COLORS,
  STREAM_POLL_INTERVAL,
  STREAM_SILENCE_THRESHOLD,
  STREAM_STATUS_INTERVAL,
} from './constants.js';
import { activeStreamWatchers } from './state.js';
import { countTasks } from './helpers.js';
import type { TaskStatus, TaskStateEntry, TaskState, StreamWatcherState } from './types.js';

${extractFunction('readTaskState')}

${extractFunction('writeTaskState')}

${extractFunction('initTaskStateFromTasksMd')}

${extractFunction('saveStreamWatcherState')}

${extractFunction('saveProjectState')}

${extractFunction('rehydrateOrchestrationState')}

${extractFunction('startStreamWatcher')}

${extractFunction('completeStreamWatcher')}

${extractFunction('stopStreamWatcher')}
`;
fs.writeFileSync(path.join(DEST_DIR, 'stream-watcher.ts'), streamWatcherContent);
console.log('  ✓ stream-watcher.ts');

// --- help.ts ---
const helpContent = `import { Client, Message, EmbedBuilder } from 'discord.js';
import { logger } from '../../logger.js';

${extractFunction('cmdHelp')}

${extractFunction('cmdHelpOrchestration')}
`;
fs.writeFileSync(path.join(DEST_DIR, 'help.ts'), helpContent);
console.log('  ✓ help.ts');

// --- monitoring.ts ---
const monitoringContent = `import { Client, Message, EmbedBuilder, TextChannel } from 'discord.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '../../logger.js';
import { AGENTS, AGENT_COLORS, WORKSTREAM_DEFS } from './constants.js';
import { activeProjects, activeStreamWatchers } from './state.js';
import { findProjectSlugForChannel, parseHandoffs } from './helpers.js';

${extractFunction('cmdAgentStatus')}

${extractFunction('cmdDashboard')}

${extractFunction('cmdBlocker')}

${extractFunction('cmdLogs')}
`;
fs.writeFileSync(path.join(DEST_DIR, 'monitoring.ts'), monitoringContent);
console.log('  ✓ monitoring.ts');

// --- project.ts ---
const projectContent = `import { Client, Message, EmbedBuilder, TextChannel, ChannelType } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { logger } from '../../logger.js';
import { CORE_CHANNELS, WORKSTREAM_DEFS } from './constants.js';
import {
  activeProjects,
  channelProjectMap,
  saveChannelProjectMap,
  getRegisterGroupCallback,
} from './state.js';
import {
  slugify,
  initProjectWorkspace,
} from './helpers.js';
import type { ProjectState } from './types.js';
import { startWorkspaceWatcher, stopWorkspaceWatcher } from './workspace-watcher.js';
import { stopStreamWatcher } from './stream-watcher.js';

${extractFunction('cmdCreateProject')}

${extractFunction('cmdCleanupServer')}
`;
fs.writeFileSync(path.join(DEST_DIR, 'project.ts'), projectContent);
console.log('  ✓ project.ts');

// --- planning.ts ---
const planningContent = `import { Client, Message, EmbedBuilder, TextChannel } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { logger } from '../../logger.js';
import {
  PLANNING_AGENTS,
  AGENT_COLORS,
  AGENT_HANDOFF_TIMEOUT,
  HUMAN_INPUT_TIMEOUT,
} from './constants.js';
import { planningSessions, activeProjects, channelProjectMap, saveChannelProjectMap } from './state.js';
import { findProjectSlugForChannel, slugify } from './helpers.js';

${extractFunction('cmdPlan')}

${extractFunction('parsePlanForStreams')}
`;
fs.writeFileSync(path.join(DEST_DIR, 'planning.ts'), planningContent);
console.log('  ✓ planning.ts');

// --- workstreams.ts ---
const workstreamsContent = `import { Client, Message, EmbedBuilder, TextChannel, ChannelType } from 'discord.js';
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

${extractFunction('cmdDecompose')}

${extractFunction('cmdAddStream')}

${extractFunction('cmdHandoff')}

${extractFunction('cmdStreamStatus')}
`;
fs.writeFileSync(path.join(DEST_DIR, 'workstreams.ts'), workstreamsContent);
console.log('  ✓ workstreams.ts');

// --- checkpoints.ts ---
const checkpointsContent = `import { Client, Message, EmbedBuilder, TextChannel } from 'discord.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '../../logger.js';
import { findProjectSlugForChannel } from './helpers.js';

${extractFunction('cmdCheckpoint')}

${extractFunction('cmdCheckpoints')}
`;
fs.writeFileSync(path.join(DEST_DIR, 'checkpoints.ts'), checkpointsContent);
console.log('  ✓ checkpoints.ts');

// --- discussion.ts ---
const discussionContent = `import { Client, Message, EmbedBuilder, TextChannel, ChannelType } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { logger } from '../../logger.js';
import {
  DISCUSSION_CHAIN,
  AGENT_COLORS,
  AGENT_HANDOFF_TIMEOUT,
} from './constants.js';
import {
  discussionSessions,
  discussionListeners,
  getRegisterGroupCallback,
} from './state.js';
import { slugify, initDiscussionFolder } from './helpers.js';

${extractFunction('startDiscussionWatchdog')}

${extractFunction('cmdCreateDiscussion')}

${extractFunction('cmdCloseDiscussion')}
`;
fs.writeFileSync(path.join(DEST_DIR, 'discussion.ts'), discussionContent);
console.log('  ✓ discussion.ts');

// --- index.ts (barrel) ---
const indexContent = `// src/channels/discord-commands/index.ts
// Barrel module — re-exports everything from the split modules.
// External consumers import from './discord-commands.js' unchanged.

import { Client, Message } from 'discord.js';
import { logger } from '../../logger.js';

// Re-export types
export type {
  PlanningSession,
  DiscussionSession,
  WorkStream,
  StreamWatcherState,
  TaskStatus,
  TaskStateEntry,
  TaskState,
  ProjectState,
  CommandHandler,
  LockInfo,
  WatcherState,
} from './types.js';

// Re-export state
export {
  setRegisterGroupCallback,
  getProjectSlugForChannel,
  setChannelProjectSlug,
  channelProjectMap,
  saveChannelProjectMap,
  planningSessions,
  discussionListeners,
  discussionSessions,
  activeProjects,
  activeStreamWatchers,
  activeWatchers,
} from './state.js';

// Re-export constants
export {
  PLANNING_AGENTS,
  DISCUSSION_CHAIN,
  AGENT_HANDOFF_TIMEOUT,
  HUMAN_INPUT_TIMEOUT,
  STREAM_POLL_INTERVAL,
  STREAM_SILENCE_THRESHOLD,
  STREAM_STATUS_INTERVAL,
  HERMES_DECOMPOSE_TIMEOUT,
  AGENTS,
  AGENT_COLORS,
  WORKSTREAM_DEFS,
  CORE_CHANNELS,
  LOCK_STALE_MS,
  WORKSPACE_POLL_INTERVAL,
} from './constants.js';

// Re-export helpers
export {
  slugify,
  countTasks,
  findProjectSlugForChannel,
  initDiscussionFolder,
  initProjectWorkspace,
  initWorkstreamFolder,
  parseHandoffs,
} from './helpers.js';

// Re-export file-lock
export { acquireFileLock, releaseFileLock, withFileLock } from './file-lock.js';

// Re-export workspace watcher
export {
  checkWorkspaceChanges,
  startWorkspaceWatcher,
  stopWorkspaceWatcher,
} from './workspace-watcher.js';

// Re-export stream watcher
export {
  startStreamWatcher,
  stopStreamWatcher,
  rehydrateOrchestrationState,
  saveStreamWatcherState,
  saveProjectState,
} from './stream-watcher.js';

// Re-export planning
export { parsePlanForStreams } from './planning.js';

// Import command handlers for registry
import { cmdHelp, cmdHelpOrchestration } from './help.js';
import { cmdAgentStatus, cmdDashboard, cmdBlocker, cmdLogs } from './monitoring.js';
import { cmdCreateProject, cmdCleanupServer } from './project.js';
import { cmdPlan } from './planning.js';
import { cmdDecompose, cmdAddStream, cmdHandoff, cmdStreamStatus } from './workstreams.js';
import { cmdCheckpoint, cmdCheckpoints } from './checkpoints.js';
import { cmdCreateDiscussion, cmdCloseDiscussion } from './discussion.js';
import type { CommandHandler } from './types.js';

// --- Command Registry ---

const commands: Record<string, CommandHandler> = {
  // Info
  help: cmdHelp,
  help_orchestration: cmdHelpOrchestration,

  // Project lifecycle
  create_project: cmdCreateProject,
  cleanup_server: cmdCleanupServer,

  // Planning
  plan: cmdPlan,
  decompose: cmdDecompose,

  // Work streams
  add_stream: cmdAddStream,
  handoff: cmdHandoff,
  stream_status: cmdStreamStatus,

  // Monitoring
  agent_status: cmdAgentStatus,
  logs: cmdLogs,
  dashboard: cmdDashboard,
  blocker: cmdBlocker,

  // Checkpoints
  checkpoint: cmdCheckpoint,
  checkpoints: cmdCheckpoints,

  // Discussion system
  create_discussion: cmdCreateDiscussion,
  close_discussion: cmdCloseDiscussion,
};

// --- Main Entry Point ---

/**
 * Handle a \`!\` prefixed command. Returns true if a command was matched, false otherwise.
 */
export async function handleCommand(
  message: Message,
  client: Client,
): Promise<boolean> {
  const content = message.content.trim();
  if (!content.startsWith('!')) return false;

  const args = content.slice(1).trim().split(/\\s+/);
  const commandName = args[0]?.toLowerCase();

  if (!commandName || !commands[commandName]) return false;

  try {
    await commands[commandName](message, client);
    return true;
  } catch (err) {
    logger.error({ err, command: commandName }, 'Command handler error');
    return true; // We matched the command, even if it errored
  }
}
`;
fs.writeFileSync(path.join(DEST_DIR, 'index.ts'), indexContent);
console.log('  ✓ index.ts');

console.log('\nAll modules created. Now run: npm run build');
