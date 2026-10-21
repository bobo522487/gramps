'use client';

import { CircleIcon, Eye, EyeOff, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useActionState, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signIn, signUp } from '@/lib/auth/actions/session';
import type { ActionState } from '@/lib/auth/types';

// Only these survive a mode switch; they drive post-auth redirects.
const PASSTHROUGH_PARAMS = ['redirect', 'invite'] as const;

export function Login({ mode = 'signin' }: { mode?: 'signin' | 'signup' }) {
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    mode === 'signin' ? signIn : signUp,
    { error: '' }
  );

  const paramsFor = (key: string) => searchParams.get(key) ?? '';
  const invite = paramsFor('invite');

  const switchParams = new URLSearchParams();
  for (const key of PASSTHROUGH_PARAMS) {
    const value = paramsFor(key);
    if (value) switchParams.set(key, value);
  }
  const switchHref = `${mode === 'signin' ? '/sign-up' : '/sign-in'}${
    switchParams.size > 0 ? `?${switchParams.toString()}` : ''
  }`;

  const emailError = state.fieldErrors?.email;
  const passwordError = state.fieldErrors?.password;

  return (
    <div className="bg-shell flex min-h-[100dvh] flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-6 flex items-center gap-2" aria-label="首页">
        <CircleIcon className="size-10 text-brand" />
        <span className="text-lg font-semibold">云谱</span>
      </Link>

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1 className="text-center text-xl leading-none font-semibold tracking-tight">
              {mode === 'signin' ? '登录云谱' : '创建账号'}
            </h1>
          </CardTitle>
          <CardDescription className="text-center">
            {mode === 'signin'
              ? '输入账号信息以进入控制台。'
              : '注册后即可开始整理你的家族谱系。'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form action={formAction} noValidate className="space-y-4">
            {PASSTHROUGH_PARAMS.map((key) =>
              paramsFor(key) ? (
                <input
                  key={key}
                  type="hidden"
                  name={key}
                  value={paramsFor(key)}
                />
              ) : null
            )}

            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                defaultValue={state.email}
                maxLength={255}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? 'email-error' : undefined}
                placeholder="you@example.com"
              />
              {emailError && (
                <p id="email-error" className="text-destructive text-sm">
                  {emailError}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={
                    mode === 'signin' ? 'current-password' : 'new-password'
                  }
                  minLength={8}
                  maxLength={100}
                  aria-invalid={passwordError ? true : undefined}
                  aria-describedby={
                    passwordError ? 'password-error' : undefined
                  }
                  placeholder={mode === 'signin' ? '输入密码' : '至少 8 个字符'}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPassword}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 -translate-y-1/2 p-2"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
              {passwordError && (
                <p id="password-error" className="text-destructive text-sm">
                  {passwordError}
                </p>
              )}
            </div>

            {state.error && !emailError && !passwordError && (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              variant="brand"
              size="lg"
              className="w-full"
              disabled={pending}
            >
              {pending ? (
                <>
                  <Loader2 className="animate-spin" />
                  {mode === 'signin' ? '登录中…' : '创建中…'}
                </>
              ) : mode === 'signin' ? (
                '登录'
              ) : (
                '注册'
              )}
            </Button>
          </form>

          {invite && (
            <p className="text-muted-foreground mt-3 text-sm">
              {mode === 'signup'
                ? '你正在通过邀请加入一个组织，请使用被邀请的邮箱注册。'
                : '登录后将进入邀请确认页。'}
            </p>
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground mt-6 text-sm">
        {mode === 'signin' ? '还没有账号？ ' : '已经有账号？ '}
        <Link
          href={switchHref}
          className="text-primary font-medium underline underline-offset-4"
        >
          {mode === 'signin' ? '注册' : '登录'}
        </Link>
      </p>
    </div>
  );
}
