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
import type { ActionState } from '@/lib/auth/types';
import { createOrgAction } from '@/lib/org/actions';

export function CreateOrgDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    createOrgAction,
    {}
  );

  useEffect(() => {
    if (state.orgSlug) {
      mutate('/api/orgs');
      onOpenChange(false);
      router.push(`/dashboard/org/${state.orgSlug}`);
      router.refresh();
    }
  }, [state.orgSlug, router, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建组织</DialogTitle>
          <DialogDescription>组织用于管理成员与项目。</DialogDescription>
        </DialogHeader>
        <form action={action} noValidate className="space-y-4">
          <Input
            name="name"
            placeholder="组织名称"
            maxLength={100}
            aria-label="组织名称"
          />
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
              {isPending ? '创建中…' : '创建'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
