import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkRateLimit,
  RATE_LIMIT_ERROR,
  resetRateLimitStore,
} from '@/lib/auth/rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    resetRateLimitStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests under the limit', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit('key', 5, 60_000).allowed).toBe(true);
    }
  });

  it('blocks requests over the limit', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('key', 5, 60_000);
    expect(checkRateLimit('key', 5, 60_000).allowed).toBe(false);
  });

  it('tracks keys independently', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('a', 5, 60_000);
    expect(checkRateLimit('b', 5, 60_000).allowed).toBe(true);
  });

  it('allows again after the window passes', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('key', 5, 60_000);
    expect(checkRateLimit('key', 5, 60_000).allowed).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(checkRateLimit('key', 5, 60_000).allowed).toBe(true);
  });

  it('exposes a user-facing Chinese error message', () => {
    expect(RATE_LIMIT_ERROR).toContain('尝试次数过多');
  });
});
