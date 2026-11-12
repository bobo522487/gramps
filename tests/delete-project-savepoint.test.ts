import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = 'user-1';
const PARAMS = { userId: USER_ID, orgId: ORG_ID, projectId: PROJECT_ID };

/**
 * 同一个 fakeTx 同时兼容改造前的 `tx.delete(...).where(...).returning(...)`
 * 与改造后的 `tx.execute(sql`savepoint/delete/release/rollback`)`，这样 RED
 * 落在「未登记约束抛 500 / 没有 rollback」上，而不是 TypeError。
 */
const fake = vi.hoisted(() => {
  const projectId = '11111111-1111-4111-8111-111111111111';
  const sqls: string[] = [];
  let deleteError: unknown = null;

  const textOf = (query: unknown): string => {
    const q = query as { toQuery: (config: unknown) => { sql: string } };
    return q.toQuery({
      escapeName: (name: string) => name,
      escapeParam: () => '?',
      escapeString: (value: string) => value,
    }).sql;
  };

  const execute = vi.fn(async (query: unknown) => {
    const text = textOf(query);
    sqls.push(text);
    if (/delete from project/i.test(text)) {
      if (deleteError) {
        throw deleteError;
      }
      return { rows: [{ id: projectId }] };
    }
    // 探查（改造前）与 savepoint/release/rollback 都不需要业务行。
    return { rows: [] };
  });

  const tx = {
    execute,
    delete: () => ({
      where: () => ({
        returning: async () => {
          if (deleteError) {
            throw deleteError;
          }
          return [{ id: projectId }];
        },
      }),
    }),
  };

  return {
    tx,
    execute,
    sqls,
    setDeleteError(error: unknown) {
      deleteError = error;
    },
    reset() {
      sqls.length = 0;
      deleteError = null;
      execute.mockClear();
    },
  };
});

vi.mock('@/lib/db/write', () => ({
  withOrgWrite: vi.fn(
    async (
      _userId: string,
      _orgId: string,
      _permission: string,
      fn: (tx: typeof fake.tx) => Promise<unknown>
    ) => fn(fake.tx)
  ),
}));

import { deleteProjectInTransaction } from '@/lib/project/services';

const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, path), 'utf8');

/** node-postgres：ON DELETE RESTRICT 命中时 SQLSTATE 是 23001，约束名在 constraint。 */
function restrictError(constraint: string) {
  return Object.assign(
    new Error('update or delete on table "project" violates RESTRICT setting'),
    { code: '23001', constraint }
  );
}

beforeEach(() => {
  fake.reset();
});

describe('deleteProjectInTransaction 用 SAVEPOINT 承接 RESTRICT', () => {
  it('23001 时先 rollback to savepoint delete_project 再返回 not_empty', async () => {
    fake.setDeleteError(restrictError('future_table_scope_fk'));

    await expect(deleteProjectInTransaction(PARAMS)).resolves.toEqual({
      ok: false,
      reason: 'not_empty',
    });
    expect(
      fake.sqls.some((text) =>
        /rollback to savepoint delete_project/i.test(text)
      )
    ).toBe(true);
  });

  it('未登记的约束名不再抛 500', async () => {
    fake.setDeleteError(restrictError('future_table_scope_fk'));

    await expect(deleteProjectInTransaction(PARAMS)).resolves.toEqual({
      ok: false,
      reason: 'not_empty',
    });
  });

  it('空项目删除成功，且不再发 13 张子表的 exists 探查', async () => {
    await expect(deleteProjectInTransaction(PARAMS)).resolves.toEqual({
      ok: true,
    });
    expect(fake.sqls.some((text) => /exists \(select 1/i.test(text))).toBe(
      false
    );
  });

  it('服务层不再维护手工约束清单', () => {
    const services = read('../lib/project/services.ts');
    expect(services).not.toContain('PROJECT_CHILD_CONSTRAINTS');
    expect(services).not.toContain('命中未登记的');
    expect(read('../lib/db/errors.ts')).not.toContain(
      'isForeignKeyViolationOf'
    );
  });
});
