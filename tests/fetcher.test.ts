import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetcher } from '@/lib/fetcher';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetcher', () => {
  it('returns parsed JSON for a successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
      )
    );

    await expect(fetcher<{ ok: boolean }>('/api/user')).resolves.toEqual({
      ok: true,
    });
  });

  it('throws with the status for a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          })
      )
    );

    await expect(fetcher('/api/user')).rejects.toMatchObject({
      message: 'Request failed with status 401',
      status: 401,
    });
  });
});
