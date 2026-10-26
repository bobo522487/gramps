import { describe, expect, it } from 'vitest';
import {
  toFolderOption,
  toLineageListItem,
  toNodeView,
  toNodeViews,
} from '@/components/lineage/types';
import type { Node } from '@/lib/db/schema';

// A server row: it must carry columns NodeView does not expose, otherwise this
// test cannot prove the mapping actually narrows the payload.
const nodeFixture = {
  id: 'n1',
  orgId: 'o1',
  lineageId: 'l1',
  parentId: null,
  spouseOfId: null,
  role: 'blood',
  path: 'aaaa',
  depth: 0,
  generation: 1,
  sort: 0,
  name: '实',
  surname: '陈',
  fullName: '陈实',
  sex: 0,
  courtesy: null,
  namePrefix: null,
  isAlive: true,
  birthText: null,
  deathText: null,
  birthYear: null,
  deathYear: null,
  burialPlace: null,
  biography: null,
  createdAt: new Date(),
  createdBy: 'u1',
  updatedAt: null,
  deletedAt: null,
} as unknown as Node;

describe('lineage view mapping', () => {
  it('maps every NodeView field explicitly and drops server-only columns', () => {
    const view = toNodeView(nodeFixture);
    expect(Object.keys(view).sort()).toEqual([
      'biography',
      'birthText',
      'birthYear',
      'burialPlace',
      'courtesy',
      'deathText',
      'deathYear',
      'depth',
      'fullName',
      'generation',
      'id',
      'isAlive',
      'name',
      'namePrefix',
      'parentId',
      'role',
      'sex',
      'sort',
      'spouseOfId',
      'surname',
    ]);
    expect(view).not.toHaveProperty('orgId');
    expect(view).not.toHaveProperty('path');
    expect(view).not.toHaveProperty('createdBy');
  });

  it('maps a list of nodes without losing order', () => {
    const views = toNodeViews([
      nodeFixture,
      { ...nodeFixture, id: 'n2' } as Node,
    ]);
    expect(views.map((view) => view.id)).toEqual(['n1', 'n2']);
  });

  it('keeps a null folder parent for a folder without one', () => {
    expect(
      toFolderOption({ id: 'f1', name: '甲', parentId: null } as never)
    ).toEqual({ id: 'f1', name: '甲', parentId: null });
  });

  it('keeps a null folder id for a lineage outside every folder', () => {
    const item = toLineageListItem({
      id: 'l1',
      name: '颍川陈氏',
      surname: '陈',
      hallCode: null,
      region: null,
      nodeCount: 0,
      folderId: null,
      orgId: 'o1',
      projectId: 'p1',
    } as never);
    expect(item.folderId).toBeNull();
    expect(item).not.toHaveProperty('orgId');
    expect(item).not.toHaveProperty('projectId');
  });
});
