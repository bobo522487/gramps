'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { enabledCommands, type NodeCommandId } from './node-commands';
import type { NodeView } from './types';

export type NodeContextMenuState = { node: NodeView; x: number; y: number };

/**
 * Right-click menu for the selected 人丁. It renders the same command list as
 * the bottom action bar (`node-commands.ts`), positioned at the pointer. The
 * menu is not rendered at all for roles without write access, so a viewer sees
 * no disabled copy of it.
 */
export function NodeContextMenu({
  state,
  canWrite,
  onCommand,
  onDismiss,
}: {
  state: NodeContextMenuState | null;
  canWrite: boolean;
  onCommand: (id: NodeCommandId) => void;
  onDismiss: () => void;
}) {
  const commands = state ? enabledCommands(state.node, canWrite) : [];
  const open = state !== null && commands.length > 0;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onDismiss();
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed size-0"
          style={{ left: state?.x ?? 0, top: state?.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" size="sm" className="min-w-40">
        {commands.map((command, index) => (
          <div key={command.id}>
            {command.isDestructive && index > 0 ? (
              <DropdownMenuSeparator />
            ) : null}
            <DropdownMenuItem
              variant={command.isDestructive ? 'destructive' : 'default'}
              onSelect={() => {
                onDismiss();
                onCommand(command.id);
              }}
            >
              {command.label}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
