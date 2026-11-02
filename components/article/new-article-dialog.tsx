'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ReadonlyProjectField } from '@/components/lineage/readonly-project-field';
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
import { createArticleAction } from '@/lib/article/actions';
import { ARTICLE_TITLE_MAX_LENGTH } from '@/lib/article/constants';
import {
  type ArticleFolderNode,
  type FolderPickerOption,
  folderPickerOptions,
} from './types';

/**
 * 新建谱文（FR-001）。
 *
 * 只有三个字段：标题（必填 1–60 字）、所属分类（可留空，服务端会在同一事务里
 * 保证「默认分类」存在）、地区（继承云谱空间，只读）。附件 PRD 里的「姓氏」
 * 与「类型（像赞/谱序/凡例/传记）」都已按规格收敛——分类树替代固定类型枚举。
 */

const NO_FOLDER = '__default__';

export function NewArticleDialog({
  orgId,
  projectId,
  projectRef,
  projectRegion,
  canProjectWrite,
  folders,
  defaultFolderId,
  open,
  onOpenChange,
}: {
  orgId: string;
  projectId: string;
  projectRef: string;
  projectRegion: string;
  canProjectWrite: boolean;
  folders: ArticleFolderNode[];
  defaultFolderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const options: FolderPickerOption[] = useMemo(
    () => folderPickerOptions(folders),
    [folders]
  );
  const [title, setTitle] = useState('');
  const [folderId, setFolderId] = useState(defaultFolderId ?? NO_FOLDER);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const selectedFolderId = options.some((option) => option.id === folderId)
    ? folderId
    : (options[0]?.id ?? NO_FOLDER);

  function reset() {
    setTitle('');
    setError(null);
  }

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) {
      setError('请填写谱文标题');
      return;
    }
    if (trimmed.length > ARTICLE_TITLE_MAX_LENGTH) {
      setError('标题最多 60 个字');
      return;
    }

    setPending(true);
    try {
      const result = await createArticleAction({
        orgId,
        projectId,
        title: trimmed,
        folderId:
          selectedFolderId === NO_FOLDER ? null : (selectedFolderId ?? null),
      });
      if ('error' in result && result.error) {
        setError(result.error);
        return;
      }
      const articleId = 'data' in result ? result.data?.articleId : undefined;
      reset();
      onOpenChange(false);
      if (articleId) {
        router.push(`/dashboard/project/${projectRef}/articles/${articleId}`);
      }
      router.refresh();
    } catch {
      setError('新建失败，请重试');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建谱文</DialogTitle>
          <DialogDescription>
            标题就是这篇谱文的名字，正文可以之后再分页、配图。
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="grid gap-3"
        >
          <div>
            <Label htmlFor="new-article-title">
              标题
              <span aria-hidden="true" className="ml-0.5 text-destructive">
                *
              </span>
            </Label>
            <Input
              id="new-article-title"
              autoFocus
              value={title}
              maxLength={ARTICLE_TITLE_MAX_LENGTH}
              aria-invalid={error !== null}
              placeholder="例如：始祖谱序"
              onChange={(event) => {
                setTitle(event.target.value);
                setError(null);
              }}
            />
            {error ? (
              <p className="mt-1 text-xs text-destructive">{error}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="new-article-folder">所属分类</Label>
            <Select
              value={selectedFolderId}
              onValueChange={(value) => setFolderId(value)}
            >
              <SelectTrigger id="new-article-folder">
                <SelectValue placeholder="选择分类" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_FOLDER}>
                  默认分类（没有时自动创建）
                </SelectItem>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ReadonlyProjectField
            id="new-article-region"
            label="地区"
            value={projectRegion}
            href={`/dashboard/project/${projectRef}/settings`}
            canEdit={canProjectWrite}
            disabledReason="只有所有者或管理员可以修改云谱空间的基本信息"
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={pending || !title.trim()}>
              {pending ? '创建中…' : '新建并编辑'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
