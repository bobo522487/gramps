import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NodeActionBar } from '@/components/lineage/node-action-bar';
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
const son = node({ id: 'a', parentId: 'r', generation: 2, fullName: '陈守义' });
const noop = () => {};

describe('NodeActionBar', () => {
  it('显示当前选中的人丁与世次', () => {
    const html = renderToStaticMarkup(
      <NodeActionBar node={son} canWrite onCommand={noop} />
    );
    expect(html).toContain('当前选中');
    expect(html).toContain('陈守义');
    expect(html).toContain('第 2 代');
  });

  it('渲染命令表里的可用命令', () => {
    const html = renderToStaticMarkup(
      <NodeActionBar node={son} canWrite onCommand={noop} />
    );
    for (const label of ['加子女', '加兄弟', '移动', '删除']) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain('查看档案');
  });

  it('始祖不出现删除、移动与加兄弟', () => {
    const html = renderToStaticMarkup(
      <NodeActionBar node={root} canWrite onCommand={noop} />
    );
    expect(html).toContain('加子女');
    expect(html).not.toContain('删除');
    expect(html).not.toContain('移动');
    expect(html).not.toContain('加兄弟');
  });

  it('没有写权限时整条不渲染', () => {
    expect(
      renderToStaticMarkup(
        <NodeActionBar node={son} canWrite={false} onCommand={noop} />
      )
    ).toBe('');
  });

  it('没有选中人丁时不渲染', () => {
    expect(
      renderToStaticMarkup(
        <NodeActionBar node={null} canWrite onCommand={noop} />
      )
    ).toBe('');
  });
});
