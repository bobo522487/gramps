'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
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
import type { ActionState } from '@/lib/auth/types';
import { createFolderAction, renameFolderAction } from '@/lib/folder/actions';

type FolderDialogProps = {
  orgId: string;
  projectId: string;
  kind: number;
  mode: 'create' | 'rename';
  parentId: string | null;
  folder?: { id: string; name: string };
  onClose: () => void;
};

export function FolderDialog({
  orgId,
  projectId,
  kind,
  mode,
  parentId,
  folder,
  onClose,
}: FolderDialogProps) {
  const router = useRouter();
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    mode === 'create' ? createFolderAction : renameFolderAction,
    {}
  );

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
          <DialogTitle>
            {mode === 'create' ? '新建分类' : '重命名分类'}
          </DialogTitle>
          <DialogDescription>
            分类用于整理谱系、谱文与谱书，最多支持 3 层。
          </DialogDescription>
        </DialogHeader>
        <form action={action} noValidate className="space-y-4">
          <input type="hidden" name="orgId" value={orgId} />
          {mode === 'create' ? (
            <>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="kind" value={kind} />
              {parentId ? (
                <input type="hidden" name="parentId" value={parentId} />
              ) : null}
            </>
          ) : (
            <input type="hidden" name="folderId" value={folder?.id ?? ''} />
          )}
          <div>
            <Label htmlFor="folder-name">分类名称</Label>
            <Input
              id="folder-name"
              name="name"
              defaultValue={folder?.name ?? ''}
              placeholder="例如：支系、地区"
              maxLength={100}
              autoFocus
            />
            {state.fieldErrors?.name ? (
              <p className="mt-1 text-xs text-destructive">
                {state.fieldErrors.name}
              </p>
            ) : null}
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
              {isPending
                ? '保存中…'
                : mode === 'create'
                  ? '创建分类'
                  : '保存名称'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
