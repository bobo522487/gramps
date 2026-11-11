import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  isFk: vi.fn(),
  constraint: vi.fn(),
}));

// 只替换两个分类 helper，默认委托真实实现；仅「非 FK 错误」用例 override。
// 所有 FK 违约仍由真实 PG18 产生（RESTRICT），不 mock 驱动。
vi.mock('@/lib/db/errors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/errors')>();
  return {
    ...actual,
    isForeignKeyViolationOf: (...args: unknown[]) => mocked.isFk(...args),
    foreignKeyConstraintOf: (...args: unknown[]) => mocked.constraint(...args),
  };
});

import { deleteProjectInTransaction } from '@/lib/project/services';
import { getTestSql } from '../helpers/db';
import {
  createLineage,
  createProject,
  createUser,
  getPersonalOrg,
} from '../helpers/factories';

const MISSING = '00000000-0000-0000-0000-000000000000';
const CHILD_TABLE = 's8_unregistered_child';
const CHILD_FK = 's8_unregistered_child_scope_fk';

async function setup(withChild = false) {
  const user = await createUser();
  const personal = await getPersonalOrg(user.id);
  if (!personal) {
    throw new Error('signup trigger did not create a personal organization');
  }
  const orgId = personal.organization.id;
  const project = await createProject({ orgId, createdBy: user.id });
  if (withChild) {
    await createLineage({
      orgId,
      projectId: project.id,
      createdBy: user.id,
    });
  }
  return { userId: user.id, orgId, projectId: project.id };
}

/** 造一张没登记进 PROJECT_CHILD_CONSTRAINTS 的子表，模拟「新增引用 project 的表忘登记」。 */
async function createUnregisteredChild(orgId: string, projectId: string) {
  const sql = getTestSql();
  await sql`
    create table public.${sql(CHILD_TABLE)} (
      organization_id uuid not null,
      project_id uuid not null,
      constraint ${sql(CHILD_FK)}
        foreign key (organization_id, project_id)
        references public.project (organization_id, id)
        on delete restrict
    )
  `;
  await sql`
    insert into public.${sql(CHILD_TABLE)} (organization_id, project_id)
    values (${orgId}, ${projectId})
  `;
}

async function dropUnregisteredChild() {
  const sql = getTestSql();
  await sql`drop table if exists public.${sql(CHILD_TABLE)}`;
}

beforeEach(async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/db/errors')>('@/lib/db/errors');
  mocked.isFk.mockReset().mockImplementation(actual.isForeignKeyViolationOf);
  mocked.constraint
    .mockReset()
    .mockImplementation(actual.foreignKeyConstraintOf);
  await dropUnregisteredChild();
});

afterAll(async () => {
  await dropUnregisteredChild();
});

describe('deleteProjectInTransaction', () => {
  it('returns not_found when the project does not exist', async () => {
    const ctx = await setup();
    expect(
      await deleteProjectInTransaction({ ...ctx, projectId: MISSING })
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns not_empty without issuing a failing DELETE when children exist', async () => {
    const ctx = await setup(true);
    // 回归：事务里第一条失败语句会让整个事务进入 aborted 状态，
    // 所以这里必须靠子表探查提前返回，不能让 DELETE 触发 RESTRICT。
    expect(await deleteProjectInTransaction(ctx)).toEqual({
      ok: false,
      reason: 'not_empty',
    });
  });

  it('deletes an empty project', async () => {
    const ctx = await setup();
    expect(await deleteProjectInTransaction(ctx)).toEqual({ ok: true });

    const [row] = await getTestSql()`
      select id from project
      where organization_id = ${ctx.orgId} and id = ${ctx.projectId}
    `;
    expect(row).toBeUndefined();
  });

  it('throws on an unregistered FK constraint instead of guessing', async () => {
    const ctx = await setup();
    await createUnregisteredChild(ctx.orgId, ctx.projectId);

    await expect(deleteProjectInTransaction(ctx)).rejects.toThrow(
      new RegExp(`未登记的 project 子表约束 ${CHILD_FK}`)
    );
  });

  it('rethrows an unclassifiable error unchanged', async () => {
    const ctx = await setup();
    await createUnregisteredChild(ctx.orgId, ctx.projectId);
    mocked.isFk.mockReturnValue(false);
    mocked.constraint.mockReturnValue(null);

    let caught: unknown;
    try {
      await deleteProjectInTransaction(ctx);
    } catch (error) {
      caught = error;
    }

    // Drizzle 包了一层「Failed query」，SQLSTATE 只在 cause 链上。确认这里
    // 既没被翻译成 not_empty、也没被换成「未登记约束」文案，而是原样冒泡
    // 到底层 23001。
    const codes: string[] = [];
    let current = caught;
    for (
      let depth = 0;
      depth < 8 && current && typeof current === 'object';
      depth += 1
    ) {
      const node = current as { code?: string; cause?: unknown };
      if (node.code) {
        codes.push(node.code);
      }
      current = node.cause;
    }
    expect(codes).toContain('23001');
    expect(mocked.isFk).toHaveBeenCalled();
    expect(mocked.constraint).toHaveBeenCalled();
  });
});
