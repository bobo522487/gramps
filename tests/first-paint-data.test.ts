import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dehydrate, hydrate, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { createQueryClient } from '@/components/query-provider';
import { queryKeys } from '@/lib/query-keys';

/**
 * 首屏数据只有一个来源：RSC 的 dehydrate。客户端 hook 若在挂载时重新拉取，
 * 服务端刚算过的同一份数据就被查了两遍（`/api/user`、`/api/orgs` 各自再跑一次
 * lib/db/queries 里的同一个函数）。这里锁住两件事：hydration 之后的数据在自己的
 * staleTime 内确实是新鲜的；以及没有任何 hook 用 refetchOnMount 把这份新鲜作废。
 */

const QUERIED_FILES = [
  'components/console/console-scope.tsx',
  'hooks/use-session-user.ts',
];

describe('首屏数据来源', () => {
  it('RSC dehydrate 送来的数据在客户端 staleTime 内是新鲜的', async () => {
    const server = createQueryClient();
    await server.fetchQuery({ queryKey: queryKeys.orgs, queryFn: () => ['A'] });
    const state = dehydrate(server);

    const client = createQueryClient();
    hydrate(client, state);

    const hash = state.queries[0]?.queryHash;
    const cached = client.getQueryCache().get(hash!);
    const staleTime = client.getDefaultOptions().queries?.staleTime;

    expect(cached).toBeDefined();
    expect(staleTime).toBeTypeOf('number');
    expect(cached!.isStaleByTime(staleTime as number)).toBe(false);
  });

  it('新鲜数据被 observer 挂载时不会重新拉取，除非显式要求 always', async () => {
    const server = createQueryClient();
    await server.fetchQuery({ queryKey: queryKeys.orgs, queryFn: () => ['A'] });
    const state = dehydrate(server);

    for (const [refetchOnMount, expectedCalls] of [
      ['always', 1],
      [undefined, 0],
    ] as const) {
      const client = createQueryClient();
      hydrate(client, state);
      let calls = 0;
      const observer = new QueryObserver(client, {
        queryKey: queryKeys.orgs,
        queryFn: () => {
          calls += 1;
          return ['B'];
        },
        ...(refetchOnMount ? { refetchOnMount } : {}),
      });
      const unsubscribe = observer.subscribe(() => {});
      await new Promise((done) => setTimeout(done, 50));

      expect({ refetchOnMount, calls }).toEqual({
        refetchOnMount,
        calls: expectedCalls,
      });
      if (refetchOnMount === undefined) {
        expect(observer.getCurrentResult().data).toEqual(['A']);
      }
      unsubscribe();
    }
  });

  it('没有任何查询 hook 在挂载时作废 dehydrate 的结果', () => {
    const offenders = QUERIED_FILES.filter((file) =>
      readFileSync(resolve(process.cwd(), file), 'utf8').includes(
        'refetchOnMount'
      )
    );

    expect(offenders).toEqual([]);
  });
});
