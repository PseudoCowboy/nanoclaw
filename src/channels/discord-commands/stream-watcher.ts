import { Client, EmbedBuilder, Message, TextChannel } from 'discord.js';
import { execSync } from 'child_process';
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
import {
  activeStreamWatchers,
  channelBranchMap,
  activeProjects,
  planningSessions,
  discussionSessions,
} from './state.js';
import { countTasks } from './helpers.js';
import { assertValidTaskTransition } from './workflow-invariants.js';
import type {
  TaskStatus,
  TaskStateEntry,
  TaskState,
  StreamWatcherState,
  ProjectState,
} from './types.js';

/**
 * Result of reading task-state.json.
 * - `{ state: TaskState }` — file exists and is valid JSON
 * - `{ missing: true }` — file does not exist
 * - `{ corrupt: true }` — file exists but contains invalid JSON
 */
export type ReadTaskStateResult =
  | { state: TaskState; missing?: never; corrupt?: never }
  | { state?: never; missing: true; corrupt?: never }
  | { state?: never; missing?: never; corrupt: true };

export function readTaskState(
  projectSlug: string,
  streamType: string,
): ReadTaskStateResult {
  const statePath = path.resolve(
    process.cwd(),
    'groups',
    'shared_project',
    'active',
    projectSlug,
    'workstreams',
    streamType,
    'task-state.json',
  );
  if (!fs.existsSync(statePath)) {
    return { missing: true };
  }
  try {
    return { state: JSON.parse(fs.readFileSync(statePath, 'utf8')) };
  } catch (err: any) {
    logger.error(
      { err: err.message, statePath },
      'task-state.json is corrupted — blocking completion until fixed',
    );
    return { corrupt: true };
  }
}

export function writeTaskState(
  projectSlug: string,
  streamType: string,
  state: TaskState,
): void {
  const statePath = path.resolve(
    process.cwd(),
    'groups',
    'shared_project',
    'active',
    projectSlug,
    'workstreams',
    streamType,
    'task-state.json',
  );
  try {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
  } catch (err: any) {
    logger.warn(
      { err: err.message, statePath },
      'Failed to write task-state.json',
    );
  }
}

/**
 * Initialize task-state.json from tasks.md if it doesn't exist yet.
 * Parses checkbox items and creates initial state entries.
 */
export function initTaskStateFromTasksMd(
  projectSlug: string,
  streamType: string,
): TaskState | null {
  const wsDir = path.resolve(
    process.cwd(),
    'groups',
    'shared_project',
    'active',
    projectSlug,
    'workstreams',
    streamType,
  );
  const tasksPath = path.join(wsDir, 'tasks.md');
  const statePath = path.join(wsDir, 'task-state.json');

  // Already exists — don't overwrite
  if (fs.existsSync(statePath))
    return readTaskState(projectSlug, streamType).state ?? null;

  try {
    if (!fs.existsSync(tasksPath)) return null;
    const content = fs.readFileSync(tasksPath, 'utf8');
    const lines = content.split('\n');
    const tasks: TaskStateEntry[] = [];
    let id = 1;
    for (const line of lines) {
      if (/^- \[[ x]\] /.test(line)) {
        const isDone = /^- \[x\] /.test(line);
        tasks.push({
          id,
          status: isDone ? 'approved' : 'pending',
          reviewRounds: 0,
        });
        id++;
      }
    }
    if (tasks.length === 0) return null;

    const state: TaskState = {
      tasks,
      currentTask: tasks.find((t) => t.status === 'pending')?.id ?? null,
      lastReviewedBy: null,
    };
    writeTaskState(projectSlug, streamType, state);
    return state;
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Failed to init task-state.json');
    return null;
  }
}

/**
 * Save a stream watcher's durable metadata to SQLite.
 * Only JSON-safe metadata — no interval handles or listeners.
 */
