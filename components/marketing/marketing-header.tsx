'use client';

import { FolderKanban } from 'lucide-react';
import Link from 'next/link';
import useSWR from 'swr';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import type { SessionUser } from '@/lib/auth/types';
import { fetcher } from '@/lib/fetcher';

export function MarketingHeader() {
  const { data: user } = useSWR<SessionUser>('/api/user', fetcher);

  return (
    <header className="border-b bg-surface">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
            <FolderKanban className="size-4" />
          </span>
          <span className="text-xl font-semibold">云谱</span>
        </Link>
        <div className="flex items-center gap-2">
          {user ? (
            <Button asChild variant="brand">
              <Link href="/dashboard">控制台</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost">
                <Link href="/sign-in">登录</Link>
              </Button>
              <Button asChild variant="brand">
                <Link href="/sign-up">免费注册</Link>
              </Button>
            </>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
