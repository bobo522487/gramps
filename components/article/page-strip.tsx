'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * 编辑器的右侧区域（FR-005、FR-012、FR-021、FR-023）：迷你纸页条。
 *
 * 每页是一张「迷你纸页」：第几页 + 这一页的前几个字，用文本片段示意而不是
 * 渲染整页 DOM / 位图缩略（FR-005，SC-003 下几十页也不拖慢编辑器）。
 * 片段来自上层用 `pagePlainText` 算出的摘要：当前页反映本地草稿，其余页是
 * 最近一次已知内容，不新建任何缩略图渲染通道。
 * 删除最后一页被拒（FR-022），顺序拖拽后回调给上层落库（FR-023）。
 */

const SNIPPET_LENGTH = 24;

export function PageStrip({
  pageIds,
  currentPageId,
  summaries,
  canWrite,
  onSelect,
  onAdd,
  onDelete,
  onReorder,
}: {
  pageIds: string[];
  currentPageId: string;
  /** 每页的文本摘要（`pagePlainText` 算出来的），空页就是空串。 */
  summaries: Record<string, string>;
  canWrite: boolean;
  onSelect: (pageId: string) => void;
  onAdd: () => void;
  onDelete: (pageId: string) => void;
  onReorder: (fromId: string, toIndex: number) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  // 删页要二次确认（FR-022）：先问清楚「删的是第几页、上面有什么」。
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  return (
    <aside
      aria-label="页列表"
      className="flex w-44 shrink-0 flex-col gap-2 border-l border-border bg-card p-3"
    >
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
              data-testid="mini-page"
              aria-label={`第 ${index + 1} 页`}
              aria-current={active ? 'page' : undefined}
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
                aria-current={active ? 'true' : undefined}
                className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
                onClick={() => onSelect(pageId)}
              >
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  第 {index + 1} 页
                </span>
                {/* FR-005：白纸小样，仅文本片段示意，不做整页 DOM / 位图缩略。 */}
                <span className="line-clamp-3 w-full break-all rounded-sm border border-border bg-card px-1.5 py-1 text-[11px] leading-snug text-foreground/80 shadow-sm">
                  {snippet(summaries[pageId] ?? '')}
                </span>
              </button>
              {canWrite ? (
                <button
                  type="button"
                  aria-label={`删除第 ${index + 1} 页`}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    setBlocked(
                      pageIds.length > 1
                        ? null
                        : '至少要保留一页，这一页删不掉。'
                    );
                    if (pageIds.length > 1) {
                      setPendingDelete(pageId);
                    }
                  }}
                >
                  <Trash2 className="size-3" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {blocked ? (
        <p role="alert" className="text-xs text-destructive">
          {blocked}
        </p>
      ) : null}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除这一页？</DialogTitle>
            <DialogDescription>
              第 {pendingDelete ? pageIds.indexOf(pendingDelete) + 1 : 0} 页
              上的文字与图片都会被删掉，这一步不能撤销。
            </DialogDescription>
          </DialogHeader>
          <p className="break-all text-xs text-muted-foreground">
            {pendingDelete ? snippet(summaries[pendingDelete] ?? '') : ''}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDelete) {
                  onDelete(pendingDelete);
                }
                setPendingDelete(null);
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

/** 空页给一个可见的占位，免得缩略图看上去像坏了。 */
function snippet(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '（空页）';
  }
  return trimmed.length > SNIPPET_LENGTH
    ? `${trimmed.slice(0, SNIPPET_LENGTH)}…`
    : trimmed;
}
