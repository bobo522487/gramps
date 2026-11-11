// In-memory sliding-window rate limiter behind a swappable interface.
// Counts reset on process restart and are per-instance; for multi-instance
// deployments replace the store with a Redis/Upstash-backed implementation
// exposing the same `checkRateLimit` signature.

import { headers } from 'next/headers';

/**
 * 只信任由最近一层可信代理写入的地址：
 * - `x-real-ip` 由平台/入口代理覆盖，优先使用；
 * - 否则取 `X-Forwarded-For` 的最后一个 hop。追加型代理会把客户端自带值
 *   放在左边，取最左值等于让客户端自己决定限流 key。
 */
export function clientIpFromHeaders(
  realIp: string | null,
  forwardedFor: string | null
): string {
  const direct = realIp?.trim();
  if (direct) {
    return direct;
  }
  const hops =
    forwardedFor
      ?.split(',')
      .map((hop) => hop.trim())
      .filter(Boolean) ?? [];
  return hops.at(-1) ?? 'unknown';
}

export async function getClientIp(): Promise<string> {
  const h = await headers();
  return clientIpFromHeaders(h.get('x-real-ip'), h.get('x-forwarded-for'));
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

type Store = {
  take(key: string, windowMs: number): number[];
  set(key: string, timestamps: number[]): void;
};

const createMemoryStore = (): Store => {
  const hits = new Map<string, number[]>();
  let lastCleanup = 0;

  return {
    take(key, windowMs) {
      const now = Date.now();
      if (now - lastCleanup > windowMs) {
        for (const [k, timestamps] of hits) {
          if (timestamps.some((t) => now - t < windowMs)) continue;
          hits.delete(k);
        }
        lastCleanup = now;
      }
      return hits.get(key) ?? [];
    },
    set(key, timestamps) {
      hits.set(key, timestamps);
    },
  };
};

let store = createMemoryStore();

// Test hook: drop all recorded attempts and reset the store implementation.
export function resetRateLimitStore() {
  store = createMemoryStore();
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const timestamps = store
    .take(key, windowMs)
    .filter((t) => now - t < windowMs);

  if (timestamps.length >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: Math.max(...timestamps) + windowMs,
    };
  }

  timestamps.push(now);
  store.set(key, timestamps);
  return {
    allowed: true,
    remaining: limit - timestamps.length,
    resetAt: timestamps[0] + windowMs,
  };
}

export const RATE_LIMIT_ERROR = '尝试次数过多，请稍后再试。';
