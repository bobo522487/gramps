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
  const ids = new Set<string>([node.id]);
  const queue = [node.id];
  while (queue.length > 0) {
    const parentId = queue.shift();
    if (!parentId) {
      break;
    }
    for (const candidate of nodes) {
      if (
        candidate.role === 'blood' &&
        candidate.parentId === parentId &&
        !ids.has(candidate.id)
      ) {
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
