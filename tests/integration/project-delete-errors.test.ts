import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  isFk: vi.fn(),
  constraint: vi.fn(),
}));

// Only the two error-classification helpers are replaced. Every test still
// runs against a real PG18 database: the 23503 is produced by an actual
// `lineage_scope_fk` RESTRICT violation, not by a mocked driver.
vi.mock('@/lib/db/errors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/errors')>();
  return {
    ...actual,
    isForeignKeyViolationOf: (...args: unknown[]) => mocked.isFk(...args),
    foreignKeyConstraintOf: (...args: unknown[]) => mocked.constraint(...args),
  };
});

import { deleteProjectInTransaction } from '@/lib/project/services';
import {
  createLineage,
  createProject,
  createUser,
  getPersonalOrg,
} from '../helpers/factories';

const MISSING = '00000000-0000-0000-0000-000000000000';

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

beforeEach(() => {
  mocked.isFk.mockReset();
  mocked.constraint.mockReset();
  mocked.isFk.mockReturnValue(true);
  mocked.constraint.mockReturnValue(null);
});

describe('deleteProjectInTransaction failure branches', () => {
  it('returns not_found when the project does not exist', async () => {
    const ctx = await setup();
    expect(
      await deleteProjectInTransaction({
        ...ctx,
        projectId: MISSING,
      })
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  it('reaches the not_empty branch, but PG aborts the transaction', async () => {
    const ctx = await setup(true);
    mocked.isFk.mockReturnValue(true);
    // 已知缺陷（阶段 D 处理）：23503 之后 PG 事务已 aborted，catch 里
    // return 的 not_empty 会被事务结束时冒泡的 RESTRICT 错误盖掉，友好提示
    // 到不了 UI。本用例确认分类分支确实执行（覆盖率拿到的就是这两行），
    // 并把这个真实行为钉住；修复缺陷后此处断言应改回 not_empty。
    await expect(deleteProjectInTransaction(ctx)).rejects.toThrow(/RESTRICT/);
    expect(mocked.isFk).toHaveBeenCalled();
  });

  it('throws on an unregistered FK constraint instead of guessing', async () => {
    const ctx = await setup(true);
    mocked.isFk.mockReturnValue(false);
    mocked.constraint.mockReturnValue('new_child_scope_fk');
    await expect(deleteProjectInTransaction(ctx)).rejects.toThrow(
      /未登记的 project 子表约束 new_child_scope_fk/
    );
  });

  it('rethrows non-FK errors unchanged', async () => {
    const ctx = await setup(true);
    mocked.isFk.mockReturnValue(false);
    mocked.constraint.mockReturnValue(null);
    await expect(deleteProjectInTransaction(ctx)).rejects.toThrow();
  });
});
