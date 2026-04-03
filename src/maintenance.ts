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
