import { Client, TextChannel } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { logger } from '../../logger.js';
import { WORKSTREAM_DEFS, WORKSPACE_POLL_INTERVAL } from './constants.js';
import { activeWatchers } from './state.js';
import { withFileLock } from './file-lock.js';

/**
 * Single poll iteration: check mtime changes in workspace files.
 * Returns list of changed files with their type context.
 */
export function checkWorkspaceChanges(
  projectSlug: string,
  mtimes: Map<string, number>,
): Array<{
  file: string;
  type: 'progress' | 'coordination' | 'handoff';
  stream?: string;
}> {
  const basePath = path.resolve(
    process.cwd(),
    'groups',
    'shared_project',
    'active',
    projectSlug,
  );
  const changes: Array<{
    file: string;
    type: 'progress' | 'coordination' | 'handoff';
    stream?: string;
  }> = [];

  // Check workstreams/*/progress.md and workstreams/*/handoffs.md
  const wsDir = path.join(basePath, 'workstreams');
  if (fs.existsSync(wsDir)) {
    try {
      const streams = fs
        .readdirSync(wsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      for (const stream of streams) {
        for (const fileName of ['progress.md', 'handoffs.md']) {
          const filePath = path.join(wsDir, stream, fileName);
          if (!fs.existsSync(filePath)) continue;

          try {
            const stat = fs.statSync(filePath);
            const prevMtime = mtimes.get(filePath) ?? 0;
            if (stat.mtimeMs > prevMtime) {
              mtimes.set(filePath, stat.mtimeMs);
              // Skip the first poll (initial population)
              if (prevMtime > 0) {
                changes.push({
                  file: filePath,
                  type: fileName === 'progress.md' ? 'progress' : 'handoff',
                  stream,
                });
              }
            }
          } catch {
            /* stat failed, skip */
          }
        }
      }
    } catch {
      /* readdir failed */
    }
  }

  // Check coordination/*.md
  const coordDir = path.join(basePath, 'coordination');
  if (fs.existsSync(coordDir)) {
    try {
      const files = fs.readdirSync(coordDir).filter((f) => f.endsWith('.md'));

      for (const fileName of files) {
        const filePath = path.join(coordDir, fileName);
        try {
          const stat = fs.statSync(filePath);
          const prevMtime = mtimes.get(filePath) ?? 0;
          if (stat.mtimeMs > prevMtime) {
            mtimes.set(filePath, stat.mtimeMs);
            if (prevMtime > 0) {
              changes.push({ file: filePath, type: 'coordination' });
            }
          }
        } catch {
          /* stat failed, skip */
        }
      }
    } catch {
      /* readdir failed */
    }
  }

  return changes;
}

/**
 * Update status-board.md by aggregating all workstream progress files.
 */
export function syncStatusBoard(projectSlug: string): void {
  const basePath = path.resolve(
    process.cwd(),
    'groups',
    'shared_project',
    'active',
    projectSlug,
  );

  const wsDir = path.join(basePath, 'workstreams');
  const statusPath = path.join(basePath, 'coordination', 'status-board.md');

  if (!fs.existsSync(wsDir)) return;

  try {
    const streams = fs
      .readdirSync(wsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    let table = '# Status Board\n\n## Overall Status: In Progress\n\n';
    table += '| Stream | Status | Last Update |\n';
    table += '|--------|--------|-------------|\n';

    for (const stream of streams) {
      const progressPath = path.join(wsDir, stream, 'progress.md');
      let summary = 'No updates';
      let lastUpdate = 'N/A';

      if (fs.existsSync(progressPath)) {
        const content = fs.readFileSync(progressPath, 'utf8');
        const lines = content
          .split('\n')
          .filter((l) => l.trim() && !l.startsWith('#'));
        summary = lines.length > 0 ? lines[0].slice(0, 60) : 'No updates';
        try {
          const stat = fs.statSync(progressPath);
          lastUpdate = new Date(stat.mtimeMs).toISOString().slice(0, 16);
        } catch {
          /* ok */
        }
      }

      table += `| ${stream} | ${summary} | ${lastUpdate} |\n`;
    }

    fs.writeFileSync(statusPath, table, 'utf8');
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to sync status board');
  }
}

/**
 * Start polling for workspace file changes. Posts notifications to Discord channels.
 */
export function startWorkspaceWatcher(
  client: Client,
  guild: { channels: { cache: { find: (fn: (c: any) => boolean) => any } } },
  projectSlug: string,
  categoryId: string,
): void {
  if (activeWatchers.has(projectSlug)) return; // Already watching

  const mtimes = new Map<string, number>();

  // Initial scan to populate mtimes (no notifications)
  checkWorkspaceChanges(projectSlug, mtimes);

  const interval = setInterval(async () => {
    try {
      const changes = checkWorkspaceChanges(projectSlug, mtimes);
      if (changes.length === 0) return;

      for (const change of changes) {
        if (change.type === 'progress' && change.stream) {
          // Notify the work stream channel
          const def = WORKSTREAM_DEFS[change.stream];
          if (def) {
            const wsChan = guild.channels.cache.find(
              (c: any) => c.name === def.channel && c.parentId === categoryId,
            ) as TextChannel | undefined;
            if (wsChan) {
              await wsChan.send(
                `\u{1F4DD} **Progress updated** in \`workstreams/${change.stream}/progress.md\``,
              );
            }
          }

          // Auto-sync: update status-board.md
          await withFileLock(
            path.resolve(
              process.cwd(),
              'groups',
              'shared_project',
              'active',
              projectSlug,
              'coordination',
              'status-board.md',
            ),
            () => syncStatusBoard(projectSlug),
          );
        }

        if (change.type === 'handoff' && change.stream) {
          // Check if handoff was delivered — auto-checkpoint
          const handoffPath = change.file;
          try {
            const content = fs.readFileSync(handoffPath, 'utf8');
            if (content.includes('[Delivered]')) {
              // Notify control room
              const controlRoom = guild.channels.cache.find(
                (c: any) =>
                  c.name === 'control-room' && c.parentId === categoryId,
              ) as TextChannel | undefined;
              if (controlRoom) {
                await controlRoom.send(
                  `\u2705 **Handoff delivered** from \`${change.stream}\` \u2014 check \`workstreams/${change.stream}/handoffs.md\``,
                );
              }
            }
          } catch {
            /* read failed, skip */
          }
        }

        if (change.type === 'coordination') {
          // Check for new blocked entries in dependencies.md
          if (change.file.endsWith('dependencies.md')) {
            const controlRoom = guild.channels.cache.find(
              (c: any) =>
                c.name === 'control-room' && c.parentId === categoryId,
            ) as TextChannel | undefined;
            if (controlRoom) {
              try {
                const content = fs.readFileSync(change.file, 'utf8');
                const blockedCount = (content.match(/\| blocked \|/gi) || [])
                  .length;
                if (blockedCount > 0) {
                  await controlRoom.send(
                    `\u{1F6A8} **Dependencies updated** \u2014 ${blockedCount} blocked item(s). Check \`coordination/dependencies.md\``,
                  );
                }
              } catch {
                /* read failed */
              }
            }
          }
        }
      }
    } catch (err: any) {
      logger.error({ err: err.message }, 'Workspace watcher error');
    }
  }, WORKSPACE_POLL_INTERVAL);

  activeWatchers.set(projectSlug, { interval, mtimes });
  logger.info({ projectSlug }, 'Workspace watcher started');
}

/**
 * Stop the workspace watcher for a project.
 */
export function stopWorkspaceWatcher(projectSlug: string): void {
  const watcher = activeWatchers.get(projectSlug);
  if (watcher) {
    clearInterval(watcher.interval);
    activeWatchers.delete(projectSlug);
    logger.info({ projectSlug }, 'Workspace watcher stopped');
  }
}
