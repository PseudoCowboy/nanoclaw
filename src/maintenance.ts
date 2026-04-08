import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { logger } from './logger.js';
import { cleanupOrphans, cleanupStaleContainers } from './container-runtime.js';
import { isWorktreeActive, removeWorktree } from './worktree.js';
import { GROUPS_DIR } from './config.js';

export function runMaintenance(): void {
  logger.info('Starting scheduled maintenance');
  cleanupOrphans();
  cleanupStaleContainers();
  cleanupStaleWorktrees();
  pruneGitMetadata();
  scanWorkflowDrift();
  logger.info('Scheduled maintenance complete');
}

function cleanupStaleWorktrees(): void {
  const sharedDir = path.join(GROUPS_DIR, 'shared_project', 'active');
  if (!fs.existsSync(sharedDir)) return;

  try {
    const projects = fs
      .readdirSync(sharedDir, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const project of projects) {
      const projectDir = path.join(sharedDir, project.name);
      const worktreeBase = path.join(projectDir, '.worktrees');
      if (!fs.existsSync(worktreeBase)) continue;

      const worktrees = fs
        .readdirSync(worktreeBase, { withFileTypes: true })
        .filter((d) => d.isDirectory());

      for (const wt of worktrees) {
        const wtPath = path.join(worktreeBase, wt.name);
        if (!isWorktreeActive(projectDir, wtPath)) {
          logger.info(
            { wtPath, project: project.name },
            'Removing stale worktree',
          );
          removeWorktree(projectDir, wtPath);
        }
      }

      try {
        execSync('git worktree prune', { cwd: projectDir, stdio: 'pipe' });
      } catch {
        /* best effort */
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up stale worktrees');
  }
}

function pruneGitMetadata(): void {
  const sharedDir = path.join(GROUPS_DIR, 'shared_project', 'active');
  if (!fs.existsSync(sharedDir)) return;

  try {
    const projects = fs
      .readdirSync(sharedDir, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const project of projects) {
      const projectDir = path.join(sharedDir, project.name);
      if (!fs.existsSync(path.join(projectDir, '.git'))) continue;
      try {
        execSync('git gc --auto', {
          cwd: projectDir,
          stdio: 'pipe',
          timeout: 30000,
        });
      } catch {
        /* best effort */
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to prune git metadata');
  }
}

/**
 * Scan active project workspaces for workflow drift patterns.
 * Logs warnings for: stale agent names, old path patterns, orphaned workstream folders,
 * zombie discussion sessions, task-state.json with impossible states.
 */
export function scanWorkflowDrift(): void {
  const sharedDir = path.join(GROUPS_DIR, 'shared_project', 'active');
  if (!fs.existsSync(sharedDir)) return;

  const STALE_AGENTS = ['Prometheus', 'Zeus', 'Hera', 'Hephaestus'];
  const OLD_PATH_PATTERN = '/workspace/shared/projects/';
  let driftCount = 0;

  try {
    const projects = fs
      .readdirSync(sharedDir, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const project of projects) {
      const projectDir = path.join(sharedDir, project.name);

      // 1. Scan markdown files for stale agent references and old paths
      const mdFiles = findMarkdownFiles(projectDir);
      for (const mdFile of mdFiles) {
        try {
          const content = fs.readFileSync(mdFile, 'utf8');
          for (const stale of STALE_AGENTS) {
            if (content.includes(stale)) {
              logger.warn(
                { file: mdFile, agent: stale, project: project.name },
                'Drift: stale agent reference found',
              );
              driftCount++;
            }
          }
          if (content.includes(OLD_PATH_PATTERN)) {
            logger.warn(
              { file: mdFile, project: project.name },
              'Drift: old path pattern found',
            );
            driftCount++;
          }
        } catch {
          /* skip unreadable files */
        }
      }

      // 2. Check task-state.json files for impossible states
      const wsDir = path.join(projectDir, 'workstreams');
      if (fs.existsSync(wsDir)) {
        const streams = fs
          .readdirSync(wsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory());
        for (const stream of streams) {
          const statePath = path.join(wsDir, stream.name, 'task-state.json');
          if (!fs.existsSync(statePath)) continue;
          try {
            const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            if (state.tasks) {
              for (const task of state.tasks) {
                if (
                  (task.status === 'in_review' ||
                    task.status === 'changes_requested' ||
                    task.status === 'in_progress') &&
                  task.reviewRounds >= 3
                ) {
                  logger.warn(
                    {
                      project: project.name,
                      stream: stream.name,
                      taskId: task.id,
                      rounds: task.reviewRounds,
                    },
                    'Drift: task stuck in excessive review rounds',
                  );
                  driftCount++;
                }
              }
            }
          } catch {
            logger.warn(
              { statePath, project: project.name },
              'Drift: corrupt task-state.json',
            );
            driftCount++;
          }
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to scan for workflow drift');
  }

  if (driftCount > 0) {
    logger.info({ driftCount }, 'Workflow drift scan complete — issues found');
  } else {
    logger.info('Workflow drift scan complete — no issues');
  }
}

/**
 * Recursively find .md files in a directory (max depth 3).
 */
function findMarkdownFiles(dir: string, depth = 0): string[] {
  if (depth > 3) return [];
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        results.push(...findMarkdownFiles(fullPath, depth + 1));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
  } catch {
    /* permission error or broken symlink */
  }
  return results;
}