export function saveStreamWatcherState(
  watcherKey: string,
  watcher: StreamWatcherState,
): void {
  const data = {
    projectSlug: watcher.projectSlug,
    streamType: watcher.streamType,
    channelId: watcher.channelId,
    categoryId: watcher.categoryId,
    lastActivityTime: watcher.lastActivityTime,
    lastStatusReport: watcher.lastStatusReport,
    lastTasksMtime: watcher.lastTasksMtime,
    completed: watcher.completed,
    lastReviewedTaskId: watcher.lastReviewedTaskId,
    taskStateInitialized: watcher.taskStateInitialized,
    currentBranch: watcher.currentBranch,
  };
  setOrchestrationState(
    `sw:${watcherKey}`,
    'stream_watcher',
    JSON.stringify(data),
  );
}

/**
 * Save a project's durable metadata to SQLite.
 */
export function saveProjectState(slug: string, project: ProjectState): void {
  const data = {
    name: project.name,
    categoryId: project.categoryId,
    controlRoomId: project.controlRoomId,
    planRoomId: project.planRoomId,
    workStreamKeys: Array.from(project.workStreams.keys()),
  };
  setOrchestrationState(`proj:${slug}`, 'project', JSON.stringify(data));
}

/**
 * Save a planning session to SQLite.
 */
export function savePlanningSession(
  channelId: string,
  session: { topic: string; featureId: string | null; round: number },
): void {
  setOrchestrationState(
    `plan:${channelId}`,
    'planning_session',
    JSON.stringify({ channelId, ...session }),
  );
}

/**
 * Save a discussion session to SQLite.
 */
export function saveDiscussionSession(
  channelId: string,
  session: {
    topic: string;
    slug: string;
    round: number;
    currentAgent: string | null;
    channelId: string;
    sourceChannelId?: string;
  },
): void {
  setOrchestrationState(
    `disc:${channelId}`,
    'discussion_session',
    JSON.stringify(session),
  );
}

/**
 * Delete a planning session from SQLite.
 */
export function deletePlanningSession(channelId: string): void {
  deleteOrchestrationState(`plan:${channelId}`);
}

/**
 * Delete a discussion session from SQLite.
 */
export function deleteDiscussionSession(channelId: string): void {
  deleteOrchestrationState(`disc:${channelId}`);
}

/**
 * Rehydrate stream watchers and projects from SQLite after Discord client connects.
 * Recreates interval handles and message listeners from persisted metadata.
 */
