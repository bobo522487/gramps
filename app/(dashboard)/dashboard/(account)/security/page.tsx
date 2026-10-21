'use client';

import { Loader2, Lock, ShieldCheck, Trash2 } from 'lucide-react';
import { useActionState } from 'react';
import { PageHeader } from '@/components/console/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { deleteAccount, updatePassword } from '@/lib/auth/actions/account';
import type { ActionState } from '@/lib/auth/types';

export default function SecurityPage() {
  const [passwordState, passwordAction, isPasswordPending] = useActionState<
    ActionState,
    FormData
  >(updatePassword, {});

  const [deleteState, deleteAction, isDeletePending] = useActionState<
    ActionState,
    FormData
  >(deleteAccount, {});

  return (
    <section className="space-y-4 p-4 lg:p-6">
      <PageHeader
        icon={ShieldCheck}
        title="安全设置"
        description="修改密码或删除账号。"
      />
      <Card size="dense" className="max-w-2xl">
        <CardHeader>
          <CardTitle>修改密码</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" action={passwordAction} noValidate>
            <div>
              <Label htmlFor="current-password" className="mb-2">
                当前密码
              </Label>
              <Input
                id="current-password"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
                maxLength={100}
              />
            </div>
            <div>
              <Label htmlFor="new-password" className="mb-2">
                新密码
              </Label>
              <Input
                id="new-password"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={100}
              />
            </div>
            <div>
              <Label htmlFor="confirm-password" className="mb-2">
                确认新密码
              </Label>
              <Input
                id="confirm-password"
                name="confirmPassword"
                type="password"
                required
                minLength={8}
                maxLength={100}
              />
            </div>
            {passwordState.error && (
              <p className="text-xs text-destructive">{passwordState.error}</p>
            )}
            {passwordState.success && (
              <p className="text-xs text-primary">{passwordState.success}</p>
            )}
            <Button
              type="submit"
              variant="brand"
              size="xs"
              disabled={isPasswordPending}
            >
              {isPasswordPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  更新中…
                </>
              ) : (
                <>
                  <Lock className="mr-2 h-4 w-4" />
                  更新密码
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card size="dense" className="max-w-2xl border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">删除账号</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            账号删除后无法恢复，请谨慎操作。
          </p>
          <form action={deleteAction} noValidate className="space-y-4">
            <div>
              <Label htmlFor="delete-password" className="mb-2">
                确认密码
              </Label>
              <Input
                id="delete-password"
                name="password"
                type="password"
                required
                minLength={8}
                maxLength={100}
              />
            </div>
            {deleteState.error && (
              <p className="text-xs text-destructive">{deleteState.error}</p>
            )}
            <Button
              type="submit"
              variant="destructive"
              size="xs"
              disabled={isDeletePending}
            >
              {isDeletePending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  删除中…
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  删除账号
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
