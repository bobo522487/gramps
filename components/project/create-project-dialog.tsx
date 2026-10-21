'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { mutate } from 'swr';
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
import { createProjectAction } from '@/lib/project/actions';
import { regionLabel } from '@/lib/ui/status';

export const PROJECT_REGIONS = [
  'us-east-1',
  'us-west-2',
  'eu-west-1',
  'eu-central-1',
  'ap-northeast-1',
  'ap-southeast-1',
  'sa-east-1',
];

export function CreateProjectDialog({
  orgId,
  open,
  onOpenChange,
}: {
  orgId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    createProjectAction,
    {}
  );

  useEffect(() => {
    if (state.projectRef) {
      mutate(`/api/orgs/${orgId}/projects`);
      onOpenChange(false);
      router.push(`/dashboard/project/${state.projectRef}`);
      router.refresh();
    }
  }, [state.projectRef, orgId, router, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>
            项目隶属于当前组织，用于承载谱系、谱文与谱书。
          </DialogDescription>
        </DialogHeader>
        <form action={action} noValidate className="space-y-4">
          <input type="hidden" name="orgId" value={orgId} />
          <div>
            <Label htmlFor="project-name">名称</Label>
            <Input
              id="project-name"
              name="name"
              placeholder="我的家谱"
              maxLength={100}
            />
          </div>
          <div>
            <Label>区域</Label>
            <Select name="region" defaultValue="us-east-1">
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="选择区域" />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_REGIONS.map((region) => (
                  <SelectItem key={region} value={region}>
                    {regionLabel(region)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              {isPending ? '创建中…' : '创建项目'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
