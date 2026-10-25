import { describe, expect, it } from 'vitest';
import {
  BOOK_COLUMN_WIDTH,
  BOOK_HEADER_WIDTH,
  BOOK_NODE_WIDTH,
  BOOK_ROW_HEIGHT,
  BOOK_START_X,
  BOOK_START_Y,
  layoutBookLtr,
} from '@/components/lineage/canvas/layout/book-ltr';
import {
  initialRenderLimit,
  LAZY_GENERATION_STEP,
  nextRenderLimit,
  shouldAppendGenerations,
} from '@/components/lineage/canvas/layout/lazy';
import {
  ancestorsOf,
  buildLineageIndex,
  displayGivenName,
  generationWord,
  isDescendant,
  matchLineagePerson,
  rankLabel,
} from '@/components/lineage/derived';
import {
  buildLineageTree,
  filterLineageTree,
} from '@/components/lineage/lineage-tree';
import type { NodeView } from '@/components/lineage/types';

function person(
  overrides: Partial<NodeView> & {
    id: string;
    name: string;
    generation: number;
    role?: string;
  }
): NodeView {
  const generation = overrides.generation;
  return {
    parentId: null,
    spouseOfId: null,
    role: 'blood',
    depth: generation - 1,
    sort: 0,
    surname: '陈',
    fullName: `陈${overrides.name}`,
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

function spouseOf(
  id: string,
  blood: NodeView,
  name: string,
  sort = 0
): NodeView {
  return person({
    id,
    name,
    generation: blood.generation,
    role: 'spouse',
    spouseOfId: blood.id,
    sort,
    surname: name.slice(0, 1),
    fullName: name,
    sex: blood.sex === 0 ? 1 : 0,
  });
}

function layout(
  nodes: NodeView[],
  overrides: Partial<{
    collapsedIds: Set<string>;
    generationLimit: number;
    generationWords: string[] | null;
  }> = {}
) {
  const index = buildLineageIndex(nodes);
  return {
    index,
    result: layoutBookLtr(index, {
      collapsedIds: overrides.collapsedIds ?? new Set(),
      generationLimit: overrides.generationLimit ?? 0,
      generationWords: overrides.generationWords ?? null,
    }),
  };
}

function positionOf(result: ReturnType<typeof layout>['result'], id: string) {
  const layoutNode = result.persons.find((entry) => entry.id === id);
  if (!layoutNode) {
    throw new Error(`missing layout node ${id}`);
  }
  return { x: layoutNode.x, y: layoutNode.y };
}

const xFor = (generation: number) =>
  BOOK_START_X +
  (generation - 1) * BOOK_COLUMN_WIDTH +
  BOOK_COLUMN_WIDTH / 2 -
  BOOK_NODE_WIDTH / 2;

describe('book_ltr layout', () => {
  it('places generations in columns and keeps the eldest line on the parent row', () => {
    const root = person({ id: 'r', name: '始祖', generation: 1 });
    const eldest = person({
      id: 'a',
      name: '长房',
      generation: 2,
      parentId: 'r',
      sort: 0,
    });
    const younger = person({
      id: 'b',
      name: '次房',
      generation: 2,
      parentId: 'r',
      sort: 1,
    });
    const grandson = person({
      id: 'g',
      name: '长孙',
      generation: 3,
      parentId: 'a',
    });

    const { result } = layout([root, eldest, younger, grandson]);

    expect(positionOf(result, 'r')).toEqual({ x: xFor(1), y: BOOK_START_Y });
    expect(positionOf(result, 'a')).toEqual({ x: xFor(2), y: BOOK_START_Y });
    expect(positionOf(result, 'g')).toEqual({ x: xFor(3), y: BOOK_START_Y });
    expect(positionOf(result, 'b')).toEqual({
      x: xFor(2),
      y: BOOK_START_Y + BOOK_ROW_HEIGHT,
    });

    expect(result.totalWidth).toBe(BOOK_START_X + 3 * BOOK_COLUMN_WIDTH + 120);
    expect(result.totalHeight).toBe(
      BOOK_START_Y + BOOK_ROW_HEIGHT + BOOK_ROW_HEIGHT + 24 + 100
    );

    expect(result.edges.map((edge) => edge.id).sort()).toEqual(
      ['edge-a-g', 'edge-r-a', 'edge-r-b'].sort()
    );
    expect(result.maxVisibleGeneration).toBe(3);
  });

  it('stacks multiple roots and treats a missing parent as a visible root', () => {
    const first = person({ id: 'r1', name: '始祖', generation: 1 });
    const orphan = person({
      id: 'o',
      name: '失考祖',
      generation: 2,
      parentId: 'missing',
    });

    const { result } = layout([first, orphan]);

    expect(positionOf(result, 'r1')).toEqual({ x: xFor(1), y: BOOK_START_Y });
    expect(positionOf(result, 'o')).toEqual({
      x: xFor(2),
      y: BOOK_START_Y + BOOK_ROW_HEIGHT + 24,
    });
    expect(result.headers.map((header) => header.generation)).toEqual([1, 2]);
  });

  it('centers generation headers above each column and counts spouses', () => {
    const root = person({ id: 'r', name: '始祖', generation: 1 });
    const son = person({ id: 'a', name: '元英', generation: 2, parentId: 'r' });
    const wife = spouseOf('w', son, '王氏');
    const daughter = person({
      id: 'd',
      name: '元秀',
      generation: 2,
      parentId: 'r',
      sex: 1,
    });

    const { result } = layout([root, son, wife, daughter], {
      generationWords: ['德', '元'],
    });

    const header = result.headers.find((entry) => entry.generation === 2);
    expect(header).toMatchObject({
      x:
        BOOK_START_X +
        BOOK_COLUMN_WIDTH +
        BOOK_COLUMN_WIDTH / 2 -
        BOOK_HEADER_WIDTH / 2,
      y: BOOK_START_Y - 56,
      count: 3,
      word: '元',
    });
    const firstHeader = result.headers.find((entry) => entry.generation === 1);
    expect(firstHeader).toMatchObject({
      x: BOOK_START_X + BOOK_COLUMN_WIDTH / 2 - BOOK_HEADER_WIDTH / 2,
      word: '德',
    });

    const sonLayout = result.persons.find((entry) => entry.id === 'a');
    expect(sonLayout?.spouses.map((entry) => entry.id)).toEqual(['w']);
    expect(sonLayout?.rank).toBe('长子');
    expect(sonLayout?.word).toBe('元');
  });

  it('hides descendants and their spouses when a node is collapsed', () => {
    const root = person({ id: 'r', name: '始祖', generation: 1 });
    const branch = person({
      id: 'a',
      name: '长房',
      generation: 2,
      parentId: 'r',
      sort: 0,
    });
    const branchWife = spouseOf('wa', branch, '王氏');
    const grandchildOne = person({
      id: 'g1',
      name: '长孙',
      generation: 3,
      parentId: 'a',
      sort: 0,
    });
    const grandchildOneWife = spouseOf('wg1', grandchildOne, '李氏');
    const grandchildTwo = person({
      id: 'g2',
      name: '次孙',
      generation: 3,
      parentId: 'a',
      sort: 1,
    });
    const other = person({
      id: 'b',
      name: '次房',
      generation: 2,
      parentId: 'r',
      sort: 1,
    });

    const expanded = layout([
      root,
      branch,
      branchWife,
      grandchildOne,
      grandchildOneWife,
      grandchildTwo,
      other,
    ]).result;
    expect(positionOf(expanded, 'b').y).toBe(
      BOOK_START_Y + BOOK_ROW_HEIGHT * 2
    );

    const { result } = layout(
      [
        root,
        branch,
        branchWife,
        grandchildOne,
        grandchildOneWife,
        grandchildTwo,
        other,
      ],
      { collapsedIds: new Set(['a']) }
    );

    expect(result.hiddenIds).toEqual(new Set(['g1', 'g2', 'wg1']));
    expect(result.visibleIds.has('g1')).toBe(false);
    expect(result.visibleIds.has('wg1')).toBe(false);
    expect(result.visibleIds.has('wa')).toBe(true);
    expect(result.persons.some((entry) => entry.id === 'a')).toBe(true);

    const collapsed = result.persons.find((entry) => entry.id === 'a');
    expect(collapsed?.isCollapsed).toBe(true);
    expect(collapsed?.descendantCount).toBe(3);
    expect(collapsed?.hasChildren).toBe(true);
    expect(collapsed?.childCount).toBe(2);

    // Each branch keeps its own row; collapsing only frees the rows below.
    expect(positionOf(result, 'b')).toEqual({
      x: xFor(2),
      y: BOOK_START_Y + BOOK_ROW_HEIGHT,
    });
    expect(result.edges.some((edge) => edge.target === 'g1')).toBe(false);
  });

  it('limits visible generations and their edges', () => {
    const root = person({ id: 'r', name: '始祖', generation: 1 });
    const son = person({ id: 'a', name: '元英', generation: 2, parentId: 'r' });
    const grandson = person({
      id: 'g',
      name: '昭明',
      generation: 3,
      parentId: 'a',
    });

    const { result } = layout([root, son, grandson], { generationLimit: 2 });

    expect(result.persons.map((entry) => entry.id).sort()).toEqual(['a', 'r']);
    expect(result.maxVisibleGeneration).toBe(2);
    expect(result.headers).toHaveLength(2);
    expect(result.edges.map((edge) => edge.id)).toEqual(['edge-r-a']);
    expect(result.totalWidth).toBe(BOOK_START_X + 2 * BOOK_COLUMN_WIDTH + 120);
  });
});

describe('lazy generation window', () => {
  it('renders everything up to the threshold and only the first window above it', () => {
    expect(initialRenderLimit(500, 12)).toBe(12);
    expect(initialRenderLimit(501, 12)).toBe(LAZY_GENERATION_STEP);
    expect(initialRenderLimit(501, 3)).toBe(3);
    expect(initialRenderLimit(0, 0)).toBe(0);
  });

  it('appends generations in steps and caps at the maximum', () => {
    expect(nextRenderLimit(5, 12)).toBe(10);
    expect(nextRenderLimit(10, 12)).toBe(12);
    expect(nextRenderLimit(12, 12)).toBe(12);
    expect(nextRenderLimit(0, 12)).toBe(5);
    expect(nextRenderLimit(5, 4)).toBe(4);
  });

  it('only appends while panned near the horizontal content edge', () => {
    const base = {
      totalWidth: 2000,
      zoom: 1,
      generationLimit: 0,
      renderGenerationLimit: 5,
      maxGeneration: 12,
      viewportWidth: 1000,
    };
    expect(shouldAppendGenerations({ ...base, viewport: { x: -600 } })).toBe(
      true
    );
    expect(shouldAppendGenerations({ ...base, viewport: { x: 0 } })).toBe(
      false
    );
    expect(
      shouldAppendGenerations({
        ...base,
        viewport: { x: 0 },
        generationLimit: 3,
      })
    ).toBe(false);
    expect(
      shouldAppendGenerations({
        ...base,
        viewport: { x: 0 },
        renderGenerationLimit: 12,
      })
    ).toBe(false);
    expect(
      shouldAppendGenerations({
        ...base,
        viewport: { x: 0 },
        totalWidth: 800,
      })
    ).toBe(false);
    expect(
      shouldAppendGenerations({
        ...base,
        viewport: { x: -3000 },
        zoom: 0.5,
        totalWidth: 3000,
      })
    ).toBe(true);
  });
});

describe('lineage derived values', () => {
  const root = person({ id: 'r', name: '始祖', generation: 1 });
  const firstSon = person({
    id: 'a',
    name: '元英',
    generation: 2,
    parentId: 'r',
    sort: 0,
    courtesy: '子安',
    birthYear: 1894,
    deathYear: 1968,
  });
  const secondSon = person({
    id: 'b',
    name: '元华',
    generation: 2,
    parentId: 'r',
    sort: 1,
  });
  const daughter = person({
    id: 'd',
    name: '元秀',
    generation: 2,
    parentId: 'r',
    sort: 2,
    sex: 1,
  });
  const wife = spouseOf('w', firstSon, '王氏');
  const grandson = person({
    id: 'g',
    name: '昭明',
    generation: 3,
    parentId: 'a',
  });
  const index = buildLineageIndex([
    root,
    firstSon,
    secondSon,
    daughter,
    wife,
    grandson,
  ]);

  it('labels sibling rank by parent, sex and sort order', () => {
    expect(rankLabel(index, root)).toBe('始祖');
    expect(rankLabel(index, firstSon)).toBe('长子');
    expect(rankLabel(index, secondSon)).toBe('次子');
    expect(rankLabel(index, daughter)).toBe('长女');
    expect(rankLabel(index, grandson)).toBe('长子');
  });

  it('resolves generation words and display given names', () => {
    expect(generationWord(['德', '元', '昭'], 1)).toBe('德');
    expect(generationWord(['德', '元', '昭'], 3)).toBe('昭');
    expect(generationWord(['德'], 2)).toBeNull();
    expect(generationWord(null, 1)).toBeNull();

    expect(displayGivenName(firstSon)).toBe('元英');
    expect(
      displayGivenName(person({ id: 'x', name: '陈', generation: 1 }))
    ).toBe('陈');
    expect(
      displayGivenName(
        person({ id: 'y', name: '李氏', surname: '', generation: 1 })
      )
    ).toBe('李氏');
  });

  it('groups spouses under their blood node and counts descendants', () => {
    expect(index.spousesByBlood.get('a')?.map((entry) => entry.id)).toEqual([
      'w',
    ]);
    expect(index.descendantCounts.get('a')).toBe(1);
    expect(index.descendantCounts.get('r')).toBe(5);
  });

  it('walks ancestors and descendants', () => {
    expect(isDescendant(index, 'g', 'r')).toBe(true);
    expect(isDescendant(index, 'g', 'a')).toBe(true);
    expect(isDescendant(index, 'r', 'g')).toBe(false);
    expect(isDescendant(index, 'd', 'r')).toBe(true);

    expect(ancestorsOf(index, 'g')).toEqual(['a', 'r']);
    expect(ancestorsOf(index, 'r')).toEqual([]);
  });

  it('matches a spouse but points focus at the blood relative', () => {
    const spouseMatch = matchLineagePerson(index, '王');
    expect(spouseMatch).toEqual({ bloodId: 'a', matchedId: 'w', count: 1 });

    const bloodMatch = matchLineagePerson(index, '子安');
    expect(bloodMatch).toEqual({ bloodId: 'a', matchedId: 'a', count: 1 });

    expect(matchLineagePerson(index, '元')).toEqual({
      bloodId: 'a',
      matchedId: 'a',
      count: 3,
    });
    expect(matchLineagePerson(index, '   ')).toBeNull();
    expect(matchLineagePerson(index, '不存在')).toBeNull();
  });
});

describe('lineage sidebar tree', () => {
  const folders = [
    { id: 'f1', name: '福建支', parentId: null },
    { id: 'f2', name: '福州房', parentId: 'f1' },
    { id: 'f3', name: '广东支', parentId: null },
  ];
  const lineages = [
    {
      id: 'l1',
      name: '陈氏宗谱',
      surname: '陈',
      hallCode: '颍川堂',
      region: '中国/福建',
      nodeCount: 120,
      folderId: 'f2',
    },
    {
      id: 'l2',
      name: '林氏家谱',
      surname: '林',
      hallCode: null,
      region: null,
      nodeCount: 30,
      folderId: null,
    },
    {
      id: 'l3',
      name: '陈氏分支',
      surname: '陈',
      hallCode: null,
      region: null,
      nodeCount: 8,
      folderId: 'f3',
    },
  ];

  it('builds nested folders, unfiled lineages and subtree counts', () => {
    const tree = buildLineageTree(folders, lineages);

    expect(tree.lineageCount).toBe(3);
    expect(tree.folders.map((folder) => folder.folder.id)).toEqual([
      'f1',
      'f3',
    ]);
    const fujian = tree.folders[0];
    expect(fujian?.lineageCount).toBe(1);
    expect(fujian?.children[0]?.folder.id).toBe('f2');
    expect(fujian?.children[0]?.depth).toBe(1);
    expect(tree.folders[1]?.lineageCount).toBe(1);
    expect(tree.unfiled.map((entry) => entry.lineage.id)).toEqual(['l2']);
  });

  it('keeps ancestor folders when filtering and matches hall names', () => {
    const tree = buildLineageTree(folders, lineages);
    const filtered = filterLineageTree(tree, '宗谱');

    expect(filtered.folders).toHaveLength(1);
    expect(filtered.folders[0]?.folder.id).toBe('f1');
    expect(filtered.folders[0]?.children[0]?.lineages[0]?.lineage.id).toBe(
      'l1'
    );
    expect(filtered.unfiled).toEqual([]);

    const byHall = filterLineageTree(tree, '颍川');
    expect(byHall.folders[0]?.lineageCount).toBe(1);
    expect(byHall.folders[0]?.children[0]?.lineages[0]?.lineage.id).toBe('l1');

    const byFolder = filterLineageTree(tree, '福州');
    expect(byFolder.folders[0]?.folder.id).toBe('f1');
    expect(byFolder.folders[0]?.children[0]?.folder.id).toBe('f2');

    const none = filterLineageTree(tree, '无匹配');
    expect(none.folders).toEqual([]);
    expect(none.unfiled).toEqual([]);
  });

  it('treats unknown folder references as unfiled', () => {
    const tree = buildLineageTree(folders, [
      { ...lineages[0], folderId: 'missing' },
    ]);
    expect(tree.unfiled).toHaveLength(1);
    expect(tree.folders[0]?.lineageCount).toBe(0);
  });
});
