'use client';

import type {
  TreeFolderInput,
  TreeLineageInput,
} from '@/components/lineage/lineage-tree';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export function SidebarDeleteDialogs({
  lineage,
  folder,
  onLineageOpenChange,
  onFolderOpenChange,
  onConfirmLineage,
  onConfirmFolder,
}: {
  lineage: TreeLineageInput | null;
  folder: TreeFolderInput | null;
  onLineageOpenChange: (open: boolean) => void;
  onFolderOpenChange: (open: boolean) => void;
  onConfirmLineage: () => void;
  onConfirmFolder: () => void;
}) {
  return (
    <>
      <ConfirmDialog
        open={lineage !== null}
        onOpenChange={onLineageOpenChange}
        title="确认删除谱系"
        description={
          lineage
            ? lineage.nodeCount > 0
              ? `删除谱系「${lineage.name}」？谱系中的 ${lineage.nodeCount} 位人丁会一并归档，且没有恢复界面。`
              : `删除谱系「${lineage.name}」？该谱系还没有人丁，且没有恢复界面。`
            : ''
        }
        confirmLabel="删除"
        cancelLabel="取消"
        destructive
        onConfirm={onConfirmLineage}
      />
      <ConfirmDialog
        open={folder !== null}
        onOpenChange={onFolderOpenChange}
        title="确认删除文件夹"
        description={
          folder
            ? `删除文件夹「${folder.name}」？子文件夹会一并删除，其中的谱系将移入未分类。`
            : ''
        }
        confirmLabel="删除"
        cancelLabel="取消"
        destructive
        onConfirm={onConfirmFolder}
      />
    </>
  );
}
