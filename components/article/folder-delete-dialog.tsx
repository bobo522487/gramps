'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getFolderDeletePreviewAction } from '@/lib/article/actions';
import type { ArticleFolderNode } from './types';

/**
 * 删除分类的确认框（FR-005、SC-005）。
 *
 * 打开时先读一次服务端预览，把「连带删掉几个子分类、几篇谱文转入未分类」
 * 写在按钮之前——规格要求这两个数字必须出现在确认框里，且只有服务端算得准。
 * 真正执行删除仍由分类树负责，这里只管预览与确认。
 */

type Preview = {
  loading: boolean;
  folderCount: number | null;
  articleCount: number | null;
  error: string | null;
};

const INITIAL: Preview = {
  loading: true,
  folderCount: null,
  articleCount: null,
  error: null,
};

export function FolderDeleteDialog({
  orgId,
  folder,
  open,
  error,
  onOpenChange,
  onConfirm,
}: {
  orgId: string;
  folder: ArticleFolderNode | null;
  open: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (folder: ArticleFolderNode) => void;
}) {
  const [preview, setPreview] = useState<Preview>(INITIAL);

  useEffect(() => {
    if (!open || !folder) {
      return;
    }
    let active = true;
    setPreview(INITIAL);
    void getFolderDeletePreviewAction({ orgId, folderId: folder.id }).then(
      (result) => {
        if (!active) {
          return;
        }
        if (!('folderCount' in result)) {
          setPreview({
            loading: false,
            folderCount: null,
            articleCount: null,
            error: result.error ?? '读取删除影响范围失败',
          });
          return;
        }
        setPreview({
          loading: false,
          folderCount: result.folderCount,
          articleCount: result.articleCount,
          error: null,
        });
      }
    );
    return () => {
      active = false;
    };
  }, [open, folder, orgId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>删除分类</DialogTitle>
          <DialogDescription>
            {folder
              ? `「${folder.name}」及其子分类会被删除，其中的谱文不会丢，会移入「未分类」。`
              : ''}
          </DialogDescription>
        </DialogHeader>
        {error || preview.error ? (
          <p className="text-sm text-destructive">{error ?? preview.error}</p>
        ) : null}
        {preview.loading ? (
          <p className="text-sm text-muted-foreground">正在统计影响范围…</p>
        ) : (
          <ul className="grid gap-1 text-sm text-muted-foreground">
            <li>连带删除分类：{preview.folderCount ?? 0} 个</li>
            <li>移入未分类的谱文：{preview.articleCount ?? 0} 篇</li>
          </ul>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={preview.loading || preview.error !== null || !folder}
            onClick={() => {
              if (folder) {
                onConfirm(folder);
              }
            }}
          >
            删除分类
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
