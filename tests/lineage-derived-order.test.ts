import { describe, expect, it } from 'vitest';
import { buildLineageIndex } from '@/components/lineage/derived';
import type { NodeView } from '@/components/lineage/types';

/**
 * FR-LIN-13 行为测试（R30）：世系表的显示序必须是「长房整支 → 次房整支」的深度优先
 * 前序，不是 `generation → sort` 的横向对齐。世系表按世次分卡片，卡片内的行序直接
 * 继承 `index.blood`（`lineage-detail.tsx` 的 `groups` 只按世次分桶、组内保序），
 * 所以这里锁 `index.blood` 全序 + 世次切片两处即可。
 * 详见 .specify/bugs/lineage-generation-order/assessment.md。
 */

function node(
  overrides: Partial<NodeView> & { id: string; name: string }
): NodeView {
  const surname = overrides.surname ?? '陈';
  return {
    parentId: null,
    spouseOfId: null,
    role: 'blood',
    generation: 1,
    sort: 0,
    surname,
    // Write-side invariant: fullName = surname + name.
    fullName: `${surname}${overrides.name}`,
    sex: 0,
    courtesy: null,
    namePrefix: null,
    isAlive: false,
    birthText: null,
    deathText: null,
    birthYear: null,
    deathYear: null,
    burialPlace: null,
    biography: null,
    ...overrides,
  };
}

function bloodIds(nodes: NodeView[]): string[] {
  return buildLineageIndex(nodes)
    .blood.map((person) => person.id)
    .sort();
}

/** 始祖 → 长房（二子）+ 次房（一子）；三世三人的 sort 分别是 0、1、0。 */
function twoBranches(): NodeView[] {
  const root = node({ id: 'r', name: '始祖', generation: 1 });
  const elder = node({
    id: 'a',
    name: '长房',
    generation: 2,
    parentId: 'r',
    sort: 0,
  });
  const younger = node({
    id: 'b',
    name: '次房',
    generation: 2,
    parentId: 'r',
    sort: 1,
  });
  const elderFirst = node({
    id: 'a1',
    name: '长房长子',
    generation: 3,
    parentId: 'a',
    sort: 0,
  });
  const elderSecond = node({
    id: 'a2',
    name: '长房次子',
    generation: 3,
    parentId: 'a',
    sort: 1,
  });
  const youngerOnly = node({
    id: 'b1',
    name: '次房独子',
    generation: 3,
    parentId: 'b',
    sort: 0,
  });
  return [root, elder, younger, elderFirst, elderSecond, youngerOnly];
}

describe('lineage blood order is branch depth-first (R30)', () => {
  it('walks the whole elder branch before the younger branch', () => {
    const index = buildLineageIndex(twoBranches());
    expect(index.blood.map((person) => person.id)).toEqual([
      'r',
      'a',
      'a1',
      'a2',
      'b',
      'b1',
    ]);
  });

  it('no longer lines up "the N-th son of every house" side by side', () => {
    const third = buildLineageIndex(twoBranches())
      .blood.filter((person) => person.generation === 3)
      .map((person) => person.id);
    // The old generation → sort order produced ['a1', 'b1', 'a2'] here.
    expect(third).toEqual(['a1', 'a2', 'b1']);
  });

  it('世系表 generation buckets keep the DFS order inside each card', () => {
    const { blood } = buildLineageIndex(twoBranches());
    // `groups` in lineage-detail.tsx pushes nodes in blood order, so a
    // generation slice is exactly what a 世次卡片 renders as rows.
    const rows = (generation: number) =>
      blood
        .filter((person) => person.generation === generation)
        .map((person) => person.id);
    expect(rows(1)).toEqual(['r']);
    expect(rows(2)).toEqual(['a', 'b']);
    expect(rows(3)).toEqual(['a1', 'a2', 'b1']);
  });

  it('orders a deeper tree as preorder, whole subtree at a time', () => {
    const nodes = [
      node({ id: 'r', name: '始祖', generation: 1 }),
      node({ id: 'a', name: '长房', generation: 2, parentId: 'r', sort: 0 }),
      node({ id: 'b', name: '次房', generation: 2, parentId: 'r', sort: 1 }),
      node({
        id: 'a1',
        name: '长房长子',
        generation: 3,
        parentId: 'a',
        sort: 0,
      }),
      node({
        id: 'a2',
        name: '长房次子',
        generation: 3,
        parentId: 'a',
        sort: 1,
      }),
      node({
        id: 'b1',
        name: '次房独子',
        generation: 3,
        parentId: 'b',
        sort: 0,
      }),
      node({
        id: 'a11',
        name: '长房长孙',
        generation: 4,
        parentId: 'a1',
        sort: 0,
      }),
      node({
        id: 'b11',
        name: '次房孙',
        generation: 4,
        parentId: 'b1',
        sort: 0,
      }),
    ];
    expect(buildLineageIndex(nodes).blood.map((p) => p.id)).toEqual([
      'r',
      'a',
      'a1',
      'a11',
      'a2',
      'b',
      'b1',
      'b11',
    ]);
  });

  it('ignores the row order the query returned', () => {
    const forward = buildLineageIndex(twoBranches()).blood.map((p) => p.id);
    const reversed = buildLineageIndex(twoBranches().reverse()).blood.map(
      (p) => p.id
    );
    expect(reversed).toEqual(forward);
  });

  it('does not put spouses into the blood sequence', () => {
    const [root, elder] = twoBranches();
    const wife = node({
      id: 'w',
      name: '王氏',
      surname: '王',
      generation: 2,
      role: 'spouse',
      spouseOfId: 'a',
      sex: 1,
    });
    const index = buildLineageIndex([root, elder, wife]);
    expect(index.blood.map((p) => p.id)).toEqual(['r', 'a']);
    expect(index.spousesByBlood.get('a')?.map((p) => p.id)).toEqual(['w']);
  });
});

