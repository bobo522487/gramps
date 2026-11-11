import { describe, expect, it } from 'vitest';
import {
  enabledCommands,
  NODE_COMMANDS,
} from '@/components/lineage/node-commands';
import type { NodeView } from '@/components/lineage/types';

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
    sex: 'male',
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
const son = node({ id: 'a', parentId: 'r', generation: 2 });
const wife = node({ id: 'w', role: 'spouse', spouseOfId: 'r' });

const ids = (n: NodeView, canWrite = true) =>
  enabledCommands(n, canWrite).map((command) => command.id);

describe('NODE_COMMANDS', () => {
  it('按固定顺序给出五条命令', () => {
    expect(NODE_COMMANDS.map((command) => command.id)).toEqual([
      'add-child',
      'add-sibling',
      'add-spouse',
      'move',
      'delete',
    ]);
  });

  it('不含「查看档案」，因为选中即打开抽屉', () => {
    expect(
      NODE_COMMANDS.some((command) => command.id === ('view' as never))
    ).toBe(false);
  });
});

describe('enabledCommands', () => {
  it('始祖只能加子女与配偶', () => {
    expect(ids(root)).toEqual(['add-child', 'add-spouse']);
  });

  it('非始祖血亲可用全部五条', () => {
    expect(ids(son)).toEqual([
      'add-child',
      'add-sibling',
      'add-spouse',
      'move',
      'delete',
    ]);
  });

  it('配偶节点只能删除（服务端对配偶父级返回 invalid_parent）', () => {
    expect(ids(wife)).toEqual(['delete']);
  });

  it('没有写权限时一条都不给', () => {
    expect(ids(son, false)).toEqual([]);
  });
});
