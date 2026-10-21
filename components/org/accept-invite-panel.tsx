'use client';

import { Loader2, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ActionState } from '@/lib/auth/types';
import { acceptInviteAction } from '@/lib/org/actions';

export function AcceptInvitePanel({ token }: { token: string }) {
  const router = useRouter();
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    acceptInviteAction,
    {}
  );

  useEffect(() => {
    if (state.success) {
      router.push('/dashboard');
      router.refresh();
    }
  }, [state.success, router]);

  return (
    <Card size="dense" className="max-w-md">
      <CardHeader>
        <CardTitle>接受组织邀请</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          接受后你会成为该组织的成员，并可以在控制台中切换到这个组织。
        </p>
        <form action={action}>
          <input type="hidden" name="token" value={token} />
          {state.error ? (
            <p className="mb-3 text-xs text-destructive">{state.error}</p>
          ) : null}
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              variant="brand"
              size="xs"
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="animate-spin" />
                  接受中…
                </>
              ) : (
                <>
                  <UserPlus />
                  接受邀请
                </>
              )}
            </Button>
            <Button asChild variant="ghost" size="xs">
              <Link href="/dashboard">返回控制台</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
