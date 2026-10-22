'use client';

import { GitBranch, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ActionState } from '@/lib/auth/types';
import { createLineageAction } from '@/lib/lineage/actions';

type FolderOption = {
  id: string;
  name: string;
  parentId: string | null;
};

function folderOptions(folders: FolderOption[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const childrenByParent = new Map<string | null, FolderOption[]>();
  for (const folder of folders) {
    const parentId =
      folder.parentId && byId.has(folder.parentId) ? folder.parentId : null;
    const bucket = childrenByParent.get(parentId) ?? [];
    bucket.push(folder);
    childrenByParent.set(parentId, bucket);
  }

  const options: { id: string; label: string }[] = [];
  function walk(parentId: string | null, depth: number) {
    for (const folder of childrenByParent.get(parentId) ?? []) {
      options.push({
        id: folder.id,
        label: `${'— '.repeat(depth)}${folder.name}`,
      });
      walk(folder.id, depth + 1);
    }
  }
  walk(null, 0);
  return options;
}

export function CreateLineageDialog({
  orgId,
  projectId,
  projectRef,
  defaultSurname,
  folders,
  defaultFolderId,
  onClose,
}: {
  orgId: string;
  projectId: string;
  projectRef: string;
  defaultSurname: string;
  folders: FolderOption[];
  defaultFolderId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    createLineageAction,
    {}
  );
  const options = useMemo(() => folderOptions(folders), [folders]);
  const [folderId, setFolderId] = useState(defaultFolderId ?? 'none');

  useEffect(() => {
    if (state.lineageId) {
      router.refresh();
      router.push(
        `/dashboard/project/${projectRef}/lineages/${state.lineageId}`
      );
      onClose();
    }
  }, [state.lineageId, projectRef, router, onClose]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="关闭新建谱系对话框"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-xs"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-lineage-title"
        className="relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <GitBranch size={18} />
            </div>
            <div className="min-w-0">
              <h2
                id="create-lineage-title"
                className="text-sm font-semibold text-foreground"
              >
                新建谱系
              </h2>
              <p className="truncate text-xs text-muted-foreground">
                谱系按姓氏与世次组织人丁，创建后即可录入始祖。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <form action={action} noValidate className="flex min-h-0 flex-col">
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="projectId" value={projectId} />
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
              <div>
                <Label htmlFor="lineage-name">谱系名称</Label>
                <Input
                  id="lineage-name"
                  name="name"
                  placeholder="例如：颖川陈氏世系"
                  maxLength={100}
                />
                {state.fieldErrors?.name ? (
                  <p className="mt-1 text-xs text-destructive">
                    {state.fieldErrors.name}
                  </p>
                ) : null}
              </div>
              <div>
                <Label htmlFor="lineage-surname">姓氏</Label>
                <Input
                  id="lineage-surname"
                  name="surname"
                  defaultValue={defaultSurname}
                  maxLength={30}
                />
                {state.fieldErrors?.surname ? (
                  <p className="mt-1 text-xs text-destructive">
                    {state.fieldErrors.surname}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="lineage-hall">郡望 / 堂号</Label>
                <Input
                  id="lineage-hall"
                  name="hallCode"
                  placeholder="颍川堂"
                  maxLength={60}
                />
              </div>
              <div>
                <Label htmlFor="lineage-folder">归属文件夹</Label>
                <input
                  type="hidden"
                  name="folderId"
                  value={folderId === 'none' ? '' : folderId}
                />
                <Select value={folderId} onValueChange={setFolderId}>
                  <SelectTrigger id="lineage-folder" size="default">
                    <SelectValue placeholder="选择文件夹" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未分类</SelectItem>
                    {options.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="lineage-generation-words">字辈</Label>
              <Input
                id="lineage-generation-words"
                name="generationWords"
                placeholder="德 维 新 学（用空格或逗号分隔）"
                maxLength={240}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                录入后，世次表头与录入表单会提示对应字辈用字。
              </p>
            </div>
            {state.error ? (
              <p className="rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
                {state.error}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-muted/20 p-4">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" variant="brand" disabled={isPending}>
              {isPending ? '创建中…' : '创建谱系'}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
