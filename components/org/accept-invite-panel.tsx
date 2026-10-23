'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Loader2, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ActionState } from '@/lib/auth/types';
import { acceptInviteAction } from '@/lib/org/actions';
import type { InvitationDetails } from '@/lib/org/invitations';
import { queryKeys } from '@/lib/query-keys';

const ROLE_LABELS: Record<string, string> = {
  owner: '所有者',
  admin: '管理员',
  editor: '编辑',
  viewer: '查看者',
};

type AcceptInvitePanelProps =
  | { invitation: InvitationDetails; error?: never }
  | { invitation?: never; error: string };

export function AcceptInvitePanel(props: AcceptInvitePanelProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    acceptInviteAction,
    {}
  );

  useEffect(() => {
    if (state.success) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgs });
      router.push('/dashboard');
      router.refresh();
    }
  }, [state.success, queryClient, router]);

  return (
    <Card size="dense" className="max-w-md">
      <CardHeader>
        <CardTitle>接受组织邀请</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.invitation ? (
          <>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">组织</dt>
                <dd className="font-medium">
                  {props.invitation.organizationName}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">邀请邮箱</dt>
                <dd>{props.invitation.email}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">角色</dt>
                <dd>
                  {ROLE_LABELS[props.invitation.role] ?? props.invitation.role}
                </dd>
              </div>
            </dl>
            <p className="text-sm text-muted-foreground">
              接受后你会成为该组织的成员，并可以在控制台中切换到这个组织。
            </p>
            <form action={action}>
              <input
                type="hidden"
                name="invitationId"
                value={props.invitation.id}
              />
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
          </>
        ) : (
          <>
            <p className="text-sm text-destructive">{props.error}</p>
            <p className="text-sm text-muted-foreground">
              邀请可能已过期、已被使用，或不属于当前登录账号。
            </p>
            <Button asChild variant="ghost" size="xs">
              <Link href="/dashboard">返回控制台</Link>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
