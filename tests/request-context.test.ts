import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import {
  addLogContext,
  getRequestContext,
  runWithRequestContext,
} from '@/lib/server/request-context';

afterEach(() => {
  process.env.LOG_LEVEL = 'error';
  vi.restoreAllMocks();
});

describe('request log context', () => {
  it('scopes context to the wrapped async call', async () => {
    expect(getRequestContext()).toBeUndefined();

    await runWithRequestContext({ request_id: 'req-1' }, async () => {
      expect(getRequestContext()?.request_id).toBe('req-1');

      addLogContext({ user_id: 7, org_id: 3 });
      expect(getRequestContext()).toMatchObject({
        request_id: 'req-1',
        user_id: 7,
        org_id: 3,
      });
    });

    expect(getRequestContext()).toBeUndefined();
  });

  it('attaches the active context to log lines', async () => {
    process.env.LOG_LEVEL = 'info';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runWithRequestContext({ request_id: 'req-2' }, async () => {
      addLogContext({ user_id: 9 });
      logger.info('hello');
    });

    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({
      message: 'hello',
      request_id: 'req-2',
      user_id: 9,
    });
  });

  it('does not leak context between concurrent requests', async () => {
    await Promise.all([
      runWithRequestContext({ request_id: 'a' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(getRequestContext()?.request_id).toBe('a');
      }),
      runWithRequestContext({ request_id: 'b' }, async () => {
        expect(getRequestContext()?.request_id).toBe('b');
      }),
    ]);
  });
});
