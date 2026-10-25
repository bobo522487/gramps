import { describe, expect, it } from 'vitest';
import { shouldAutoOpenRoot } from '@/lib/lineage/auto-root';

describe('shouldAutoOpenRoot', () => {
  it('opens once for an empty lineage', () => {
    expect(
      shouldAutoOpenRoot({ nodeCount: 0, alreadyOpened: false, canWrite: true })
    ).toBe(true);
  });

  it('never opens again in the same visit', () => {
    expect(
      shouldAutoOpenRoot({ nodeCount: 0, alreadyOpened: true, canWrite: true })
    ).toBe(false);
  });

  it('never opens for a lineage that already has people', () => {
    expect(
      shouldAutoOpenRoot({ nodeCount: 2, alreadyOpened: false, canWrite: true })
    ).toBe(false);
  });

  it('never opens for users who cannot write', () => {
    expect(
      shouldAutoOpenRoot({
        nodeCount: 0,
        alreadyOpened: false,
        canWrite: false,
      })
    ).toBe(false);
  });
});
