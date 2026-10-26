import { and, count, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ActivityType, activityLogs, lineages, nodes } from '@/lib/db/schema';
import {
  addChildInTransaction,
  addSiblingInTransaction,
  addSpouseInTransaction,
  createRootNodeInTransaction,
  deleteNodeInTransaction,
  moveNodeInTransaction,
  reorderSiblingsInTransaction,
  updateNodeInTransaction,
} from '@/lib/lineage/node-services';
import { createLineageInTransaction } from '@/lib/lineage/services';
import { getTestDb } from '../helpers/db';
import {
  addMember,
  createLineage,
  createOrganization,
  createProject,
  createUser,
  getPersonalOrg,
} from '../helpers/factories';

async function setup() {
  const user = await createUser();
  const personal = await getPersonalOrg(user.id);
  if (!personal) {
    throw new Error('expected signup trigger to create a personal org');
  }
  const project = await createProject({
    orgId: personal.organization.id,
    createdBy: user.id,
  });
  const lineage = await createLineageInTransaction({
    userId: user.id,
    orgId: personal.organization.id,
    projectId: project.id,
    name: '测试谱系',
    region: '中国/福建',
  });
  if (!lineage.ok) {
    throw new Error('failed to create lineage');
  }
  return {
    user,
    organization: personal.organization,
    project,
    lineage: lineage.lineage,
  };
}

async function root(
  userId: string,
  orgId: string,
  lineageId: string,
  name = '始祖'
) {
  const result = await createRootNodeInTransaction({
    userId,
    orgId,
    lineageId,
    name,
    sex: 0,
  });
  if (!result.ok) {
    throw new Error(`failed to create root: ${result.reason}`);
  }
  return result.node;
}

async function child(
  userId: string,
  orgId: string,
  lineageId: string,
  parentId: string,
  name: string
) {
  const result = await addChildInTransaction({
    userId,
    orgId,
    lineageId,
    parentId,
    name,
    sex: 0,
  });
  if (!result.ok) {
    throw new Error(`failed to add child: ${result.reason}`);
  }
  return result.node;
}

async function activeNodeCount(orgId: string, lineageId: string) {
  const [row] = await getTestDb()
    .select({ value: count() })
    .from(nodes)
    .where(
      and(
        eq(nodes.orgId, orgId),
        eq(nodes.lineageId, lineageId),
        isNull(nodes.deletedAt)
      )
    );
  return row?.value ?? 0;
}

