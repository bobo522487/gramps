import { describe, expect, it, vi } from 'vitest';
import { GET as getOrgsRoute } from '@/app/api/orgs/route';
import { GET as getUserRoute } from '@/app/api/user/route';

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => undefined,
  }),
}));

describe('read-only API authentication', () => {
  it('returns 401 from /api/user without a session', async () => {
    const response = await getUserRoute(
      new Request('http://localhost/api/user')
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 from /api/orgs without a session', async () => {
    const response = await getOrgsRoute(
      new Request('http://localhost/api/orgs')
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });
});
