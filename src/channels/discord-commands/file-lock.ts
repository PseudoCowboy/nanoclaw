import fs from 'fs';
import { logger } from '../../logger.js';
import { LOCK_STALE_MS } from './constants.js';

interface LockInfo {
  pid: number;
  timestamp: number;
}

/**
 * Acquire a lock file for the given path. Waits up to `timeout` ms if an existing fresh lock is held.
 * Stale locks (> 30s old) are auto-cleaned.
 */
export async function acquireFileLock(
  filePath: string,
  timeout = 5000,
): Promise<void> {
  const lockPath = `${filePath}.lock`;
  const start = Date.now();

  while (true) {
    // Check for existing lock
    if (fs.existsSync(lockPath)) {
      try {
        const lockData: LockInfo = JSON.parse(
          fs.readFileSync(lockPath, 'utf8'),
        );
        const age = Date.now() - lockData.timestamp;
        if (age < LOCK_STALE_MS) {
          // Lock is fresh — wait and retry
          if (Date.now() - start >= timeout) {
            throw new Error(`Timed out waiting for lock on ${filePath}`);
          }
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }
        // Stale lock — clean it
        logger.warn({ lockPath, age }, 'Cleaning stale lock');
      } catch (err: any) {
        if (err.message?.startsWith('Timed out')) throw err;
        // Corrupted lock file — remove it
      }
      try {
        fs.unlinkSync(lockPath);
      } catch {
        /* already gone */
      }
    }

    // Write our lock
    const lockInfo: LockInfo = { pid: process.pid, timestamp: Date.now() };
    fs.writeFileSync(lockPath, JSON.stringify(lockInfo), 'utf8');
    return;
  }
}

/**
 * Release a lock file for the given path.
 */
export function releaseFileLock(filePath: string): void {
  const lockPath = `${filePath}.lock`;
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // Lock file already gone
  }
}

/**
 * Run a function while holding a file lock. Lock is released on success or error.
 */
export async function withFileLock<T>(
  filePath: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  await acquireFileLock(filePath);
  try {
    return await fn();
  } finally {
    releaseFileLock(filePath);
  }
}
