'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useActionState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionState } from '@/lib/auth/types';
import { updateProjectAction } from '@/lib/project/actions';
import { queryKeys } from '@/lib/query-keys';

export function ProjectSettingsPanel({
  orgId,
  projectId,
  name,
  primaryName,
  primarySurname,
  hallCode,
  countriesRegions,
  projectRef,
  canManage,
}: {
  orgId: string;
  projectId: string;
  name: string;
  primaryName: string;
  primarySurname: string;
  hallCode: string | null;
  countriesRegions: string | null;
  projectRef: string;
  canManage: boolean;
}) {
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    updateProjectAction,
    {}
  );
  const queryClient = useQueryClient();

  useEffect(() => {
    if (state.success) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects(orgId),
      });
    }
  }, [state.success, orgId, queryClient]);

  return (
    <Card size="dense" className="max-w-2xl">
      <CardHeader>
        <CardTitle>空间设置</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center justify-between gap-4 rounded-md border bg-surface px-3 py-2">
          <span className="text-xs text-muted-foreground">项目 ID</span>
          <code className="font-mono text-xs">{projectRef}</code>
        </div>
        <form action={action} noValidate className="space-y-3">
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="projectId" value={projectId} />
          <div>
            <Label htmlFor="project-name">空间名称</Label>
            <Input
              id="project-name"
              name="name"
              defaultValue={name}
              maxLength={100}
              className="mt-1"
              size="sm"
              disabled={!canManage}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="project-primary-surname">主姓氏</Label>
              <Input
                id="project-primary-surname"
                name="primarySurname"
                defaultValue={primarySurname}
                maxLength={30}
                className="mt-1"
                size="sm"
                disabled={!canManage}
              />
            </div>
            <div>
              <Label htmlFor="project-primary-name">主姓名</Label>
              <Input
                id="project-primary-name"
                name="primaryName"
                defaultValue={primaryName}
                maxLength={60}
                className="mt-1"
                size="sm"
                disabled={!canManage}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="project-hall">郡望 / 堂号</Label>
              <Input
                id="project-hall"
                name="hallCode"
                defaultValue={hallCode ?? ''}
                maxLength={60}
                className="mt-1"
                size="sm"
                disabled={!canManage}
              />
            </div>
            <div>
              <Label htmlFor="project-regions">国家 / 地区</Label>
              <Input
                id="project-regions"
                name="countriesRegions"
                defaultValue={countriesRegions ?? ''}
                maxLength={100}
                className="mt-1"
                size="sm"
                disabled={!canManage}
              />
            </div>
          </div>
          {state.error ? (
            <p className="text-xs text-destructive">{state.error}</p>
          ) : null}
          {state.success ? (
            <p className="text-xs text-primary">{state.success}</p>
          ) : null}
          {canManage ? (
            <Button
              type="submit"
              variant="outline"
              size="xs"
              disabled={isPending}
            >
              {isPending ? '保存中…' : '保存'}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              只有所有者或管理员可以修改空间设置。
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