describe('node tree semantics', () => {
  it('supports root, child, sibling and spouse with consistent counts', async () => {
    const { user, organization, lineage } = await setup();

    const founder = await root(user.id, organization.id, lineage.id);
    expect(founder.role).toBe('blood');
    expect(founder.generation).toBe(1);
    expect(founder.depth).toBe(0);
    expect(founder.path).toBe(founder.id.replaceAll('-', ''));

    const son = await child(
      user.id,
      organization.id,
      lineage.id,
      founder.id,
      '元英'
    );
    expect(son.generation).toBe(2);
    expect(son.depth).toBe(1);
    expect(son.parentId).toBe(founder.id);
    expect(son.path?.startsWith(`${founder.path}.`)).toBe(true);

    const sibling = await addSiblingInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: lineage.id,
      siblingOfId: son.id,
      name: '元华',
      surname: '陈',
      sex: 1,
    });
    expect(sibling.ok).toBe(true);
    if (!sibling.ok) return;
    expect(sibling.node.generation).toBe(2);
    expect(sibling.node.parentId).toBe(founder.id);
    expect(sibling.node.sort).toBeGreaterThan(son.sort);

    const spouse = await addSpouseInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: lineage.id,
      spouseOfId: son.id,
      name: '林氏',
      surname: '林',
      sex: 1,
    });
    expect(spouse.ok).toBe(true);
    if (!spouse.ok) return;
    expect(spouse.node.role).toBe('spouse');
    expect(spouse.node.path).toBeNull();
    expect(spouse.node.spouseOfId).toBe(son.id);
    expect(spouse.node.generation).toBe(2);

    const [stored] = await getTestDb()
      .select({ nodeCount: lineages.nodeCount })
      .from(lineages)
      .where(eq(lineages.id, lineage.id));
    expect(stored?.nodeCount).toBe(4);
    expect(await activeNodeCount(organization.id, lineage.id)).toBe(4);
  });

  it('records creation details and a co-recorded spouse in one transaction', async () => {
    const { user, organization, lineage } = await setup();
    const founder = await root(user.id, organization.id, lineage.id);

    const result = await addChildInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: lineage.id,
      parentId: founder.id,
      name: '元英',
      surname: '陈',
      sex: 0,
      details: {
        courtesy: '子安',
        namePrefix: '公',
        isAlive: true,
        birthText: '光绪二十年',
        deathText: '一九六八年',
        birthYear: 1894,
        deathYear: 1968,
        burialPlace: '村东祖坟',
        biography: '勤俭持家，耕读传家。',
      },
      spouse: { name: '氏', surname: '王' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.node).toMatchObject({
      role: 'blood',
      generation: 2,
      parentId: founder.id,
      courtesy: '子安',
      namePrefix: '公',
      isAlive: true,
      birthText: '光绪二十年',
      deathText: '一九六八年',
      birthYear: 1894,
      deathYear: 1968,
      burialPlace: '村东祖坟',
      biography: '勤俭持家，耕读传家。',
    });
    expect(result.spouse).toMatchObject({
      role: 'spouse',
      spouseOfId: result.node.id,
      parentId: null,
      path: null,
      generation: 2,
      depth: 1,
      sort: 0,
      surname: '王',
      name: '氏',
      fullName: '王氏',
      sex: 1,
      isAlive: true,
    });

    const [stored] = await getTestDb()
      .select({ nodeCount: lineages.nodeCount })
      .from(lineages)
      .where(eq(lineages.id, lineage.id));
    expect(stored?.nodeCount).toBe(3);
    expect(await activeNodeCount(organization.id, lineage.id)).toBe(3);

    const [logCount] = await getTestDb()
      .select({ value: count() })
      .from(activityLogs)
      .where(
        and(
          eq(activityLogs.orgId, organization.id),
          eq(activityLogs.action, ActivityType.CREATE_NODE)
        )
      );
    expect(logCount?.value).toBe(2);
  });

  it('creates a founder with details and a co-recorded spouse', async () => {
    const { user, organization, lineage } = await setup();

    const result = await createRootNodeInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: lineage.id,
      name: '始迁祖',
      surname: '陈',
      sex: 0,
      details: {
        isAlive: false,
        birthYear: 1860,
        burialPlace: '村东祖坟',
        biography: '始迁于此。',
      },
      spouse: { name: '氏', surname: '林' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.node).toMatchObject({
      generation: 1,
      depth: 0,
      birthYear: 1860,
      burialPlace: '村东祖坟',
      biography: '始迁于此。',
    });
    expect(result.spouse).toMatchObject({
      role: 'spouse',
      spouseOfId: result.node.id,
      path: null,
      generation: 1,
      depth: 0,
      surname: '林',
      fullName: '林氏',
      sex: 1,
      isAlive: false,
    });

    const [stored] = await getTestDb()
      .select({ nodeCount: lineages.nodeCount })
      .from(lineages)
      .where(eq(lineages.id, lineage.id));
    expect(stored?.nodeCount).toBe(2);
    expect(await activeNodeCount(organization.id, lineage.id)).toBe(2);
  });

  it('refuses to delete the root and leaves nodes and counts untouched', async () => {
    const { user, organization, lineage } = await setup();
    const founder = await root(user.id, organization.id, lineage.id);
    const son = await child(
      user.id,
      organization.id,
      lineage.id,
      founder.id,
      '元英'
    );
    const spouse = await addSpouseInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: lineage.id,
      spouseOfId: son.id,
      name: '王氏',
      sex: 1,
    });
    if (!spouse.ok) {
      throw new Error('failed to add spouse');
    }

    const result = await deleteNodeInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: lineage.id,
      nodeId: founder.id,
    });
    expect(result).toEqual({ ok: false, reason: 'root_forbidden' });
    expect(await activeNodeCount(organization.id, lineage.id)).toBe(3);

    const [stored] = await getTestDb()
      .select({ nodeCount: lineages.nodeCount })
      .from(lineages)
      .where(eq(lineages.id, lineage.id));
    expect(stored?.nodeCount).toBe(3);
  });

  it('rejects a second root and a sibling of the root', async () => {
    const { user, organization, lineage } = await setup();
    const founder = await root(user.id, organization.id, lineage.id);

    const secondRoot = await createRootNodeInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: lineage.id,
      name: '另一位始祖',
      sex: 0,
    });
    expect(secondRoot).toEqual({ ok: false, reason: 'root_exists' });

    const sibling = await addSiblingInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: lineage.id,
      siblingOfId: founder.id,
      name: '始祖兄弟',
      sex: 0,
    });
    expect(sibling).toEqual({ ok: false, reason: 'root_sibling' });
  });

  it('does not allow a spouse to be a parent', async () => {
    const { user, organization, lineage } = await setup();
    const founder = await root(user.id, organization.id, lineage.id);
    const spouse = await addSpouseInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: lineage.id,
      spouseOfId: founder.id,
      name: '林氏',
      sex: 1,
    });
    if (!spouse.ok) {
      throw new Error('failed to add spouse');
    }

    const result = await addChildInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: lineage.id,
      parentId: spouse.node.id,
      name: '错误子女',
      sex: 0,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_parent' });
  });

  it('soft-deletes descendants and their spouses, then reconciles node_count', async () => {
    const { user, organization, lineage } = await setup();
    const founder = await root(user.id, organization.id, lineage.id);
    const branchA = await child(
      user.id,
      organization.id,
      lineage.id,
      founder.id,
      '长房'
    );
    const branchB = await child(
      user.id,
      organization.id,
      lineage.id,
      founder.id,
      '次房'
    );
    const grandchild = await child(
      user.id,
      organization.id,
      lineage.id,
      branchA.id,
      '长孙'
    );
    for (const [targetId, name] of [
      [branchA.id, '长房配偶'],
      [grandchild.id, '长孙配偶'],
    ] as const) {
      const spouse = await addSpouseInTransaction({
        userId: user.id,
        orgId: organization.id,
        lineageId: lineage.id,
        spouseOfId: targetId,
        name,
        sex: 1,
      });
      if (!spouse.ok) {
        throw new Error('failed to add spouse');
      }
    }

    const result = await deleteNodeInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: lineage.id,
      nodeId: branchA.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deletedNodes).toBe(4);

    const remaining = await getTestDb()
      .select({ id: nodes.id })
      .from(nodes)
      .where(and(eq(nodes.lineageId, lineage.id), isNull(nodes.deletedAt)));
    expect(remaining.map((node) => node.id).sort()).toEqual(
      [founder.id, branchB.id].sort()
    );

    const [stored] = await getTestDb()
      .select({ nodeCount: lineages.nodeCount })
      .from(lineages)
      .where(eq(lineages.id, lineage.id));
    expect(stored?.nodeCount).toBe(2);
    expect(await activeNodeCount(organization.id, lineage.id)).toBe(2);
  });

  it('moves a subtree and recomputes path, depth and generation', async () => {
    const { user, organization, lineage } = await setup();
    const founder = await root(user.id, organization.id, lineage.id);
    const branchA = await child(
      user.id,
      organization.id,
      lineage.id,
      founder.id,
      '长房'
    );
    const branchB = await child(
      user.id,
      organization.id,
      lineage.id,
      founder.id,
      '次房'
    );
    const grandchild = await child(
      user.id,
      organization.id,
      lineage.id,
      branchA.id,
      '长孙'
    );
    const branchSpouse = await addSpouseInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: lineage.id,
      spouseOfId: branchA.id,
      name: '长房妻',
      sex: 1,
    });
    if (!branchSpouse.ok) {
      throw new Error('failed to add spouse');
    }

    const moved = await moveNodeInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: lineage.id,
      nodeId: branchA.id,
      newParentId: branchB.id,
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.node.parentId).toBe(branchB.id);
    expect(moved.node.generation).toBe(3);
    expect(moved.node.depth).toBe(2);

    const [movedGrandchild] = await getTestDb()
      .select()
      .from(nodes)
      .where(eq(nodes.id, grandchild.id));
    expect(movedGrandchild?.generation).toBe(4);
    expect(movedGrandchild?.depth).toBe(3);
    expect(movedGrandchild?.path?.startsWith(`${branchB.path}.`)).toBe(true);

    const [movedSpouse] = await getTestDb()
      .select()
      .from(nodes)
      .where(eq(nodes.id, branchSpouse.node.id));
    expect(movedSpouse?.generation).toBe(3);
    expect(movedSpouse?.depth).toBe(2);
    expect(movedSpouse?.path).toBeNull();

    const cycle = await moveNodeInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: lineage.id,
      nodeId: branchB.id,
      newParentId: grandchild.id,
    });
    expect(cycle).toEqual({ ok: false, reason: 'cycle' });

    const rootMove = await moveNodeInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: lineage.id,
      nodeId: founder.id,
      newParentId: branchB.id,
    });
    expect(rootMove).toEqual({ ok: false, reason: 'invalid_target' });

    const [stored] = await getTestDb()
      .select({ nodeCount: lineages.nodeCount })
      .from(lineages)
      .where(eq(lineages.id, lineage.id));
    expect(stored?.nodeCount).toBe(5);
    expect(await activeNodeCount(organization.id, lineage.id)).toBe(5);
  });

  it('reorders siblings and rejects mixed parents', async () => {
    const { user, organization, lineage } = await setup();
    const founder = await root(user.id, organization.id, lineage.id);
    const first = await child(
      user.id,
      organization.id,
      lineage.id,
      founder.id,
      '长子'
    );
    const second = await child(
      user.id,
      organization.id,
      lineage.id,
      founder.id,
      '次子'
    );

    const reordered = await reorderSiblingsInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: lineage.id,
      parentId: founder.id,
      orderedIds: [second.id, first.id],
    });
    expect(reordered).toEqual({ ok: true });

    const rows = await getTestDb()
      .select({ id: nodes.id, sort: nodes.sort })
      .from(nodes)
      .where(eq(nodes.lineageId, lineage.id));
    const byId = new Map(rows.map((row) => [row.id, row.sort]));
    expect(byId.get(second.id)).toBe(0);
    expect(byId.get(first.id)).toBe(1);

    const invalid = await reorderSiblingsInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: lineage.id,
      parentId: founder.id,
      orderedIds: [first.id, founder.id],
    });
    expect(invalid).toEqual({ ok: false, reason: 'invalid_order' });
  });

  it('rejects node writes from viewers and from other orgs', async () => {
    const { user, organization, project, lineage } = await setup();
    const viewer = await createUser();
    await addMember({
      userId: viewer.id,
      organizationId: organization.id,
      role: 'viewer',
    });
    const denied = await createRootNodeInTransaction({
      userId: viewer.id,
      orgId: organization.id,
      lineageId: lineage.id,
      name: '越权始祖',
      sex: 0,
    });
    expect(denied).toEqual({ ok: false, reason: 'forbidden' });

    const otherOrg = await createOrganization({ name: '另一个组织' });
    const otherProject = await createProject({
      orgId: otherOrg.id,
      createdBy: user.id,
    });
    const foreignLineage = await createLineage({
      orgId: otherOrg.id,
      projectId: otherProject.id,
      createdBy: user.id,
    });
    const foreign = await createRootNodeInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: foreignLineage.id,
      name: '跨组织始祖',
      sex: 0,
    });
    expect(foreign).toEqual({ ok: false, reason: 'not_found' });
    expect(project.id).toBeTruthy();
  });

  // Every write entry point funnels through withOrgWrite; this pins each one so
  // a future rewrite cannot keep the guard on seven and drop it on the eighth.
  it('refuses every node write entry point for a viewer', async () => {
    const { user, organization, lineage } = await setup();
    const founder = await root(user.id, organization.id, lineage.id);
    const childNode = await child(
      user.id,
      organization.id,
      lineage.id,
      founder.id,
      '元英'
    );

    const viewer = await createUser();
    await addMember({
      userId: viewer.id,
      organizationId: organization.id,
      role: 'viewer',
    });

    const attempts = await Promise.all([
      createRootNodeInTransaction({
        userId: viewer.id,
        orgId: organization.id,
        lineageId: lineage.id,
        name: '越权始祖',
        sex: 0,
      }),
      addChildInTransaction({
        userId: viewer.id,
        orgId: organization.id,
        lineageId: lineage.id,
        parentId: founder.id,
        name: '越权子女',
        surname: '陈',
        sex: 0,
      }),
      addSiblingInTransaction({
        userId: viewer.id,
        orgId: organization.id,
        lineageId: lineage.id,
        siblingOfId: childNode.id,
        name: '越权兄弟',
        surname: '陈',
        sex: 0,
      }),
      addSpouseInTransaction({
        userId: viewer.id,
        orgId: organization.id,
        lineageId: lineage.id,
        spouseOfId: founder.id,
        name: '越权配偶',
        surname: '陈',
        sex: 1,
      }),
      updateNodeInTransaction({
        userId: viewer.id,
        orgId: organization.id,
        lineageId: lineage.id,
        nodeId: founder.id,
        updates: { name: '越权改名', surname: '陈', sex: 0 },
      }),
      deleteNodeInTransaction({
        userId: viewer.id,
        orgId: organization.id,
        lineageId: lineage.id,
        nodeId: childNode.id,
      }),
      moveNodeInTransaction({
        userId: viewer.id,
        orgId: organization.id,
        lineageId: lineage.id,
        nodeId: childNode.id,
        newParentId: founder.id,
      }),
      reorderSiblingsInTransaction({
        userId: viewer.id,
        orgId: organization.id,
        lineageId: lineage.id,
        parentId: founder.id,
        orderedIds: [childNode.id],
      }),
    ]);

    for (const result of attempts) {
      expect(result).toEqual({ ok: false, reason: 'forbidden' });
    }
  });
});
