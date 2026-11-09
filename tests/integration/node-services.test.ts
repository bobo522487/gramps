import { describe, expect, it } from 'vitest';
import { nodes } from '@/lib/db/schema';
import {
  addChildInTransaction,
  addSiblingInTransaction,
  addSpouseInTransaction,
  createRootNodeInTransaction,
  deleteNodeInTransaction,
  moveNodeInTransaction,
  reorderSiblingsInTransaction,
  toNodeDetails,
  updateNodeInTransaction,
} from '@/lib/lineage/node-services';
import { getTestDb } from '../helpers/db';
import {
  createLineage,
  createProject,
  createUser,
  getPersonalOrg,
} from '../helpers/factories';

/**
 * A′ 写入层的目标态契约。这些函数在 S8 重构后没有任何运行时测试，只有
 * 静态门禁读它们的源码；覆盖率一度是 0%。这里逐条走真实数据库，既补覆盖
 * 也钉住「不写坏数据」的契约：配偶 / 整树移动 / 兄弟重排在目标态下显式
 * 失败，而不是写一棵坏的树（docs/data-model.md §8）。
 */
async function setup() {
  const user = await createUser();
  const personal = await getPersonalOrg(user.id);
  if (!personal) {
    throw new Error('signup trigger did not create a personal organization');
  }
  const orgId = personal.organization.id;
  const project = await createProject({ orgId, createdBy: user.id });
  const lineage = await createLineage({
    orgId,
    projectId: project.id,
    createdBy: user.id,
  });
  return { user, orgId, project, lineage };
}

function createParams(
  ctx: Awaited<ReturnType<typeof setup>>,
  overrides: Record<string, unknown> = {}
) {
  return {
    userId: ctx.user.id,
    orgId: ctx.orgId,
    lineageId: ctx.lineage.id,
    name: '实',
    surname: '陈',
    sex: 'male' as const,
    ...overrides,
  };
}

describe('toNodeDetails', () => {
  it('fills neutral values for an absent form payload', () => {
    expect(toNodeDetails(undefined)).toEqual({
      courtesy: null,
      namePrefix: null,
      isAlive: false,
      birthText: null,
      deathText: null,
      birthYear: null,
      deathYear: null,
      burialPlace: null,
      biography: null,
    });
  });

  it('keeps supplied values (the fields are a stable form contract)', () => {
    expect(
      toNodeDetails({
        courtesy: '伯',
        isAlive: true,
        birthYear: 1894,
        biography: '传略',
      })
    ).toMatchObject({
      courtesy: '伯',
      isAlive: true,
      birthYear: 1894,
      biography: '传略',
      deathText: null,
    });
  });
});

