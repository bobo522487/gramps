import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  it('reports the database as reachable', async () => {
    const response = await GET(new Request('http://localhost/api/health'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', database: 'up' });
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });

  it('preserves an upstream request id', async () => {
    const response = await GET(
      new Request('http://localhost/api/health', {
        headers: { 'x-request-id': 'upstream-id' },
      })
    );

    expect(response.headers.get('x-request-id')).toBe('upstream-id');
  });
});