export async function rehydrateOrchestrationState(
  client: Client,
  guild: { channels: { cache: { find: (fn: (c: any) => boolean) => any } } },
): Promise<void> {
  const rows = getAllOrchestrationState('stream_watcher');
  let rehydrated = 0;

  for (const row of rows) {
    try {
      const meta = JSON.parse(row.data);
      if (meta.completed) {
        // Clean up completed watchers from DB
        deleteOrchestrationState(row.key);
        continue;
      }

      const watcherKey = row.key.replace(/^sw:/, '');
      if (activeStreamWatchers.has(watcherKey)) continue; // Already running

      // Check task-state.json to decide whether to re-trigger
      const taskResult = readTaskState(meta.projectSlug, meta.streamType);
      const currentTask =
        taskResult.state?.currentTask != null
          ? taskResult.state.tasks.find(
              (t) => t.id === taskResult.state!.currentTask,
            )
          : null;

      // Grace period — don't re-trigger immediately, just resume monitoring
      logger.info(
        { watcherKey, currentTaskStatus: currentTask?.status },
        'Rehydrating stream watcher from SQLite',
      );

      // Restart the watcher using the existing function
      startStreamWatcher(
        client,
        guild,
        meta.projectSlug,
        meta.streamType,
        meta.channelId,
        meta.categoryId,
      );

      // Restore branch tracking from persisted state
      const rehydratedWatcher = activeStreamWatchers.get(watcherKey);
      if (rehydratedWatcher && meta.currentBranch) {
        rehydratedWatcher.currentBranch = meta.currentBranch;
        channelBranchMap.set(meta.channelId, meta.currentBranch);
      }

      // Post recovery notice
      const wsChannel = guild.channels.cache.find(
        (c: any) => c.id === meta.channelId,
      ) as TextChannel | undefined;
      if (wsChannel && currentTask?.status === 'in_progress') {
        const def = WORKSTREAM_DEFS[meta.streamType];
        const leadAgent = def?.agents[0] || 'Agent';
        wsChannel
          .send(
            `\u{1F504} NanoClaw restarted. @${leadAgent} \u2014 if you're still working, continue. If not, re-read task-state.json and resume.`,
          )
          .catch(() => {});
      }

      rehydrated++;
    } catch (err: any) {
      logger.warn(
        { err: err.message, key: row.key },
        'Failed to rehydrate stream watcher',
      );
    }
  }

  if (rehydrated > 0) {
    logger.info(
      { count: rehydrated },
      'Rehydrated stream watchers from SQLite',
    );
  }

  // Rehydrate projects
  const projectRows = getAllOrchestrationState('project');
  for (const row of projectRows) {
    try {
      const meta = JSON.parse(row.data);
      const slug = row.key.replace(/^proj:/, '');
      if (!activeProjects.has(slug)) {
        activeProjects.set(slug, {
          name: meta.name,
          categoryId: meta.categoryId,
          controlRoomId: meta.controlRoomId,
          planRoomId: meta.planRoomId,
          workStreams: new Map(),
        });
        logger.info({ slug }, 'Rehydrated project from SQLite');
      }
    } catch (err: any) {
      logger.warn(
        { err: err.message, key: row.key },
        'Failed to rehydrate project',
      );
    }
  }

  // Rehydrate planning sessions
  const planningRows = getAllOrchestrationState('planning_session');
  for (const row of planningRows) {
    try {
      const meta = JSON.parse(row.data);
      const channelId = meta.channelId || row.key.replace(/^plan:/, '');
      if (!planningSessions.has(channelId)) {
        planningSessions.set(channelId, {
          topic: meta.topic,
          featureId: meta.featureId ?? null,
          round: meta.round ?? 0,
        });
        logger.info(
          { channelId, topic: meta.topic },
          'Rehydrated planning session from SQLite',
        );
      }
    } catch (err: any) {
      logger.warn(
        { err: err.message, key: row.key },
        'Failed to rehydrate planning session',
      );
    }
  }

  // Rehydrate discussion sessions
  const discussionRows = getAllOrchestrationState('discussion_session');
  for (const row of discussionRows) {
    try {
      const meta = JSON.parse(row.data);
      const channelId = meta.channelId || row.key.replace(/^disc:/, '');
      if (!discussionSessions.has(channelId)) {
        discussionSessions.set(channelId, {
          topic: meta.topic,
          slug: meta.slug,
          round: meta.round ?? 0,
          currentAgent: meta.currentAgent ?? null,
          channelId,
          sourceChannelId: meta.sourceChannelId,
        });

        // Restart discussion watchdog if session was in progress (round > 0)
        if (meta.round > 0) {
          const discChannel = guild.channels.cache.find(
            (c: any) => c.id === channelId,
          ) as TextChannel | undefined;
          if (discChannel) {
            // Lazy import to avoid circular dependency
            const { startDiscussionWatchdog } = await import('./discussion.js');
            startDiscussionWatchdog(client, discChannel, meta.slug);
            logger.info(
              { channelId, slug: meta.slug, round: meta.round },
              'Rehydrated discussion session and restarted watchdog',
            );
          } else {
            logger.warn(
              { channelId, slug: meta.slug },
              'Discussion channel not found — cleaning up stale session',
            );
            deleteOrchestrationState(row.key);
            discussionSessions.delete(channelId);
          }
        } else {
          logger.info(
            { channelId, slug: meta.slug },
            'Rehydrated discussion session (not yet started)',
          );
        }
      }
    } catch (err: any) {
      logger.warn(
        { err: err.message, key: row.key },
        'Failed to rehydrate discussion session',
      );
    }
  }
}

// --- Git branch helpers for agent isolation ---

/**
 * Run a git command in a workstream directory.
 * Both projectSlug and streamType come from constants/controlled vocabulary — safe from injection.
 */
