import { describe, expect, it } from 'vitest';
import type { NodeView } from '@/components/lineage/types';
import {
  buildDeleteConfirmMessage,
  collectSubtreeIds,
} from '@/lib/lineage/subtree';

function node(over: Partial<NodeView>): NodeView {
  return {
    id: 'n',
    parentId: null,
    spouseOfId: null,
    role: 'blood',
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
    ...over,
  };
}

const root = node({ id: 'r' });
const sonA = node({ id: 'a', parentId: 'r', generation: 2 });
const sonB = node({ id: 'b', parentId: 'r', generation: 2 });
const wifeOfA = node({ id: 'wa', role: 'spouse', spouseOfId: 'a' });

describe('collectSubtreeIds', () => {
  it('把血亲子树与其配偶一并计入', () => {
    const ids = collectSubtreeIds(root, [root, sonA, sonB, wifeOfA]);
    expect([...ids].sort()).toEqual(['a', 'b', 'r', 'wa']);
  });

  it('不把旁支算进来', () => {
    const other = node({ id: 'x', parentId: 'other' });
    expect(
      collectSubtreeIds(sonA, [root, sonA, sonB, wifeOfA, other]).has('x')
    ).toBe(false);
  });
});

describe('buildDeleteConfirmMessage', () => {
  it('多人时写明子孙与配偶', () => {
    expect(buildDeleteConfirmMessage(root, 4)).toBe(
      '删除「陈实」及其子孙与配偶？共 4 位人丁会归档。'
    );
  });

  it('单人时不给人数', () => {
    expect(buildDeleteConfirmMessage(root, 1)).toBe(
      '删除「陈实」？该人丁会归档。'
    );
  });
});
