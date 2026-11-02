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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  deleteArticleAction,
  getArticleDeletePreviewAction,
  moveArticleAction,
  updateArticleTitleAction,
} from '@/lib/article/actions';
import {
  ARTICLE_TITLE_MAX_LENGTH,
  ARTICLE_TITLE_MIN_LENGTH,
} from '@/lib/article/constants';
import {
  type ArticleRow,
  type FolderPickerOption,
  UNFILED_FOLDER_ID,
} from './types';

/** 谱文行的「重命名 / 移到分类 / 删除」三个确认框（FR-003、FR-006、FR-010、FR-011）。 */

export function ArticleRenameDialog({
  orgId,
  row,
  open,
  onOpenChange,
  onSaved,
}: {
  orgId: string;
  row: ArticleRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function reset(current: ArticleRow | null) {
    setValue(current?.title ?? '');
    setError(null);
  }

  async function submit() {
    if (!row) {
      return;
    }
    const title = value.trim();
    if (title.length < ARTICLE_TITLE_MIN_LENGTH) {
      setError('请填写谱文标题');
      return;
    }
    if (title.length > ARTICLE_TITLE_MAX_LENGTH) {
      setError('标题最多 60 个字');
      return;
    }
    const result = await updateArticleTitleAction({
      orgId,
      articleId: row.id,
      title,
    });
    if ('error' in result && result.error) {
      setError(result.error);
      return;
    }
    reset(row);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset(row);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>重命名谱文</DialogTitle>
          <DialogDescription>
            标题 1–60 个字；改完列表、分类与搜索同步生效。
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="article-rename-title">标题</Label>
          <Input
            id="article-rename-title"
            autoFocus
            value={value}
            maxLength={ARTICLE_TITLE_MAX_LENGTH}
            aria-invalid={error !== null}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
          />
          {error ? (
            <p className="mt-1 text-xs text-destructive">{error}</p>
          ) : null}
        </div>
        <DialogFooter className="mt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button type="button" onClick={submit}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ArticleMoveDialog({
  orgId,
  row,
  folders,
  open,
  onOpenChange,
  onSaved,
}: {
  orgId: string;
  row: ArticleRow | null;
  folders: FolderPickerOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [folderId, setFolderId] = useState<string>(UNFILED_FOLDER_ID);

  async function submit() {
    if (!row) {
      return;
    }
    const result = await moveArticleAction({
      orgId,
      articleId: row.id,
      folderId: folderId === UNFILED_FOLDER_ID ? null : folderId,
    });
    if ('error' in result && result.error) {
      return;
    }
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>移到分类</DialogTitle>
          <DialogDescription>
            移入或移出分类都会同步更新两边的篇数。
          </DialogDescription>
        </DialogHeader>
        <Select value={folderId} onValueChange={(next) => setFolderId(next)}>
          <SelectTrigger aria-label="目标分类">
            <SelectValue placeholder="选择分类" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNFILED_FOLDER_ID}>未分类</SelectItem>
            {folders.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter className="mt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button type="button" onClick={submit}>
            移动
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ArticleDeleteDialog({
  orgId,
  row,
  open,
  onOpenChange,
  onDeleted,
}: {
  orgId: string;
  row: ArticleRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [imageCount, setImageCount] = useState<number | null>(null);
  const [referenced, setReferenced] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 打开对话框那一刻就取影响范围（FR-004、SC-005）。父组件直接翻转 `open`，
  // Radix 不会为此回调 onOpenChange，所以只能在 effect 里取；取到之前按钮保持禁用，
  // 免得弹窗里先给出一个没有数字的确认框。
  useEffect(() => {
    if (!open || !row) {
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    void getArticleDeletePreviewAction({ orgId, articleId: row.id }).then(
      (result) => {
        if (!active) {
          return;
        }
        setLoading(false);
        if (!('pageCount' in result)) {
          setError(result.error ?? '读取删除影响范围失败');
          return;
        }
        setPageCount(result.pageCount);
        setImageCount(result.imageCount);
        setReferenced(result.referencedByCatalog);
      }
    );
    return () => {
      active = false;
    };
  }, [open, row, orgId]);

  async function confirm() {
    if (!row) {
      return;
    }
    const result = await deleteArticleAction({ orgId, articleId: row.id });
    if ('error' in result && result.error) {
      setError(result.error);
      onOpenChange(false);
      onDeleted();
      return;
    }
    onOpenChange(false);
    onDeleted();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setLoading(false);
          setPageCount(null);
          setImageCount(null);
          setReferenced(null);
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>删除谱文</DialogTitle>
          <DialogDescription>
            {loading
              ? '正在统计影响范围…'
              : row
                ? `「${row.title}」删除后不再出现在列表与搜索里。`
                : ''}
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {!loading && pageCount !== null ? (
          <ul className="grid gap-1 text-sm text-muted-foreground">
            <li>页数：{pageCount} 页</li>
            <li>图片：{imageCount ?? 0} 张</li>
            {referenced ? (
              <li className="text-destructive">
                这篇谱文正被谱书编目引用，需要先移除编目才能删除。
              </li>
            ) : null}
          </ul>
        ) : null}
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
            disabled={loading || referenced === true}
            onClick={confirm}
          >
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
