'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { type FolderOption, folderOptions } from '@/components/lineage/types';
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
import { updateLineageAction } from '@/lib/lineage/actions';
import { MAX_LINEAGE_NAME_LENGTH } from '@/lib/lineage/constants';

export function LineageEditDialog({
  orgId,
  lineage,
  folders,
  onClose,
}: {
  orgId: string;
  lineage: {
    id: string;
    name: string;
    surname: string;
    folderId: string | null;
  };
  folders: FolderOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    updateLineageAction,
    {}
  );
  const options = useMemo(() => folderOptions(folders), [folders]);
  const [folderId, setFolderId] = useState(lineage.folderId ?? 'none');

  useEffect(() => {
    if (state.success) {
      router.refresh();
      onClose();
    }
  }, [state.success, router, onClose]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑谱系</DialogTitle>
          <DialogDescription>
            名称会显示在世系表和打印视图中。
          </DialogDescription>
        </DialogHeader>
        <form action={action} noValidate className="space-y-4">
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="lineageId" value={lineage.id} />
          <input
            type="hidden"
            name="folderId"
            value={folderId === 'none' ? '' : folderId}
          />

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
            <div>
              <Label htmlFor="edit-lineage-name">谱系名称</Label>
              <Input
                id="edit-lineage-name"
                name="name"
                defaultValue={lineage.name}
                maxLength={Math.max(
                  MAX_LINEAGE_NAME_LENGTH,
                  lineage.name.length
                )}
              />
              {state.fieldErrors?.name ? (
                <p className="mt-1 text-xs text-destructive">
                  {state.fieldErrors.name}
                </p>
              ) : null}
            </div>
            <div>
              <p className="text-sm font-medium">姓氏</p>
              <p
                id="edit-lineage-surname"
                className="mt-1 text-sm text-muted-foreground"
              >
                {lineage.surname}
              </p>
              <p className="text-xs text-muted-foreground">
                继承自云谱空间，不可修改
              </p>
            </div>
          </div>

          <div>
            <Label htmlFor="edit-lineage-folder">分类</Label>
            <Select value={folderId} onValueChange={setFolderId}>
              <SelectTrigger id="edit-lineage-folder">
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
              {isPending ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
