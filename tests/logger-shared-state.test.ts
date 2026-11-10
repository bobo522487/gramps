import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLogContextProvider, setLogLevel } from '@/lib/logger';

afterEach(() => {
  setLogLevel('error');
  setLogContextProvider(undefined);
  vi.restoreAllMocks();
});

describe('日志状态跨模块实例共享', () => {
  it('跨 vi.resetModules() 的新模块实例能看到已配置的级别', async () => {
    // Next 会把 lib/logger.ts 打进 RSC 与 client error boundary 两份实例；
    // instrumentation.ts 只在其中一份上调 setLogLevel。状态若挂在模块级变量，
    // 另一份实例永远回退到 'error'，info/warn 静默消失。
    const first = await import('@/lib/logger');
    first.setLogLevel('info');

    vi.resetModules();

    const { logger: fresh } = await import('@/lib/logger');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    fresh.info('shared');
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('跨模块实例共享 contextProvider（addLogContext 落到日志）', async () => {
    const first = await import('@/lib/logger');
    first.setLogLevel('info');
    first.setLogContextProvider(() => ({ tenant: 't-1' }));

    vi.resetModules();

    const { logger: fresh } = await import('@/lib/logger');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    fresh.info('with-context');
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({
      tenant: 't-1',
    });
  });
});
