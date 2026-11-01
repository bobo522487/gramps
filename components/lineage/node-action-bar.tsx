'use client';

import { Button } from '@/components/ui/button';
import { enabledCommands, type NodeCommandId } from './node-commands';
import type { NodeView } from './types';

/**
 * Bottom shortcut bar for the selected 人丁. It renders nothing when no node is
 * selected or when the role cannot write, so a viewer never sees a disabled
 * copy of the toolbar. The command list comes from `node-commands.ts`; the
 * canvas context menu renders the same list.
 */
export function NodeActionBar({
  node,
  canWrite,
  onCommand,
}: {
  node: NodeView | null;
  canWrite: boolean;
  onCommand: (id: NodeCommandId) => void;
}) {
  if (!node) {
    return null;
  }
  const commands = enabledCommands(node, canWrite);
  if (commands.length === 0) {
    return null;
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 border-t bg-background/95 px-4 py-2"
      data-testid="node-action-bar"
    >
      <p className="truncate text-xs text-muted-foreground">
        当前选中：
        <span className="font-medium text-foreground">{node.fullName}</span>
        {` · 第 ${node.generation} 代`}
      </p>
      <div className="flex items-center gap-1.5">
        {commands.map((command) => (
          <Button
            key={command.id}
            size="sm"
            variant={command.isDestructive ? 'destructive' : 'outline'}
            onClick={() => onCommand(command.id)}
          >
            {command.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
