// src/channels/discord-commands/index.ts
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
  channelBranchMap,
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
  savePlanningSession,
  saveDiscussionSession,
  deletePlanningSession,
  deleteDiscussionSession,
} from './stream-watcher.js';

// Re-export workflow invariants
export {
  assertNotSelfReview,
  assertValidTaskTransition,
  assertSessionNotOrphaned,
  checkInvariant,
} from './workflow-invariants.js';

// Re-export planning
export {
  parsePlanForStreams,
  trackPlanInIndex,
  completePlanInIndex,
  cmdPlans,
} from './planning.js';

// --- Branch lookup helper ---

import { channelBranchMap } from './state.js';

/**
 * Get the agent branch name for a Discord channel (workstream isolation).
 * Returns null if the channel has no active branch.
 */
export function getBranchForChannel(channelId: string): string | null {
  return channelBranchMap.get(channelId) ?? null;
}

// Import command handlers for registry
import { cmdHelp, cmdHelpOrchestration } from './help.js';
import {
  cmdAgentStatus,
  cmdDashboard,
  cmdBlocker,
  cmdLogs,
} from './monitoring.js';
import { cmdCreateProject, cmdCleanupServer } from './project.js';
import { cmdPlan, cmdPlans } from './planning.js';
import {
  cmdDecompose,
  cmdAddStream,
  cmdHandoff,
  cmdStreamStatus,
} from './workstreams.js';
import { cmdCheckpoint, cmdCheckpoints } from './checkpoints.js';
import { cmdCreateDiscussion, cmdCloseDiscussion } from './discussion.js';
import { cmdDoctorWorkflow } from './doctor.js';
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
  plans: cmdPlans,
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

  // Diagnostics
  doctor_workflow: cmdDoctorWorkflow,

  // Discussion system
  create_discussion: cmdCreateDiscussion,
  close_discussion: cmdCloseDiscussion,
};

// --- Main Entry Point ---

/**
 * Handle a `!` prefixed command. Returns true if a command was matched, false otherwise.
 */
export async function handleCommand(
  message: Message,
  client: Client,
): Promise<boolean> {
  const content = message.content.trim();
  if (!content.startsWith('!')) return false;

  const args = content.slice(1).trim().split(/\s+/);
  const commandName = args[0]?.toLowerCase();

  if (!commandName || !commands[commandName]) return false;

  try {
    await commands[commandName](message, client);
  } catch (err) {
    logger.error({ err, command: commandName }, 'Discord command error');
    await message
      .reply('\u274C An error occurred while executing that command.')
      .catch(() => {});
  }
  return true;
}
