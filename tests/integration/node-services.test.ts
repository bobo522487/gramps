import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getNodes } from '@/lib/db/queries/nodes';
import { events, nodes, personNames, persons } from '@/lib/db/schema';
import { deleteLineageInTransaction } from '@/lib/lineage/services';
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
      isAlive: false,
      birthText: null,
      deathText: null,
      birthYear: null,
      deathYear: null,
      burialPlace: null,
    });
  });

  it('keeps supplied values (the fields are a stable form contract)', () => {
    expect(
      toNodeDetails({
        courtesy: '伯',
        isAlive: true,
        birthYear: 1894,
      })
    ).toMatchObject({
      courtesy: '伯',
      isAlive: true,
      birthYear: 1894,
      deathText: null,
    });
  });
});

describe('node creation paths', () => {
  it('persists the form facts alongside the node', async () => {
    const ctx = await setup();
    const result = await createRootNodeInTransaction(
      createParams(ctx, {
        details: {
          courtesy: '子安',
          isAlive: false,
          birthText: '光绪二十年',
          birthYear: 1894,
          deathText: '一九六八年',
          burialPlace: '村东祖坟',
        },
      })
    );
    if (!result.ok) throw new Error('root creation failed');

    const [view] = await getNodes(ctx.user.id, ctx.orgId, ctx.lineage.id);
    expect(view).toMatchObject({
      courtesy: '子安',
      isAlive: false,
      birthText: '光绪二十年',
      birthYear: 1894,
      deathText: '一九六八年',
      burialPlace: '村东祖坟',
    });
  });

  it('creates a root as person + primary name + sparse path', async () => {
    const ctx = await setup();
    const result = await createRootNodeInTransaction(createParams(ctx));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.node.path).toBe('0010');
    expect(result.node.parentPath).toBeNull();
    expect(result.node.displayName).toBeNull();
    const [person] = await getTestDb().select().from(persons);
    const [given] = await getTestDb()
      .select()
      .from(personNames)
      .where(eq(personNames.isPrimary, true));
    expect(person?.surname).toBe('陈');
    expect(given?.value).toBe('实');

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

  it('reports spouses as unsupported without writing a fake node', async () => {
    const ctx = await setup();
    const root = await createRootNodeInTransaction(createParams(ctx));
    if (!root.ok) throw new Error('root creation failed');

    expect(
      await addSpouseInTransaction({
        ...createParams(ctx),
        anchorId: root.node.id,
      })
    ).toEqual({ ok: false, reason: 'not_supported' });
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
        isAlive: false,
        birthText: '光绪二十年',
        birthYear: 1894,
        deathText: '一九六八年',
        burialPlace: '桐梓凤凰山',
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.node.displayName).toBeNull();
    const [renamed] = await getTestDb()
      .select()
      .from(personNames)
      .where(eq(personNames.isPrimary, true));
    expect(renamed?.value).toBe('元英');

    const [view] = await getNodes(ctx.user.id, ctx.orgId, ctx.lineage.id);
    expect(view).toMatchObject({
      surname: '陈',
      name: '元英',
      fullName: '陈元英',
      courtesy: '伯',
      isAlive: false,
      birthText: '光绪二十年',
      birthYear: 1894,
      deathText: '一九六八年',
      deathYear: null,
      burialPlace: '桐梓凤凰山',
    });
  });

  it('clears the death fact when the person is marked alive again', async () => {
    const ctx = await setup();
    const root = await createRootNodeInTransaction(
      createParams(ctx, {
        details: { isAlive: false, deathText: '一九六八年' },
      })
    );
    if (!root.ok) throw new Error('root creation failed');

    await updateNodeInTransaction({
      userId: ctx.user.id,
      orgId: ctx.orgId,
      lineageId: ctx.lineage.id,
      nodeId: root.node.id,
      updates: { name: '实', surname: '陈', sex: 'male', isAlive: true },
    });

    const [view] = await getNodes(ctx.user.id, ctx.orgId, ctx.lineage.id);
    expect(view?.isAlive).toBe(true);
    expect(view?.deathText).toBeNull();
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

  it('moves a subtree onto a free slot with one path rewrite', async () => {
    const ctx = await setup();
    const root = await createRootNodeInTransaction(createParams(ctx));
    if (!root.ok) throw new Error('root failed');
    const child = await addChildInTransaction({
      ...createParams(ctx, { name: '二' }),
      parentId: root.node.id,
    });
    if (!child.ok) throw new Error('child failed');
    const grandchild = await addChildInTransaction({
      ...createParams(ctx, { name: '三' }),
      parentId: child.node.id,
    });
    if (!grandchild.ok) throw new Error('grandchild failed');
    const uncle = await addChildInTransaction({
      ...createParams(ctx, { name: '叔', surname: '陈' }),
      parentId: root.node.id,
    });
    if (!uncle.ok) throw new Error('uncle failed');

    const moved = await moveNodeInTransaction({
      userId: ctx.user.id,
      orgId: ctx.orgId,
      lineageId: ctx.lineage.id,
      nodeId: child.node.id,
      newParentId: uncle.node.id,
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;

    const rows = await getTestDb().select().from(nodes);
    const byId = new Map(rows.map((row) => [row.id, row.path]));
    expect(byId.get(child.node.id)).toBe(`${uncle.node.path}.0010`);
    expect(byId.get(grandchild.node.id)).toBe(`${uncle.node.path}.0010.0010`);
    expect(byId.get(root.node.id)).toBe(root.node.path);
  });

  it('refuses to move the root', async () => {
    const ctx = await setup();
    const root = await createRootNodeInTransaction(createParams(ctx));
    if (!root.ok) throw new Error('root failed');
    const child = await addChildInTransaction({
      ...createParams(ctx, { name: '二' }),
      parentId: root.node.id,
    });
    if (!child.ok) throw new Error('child failed');
    const moved = await moveNodeInTransaction({
      userId: ctx.user.id,
      orgId: ctx.orgId,
      lineageId: ctx.lineage.id,
      nodeId: root.node.id,
      newParentId: child.node.id,
    });
    expect(moved).toEqual({ ok: false, reason: 'root_forbidden' });
  });

  it('refuses to move a node under its descendant', async () => {
    const ctx = await setup();
    const root = await createRootNodeInTransaction(createParams(ctx));
    if (!root.ok) throw new Error('root failed');
    const child = await addChildInTransaction({
      ...createParams(ctx, { name: '二' }),
      parentId: root.node.id,
    });
    if (!child.ok) throw new Error('child failed');
    const grandchild = await addChildInTransaction({
      ...createParams(ctx, { name: '三' }),
      parentId: child.node.id,
    });
    if (!grandchild.ok) throw new Error('grandchild failed');
    expect(
      await moveNodeInTransaction({
        userId: ctx.user.id,
        orgId: ctx.orgId,
        lineageId: ctx.lineage.id,
        nodeId: child.node.id,
        newParentId: grandchild.node.id,
      })
    ).toEqual({ ok: false, reason: 'cycle' });
  });

  it('reports sibling reordering as unsupported', async () => {
    const ctx = await setup();
    const root = await createRootNodeInTransaction(createParams(ctx));
    if (!root.ok) throw new Error('root creation failed');

    expect(
      await reorderSiblingsInTransaction({
        userId: ctx.user.id,
        orgId: ctx.orgId,
        lineageId: ctx.lineage.id,
        parentId: root.node.id,
        orderedIds: [],
      })
    ).toEqual({ ok: false, reason: 'not_supported' });
  });

  it('stores the surname on person and the given name on person_name', async () => {
    const ctx = await setup();
    const created = await createRootNodeInTransaction(
      createParams(ctx, { surname: '司马', name: '相如' })
    );
    if (!created.ok) throw new Error('create failed');
    const db = getTestDb();
    const [person] = await db.select().from(persons);
    const [given] = await db
      .select()
      .from(personNames)
      .where(eq(personNames.isPrimary, true));
    expect(person?.surname).toBe('司马');
    expect(given?.value).toBe('相如');
    expect(created.node.displayName).toBeNull();

    const views = await getNodes(ctx.user.id, ctx.orgId, ctx.lineage.id);
    expect(views[0]).toMatchObject({
      surname: '司马',
      name: '相如',
      fullName: '司马相如',
    });
  });

  it('removes the person, names, and events when the last node is deleted', async () => {
    const ctx = await setup();
    const root = await createRootNodeInTransaction(createParams(ctx));
    if (!root.ok) throw new Error('root failed');
    const child = await addChildInTransaction({
      ...createParams(ctx, { name: '二', surname: '陈' }),
      parentId: root.node.id,
    });
    if (!child.ok) throw new Error('child failed');

    const deleted = await deleteNodeInTransaction({
      userId: ctx.user.id,
      orgId: ctx.orgId,
      lineageId: ctx.lineage.id,
      nodeId: child.node.id,
    });
    expect(deleted.ok).toBe(true);

    const db = getTestDb();
    const people = await db.select().from(persons);
    const names = await db.select().from(personNames);
    const factEvents = await db.select().from(events);
    expect(people).toHaveLength(1);
    expect(names.every((row) => row.personId === people[0]?.id)).toBe(true);
    expect(factEvents.every((row) => row.personId === people[0]?.id)).toBe(true);
  });

  it('drops every person of a lineage when that lineage is deleted', async () => {
    const ctx = await setup();
    const root = await createRootNodeInTransaction(createParams(ctx));
    if (!root.ok) throw new Error('root failed');
    const result = await deleteLineageInTransaction({
      userId: ctx.user.id,
      orgId: ctx.orgId,
      lineageId: ctx.lineage.id,
    });
    expect(result.ok).toBe(true);
    expect(await getTestDb().select().from(persons)).toEqual([]);
  });
});
