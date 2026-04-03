import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createWorktree, removeWorktree, isWorktreeActive } from './worktree.js';

describe('worktree helpers', () => {
  let testRepo: string;

  beforeEach(() => {
    testRepo = path.join('/tmp', `worktree-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(testRepo, { recursive: true });
    execSync('git init && git commit --allow-empty -m "init"', {
      cwd: testRepo,
      stdio: 'pipe',
    });
    execSync('git branch test-branch', { cwd: testRepo, stdio: 'pipe' });
  });

  afterEach(() => {
    // Clean up all worktrees first, then remove the repo
    try {
      execSync('git worktree prune', { cwd: testRepo, stdio: 'pipe' });
      const list = execSync('git worktree list --porcelain', {
        cwd: testRepo,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      for (const line of list.split('\n')) {
        if (line.startsWith('worktree ')) {
          const wtPath = line.replace('worktree ', '');
          if (wtPath !== testRepo) {
            try {
              execSync(`git worktree remove "${wtPath}" --force`, {
                cwd: testRepo,
                stdio: 'pipe',
              });
            } catch {
              /* already gone */
            }
          }
        }
      }
    } catch {
      /* best effort */
    }
    fs.rmSync(testRepo, { recursive: true, force: true });
  });

  it('creates a worktree for a branch', () => {
    const worktreePath = createWorktree(testRepo, 'test-branch', 'agent-atlas');
    expect(fs.existsSync(worktreePath)).toBe(true);
    // Worktree has a .git file (not directory) pointing to main repo
    expect(fs.existsSync(path.join(worktreePath, '.git'))).toBe(true);
    removeWorktree(testRepo, worktreePath);
  });

  it('removes a worktree cleanly', () => {
    const worktreePath = createWorktree(testRepo, 'test-branch', 'agent-atlas');
    removeWorktree(testRepo, worktreePath);
    expect(fs.existsSync(worktreePath)).toBe(false);
  });

  it('reuses existing worktree for same agent+branch', () => {
    const wt1 = createWorktree(testRepo, 'test-branch', 'agent-atlas');
    const wt2 = createWorktree(testRepo, 'test-branch', 'agent-atlas');
    expect(wt1).toBe(wt2);
    removeWorktree(testRepo, wt1);
  });

  it('handles cleanup after crash (stale dir exists but git metadata gone)', () => {
    const worktreePath = createWorktree(testRepo, 'test-branch', 'agent-atlas');
    // Simulate crash: remove git worktree metadata but leave directory
    execSync(`git worktree remove "${worktreePath}" --force`, {
      cwd: testRepo,
      stdio: 'pipe',
    });
    fs.mkdirSync(worktreePath, { recursive: true });
    // Should handle gracefully — prune stale metadata and recreate
    const wt2 = createWorktree(testRepo, 'test-branch', 'agent-atlas');
    expect(fs.existsSync(wt2)).toBe(true);
    expect(fs.existsSync(path.join(wt2, '.git'))).toBe(true);
    removeWorktree(testRepo, wt2);
  });

  it('removeWorktree is safe on already-removed path', () => {
    // Should not throw
    expect(() =>
      removeWorktree(testRepo, '/tmp/nonexistent-worktree-path'),
    ).not.toThrow();
  });

  it('isWorktreeActive detects active worktrees', () => {
    const worktreePath = createWorktree(testRepo, 'test-branch', 'agent-atlas');
    expect(isWorktreeActive(testRepo, worktreePath)).toBe(true);
    removeWorktree(testRepo, worktreePath);
    expect(isWorktreeActive(testRepo, worktreePath)).toBe(false);
  });
});
