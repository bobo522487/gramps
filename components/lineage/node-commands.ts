import type { NodeView } from '@/components/lineage/types';

export type NodeCommandId =
  | 'add-child'
  | 'add-sibling'
  | 'add-spouse'
  | 'move'
  | 'delete';

export type NodeCommand = {
  id: NodeCommandId;
  label: string;
  isEnabled: (node: NodeView) => boolean;
  isDestructive?: boolean;
};

function isRoot(node: NodeView): boolean {
  return node.role === 'blood' && !node.parentId;
}

/**
 * The single source of truth for what you can do with the selected 人丁. Both
 * entry points (the bottom action bar and the canvas context menu) render this
 * list, so they cannot drift apart. 「查看档案」 is not here on purpose:
 * selecting a node opens the inspector drawer.
 *
 * Spouse nodes only expose 删除 because the server rejects a spouse as a
 * parent (`invalid_parent` in `lib/lineage/node-services.ts`), so offering the
 * other commands would only produce error toasts.
 */
export const NODE_COMMANDS: readonly NodeCommand[] = [
  {
    id: 'add-child',
    label: '加子女',
    isEnabled: (node) => node.role === 'blood',
  },
  {
    id: 'add-sibling',
    label: '加兄弟',
    isEnabled: (node) => node.role === 'blood' && !isRoot(node),
  },
  {
    id: 'add-spouse',
    label: '加配偶',
    isEnabled: (node) => node.role === 'blood',
  },
  {
    id: 'move',
    label: '移动',
    isEnabled: (node) => node.role === 'blood' && !isRoot(node),
  },
  {
    id: 'delete',
    label: '删除',
    isEnabled: (node) => !isRoot(node),
    isDestructive: true,
  },
];

export function enabledCommands(
  node: NodeView,
  canWrite: boolean
): NodeCommand[] {
  if (!canWrite) {
    return [];
  }
  return NODE_COMMANDS.filter((command) => command.isEnabled(node));
}
