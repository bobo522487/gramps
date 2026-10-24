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
          <DialogTitle>创建云谱项目</DialogTitle>
          <DialogDescription>
            项目隶属于当前组织；姓氏与主题名创建后不可修改。
          </DialogDescription>
        </DialogHeader>
        <form action={action} noValidate className="space-y-4">
          <input type="hidden" name="orgId" value={orgId} />
          <div>
            <Label htmlFor="project-name">项目名</Label>
            <Input
              id="project-name"
              name="name"
              placeholder="例如：颍川陈氏云谱"
              maxLength={24}
            />
            {state.fieldErrors?.name ? (
              <p className="mt-1 text-xs text-destructive">
                {state.fieldErrors.name}
              </p>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="project-surname">姓氏</Label>
              <Input
                id="project-surname"
                name="surname"
                placeholder="陈"
                maxLength={30}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                创建后不可修改
              </p>
              {state.fieldErrors?.surname ? (
                <p className="mt-1 text-xs text-destructive">
                  {state.fieldErrors.surname}
                </p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="project-theme-name">主题名</Label>
              <Input
                id="project-theme-name"
                name="themeName"
                placeholder="义门陈氏宗谱"
                maxLength={60}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                创建后不可修改
              </p>
              {state.fieldErrors?.themeName ? (
                <p className="mt-1 text-xs text-destructive">
                  {state.fieldErrors.themeName}
                </p>
              ) : null}
            </div>
          </div>
          <div>
            <Label htmlFor="project-regions">地区</Label>
            <Input
              id="project-regions"
              name="countriesRegions"
              placeholder="中国福建"
              maxLength={100}
            />
            {state.fieldErrors?.countriesRegions ? (
              <p className="mt-1 text-xs text-destructive">
                {state.fieldErrors.countriesRegions}
              </p>
            ) : null}
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
              {isPending ? '创建中…' : '确定'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
