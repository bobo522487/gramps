'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { ActionState } from '@/lib/auth/types';
import { createOrgAction } from '@/lib/org/actions';
import { queryKeys } from '@/lib/query-keys';

export function EmptyOrgState() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    createOrgAction,
    {}
  );

  useEffect(() => {
    if (state.orgSlug) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgs });
      router.push(`/dashboard/org/${state.orgSlug}`);
    }
  }, [state.orgSlug, queryClient, router]);

  return (
    <section className="p-4 lg:p-6">
      <Card size="dense" className="mx-auto mt-12 max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-4 text-primary" />
            创建你的第一个组织
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form action={action} noValidate className="flex gap-2">
            <Input
              name="name"
              placeholder="组织名称"
              maxLength={100}
              size="sm"
              aria-label="组织名称"
            />
            <Button
              type="submit"
              variant="brand"
              size="sm"
              disabled={isPending}
            >
              {isPending ? '创建中…' : '创建'}
            </Button>
          </form>
          {state.error ? (
            <p className="mt-2 text-xs text-destructive">{state.error}</p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
