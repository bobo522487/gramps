import { describe, expect, it } from 'vitest';
import { getArticle } from '@/lib/db/queries/articles';
import { getLineageById } from '@/lib/db/queries/lineages';
import { getNodes, toNodeViewRows } from '@/lib/db/queries/nodes';
import { getOrgById } from '@/lib/db/queries/organizations';
import { events } from '@/lib/db/schema';
import { createRootNodeInTransaction } from '@/lib/lineage/node-services';
import { getTestDb } from '../helpers/db';
import {
  createLineage,
  createProject,
  createUser,
  getPersonalOrg,
} from '../helpers/factories';

/**
 * 查询层的兜底分支。S8 重构后这些分支（查不到返回 null、姓名为空的投影、
 * 生卒事实合并）没有对应测试，导致 `lib/db/queries/**` 的 98% 门槛落空。
 * 这里按目标态的真实形状逐条走一遍，不 mock 服务层。
 */
const MISSING = '00000000-0000-0000-0000-000000000000';

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

describe('query fallbacks return null instead of throwing', () => {
  it('getArticle returns null for an unknown id', async () => {
    const ctx = await setup();
    expect(await getArticle(ctx.user.id, ctx.orgId, MISSING)).toBeNull();
  });

  it('getLineageById returns null for an unknown id', async () => {
    const ctx = await setup();
    expect(await getLineageById(ctx.user.id, ctx.orgId, MISSING)).toBeNull();
  });

  it('getOrgById returns null for an unknown organization', async () => {
    const ctx = await setup();
    expect(await getOrgById(ctx.user.id, MISSING)).toBeNull();
  });
});

describe('toNodeViewRows display heuristics', () => {
  const base = {
    id: 'n1',
    path: '0010',
    parentPath: null,
    kind: 'primary',
    displayName: null,
    sex: null,
    primaryName: null,
  };

  it('falls back to empty surname / given name when no name is available', () => {
    const [row] = toNodeViewRows([base]);
    expect(row?.fullName).toBe('');
    expect(row?.surname).toBe('');
    expect(row?.name).toBe('');
    expect(row?.parentId).toBeNull();
    expect(row?.spouseOfId).toBeNull();
    expect(row?.role).toBe('blood');
    expect(row?.generation).toBe(1);
    expect(row?.sex).toBe(0);
    expect(row?.birthText).toBeNull();
    expect(row?.deathText).toBeNull();
  });

  it('uses displayName when primaryName is absent and resolves parentPath', () => {
    const [parent, child] = toNodeViewRows([
      { ...base, id: 'root', path: '0010', displayName: '陈实', sex: 'male' },
      {
        ...base,
        id: 'child',
        path: '0010.0010',
        parentPath: '0010',
        primaryName: '陈二',
        sex: 'female',
        birthText: '光绪二十年',
        deathText: '一九六八年',
      },
      {
        ...base,
        id: 'orphan',
        path: '0020',
        parentPath: '0999',
        primaryName: '陈三',
      },
    ]);
    expect(parent?.surname).toBe('陈');
    expect(parent?.name).toBe('实');
    expect(parent?.sex).toBe(1);
    expect(child?.parentId).toBe('root');
    expect(child?.generation).toBe(2);
    expect(child?.sort).toBe(10);
    expect(child?.sex).toBe(0);
    expect(child?.birthText).toBe('光绪二十年');
    expect(child?.deathText).toBe('一九六八年');
    expect(child?.fullName).toBe('陈二');
    expect(child?.surname).toBe('陈');
    // A parent_path with no matching row must not leak a bogus id.
    expect(parent?.parentId).toBeNull();
    expect(
      toNodeViewRows([{ ...base, id: 'orphan', parentPath: '0999' }])[0]
        ?.parentId
    ).toBeNull();
  });
});

describe('getNodes merges birth / death facts', () => {
  it('writes both date slots for the same person', async () => {
    const ctx = await setup();
    const root = await createRootNodeInTransaction({
      userId: ctx.user.id,
      orgId: ctx.orgId,
      lineageId: ctx.lineage.id,
      name: '实',
      surname: '陈',
      sex: 'male',
    });
    if (!root.ok || !root.node.personId) {
      throw new Error('root creation failed');
    }

    await getTestDb()
      .insert(events)
      .values([
        {
          orgId: ctx.orgId,
          projectId: ctx.project.id,
          kind: 'birth',
          personId: root.node.personId,
          dateText: '光绪二十年',
          dateSort: '1894',
        },
        {
          orgId: ctx.orgId,
          projectId: ctx.project.id,
          kind: 'death',
          personId: root.node.personId,
          dateText: '一九六八年',
          dateSort: '1968',
        },
      ]);

    const rows = await getNodes(ctx.user.id, ctx.orgId, ctx.lineage.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.birthText).toBe('光绪二十年');
    expect(rows[0]?.deathText).toBe('一九六八年');
  });

  it('returns an empty projection for an unknown lineage', async () => {
    const ctx = await setup();
    expect(await getNodes(ctx.user.id, ctx.orgId, MISSING)).toEqual([]);
  });
});
