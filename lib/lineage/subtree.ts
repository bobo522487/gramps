import type { NodeView } from '@/components/lineage/types';

/**
 * The set of rows that a node deletion archives: the blood subtree rooted at
 * `node` plus every spouse attached to one of those blood nodes. It mirrors
 * `deleteNodeInTransaction` in `lib/lineage/node-services.ts`, so the confirm
 * dialog and the write path cannot drift apart.
 */
export function collectSubtreeIds(
  node: NodeView,
  nodes: NodeView[]
): Set<string> {
  // 先按父节点建索引。每出队一个父节点都全量扫描 nodes 是 O(n²)，
  // 数千到上万人丁时打开删除确认会明显卡顿。
  const childrenByParent = new Map<string, NodeView[]>();
  for (const candidate of nodes) {
    if (candidate.role !== 'blood' || !candidate.parentId) {
      continue;
    }
    const bucket = childrenByParent.get(candidate.parentId) ?? [];
    bucket.push(candidate);
    childrenByParent.set(candidate.parentId, bucket);
  }

  const ids = new Set<string>([node.id]);
  const queue = [node.id];
  // 迭代过程中 push 的新节点会被同一个迭代器继续访问。
  for (const parentId of queue) {
    for (const candidate of childrenByParent.get(parentId) ?? []) {
      if (!ids.has(candidate.id)) {
        ids.add(candidate.id);
        queue.push(candidate.id);
      }
    }
  }

  for (const candidate of nodes) {
    if (
      candidate.role === 'spouse' &&
      candidate.spouseOfId &&
      ids.has(candidate.spouseOfId)
    ) {
      ids.add(candidate.id);
    }
  }
  return ids;
}

export function buildDeleteConfirmMessage(
  node: NodeView,
  count: number
): string {
  return count > 1
    ? `删除「${node.fullName}」及其子孙？共 ${count} 位人丁会被删除，且不可恢复。`
    : `删除「${node.fullName}」？该人丁会被删除，且不可恢复。`;
}
