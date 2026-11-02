'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * 编辑器的右侧区域（FR-012、FR-021、FR-023）：页缩略图条。
 *
 * 这里只做**导航与顺序**，正文缩略图是「第几页 + 前几个字」的占位，
 * 真正的预览交给编辑器本身（FR-024：每页内容互不影响）。
 * 删除最后一页被拒（FR-021），顺序拖拽后回调给上层落库。
 */

export function PageStrip({
  pageIds,
  currentPageId,
  canWrite,
  onSelect,
  onAdd,
  onDelete,
  onReorder,
}: {
  pageIds: string[];
  currentPageId: string;
  canWrite: boolean;
  onSelect: (pageId: string) => void;
  onAdd: () => void;
  onDelete: (pageId: string) => void;
  onReorder: (fromId: string, toIndex: number) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);

  return (
    <aside className="flex w-44 shrink-0 flex-col gap-2 border-l border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          页（{pageIds.length}）
        </span>
        {canWrite ? (
          <Button variant="ghost" size="xs" onClick={onAdd}>
            <Plus className="size-3" />
            添加页
          </Button>
        ) : null}
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {pageIds.map((pageId, index) => {
          const active = pageId === currentPageId;
          return (
            <li
              key={pageId}
              draggable={canWrite}
              onDragStart={() => setDragId(pageId)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                setDragId(null);
                if (dragId && dragId !== pageId) {
                  onReorder(dragId, index);
                }
              }}
              className={[
                'flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs',
                active
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-background hover:bg-muted',
                canWrite ? 'cursor-grab' : '',
              ].join(' ')}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => onSelect(pageId)}
              >
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
              </button>
              {canWrite && pageIds.length > 1 ? (
                <button
                  type="button"
                  aria-label={`删除第 ${index + 1} 页`}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => onDelete(pageId)}
                >
                  <Trash2 className="size-3" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
