import type { NodeView } from './types';

export type LineageIndex = {
  nodes: NodeView[];
  blood: NodeView[];
  byId: Map<string, NodeView>;
  spousesByBlood: Map<string, NodeView[]>;
  childrenByParent: Map<string, NodeView[]>;
  roots: NodeView[];
  maxGeneration: number;
  descendantCounts: Map<string, number>;
};

function bySortThenName(left: NodeView, right: NodeView) {
  if (left.sort !== right.sort) {
    return left.sort - right.sort;
  }
  return left.fullName.localeCompare(right.fullName, 'zh-Hans-CN');
}

/**
 * The single source of lineage display order (R30). 世系表的世次卡片、画布的纵向
 * 堆叠、搜索首匹配、打印视图全部继承 `index.blood`，谁都不再自己排一次序；
 * `lib/db/queries/nodes.ts` 的 `orderBy` 只提供稳定的入库序。
 *
 * The order is a depth-first **preorder** from the roots: 长房整支在前、次房整支在后
 * (FR-LIN-13). Ordering by `generation → sort` — the old rule — interleaves the
 * branches, because `sort` is a sibling rank *within one parent* (`nextSort` in
 * `lib/lineage/node-services.ts`); comparing it across branches lines up "the
 * N-th son of every house" side by side instead of walking one house at a time.
 * Sorting by ltree `path` is not an alternative either: the label is a UUID
 * (`nodeLabel`), so its collation says nothing about 长幼房支序 — see ADR 0003.
 *
 * Roots (multiple 始祖, or 悬空 `parentId`) are ordered between themselves by
 * `sort` → 全名; the same rule orders siblings, and nothing else is available.
 */
function bloodDepthFirst(
  roots: NodeView[],
  members: NodeView[],
  childrenByParent: Map<string, NodeView[]>
): NodeView[] {
  const ordered: NodeView[] = [];
  const visited = new Set<string>();
  // 显式栈而不是递归：万人谱不该靠 JS 调用栈扛深链。
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || visited.has(node.id)) {
      continue;
    }
    visited.add(node.id);
    ordered.push(node);
    const children = childrenByParent.get(node.id);
    if (children) {
      // 副本再反转：childrenByParent 的桶还服务 rankLabel，不能就地改序。
      stack.push(...[...children].reverse());
    }
  }

  // 兜底：只有父链成环（自环、A→B→A）的节点走不到——悬空 `parentId` 已经算根。
  // 按 generation → sort → 全名追加，保证一个人都不丢，且两次构建结果一致。
  const unreachable = members.filter((node) => !visited.has(node.id));
  if (unreachable.length > 0) {
    unreachable.sort((left, right) => {
      if (left.generation !== right.generation) {
        return left.generation - right.generation;
      }
      return bySortThenName(left, right);
    });
    ordered.push(...unreachable);
  }

  return ordered;
}

export function buildLineageIndex(nodes: NodeView[]): LineageIndex {
  const byId = new Map<string, NodeView>();
  const members: NodeView[] = [];
  const spousesByBlood = new Map<string, NodeView[]>();
  const childrenByParent = new Map<string, NodeView[]>();

  for (const node of nodes) {
    byId.set(node.id, node);
    if (node.role === 'blood') {
      members.push(node);
    } else if (node.spouseOfId) {
      const bucket = spousesByBlood.get(node.spouseOfId) ?? [];
      bucket.push(node);
      spousesByBlood.set(node.spouseOfId, bucket);
    }
  }

  for (const bucket of spousesByBlood.values()) {
    bucket.sort(bySortThenName);
  }

  for (const node of members) {
    if (node.parentId && byId.get(node.parentId)?.role === 'blood') {
      const bucket = childrenByParent.get(node.parentId) ?? [];
      bucket.push(node);
      childrenByParent.set(node.parentId, bucket);
    }
  }
  for (const bucket of childrenByParent.values()) {
    bucket.sort(bySortThenName);
  }

  const roots = members
    .filter(
      (node) => !node.parentId || byId.get(node.parentId)?.role !== 'blood'
    )
    .sort(bySortThenName);

  const blood = bloodDepthFirst(roots, members, childrenByParent);
  const maxGeneration = members.reduce(
    (max, node) => Math.max(max, node.generation),
    0
  );

  const descendantCounts = new Map<string, number>();
  // 脏数据（父链成环）时防止无界递归：环上重入的节点按 0 计，不缓存。
  const counting = new Set<string>();
  const countDescendants = (nodeId: string): number => {
    const cached = descendantCounts.get(nodeId);
    if (cached !== undefined) {
      return cached;
    }
    if (counting.has(nodeId)) {
      return 0;
    }
    counting.add(nodeId);
    let total = 0;
    for (const child of childrenByParent.get(nodeId) ?? []) {
      total += 1;
      total += spousesByBlood.get(child.id)?.length ?? 0;
      total += countDescendants(child.id);
    }
    counting.delete(nodeId);
    descendantCounts.set(nodeId, total);
    return total;
  };
  for (const node of roots) {
    countDescendants(node.id);
  }
  for (const node of blood) {
    countDescendants(node.id);
  }

  return {
    nodes,
    blood,
    byId,
    spousesByBlood,
    childrenByParent,
    roots,
    maxGeneration,
    descendantCounts,
  };
}

