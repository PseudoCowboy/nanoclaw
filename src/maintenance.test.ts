import { describe, it, expect } from 'vitest';

describe('maintenance', () => {
  it('exports a runMaintenance function', async () => {
    const mod = await import('./maintenance.js');
    expect(typeof mod.runMaintenance).toBe('function');
  });
});
