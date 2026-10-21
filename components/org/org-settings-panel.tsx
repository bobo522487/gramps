'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { mutate } from 'swr';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionState } from '@/lib/auth/types';
import { deleteOrgAction, renameOrgAction } from '@/lib/org/actions';

export function OrgSettingsPanel({
  orgId,
  orgName,
  orgSlug,
  projectCount,
  isOwner,
}: {
  orgId: number;
  orgName: string;
  orgSlug: string;
  projectCount: number;
  isOwner: boolean;
}) {
  const router = useRouter();
  // revalidatePath refreshes the RSC tree but not the switcher's SWR cache, so
  // the org list is re-fetched here to keep its label in sync
  const [renameState, renameAction, isRenaming] = useActionState<
    ActionState,
    FormData
  >(async (_prev, formData) => {
    const result = await renameOrgAction({}, formData);
    if (result && 'success' in result && result.success) {
      mutate('/api/orgs');
    }
    return result ?? {};
  }, {});
  const [deleteState, deleteAction, isDeleting] = useActionState<
    ActionState,
    FormData
  >(async (_prev, formData) => {
    const result = await deleteOrgAction({}, formData);
    if (result && 'success' in result && result.success) {
      mutate('/api/orgs');
    }
    return result ?? {};
  }, {});

  useEffect(() => {
    if (deleteState.success) {
      router.push('/dashboard');
    }
  }, [deleteState.success, router]);

  return (
    <section className="max-w-4xl space-y-4">
      <Card size="dense">
        <CardHeader>
          <CardTitle>重命名组织</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-center justify-between gap-4 rounded-md border bg-surface px-3 py-2">
            <span className="text-xs text-muted-foreground">组织 ID</span>
            <code className="font-mono text-xs">{orgSlug}</code>
          </div>
          <form action={renameAction} noValidate className="space-y-4">
            <input type="hidden" name="orgId" value={orgId} />
            <div>
              <Label htmlFor="org-name">名称</Label>
              <Input
                id="org-name"
                name="name"
                defaultValue={orgName}
                maxLength={100}
                className="mt-1"
                size="sm"
                disabled={!isOwner}
              />
            </div>
            {renameState.error && (
              <p className="text-xs text-destructive">{renameState.error}</p>
            )}
            {renameState.success && (
              <p className="text-xs text-primary">{renameState.success}</p>
            )}
            {isOwner ? (
              <Button
                type="submit"
                variant="outline"
                size="xs"
                disabled={isRenaming}
              >
                {isRenaming ? '保存中…' : '保存'}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                只有组织所有者可以重命名组织。
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      <Card size="dense" className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">删除组织</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            删除 <span className="font-medium">{orgName}</span> 将同时移除{' '}
            {projectCount} 个项目、成员与活动记录，且不可恢复。
          </p>
          {isOwner ? (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive" size="xs">
                  删除组织
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>确认删除组织？</DialogTitle>
                  <DialogDescription>
                    删除「{orgName}」将同时移除 {projectCount}{' '}
                    个项目、成员与活动记录，且不可恢复。
                  </DialogDescription>
                </DialogHeader>
                <form action={deleteAction} className="space-y-3">
                  <input type="hidden" name="orgId" value={orgId} />
                  {deleteState.error ? (
                    <p className="text-xs text-destructive">
                      {deleteState.error}
                    </p>
                  ) : null}
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button type="button" variant="outline" size="xs">
                        取消
                      </Button>
                    </DialogClose>
                    <Button
                      type="submit"
                      variant="destructive"
                      size="xs"
                      disabled={isDeleting}
                    >
                      {isDeleting ? '删除中…' : '确认删除'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ) : (
            <p className="text-xs text-muted-foreground">
              只有组织所有者可以删除组织。
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