describe('node creation paths', () => {
  it('creates a root as person + primary name + sparse path', async () => {
    const ctx = await setup();
    const result = await createRootNodeInTransaction(createParams(ctx));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.node.path).toBe('0010');
    expect(result.node.parentPath).toBeNull();
    expect(result.node.displayName).toBe('陈实');

    const rows = await getTestDb().select().from(nodes);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.personId).toBe(result.node.personId);
  });

  it('refuses a second root', async () => {
    const ctx = await setup();
    expect(await createRootNodeInTransaction(createParams(ctx))).toMatchObject({
      ok: true,
    });
    expect(
      await createRootNodeInTransaction(createParams(ctx, { name: '二' }))
    ).toEqual({ ok: false, reason: 'root_exists' });
  });

  it('allocates the next sparse segment for siblings', async () => {
    const ctx = await setup();
    const root = await createRootNodeInTransaction(createParams(ctx));
    if (!root.ok) throw new Error('root creation failed');

    const child = await addChildInTransaction(
      createParams(ctx, {
        name: '二',
        parentId: root.node.id,
      }) as Parameters<typeof addChildInTransaction>[0]
    );
    expect(child.ok).toBe(true);
    if (!child.ok) return;
    expect(child.node.path).toBe('0010.0010');

    const sibling = await addSiblingInTransaction(
      createParams(ctx, {
        name: '三',
        siblingOfId: child.node.id,
      }) as Parameters<typeof addSiblingInTransaction>[0]
    );
    expect(sibling.ok).toBe(true);
    if (!sibling.ok) return;
    expect(sibling.node.path).toBe('0010.0020');
  });

  it('refuses a child under a missing parent', async () => {
    const ctx = await setup();
    const result = await addChildInTransaction(
      createParams(ctx, {
        parentId: '00000000-0000-0000-0000-000000000000',
      }) as Parameters<typeof addChildInTransaction>[0]
    );
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('refuses a sibling of a root and of a missing node', async () => {
    const ctx = await setup();
    const root = await createRootNodeInTransaction(createParams(ctx));
    if (!root.ok) throw new Error('root creation failed');

    expect(
      await addSiblingInTransaction(
        createParams(ctx, {
          siblingOfId: root.node.id,
        }) as Parameters<typeof addSiblingInTransaction>[0]
      )
    ).toEqual({ ok: false, reason: 'root_sibling' });

    expect(
      await addSiblingInTransaction(
        createParams(ctx, {
          siblingOfId: '00000000-0000-0000-0000-000000000000',
        }) as Parameters<typeof addSiblingInTransaction>[0]
      )
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  it('never writes a fake spouse: the target node has no spouse edge', async () => {
    const ctx = await setup();
    const root = await createRootNodeInTransaction(createParams(ctx));
    if (!root.ok) throw new Error('root creation failed');

    expect(
      await addSpouseInTransaction({
        ...createParams(ctx),
        anchorId: root.node.id,
      })
    ).toEqual({ ok: false, reason: 'invalid_target' });
    expect(
      await addSpouseInTransaction({
        ...createParams(ctx),
        anchorId: '00000000-0000-0000-0000-000000000000',
      })
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(await getTestDb().select().from(nodes)).toHaveLength(1);
  });
});

describe('node mutation paths', () => {
  it('updates sex, primary name and display name', async () => {
    const ctx = await setup();
    const root = await createRootNodeInTransaction(createParams(ctx));
    if (!root.ok) throw new Error('root creation failed');

    const result = await updateNodeInTransaction({
      userId: ctx.user.id,
      orgId: ctx.orgId,
      lineageId: ctx.lineage.id,
      nodeId: root.node.id,
      updates: {
        name: '元英',
        surname: '陈',
        sex: 'female',
        courtesy: '伯',
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.node.displayName).toBe('陈元英');
  });

  it('refuses to update a missing node', async () => {
    const ctx = await setup();
    expect(
      await updateNodeInTransaction({
        userId: ctx.user.id,
        orgId: ctx.orgId,
        lineageId: ctx.lineage.id,
        nodeId: '00000000-0000-0000-0000-000000000000',
        updates: { name: '实', surname: '陈', sex: 'male' },
      })
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  it('deletes a whole subtree and refuses the root / a missing node', async () => {
    const ctx = await setup();
    const root = await createRootNodeInTransaction(createParams(ctx));
    if (!root.ok) throw new Error('root creation failed');
    const child = await addChildInTransaction(
      createParams(ctx, {
        name: '二',
        parentId: root.node.id,
      }) as Parameters<typeof addChildInTransaction>[0]
    );
    if (!child.ok) throw new Error('child creation failed');
    const grandchild = await addChildInTransaction(
      createParams(ctx, {
        name: '三',
        parentId: child.node.id,
      }) as Parameters<typeof addChildInTransaction>[0]
    );
    if (!grandchild.ok) throw new Error('grandchild creation failed');

    expect(
      await deleteNodeInTransaction({
        userId: ctx.user.id,
        orgId: ctx.orgId,
        lineageId: ctx.lineage.id,
        nodeId: root.node.id,
      })
    ).toEqual({ ok: false, reason: 'root_forbidden' });

    expect(
      await deleteNodeInTransaction({
        userId: ctx.user.id,
        orgId: ctx.orgId,
        lineageId: ctx.lineage.id,
        nodeId: '00000000-0000-0000-0000-000000000000',
      })
    ).toEqual({ ok: false, reason: 'not_found' });

    const deleted = await deleteNodeInTransaction({
      userId: ctx.user.id,
      orgId: ctx.orgId,
      lineageId: ctx.lineage.id,
      nodeId: child.node.id,
    });
    expect(deleted).toMatchObject({ ok: true, deletedNodes: 2 });
    expect(await getTestDb().select().from(nodes)).toHaveLength(1);
  });

  it('rejects every subtree move instead of writing a broken tree', async () => {
    const ctx = await setup();
    const root = await createRootNodeInTransaction(createParams(ctx));
    if (!root.ok) throw new Error('root creation failed');
    const child = await addChildInTransaction(
      createParams(ctx, {
        name: '二',
        parentId: root.node.id,
      }) as Parameters<typeof addChildInTransaction>[0]
    );
    if (!child.ok) throw new Error('child creation failed');
    const grandchild = await addChildInTransaction(
      createParams(ctx, {
        name: '三',
        parentId: child.node.id,
      }) as Parameters<typeof addChildInTransaction>[0]
    );
    if (!grandchild.ok) throw new Error('grandchild creation failed');

    const base = {
      userId: ctx.user.id,
      orgId: ctx.orgId,
      lineageId: ctx.lineage.id,
    };
    expect(
      await moveNodeInTransaction({
        ...base,
        nodeId: root.node.id,
        newParentId: child.node.id,
      })
    ).toEqual({ ok: false, reason: 'invalid_target' });
    expect(
      await moveNodeInTransaction({
        ...base,
        nodeId: child.node.id,
        newParentId: child.node.id,
      })
    ).toEqual({ ok: false, reason: 'invalid_parent' });
    expect(
      await moveNodeInTransaction({
        ...base,
        nodeId: child.node.id,
        newParentId: '00000000-0000-0000-0000-000000000000',
      })
    ).toEqual({ ok: false, reason: 'invalid_parent' });
    expect(
      await moveNodeInTransaction({
        ...base,
        nodeId: child.node.id,
        newParentId: grandchild.node.id,
      })
    ).toEqual({ ok: false, reason: 'cycle' });
    expect(
      await moveNodeInTransaction({
        ...base,
        nodeId: child.node.id,
        newParentId: root.node.id,
      })
    ).toEqual({ ok: false, reason: 'invalid_target' });
  });

  it('rejects sibling reordering with explicit reasons', async () => {
    const ctx = await setup();
    const root = await createRootNodeInTransaction(createParams(ctx));
    if (!root.ok) throw new Error('root creation failed');
    const child = await addChildInTransaction(
      createParams(ctx, {
        name: '二',
        parentId: root.node.id,
      }) as Parameters<typeof addChildInTransaction>[0]
    );
    if (!child.ok) throw new Error('child creation failed');

    const base = {
      userId: ctx.user.id,
      orgId: ctx.orgId,
      lineageId: ctx.lineage.id,
      parentId: root.node.id,
    };
    expect(
      await reorderSiblingsInTransaction({
        ...base,
        orderedIds: [],
      })
    ).toEqual({ ok: true });
    expect(
      await reorderSiblingsInTransaction({
        ...base,
        orderedIds: [child.node.id, child.node.id],
      })
    ).toEqual({ ok: false, reason: 'invalid_order' });
    expect(
      await reorderSiblingsInTransaction({
        ...base,
        orderedIds: [child.node.id, '00000000-0000-0000-0000-000000000000'],
      })
    ).toEqual({ ok: false, reason: 'invalid_order' });
    expect(
      await reorderSiblingsInTransaction({
        ...base,
        orderedIds: [child.node.id],
      })
    ).toEqual({ ok: false, reason: 'invalid_order' });
  });
});
