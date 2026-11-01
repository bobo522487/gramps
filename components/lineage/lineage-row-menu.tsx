'use client';

import { MoreVertical, Pencil, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { TreeLineageInput } from './lineage-tree';

/**
 * 谱系行右侧的「重命名 / 删除谱系」菜单。重命名归 `lineage.write`（调用方决定是否渲染），
 * 删除谱系归 `lineage.delete`，由 `canDelete` 单独门禁——两者不是同一个权限。
 */
export function LineageRowMenu({
  lineage,
  canDelete,
  onRename,
  onDelete,
}: {
  lineage: TreeLineageInput;
  canDelete: boolean;
  onRename: (lineage: TreeLineageInput) => void;
  onDelete: (lineage: TreeLineageInput) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="谱系操作"
          aria-label="谱系操作"
          className="rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
        >
          <MoreVertical size={12} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" size="sm">
        <DropdownMenuItem onSelect={() => onRename(lineage)}>
          <Pencil size={12} /> 重命名
        </DropdownMenuItem>
        {canDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onDelete(lineage)}
            >
              <Trash2 size={12} /> 删除谱系
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
