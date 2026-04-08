import type { TaskStatus } from './types.js';
import { logger } from '../../logger.js';

/**
 * Valid task status transitions in the stream watcher state machine.
 * Adjacency list: from → Set<to>
 */
const VALID_TRANSITIONS: Record<string, Set<string>> = {
  pending: new Set(['in_progress']),
  in_progress: new Set(['implemented']),
  implemented: new Set(['in_review', 'approved']), // approved = auto-approve path (Argus lead)
  in_review: new Set(['approved', 'changes_requested']),
  changes_requested: new Set(['in_progress']),
  approved: new Set(['merge_conflict']),
  merge_conflict: new Set(['approved']), // manual resolution sets back to approved
};

/**
 * Assert that an agent is not reviewing its own work.
 * @throws {Error} if leadAgent === reviewer
 */
export function assertNotSelfReview(
  leadAgent: string,
  reviewer: string,
): void {
  if (leadAgent === reviewer) {
    const msg = `Workflow invariant violation: self-review detected (${leadAgent} reviewing ${leadAgent})`;
    logger.error({ leadAgent, reviewer }, msg);
    throw new Error(msg);
  }
}

/**
 * Assert that a task status transition is valid per the state machine.
 * @throws {Error} if the transition is not in VALID_TRANSITIONS
 */
export function assertValidTaskTransition(
  from: TaskStatus | string,
  to: TaskStatus | string,
): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed || !allowed.has(to)) {
    const msg = `Workflow invariant violation: invalid task transition ${from} → ${to}`;
    logger.error({ from, to }, msg);
    throw new Error(msg);
  }
}

/**
 * Assert that all sessions in a map have a corresponding active channel.
 * @throws {Error} listing orphaned channel IDs
 */
export function assertSessionNotOrphaned(
  sessions: Map<string, unknown>,
  activeChannelIds: Set<string>,
): void {
  const orphaned: string[] = [];
  for (const channelId of sessions.keys()) {
    if (!activeChannelIds.has(channelId)) {
      orphaned.push(channelId);
    }
  }
  if (orphaned.length > 0) {
    const msg = `Workflow invariant violation: orphaned sessions for channels: ${orphaned.join(', ')}`;
    logger.warn({ orphaned }, msg);
    throw new Error(msg);
  }
}

/**
 * Soft-check variant that logs but doesn't throw.
 * Use in production poll loops where you want observability without crashing.
 */
export function checkInvariant(
  name: string,
  fn: () => void,
): { ok: boolean; error?: string } {
  try {
    fn();
    return { ok: true };
  } catch (err: any) {
    logger.warn({ invariant: name, error: err.message }, `Invariant check failed: ${name}`);
    return { ok: false, error: err.message };
  }
}