function gitInWorkspace(
  projectSlug: string,
  streamType: string,
  cmd: string,
): string {
  const wsDir = path.resolve(
    process.cwd(),
    'groups',
    'shared_project',
    'active',
    projectSlug,
    'workstreams',
    streamType,
  );
  return execSync(`git ${cmd}`, {
    cwd: wsDir,
    encoding: 'utf8',
    timeout: 15000,
  }).trim();
}

/**
 * Ensure an agent branch exists. Creates from main if it doesn't.
 * Returns the branch name. Does NOT checkout the branch (host stays on main).
 */
function ensureAgentBranch(
  projectSlug: string,
  streamType: string,
  agentName: string,
): string {
  const branchName = `agent/${agentName.toLowerCase()}/${streamType}`;
  try {
    gitInWorkspace(projectSlug, streamType, `branch ${branchName} main`);
    logger.info(
      { branchName, projectSlug, streamType },
      'Created agent branch',
    );
  } catch {
    // Branch already exists — that's fine
    logger.debug({ branchName }, 'Agent branch already exists');
  }
  return branchName;
}

/**
 * Merge an agent branch into main (no-ff), then delete the branch.
 * Throws on merge conflict — caller must handle.
 */
function mergeAgentBranch(
  projectSlug: string,
  streamType: string,
  agentName: string,
  taskId: number,
): void {
  const branchName = `agent/${agentName.toLowerCase()}/${streamType}`;
  gitInWorkspace(projectSlug, streamType, 'checkout main');
  gitInWorkspace(
    projectSlug,
    streamType,
    `merge --no-ff ${branchName} -m "Merge task #${taskId} (${agentName})"`,
  );
  try {
    gitInWorkspace(projectSlug, streamType, `branch -d ${branchName}`);
  } catch {
    /* ignore — branch may have already been deleted */
  }
  // Ensure host stays on main
  gitInWorkspace(projectSlug, streamType, 'checkout main');
}

/**
 * Force-delete an agent branch. Used during cleanup.
 */
function deleteAgentBranch(
  projectSlug: string,
  streamType: string,
  agentName: string,
): void {
  const branchName = `agent/${agentName.toLowerCase()}/${streamType}`;
  try {
    gitInWorkspace(projectSlug, streamType, 'checkout main');
    gitInWorkspace(projectSlug, streamType, `branch -D ${branchName}`);
  } catch {
    /* ignore — branch may not exist */
  }
}

/**
 * Start a per-stream watcher that:
 * - Polls every 10 min for tasks.md / progress.md mtime changes
 * - Posts hourly status reports to control-room
 * - Detects silence (1 hour) and nudges the lead agent
 * - Re-triggers the agent when tasks.md updates and unchecked tasks remain
 * - Stops when all tasks are checked or agent posts "Work complete"
 */
