import { describe, it, expect, vi } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  assertNotSelfReview,
  assertValidTaskTransition,
  assertSessionNotOrphaned,
  checkInvariant,
} from './workflow-invariants.js';

describe('workflow-invariants', () => {
  describe('assertNotSelfReview', () => {
    it('throws when lead agent is the reviewer', () => {
      expect(() => assertNotSelfReview('Argus', 'Argus')).toThrow(
        /self-review/i,
      );
    });

    it('does not throw when agents differ', () => {
      expect(() => assertNotSelfReview('Atlas', 'Argus')).not.toThrow();
    });
  });

  describe('assertValidTaskTransition', () => {
    it('allows pending → in_progress', () => {
      expect(() =>
        assertValidTaskTransition('pending', 'in_progress'),
      ).not.toThrow();
    });

    it('allows in_progress → implemented', () => {
      expect(() =>
        assertValidTaskTransition('in_progress', 'implemented'),
      ).not.toThrow();
    });

    it('allows implemented → in_review', () => {
      expect(() =>
        assertValidTaskTransition('implemented', 'in_review'),
      ).not.toThrow();
    });

    it('allows implemented → approved (auto-approve path)', () => {
      expect(() =>
        assertValidTaskTransition('implemented', 'approved'),
      ).not.toThrow();
    });

    it('allows in_review → approved', () => {
      expect(() =>
        assertValidTaskTransition('in_review', 'approved'),
      ).not.toThrow();
    });

    it('allows in_review → changes_requested', () => {
      expect(() =>
        assertValidTaskTransition('in_review', 'changes_requested'),
      ).not.toThrow();
    });

    it('allows changes_requested → in_progress', () => {
      expect(() =>
        assertValidTaskTransition('changes_requested', 'in_progress'),
      ).not.toThrow();
    });

    it('allows approved → merge_conflict', () => {
      expect(() =>
        assertValidTaskTransition('approved', 'merge_conflict'),
      ).not.toThrow();
    });

    it('allows merge_conflict → approved', () => {
      expect(() =>
        assertValidTaskTransition('merge_conflict', 'approved'),
      ).not.toThrow();
    });

    it('rejects pending → approved (skipping implementation)', () => {
      expect(() =>
        assertValidTaskTransition('pending', 'approved'),
      ).toThrow(/invalid.*transition/i);
    });

    it('rejects approved → in_progress (going backwards)', () => {
      expect(() =>
        assertValidTaskTransition('approved', 'in_progress'),
      ).toThrow(/invalid.*transition/i);
    });

    it('rejects unknown status', () => {
      expect(() =>
        assertValidTaskTransition('nonexistent', 'approved'),
      ).toThrow(/invalid.*transition/i);
    });
  });

  describe('assertSessionNotOrphaned', () => {
    it('throws when session has no matching channel', () => {
      const sessions = new Map([['chan-1', { topic: 'test' }]]);
      const activeChannels = new Set<string>();
      expect(() =>
        assertSessionNotOrphaned(sessions, activeChannels),
      ).toThrow(/orphaned/i);
    });

    it('does not throw when all sessions have channels', () => {
      const sessions = new Map([['chan-1', { topic: 'test' }]]);
      const activeChannels = new Set(['chan-1']);
      expect(() =>
        assertSessionNotOrphaned(sessions, activeChannels),
      ).not.toThrow();
    });

    it('does not throw for empty sessions map', () => {
      const sessions = new Map();
      const activeChannels = new Set<string>();
      expect(() =>
        assertSessionNotOrphaned(sessions, activeChannels),
      ).not.toThrow();
    });
  });

  describe('checkInvariant', () => {
    it('returns ok when assertion passes', () => {
      const result = checkInvariant('test', () => {});
      expect(result).toEqual({ ok: true });
    });

    it('returns error when assertion fails', () => {
      const result = checkInvariant('test', () => {
        throw new Error('boom');
      });
      expect(result).toEqual({ ok: false, error: 'boom' });
    });
  });
});
