'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Loader2, UserCog } from 'lucide-react';
import { Suspense, useActionState, useEffect } from 'react';
import { PageHeader } from '@/components/console/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSessionUser } from '@/hooks/use-session-user';
import { updateAccount } from '@/lib/auth/actions/account';
import type { ActionState } from '@/lib/auth/types';
import { queryKeys } from '@/lib/query-keys';

type AccountFormProps = {
  state: ActionState;
  nameValue?: string;
  emailValue?: string;
};

function AccountForm({
  state,
  nameValue = '',
  emailValue = '',
}: AccountFormProps) {
  return (
    <>
      <div>
        <Label htmlFor="name" className="mb-2">
          姓名
        </Label>
        <Input
          id="name"
          name="name"
          placeholder="请输入姓名"
          defaultValue={state.name || nameValue}
        />
      </div>
      <div>
        <Label htmlFor="email" className="mb-2">
          邮箱
        </Label>
        <Input
          id="email"
          type="email"
          value={emailValue}
          readOnly
          disabled
          aria-describedby="email-hint"
        />
        <p id="email-hint" className="text-muted-foreground mt-1 text-xs">
          登录邮箱暂不支持修改。
        </p>
      </div>
    </>
  );
}

function AccountFormWithData({ state }: { state: ActionState }) {
  const { data: user } = useSessionUser();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (state.success) {
      // revalidatePath refreshes the RSC tree; the user menu reads the same
      // query, so refresh that cache as well.
      void queryClient.invalidateQueries({ queryKey: queryKeys.user });
    }
  }, [state.success, queryClient]);

  return (
    <AccountForm
      state={state}
      nameValue={user?.name ?? ''}
      emailValue={user?.email ?? ''}
    />
  );
}

export default function GeneralPage() {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    updateAccount,
    {}
  );

  return (
    <section className="space-y-4 p-4 lg:p-6">
      <PageHeader
        icon={UserCog}
        title="通用设置"
        description="姓名会显示在组织成员列表中；邮箱用于登录，暂不支持修改。"
      />

      <Card size="dense" className="max-w-2xl">
        <CardHeader>
          <CardTitle>账号信息</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" action={formAction} noValidate>
            <Suspense fallback={<AccountForm state={state} />}>
              <AccountFormWithData state={state} />
            </Suspense>
            {state.error && (
              <p className="text-xs text-destructive">{state.error}</p>
            )}
            {state.success && (
              <p className="text-xs text-primary">{state.success}</p>
            )}
            <Button
              type="submit"
              variant="brand"
              size="xs"
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  保存中…
                </>
              ) : (
                '保存修改'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