export function startStreamWatcher(
  client: Client,
  guild: { channels: { cache: { find: (fn: (c: any) => boolean) => any } } },
  projectSlug: string,
  streamType: string,
  channelId: string,
  categoryId: string,
): void {
  const watcherKey = `${projectSlug}:${streamType}`;
  if (activeStreamWatchers.has(watcherKey)) return;

  const now = Date.now();
  const def = WORKSTREAM_DEFS[streamType];
  if (!def) return;

  const leadAgent = def.agents[0];

  // Discord message listener — tracks activity from agents
  const listener = (msg: Message) => {
    if (msg.channelId !== channelId) return;
    if (!msg.author.bot) return;

    const watcher = activeStreamWatchers.get(watcherKey);
    if (!watcher || watcher.completed) return;

    watcher.lastActivityTime = Date.now();

    // Completion detection: agent says "Work complete" — but only if all tasks approved
    if (msg.content.toLowerCase().includes('work complete')) {
      const result = readTaskState(projectSlug, streamType);
      if (result.missing) {
        // No task-state.json — legacy fallback, allow completion
        completeStreamWatcher(client, guild, watcherKey);
      } else if (result.corrupt) {
        // Corrupted file — block completion, surface error
        logger.error(
          { watcherKey },
          'Agent said "work complete" but task-state.json is corrupted — blocking completion',
        );
      } else {
        const allApproved =
          result.state.tasks.length > 0 &&
          result.state.tasks.every((t) => t.status === 'approved');
        if (allApproved) {
          completeStreamWatcher(client, guild, watcherKey);
        } else {
          logger.warn(
            {
              watcherKey,
              tasks: result.state.tasks.map((t) => ({
                id: t.id,
                status: t.status,
              })),
            },
            'Agent said "work complete" but not all tasks are approved — ignoring',
          );
        }
      }
    }
  };

  client.on('messageCreate', listener);

  // Initialize task-state.json on watcher start
  const initialTaskState = initTaskStateFromTasksMd(projectSlug, streamType);
  const taskStateInitialized = initialTaskState !== null;

  const interval = setInterval(async () => {
    const watcher = activeStreamWatchers.get(watcherKey);
    if (!watcher || watcher.completed) return;

    try {
      const wsDir = path.resolve(
        process.cwd(),
        'groups',
        'shared_project',
        'active',
        projectSlug,
        'workstreams',
        streamType,
      );
      const tasksPath = path.join(wsDir, 'tasks.md');
      const progressPath = path.join(wsDir, 'progress.md');

      // 1. Check file mtime changes (activity tracking)
      try {
        const tasksStat = fs.statSync(tasksPath);
        if (tasksStat.mtimeMs > watcher.lastTasksMtime) {
          watcher.lastTasksMtime = tasksStat.mtimeMs;
          watcher.lastActivityTime = Date.now();
        }
      } catch {
        /* file may not exist yet */
      }

      try {
        const progressStat = fs.statSync(progressPath);
        if (progressStat.mtimeMs > watcher.lastActivityTime) {
          watcher.lastActivityTime = Date.now();
        }
      } catch {
        /* file may not exist yet */
      }

      // 2. Read task-state.json for status-driven decisions
      const taskResult = readTaskState(projectSlug, streamType);
      const taskState = taskResult.state ?? null;

      // Corrupted task-state.json — block all state machine decisions, skip this poll cycle
      if (taskResult.corrupt) {
        logger.error(
          { watcherKey },
          'task-state.json is corrupted — skipping poll cycle. Fix or delete the file to unblock.',
        );
        // Still flush watcher state so we don't lose runtime metadata
        saveStreamWatcherState(watcherKey, watcher);
        return;
      }

      // Fall back to tasks.md checkbox counting if no task-state.json
      let done = 0;
      let total = 0;
      let tasksContent = '';
      try {
        tasksContent = fs.readFileSync(tasksPath, 'utf8');
        const counts = countTasks(tasksContent);
        done = counts.done;
        total = counts.total;
      } catch {
        /* file may not exist */
      }

      const currentTime = Date.now();

      // 3. Task state machine — drive review gate
      if (taskState) {
        const allApproved =
          taskState.tasks.length > 0 &&
          taskState.tasks.every((t) => t.status === 'approved');

        // All tasks approved → stream complete
        if (allApproved) {
          completeStreamWatcher(client, guild, watcherKey);
          return;
        }

        const currentTask =
          taskState.currentTask != null
            ? taskState.tasks.find((t) => t.id === taskState.currentTask)
            : null;

        if (currentTask) {
          const wsChannel = guild.channels.cache.find(
            (c: any) => c.id === channelId,
          ) as TextChannel | undefined;

          switch (currentTask.status) {
            case 'implemented': {
              // Agent finished task → trigger review
              if (watcher.lastReviewedTaskId !== currentTask.id) {
                watcher.lastReviewedTaskId = currentTask.id;

                // If the lead agent IS Argus (e.g., ws-qa), auto-approve
                // since Argus is the reviewer — can't meaningfully review itself
                if (leadAgent === 'Argus') {
                  assertValidTaskTransition('implemented', 'approved');
                  currentTask.status = 'approved';
                  currentTask.reviewRounds =
                    (currentTask.reviewRounds || 0) + 1;
                  writeTaskState(projectSlug, streamType, taskState);
                  if (wsChannel) {
                    await wsChannel.send(
                      `\u2705 Task #${currentTask.id} auto-approved (Argus is both lead and reviewer).`,
                    );
                  }
                  watcher.lastActivityTime = currentTime;
                  break;
                }

                assertValidTaskTransition('implemented', 'in_review');
                currentTask.status = 'in_review';
                writeTaskState(projectSlug, streamType, taskState);

                if (wsChannel) {
                  const commitInfo = currentTask.lastCommit
                    ? ` Commit: ${currentTask.lastCommit}`
                    : '';
                  const branchInfo = watcher.currentBranch
                    ? ` Branch: \`${watcher.currentBranch}\``
                    : '';
                  await wsChannel.send(
                    `@Argus \u2014 Review task #${currentTask.id} in ws-${streamType}.${commitInfo}${branchInfo}`,
                  );
                }
                watcher.lastActivityTime = currentTime;
              }
              break;
            }

            case 'approved': {
              // Argus approved → merge agent branch to main, advance to next task
              try {
                mergeAgentBranch(
                  projectSlug,
                  streamType,
                  leadAgent,
                  currentTask.id,
                );
                logger.info(
                  { watcherKey, taskId: currentTask.id },
                  'Merged agent branch to main',
                );
              } catch (mergeErr: any) {
                // Abort the failed merge to leave the repo clean
                try {
                  gitInWorkspace(projectSlug, streamType, 'merge --abort');
                } catch {
                  /* merge --abort can fail if no merge in progress */
                }
                logger.error(
                  { err: mergeErr.message, watcherKey },
                  'Failed to merge agent branch — aborted merge, setting merge_conflict',
                );
                // Set task to merge_conflict so we don't retry every poll
                assertValidTaskTransition('approved', 'merge_conflict');
                currentTask.status = 'merge_conflict' as TaskStatus;
                writeTaskState(projectSlug, streamType, taskState);
                const controlRoom = guild.channels.cache.find(
                  (c: any) =>
                    c.name === 'control-room' && c.parentId === categoryId,
                ) as TextChannel | undefined;
                if (controlRoom) {
                  await controlRoom.send(
                    `\u26A0\u{FE0F} **ws-${streamType}** merge conflict on task #${currentTask.id}. Human intervention needed. Task set to \`merge_conflict\` — resolve manually and set status back to \`approved\`.`,
                  );
                }
                break; // Don't advance — needs manual resolution
              }

              const nextTask = taskState.tasks.find(
                (t) => t.status === 'pending',
              );
              if (nextTask) {
                assertValidTaskTransition('pending', 'in_progress');
                nextTask.status = 'in_progress';
                taskState.currentTask = nextTask.id;

                let branchName: string | undefined;
                try {
                  branchName = ensureAgentBranch(
                    projectSlug,
                    streamType,
                    leadAgent,
                  );
                  watcher.currentBranch = branchName;
                  channelBranchMap.set(channelId, branchName);
                } catch (branchErr: any) {
                  logger.warn(
                    { err: branchErr.message, watcherKey },
                    'Failed to create agent branch for next task',
                  );
                }

                writeTaskState(projectSlug, streamType, taskState);
                // Flush watcher state immediately so currentBranch survives crashes
                saveStreamWatcherState(watcherKey, watcher);

                if (wsChannel) {
                  const branchInfo = branchName
                    ? ` (branch: \`${branchName}\`)`
                    : '';
                  await wsChannel.send(
                    `@${leadAgent} \u2014 Start task #${nextTask.id} in tasks.md${branchInfo}`,
                  );
                }
                watcher.lastActivityTime = currentTime;
              } else {
                // No more pending tasks but not all approved — shouldn't happen,
                // but handle gracefully by checking completion again
                const allDone = taskState.tasks.every(
                  (t) => t.status === 'approved',
                );
                if (allDone) {
                  completeStreamWatcher(client, guild, watcherKey);
                  return;
                }
              }
              break;
            }

            case 'changes_requested': {
              // Argus requested changes → re-trigger lead agent on same branch
              assertValidTaskTransition('changes_requested', 'in_progress');
              currentTask.status = 'in_progress';
              // Reset so the next `implemented` transition will re-trigger Argus
              watcher.lastReviewedTaskId = undefined;
              writeTaskState(projectSlug, streamType, taskState);

              if (wsChannel) {
                const branchInfo = watcher.currentBranch
                  ? ` Fix on branch \`${watcher.currentBranch}\` and re-submit.`
                  : ' Fix and re-submit.';
                await wsChannel.send(
                  `@${leadAgent} \u2014 Argus requested changes on task #${currentTask.id}. ` +
                    `Review round ${currentTask.reviewRounds}.${branchInfo}`,
                );
              }
              watcher.lastActivityTime = currentTime;

              // Escalate if too many review rounds
              if (currentTask.reviewRounds >= 3) {
                const controlRoom = guild.channels.cache.find(
                  (c: any) =>
                    c.name === 'control-room' && c.parentId === categoryId,
                ) as TextChannel | undefined;
                if (controlRoom) {
                  await controlRoom.send(
                    `\u26A0\u{FE0F} **ws-${streamType}** task #${currentTask.id} has gone ${currentTask.reviewRounds} review rounds. Human input needed.`,
                  );
                }
              }
              break;
            }

            case 'in_review':
              // Waiting for Argus — do nothing, don't re-trigger
              break;

            case 'in_progress':
              // Agent is working — don't interrupt
              break;

            case 'pending': {
              // Not started yet — create agent branch and trigger lead agent
              assertValidTaskTransition('pending', 'in_progress');
              currentTask.status = 'in_progress';
              taskState.currentTask = currentTask.id;

              let branchName: string | undefined;
              try {
                branchName = ensureAgentBranch(
                  projectSlug,
                  streamType,
                  leadAgent,
                );
                watcher.currentBranch = branchName;
                channelBranchMap.set(channelId, branchName);
              } catch (branchErr: any) {
                logger.warn(
                  { err: branchErr.message, watcherKey },
                  'Failed to create agent branch — proceeding without isolation',
                );
              }

              writeTaskState(projectSlug, streamType, taskState);
              // Flush watcher state immediately so currentBranch survives crashes
              saveStreamWatcherState(watcherKey, watcher);

              if (wsChannel) {
                const branchInfo = branchName
                  ? ` (branch: \`${branchName}\`)`
                  : '';
                await wsChannel.send(
                  `@${leadAgent} \u2014 Start task #${currentTask.id} in tasks.md${branchInfo}`,
                );
              }
              watcher.lastActivityTime = currentTime;
              break;
            }
          }
        }
      } else if (!watcher.taskStateInitialized) {
        // task-state.json was never created — legacy fallback: complete on all checkboxes done
        if (total > 0 && done === total) {
          completeStreamWatcher(client, guild, watcherKey);
          return;
        }
      }

      // Periodically flush watcher state to SQLite for crash recovery
      saveStreamWatcherState(watcherKey, watcher);

      // 4. Hourly status report to control-room
      if (currentTime - watcher.lastStatusReport >= STREAM_STATUS_INTERVAL) {
        watcher.lastStatusReport = currentTime;
        const approvedCount = taskState
          ? taskState.tasks.filter((t) => t.status === 'approved').length
          : done;
        const totalCount = taskState ? taskState.tasks.length : total;
        const currentTaskInfo =
          taskState?.currentTask != null
            ? taskState.tasks.find((t) => t.id === taskState.currentTask)
            : null;

        const controlRoom = guild.channels.cache.find(
          (c: any) => c.name === 'control-room' && c.parentId === categoryId,
        ) as TextChannel | undefined;
        if (controlRoom) {
          const statusEmbed = new EmbedBuilder()
            .setColor(AGENT_COLORS[leadAgent] || 0x5865f2)
            .setTitle(
              `\u2699\u{FE0F} ws-${streamType}: ${approvedCount}/${totalCount} tasks approved`,
            )
            .setDescription(
              `**Lead:** ${leadAgent}\n` +
                `**Current task:** ${currentTaskInfo ? `#${currentTaskInfo.id} (${currentTaskInfo.status})` : 'none'}\n` +
                `**Last activity:** ${new Date(watcher.lastActivityTime).toLocaleTimeString()}`,
            )
            .setTimestamp();
          await controlRoom.send({ embeds: [statusEmbed] });
        }
      }

      // 5. Silence detection — 1 hour no activity
      if (currentTime - watcher.lastActivityTime >= STREAM_SILENCE_THRESHOLD) {
        const wsChannel = guild.channels.cache.find(
          (c: any) => c.id === channelId,
        ) as TextChannel | undefined;
        if (wsChannel) {
          await wsChannel.send(
            `\u23F0 @${leadAgent} \u2014 no activity detected for 1 hour. Are you blocked?`,
          );
        }
        const controlRoom = guild.channels.cache.find(
          (c: any) => c.name === 'control-room' && c.parentId === categoryId,
        ) as TextChannel | undefined;
        if (controlRoom) {
          await controlRoom.send(
            `\u26A0\u{FE0F} **ws-${streamType}**: no activity for 1 hour. May need attention.`,
          );
        }
        // Reset to avoid spamming every poll interval
        watcher.lastActivityTime = currentTime;
      }
    } catch (err: any) {
      logger.error({ err: err.message, watcherKey }, 'Stream watcher error');
    }
  }, STREAM_POLL_INTERVAL);

  activeStreamWatchers.set(watcherKey, {
    interval,
    listener,
    projectSlug,
    streamType,
    channelId,
    categoryId,
    lastActivityTime: now,
    lastStatusReport: now,
    lastTasksMtime: 0,
    completed: false,
    lastReviewedTaskId: undefined,
    taskStateInitialized,
  });

  logger.info({ projectSlug, streamType }, 'Stream watcher started');

  // Persist to SQLite for restart recovery
  const createdWatcher = activeStreamWatchers.get(watcherKey);
  if (createdWatcher) saveStreamWatcherState(watcherKey, createdWatcher);
}

