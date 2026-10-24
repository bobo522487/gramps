'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useActionState, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StarRating } from '@/components/ui/star-rating';
import { Textarea } from '@/components/ui/textarea';
import type { ActionState } from '@/lib/auth/types';
import { updateProjectAction } from '@/lib/project/actions';
import {
  MAX_PROJECT_NAME_LENGTH,
  MAX_PROJECT_NOTES_LENGTH,
  MAX_PROJECT_REGIONS_LENGTH,
  PROJECT_STATUS_OPTIONS,
  type ProjectStatus,
} from '@/lib/project/constants';
import { queryKeys } from '@/lib/query-keys';

export function ProjectSettingsPanel({
  orgId,
  projectId,
  name,
  surname,
  themeName,
  hallCode,
  countriesRegions,
  status: initialStatus,
  importance: initialImportance,
  notes,
  projectRef,
  canManage,
}: {
  orgId: string;
  projectId: string;
  name: string;
  surname: string | null;
  themeName: string | null;
  hallCode: string | null;
  countriesRegions: string | null;
  status: ProjectStatus;
  importance: number;
  notes: string | null;
  projectRef: string;
  canManage: boolean;
}) {
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    updateProjectAction,
    {}
  );
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ProjectStatus>(initialStatus);
  const [importance, setImportance] = useState(initialImportance);

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
          <input type="hidden" name="status" value={status} />
          <input type="hidden" name="importance" value={importance} />
          <div>
            <Label htmlFor="project-name">项目名</Label>
            <Input
              id="project-name"
              name="name"
              defaultValue={name}
              maxLength={MAX_PROJECT_NAME_LENGTH}
              className="mt-1"
              size="sm"
              disabled={!canManage}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-sm font-medium">姓氏</p>
              <p id="project-surname" className="text-sm text-muted-foreground">
                {surname ?? '—'}
              </p>
              <p className="text-xs text-muted-foreground">创建后不可修改</p>
            </div>
            <div>
              <p className="text-sm font-medium">主题名</p>
              <p
                id="project-theme-name"
                className="text-sm text-muted-foreground"
              >
                {themeName ?? '—'}
              </p>
              <p className="text-xs text-muted-foreground">创建后不可修改</p>
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
              <Label htmlFor="project-regions">地区</Label>
              <Input
                id="project-regions"
                name="countriesRegions"
                defaultValue={countriesRegions ?? ''}
                maxLength={MAX_PROJECT_REGIONS_LENGTH}
                className="mt-1"
                size="sm"
                disabled={!canManage}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="project-status">状态</Label>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as ProjectStatus)}
              disabled={!canManage}
            >
              <SelectTrigger
                id="project-status"
                aria-label="状态"
                className="mt-1"
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>重要等级</Label>
            <div className="mt-1">
              <StarRating
                value={importance}
                onChange={setImportance}
                disabled={!canManage}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="project-notes">备注</Label>
            <Textarea
              id="project-notes"
              name="notes"
              defaultValue={notes ?? ''}
              maxLength={MAX_PROJECT_NOTES_LENGTH}
              className="mt-1"
              disabled={!canManage}
            />
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
