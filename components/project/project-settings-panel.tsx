'use client';

import { useActionState } from 'react';
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
import type { ActionState } from '@/lib/auth/types';
import { updateProjectAction } from '@/lib/project/actions';
import { statusLabel } from '@/lib/ui/status';

const STATUSES = ['ACTIVE', 'PAUSED', 'ARCHIVED'] as const;

export function ProjectSettingsPanel({
  orgId,
  projectId,
  name,
  status,
  projectRef,
  isOwner,
}: {
  orgId: number;
  projectId: number;
  name: string;
  status: string;
  projectRef: string;
  isOwner: boolean;
}) {
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    updateProjectAction,
    {}
  );

  return (
    <Card size="dense" className="max-w-2xl">
      <CardHeader>
        <CardTitle>项目设置</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center justify-between gap-4 rounded-md border bg-surface px-3 py-2">
          <span className="text-xs text-muted-foreground">项目 ID</span>
          <code className="font-mono text-xs">{projectRef}</code>
        </div>
        <form action={action} noValidate className="space-y-3">
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="projectId" value={projectId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="project-name">名称</Label>
              <Input
                id="project-name"
                name="name"
                defaultValue={name}
                maxLength={100}
                className="mt-1"
                size="sm"
                disabled={!isOwner}
              />
            </div>
            <div>
              <Label>状态</Label>
              <Select name="status" defaultValue={status} disabled={!isOwner}>
                <SelectTrigger className="mt-1" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {statusLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {state.error ? (
            <p className="text-xs text-destructive">{state.error}</p>
          ) : null}
          {state.success ? (
            <p className="text-xs text-primary">{state.success}</p>
          ) : null}
          {isOwner ? (
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
              只有组织所有者可以修改项目设置。
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
