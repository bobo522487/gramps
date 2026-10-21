'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
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

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建谱系</DialogTitle>
          <DialogDescription>
            谱系按姓氏与世次组织人丁，创建后可继续录入始祖与后代。
          </DialogDescription>
        </DialogHeader>
        <form action={action} noValidate className="space-y-4">
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="projectId" value={projectId} />
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
              <Label htmlFor="lineage-folder">分类</Label>
              <input
                type="hidden"
                name="folderId"
                value={folderId === 'none' ? '' : folderId}
              />
              <Select value={folderId} onValueChange={setFolderId}>
                <SelectTrigger id="lineage-folder" size="default">
                  <SelectValue placeholder="选择分类" />
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
              录入后，世系表会在对应世次旁提示字辈用字。
            </p>
          </div>
          {state.error ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                取消
              </Button>
            </DialogClose>
            <Button type="submit" variant="brand" disabled={isPending}>
              {isPending ? '创建中…' : '创建谱系'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
