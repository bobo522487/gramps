'use client';

import { useQueryClient } from '@tanstack/react-query';
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
import { createProjectAction } from '@/lib/project/actions';
import { queryKeys } from '@/lib/query-keys';

export function CreateProjectDialog({
  orgId,
  open,
  onOpenChange,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    createProjectAction,
    {}
  );

  useEffect(() => {
    if (state.projectRef) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects(orgId),
      });
      onOpenChange(false);
      router.push(`/dashboard/project/${state.projectRef}`);
      router.refresh();
    }
  }, [state.projectRef, orgId, queryClient, router, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建云谱空间</DialogTitle>
          <DialogDescription>
            空间隶属于当前组织，用于承载谱系、谱文与谱书。
          </DialogDescription>
        </DialogHeader>
        <form action={action} noValidate className="space-y-4">
          <input type="hidden" name="orgId" value={orgId} />
          <div>
            <Label htmlFor="project-name">空间名称</Label>
            <Input
              id="project-name"
              name="name"
              placeholder="例如：颍川陈氏云谱"
              maxLength={100}
            />
            {state.fieldErrors?.name ? (
              <p className="mt-1 text-xs text-destructive">
                {state.fieldErrors.name}
              </p>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="project-primary-surname">主姓氏</Label>
              <Input
                id="project-primary-surname"
                name="primarySurname"
                placeholder="陈"
                maxLength={30}
              />
              {state.fieldErrors?.primarySurname ? (
                <p className="mt-1 text-xs text-destructive">
                  {state.fieldErrors.primarySurname}
                </p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="project-primary-name">主姓名</Label>
              <Input
                id="project-primary-name"
                name="primaryName"
                placeholder="陈寔"
                maxLength={60}
              />
              {state.fieldErrors?.primaryName ? (
                <p className="mt-1 text-xs text-destructive">
                  {state.fieldErrors.primaryName}
                </p>
              ) : null}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="project-hall">郡望 / 堂号</Label>
              <Input
                id="project-hall"
                name="hallCode"
                placeholder="颍川堂"
                maxLength={60}
              />
            </div>
            <div>
              <Label htmlFor="project-regions">国家 / 地区</Label>
              <Input
                id="project-regions"
                name="countriesRegions"
                placeholder="中国福建"
                maxLength={100}
              />
            </div>
          </div>
          {state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                取消
              </Button>
            </DialogClose>
            <Button type="submit" variant="brand" disabled={isPending}>
              {isPending ? '创建中…' : '创建空间'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