describe('lineage blood order roots and fallbacks', () => {
  it('orders multiple roots by sort, then fullName', () => {
    const nodes = [
      node({ id: 'r2', name: '白祖', generation: 1, sort: 1 }),
      node({ id: 'r1', name: '安祖', generation: 1, sort: 0 }),
      node({ id: 'r3', name: '康祖', generation: 1, sort: 0 }),
    ];
    // sort first: r1/r3 (sort 0) before r2 (sort 1); 安 < 康 by pinyin.
    expect(buildLineageIndex(nodes).blood.map((p) => p.id)).toEqual([
      'r1',
      'r3',
      'r2',
    ]);
    expect(buildLineageIndex(nodes).roots.map((p) => p.id)).toEqual([
      'r1',
      'r3',
      'r2',
    ]);
  });

  it('treats a dangling parentId as a root and still walks its subtree', () => {
    const nodes = [
      node({ id: 'r', name: '始祖', generation: 1, sort: 0 }),
      node({
        id: 'o',
        name: '失考祖',
        generation: 2,
        parentId: 'ghost',
        sort: 1,
      }),
      node({ id: 'oc', name: '失考子', generation: 3, parentId: 'o', sort: 0 }),
    ];
    expect(buildLineageIndex(nodes).blood.map((p) => p.id)).toEqual([
      'r',
      'o',
      'oc',
    ]);
  });

  it('keeps every node when a parent chain forms a cycle', () => {
    const nodes = [
      node({ id: 'r', name: '始祖', generation: 1 }),
      node({ id: 's', name: '独子', generation: 2, parentId: 'r' }),
      // 环：c1 ↔ c2，两者都不可能是根
      node({ id: 'c1', name: '环一', generation: 3, parentId: 'c2', sort: 0 }),
      node({ id: 'c2', name: '环二', generation: 3, parentId: 'c1', sort: 1 }),
      // 父链通向环的节点也到不了
      node({
        id: 'c3',
        name: '环裔',
        generation: 4,
        parentId: 'c2',
        sort: 0,
      }),
    ];
    expect(bloodIds(nodes)).toEqual(['c1', 'c2', 'c3', 'r', 's']);
    const first = buildLineageIndex(nodes).blood.map((p) => p.id);
    expect(first.slice(0, 2)).toEqual(['r', 's']);
    // 兜底序：generation → sort → fullName，确定性
    expect(first.slice(2)).toEqual(['c1', 'c2', 'c3']);
    expect(buildLineageIndex(nodes).blood.map((p) => p.id)).toEqual(first);
  });

  it('is stable for a self-parented node and repeated builds', () => {
    const nodes = [
      node({ id: 'r', name: '始祖', generation: 1 }),
      node({ id: 's', name: '自环', generation: 2, parentId: 's' }),
    ];
    const once = buildLineageIndex(nodes).blood.map((p) => p.id);
    const twice = buildLineageIndex(nodes.reverse()).blood.map((p) => p.id);
    expect(bloodIds(nodes)).toEqual(['r', 's']);
    expect(twice).toEqual(once);
  });

  it('walks a deep chain without dropping nodes (explicit stack)', () => {
    const depth = 2000;
    const chain: NodeView[] = [];
    for (let generation = 1; generation <= depth; generation += 1) {
      chain.push(
        node({
          id: `n${generation}`,
          name: `世代${generation}`,
          generation,
          parentId: generation === 1 ? null : `n${generation - 1}`,
        })
      );
    }
    const index = buildLineageIndex(chain);
    expect(index.blood).toHaveLength(depth);
    expect(index.blood[0]?.id).toBe('n1');
    expect(index.blood[depth - 1]?.id).toBe(`n${depth}`);
  });
});
