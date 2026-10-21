'use client';

import { Loader2, UserCog } from 'lucide-react';
import { Suspense, useActionState, useEffect } from 'react';
import useSWR, { mutate } from 'swr';
import { PageHeader } from '@/components/console/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateAccount } from '@/lib/auth/actions/account';
import type { ActionState, SessionUser } from '@/lib/auth/types';
import { fetcher } from '@/lib/fetcher';

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
          name="email"
          type="email"
          placeholder="请输入邮箱"
          defaultValue={state.email || emailValue}
        />
        {state.fieldErrors?.email && (
          <p className="mt-1 text-xs text-destructive">
            {state.fieldErrors.email}
          </p>
        )}
      </div>
      <div>
        <Label htmlFor="currentPassword" className="mb-2">
          当前密码
        </Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          placeholder="仅修改邮箱时需要"
          maxLength={100}
        />
        {state.fieldErrors?.currentPassword && (
          <p className="mt-1 text-xs text-destructive">
            {state.fieldErrors.currentPassword}
          </p>
        )}
      </div>
    </>
  );
}

function AccountFormWithData({ state }: { state: ActionState }) {
  const { data: user } = useSWR<SessionUser>('/api/user', fetcher);

  useEffect(() => {
    if (state.success) {
      // revalidatePath refreshes the RSC tree, but the user menu reads this
      // endpoint through SWR and needs its cache invalidated too.
      void mutate('/api/user');
    }
  }, [state.success]);

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
        description="姓名与邮箱用于登录，并会显示在组织成员列表中。"
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
