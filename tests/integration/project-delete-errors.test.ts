import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  sqlStateOf: vi.fn(),
}));

// 只替换 SQLSTATE 判定，默认委托真实实现；仅「不可分类错误」用例 override。
// 所有 FK 违约仍由真实 PG18 产生（RESTRICT），不 mock 驱动。
vi.mock('@/lib/db/errors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/errors')>();
  return {
    ...actual,
    sqlStateOf: (...args: unknown[]) => mocked.sqlStateOf(...args),
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
const CHILD_FK = `${CHILD_TABLE}_scope_fk`;

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

/** 造一张基线清单里没登记的子表，验证 SAVEPOINT 不依赖人工登记。 */
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
  mocked.sqlStateOf.mockReset().mockImplementation(actual.sqlStateOf);
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

  it('returns not_empty when children exist (SAVEPOINT rolls back the failed DELETE)', async () => {
    const ctx = await setup(true);
    // RESTRICT 让 DELETE 以 23001 失败；SAVEPOINT 回滚后事务仍可提交，
    // 服务层据此返回 not_empty，无需预先探查子表，也无需维护约束名清单。
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

  it('未登记的子表约束也照样返回 not_empty，不抛 500', async () => {
    const ctx = await setup();
    await createUnregisteredChild(ctx.orgId, ctx.projectId);

    await expect(deleteProjectInTransaction(ctx)).resolves.toEqual({
      ok: false,
      reason: 'not_empty',
    });
  });

  it('rethrows an unclassifiable error unchanged', async () => {
    const ctx = await setup(true);
    // 让 SQLSTATE 判定一律落空，模拟不可分类的底层故障：SAVEPOINT 已回滚，
    // 错误应原样冒泡，而不是被翻译成 not_empty 或「未登记约束」文案。
    mocked.sqlStateOf.mockReturnValue(false);

    let caught: unknown;
    try {
      await deleteProjectInTransaction(ctx);
    } catch (error) {
      caught = error;
    }

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
    expect(mocked.sqlStateOf).toHaveBeenCalled();
  });
});
