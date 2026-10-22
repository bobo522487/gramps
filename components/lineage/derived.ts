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

export function buildLineageIndex(nodes: NodeView[]): LineageIndex {
  const byId = new Map<string, NodeView>();
  const blood: NodeView[] = [];
  const spousesByBlood = new Map<string, NodeView[]>();
  const childrenByParent = new Map<string, NodeView[]>();

  for (const node of nodes) {
    byId.set(node.id, node);
    if (node.role === 'blood') {
      blood.push(node);
    } else if (node.spouseOfId) {
      const bucket = spousesByBlood.get(node.spouseOfId) ?? [];
      bucket.push(node);
      spousesByBlood.set(node.spouseOfId, bucket);
    }
  }

  blood.sort((left, right) => {
    if (left.generation !== right.generation) {
      return left.generation - right.generation;
    }
    return bySortThenName(left, right);
  });

  for (const bucket of spousesByBlood.values()) {
    bucket.sort(bySortThenName);
  }

  for (const node of blood) {
    if (node.parentId && byId.get(node.parentId)?.role === 'blood') {
      const bucket = childrenByParent.get(node.parentId) ?? [];
      bucket.push(node);
      childrenByParent.set(node.parentId, bucket);
    }
  }
  for (const bucket of childrenByParent.values()) {
    bucket.sort(bySortThenName);
  }

  const roots = blood.filter(
    (node) => !node.parentId || byId.get(node.parentId)?.role !== 'blood'
  );
  const maxGeneration = blood.reduce(
    (max, node) => Math.max(max, node.generation),
    0
  );

  const descendantCounts = new Map<string, number>();
  const countDescendants = (nodeId: string): number => {
    const cached = descendantCounts.get(nodeId);
    if (cached !== undefined) {
      return cached;
    }
    let total = 0;
    for (const child of childrenByParent.get(nodeId) ?? []) {
      total += 1;
      total += spousesByBlood.get(child.id)?.length ?? 0;
      total += countDescendants(child.id);
    }
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

const MALE_RANKS = ['长子', '次子', '三子', '四子', '五子', '六子'];
const FEMALE_RANKS = ['长女', '次女', '三女', '四女', '五女', '六女'];

export function rankLabel(index: LineageIndex, node: NodeView): string {
  if (node.role === 'spouse') {
    return node.sex === 1 ? '配' : '配';
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
  const labels = node.sex === 1 ? FEMALE_RANKS : MALE_RANKS;
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

function matchesNode(node: NodeView, needle: string): boolean {
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
