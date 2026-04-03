import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

const WORKTREE_BASE = '.worktrees';

/**
 * Sanitize a string for use in filesystem paths.
 * Replaces any non-alphanumeric, non-hyphen characters with hyphens.
 */
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9-]/g, '-');
}

/**
 * Create a git worktree for a specific branch and agent.
 * The host is the single source of truth for branch selection.
 * If the worktree already exists for this agent+branch, reuse it.
 */
export function createWorktree(
  repoDir: string,
  branchName: string,
  agentId: string,
): string {
  const safeName = `${sanitize(agentId)}-${sanitize(branchName)}`;
  const worktreeDir = path.join(repoDir, WORKTREE_BASE, safeName);

  // Prune stale worktree metadata first (handles crash recovery)
  try {
    execSync('git worktree prune', { cwd: repoDir, stdio: 'pipe' });
  } catch {
    /* best effort */
  }

  // If directory exists and is a valid worktree, reuse it
  if (
    fs.existsSync(worktreeDir) &&
    fs.existsSync(path.join(worktreeDir, '.git'))
  ) {
    logger.debug({ worktreeDir, branchName }, 'Reusing existing worktree');
    return worktreeDir;
  }

  // If directory exists but is not a valid worktree (stale), remove it
  if (fs.existsSync(worktreeDir)) {
    fs.rmSync(worktreeDir, { recursive: true, force: true });
  }

  fs.mkdirSync(path.join(repoDir, WORKTREE_BASE), { recursive: true });

  try {
    execSync(`git worktree add "${worktreeDir}" "${branchName}"`, {
      cwd: repoDir,
      stdio: 'pipe',
    });
    logger.info({ worktreeDir, branchName, agentId }, 'Created worktree');
  } catch (err) {
    logger.error({ err, branchName, agentId }, 'Failed to create worktree');
    throw err;
  }

  return worktreeDir;
}

/**
 * Remove a git worktree. Safe to call on already-removed paths.
 * Uses fallback to manual cleanup + prune on failure.
 */
export function removeWorktree(repoDir: string, worktreeDir: string): void {
  try {
    if (!fs.existsSync(worktreeDir)) {
      // Already gone — just prune metadata
      try {
        execSync('git worktree prune', { cwd: repoDir, stdio: 'pipe' });
      } catch {
        /* best effort */
      }
      return;
    }
    execSync(`git worktree remove "${worktreeDir}" --force`, {
      cwd: repoDir,
      stdio: 'pipe',
    });
    logger.info({ worktreeDir }, 'Removed worktree');
  } catch {
    // Fallback: manual cleanup
    if (fs.existsSync(worktreeDir)) {
      fs.rmSync(worktreeDir, { recursive: true, force: true });
    }
    try {
      execSync('git worktree prune', { cwd: repoDir, stdio: 'pipe' });
    } catch {
      /* best effort */
    }
  }
}

/**
 * Check if a worktree path is registered as active in git.
 */
export function isWorktreeActive(
  repoDir: string,
  worktreeDir: string,
): boolean {
  try {
    const output = execSync('git worktree list --porcelain', {
      cwd: repoDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.includes(`worktree ${worktreeDir}`);
  } catch {
    return false;
  }
}