/**
 * Complete a stream watcher — posts completion to control-room and cleans up.
 */
export function completeStreamWatcher(
  client: Client,
  guild: { channels: { cache: { find: (fn: (c: any) => boolean) => any } } },
  watcherKey: string,
): void {
  const watcher = activeStreamWatchers.get(watcherKey);
  if (!watcher || watcher.completed) return;

  watcher.completed = true;

  // Read final task count from task-state.json or tasks.md
  const wsDir = path.resolve(
    process.cwd(),
    'groups',
    'shared_project',
    'active',
    watcher.projectSlug,
    'workstreams',
    watcher.streamType,
  );
  let done = 0;
  let total = 0;

  const taskResult = readTaskState(watcher.projectSlug, watcher.streamType);
  if (taskResult.state) {
    total = taskResult.state.tasks.length;
    done = taskResult.state.tasks.filter((t) => t.status === 'approved').length;
  } else {
    try {
      const tasksContent = fs.readFileSync(
        path.join(wsDir, 'tasks.md'),
        'utf8',
      );
      const counts = countTasks(tasksContent);
      done = counts.done;
      total = counts.total;
    } catch {
      /* ignore */
    }
  }

  // Post completion to control-room
  const controlRoom = guild.channels.cache.find(
    (c: any) => c.name === 'control-room' && c.parentId === watcher.categoryId,
  ) as TextChannel | undefined;
  if (controlRoom) {
    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle(
        `\u2705 ws-${watcher.streamType} complete: ${done}/${total} tasks done`,
      )
      .setTimestamp();
    controlRoom.send({ embeds: [embed] }).catch(() => {});
  }

  // Clean up
  stopStreamWatcher(watcherKey, client);
}

/**
 * Stop a stream watcher by its key (projectSlug:streamType).
 */
export function stopStreamWatcher(watcherKey: string, client?: Client): void {
  const watcher = activeStreamWatchers.get(watcherKey);
  if (!watcher) return;

  clearInterval(watcher.interval);
  if (client) {
    client.removeListener('messageCreate', watcher.listener);
  }

  // Clean up branch tracking
  channelBranchMap.delete(watcher.channelId);

  activeStreamWatchers.delete(watcherKey);
  deleteOrchestrationState(`sw:${watcherKey}`);
  logger.info({ watcherKey }, 'Stream watcher stopped');
}