export function displayGivenName(node: NodeView): string {
  if (node.surname && node.name.startsWith(node.surname)) {
    return node.name.slice(node.surname.length) || node.name;
  }
  return node.name;
}

export const RANK_LABELS = {
  male: ['长子', '次子', '三子', '四子', '五子', '六子'],
  female: ['长女', '次女', '三女', '四女', '五女', '六女'],
} as const;

export function rankLabel(index: LineageIndex, node: NodeView): string {
  if (node.role === 'spouse') {
    return '配';
  }
  if (!node.parentId) {
    return '始祖';
  }
  const siblings = (index.childrenByParent.get(node.parentId) ?? []).filter(
    (candidate) => candidate.sex === node.sex
  );
  const order = siblings.findIndex((candidate) => candidate.id === node.id);
  if (order < 0) {
    return '';
  }
  const labels = node.sex === 1 ? RANK_LABELS.female : RANK_LABELS.male;
  return labels[order] ?? `第${order + 1}${node.sex === 1 ? '女' : '子'}`;
}

export function generationWord(
  words: string[] | null | undefined,
  generation: number
): string | null {
  return words?.[generation - 1] ?? null;
}

export function lifeSpan(node: NodeView): string {
  const birth = node.birthText ?? node.birthYear?.toString() ?? '';
  const death = node.isAlive
    ? ''
    : (node.deathText ?? node.deathYear?.toString() ?? '');
  if (!birth && !death) {
    return node.isAlive ? '在世' : '—';
  }
  return `${birth || '?'} — ${death || (node.isAlive ? '' : '?')}`.trim();
}

export function isDescendant(
  index: LineageIndex,
  nodeId: string,
  ancestorId: string
): boolean {
  let current = index.byId.get(nodeId);
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.id)) {
    if (current.parentId === ancestorId) {
      return true;
    }
    seen.add(current.id);
    current = index.byId.get(current.parentId);
  }
  return false;
}

export function ancestorsOf(index: LineageIndex, nodeId: string): string[] {
  const ancestors: string[] = [];
  let current = index.byId.get(nodeId);
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    ancestors.push(current.parentId);
    current = index.byId.get(current.parentId);
  }
  return ancestors;
}

export function spouseCount(index: LineageIndex, nodeId: string): number {
  return index.spousesByBlood.get(nodeId)?.length ?? 0;
}

export type PersonMatch = {
  bloodId: string;
  matchedId: string;
  count: number;
};

/**
 * The single person-search predicate, shared by the canvas and the 世系表.
 * `needle` must already be `trim().toLowerCase()`-normalized by the caller.
 */
export function matchesNode(node: NodeView, needle: string): boolean {
  const values = [
    node.fullName,
    node.name,
    node.courtesy,
    node.namePrefix,
    node.birthText,
    node.deathText,
    node.burialPlace,
    node.biography,
  ];
  return values.some((value) => value?.toLowerCase().includes(needle));
}

export function matchLineagePerson(
  index: LineageIndex,
  query: string
): PersonMatch | null {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return null;
  }

  let count = 0;
  let first: PersonMatch | null = null;
  for (const blood of index.blood) {
    const spouses = index.spousesByBlood.get(blood.id) ?? [];
    if (matchesNode(blood, needle)) {
      count += 1;
      first ??= { bloodId: blood.id, matchedId: blood.id, count: 0 };
    }
    for (const spouse of spouses) {
      if (matchesNode(spouse, needle)) {
        count += 1;
        first ??= { bloodId: blood.id, matchedId: spouse.id, count: 0 };
      }
    }
  }

  if (!first) {
    return null;
  }
  return { ...first, count };
}
