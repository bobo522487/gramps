'use client';

import { Activity, ChevronRight, LogOut, Shield, UserCog } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR, { mutate } from 'swr';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOut } from '@/lib/auth/actions/session';
import type { SessionUser } from '@/lib/auth/types';
import { fetcher } from '@/lib/fetcher';

const ACCOUNT_ITEMS = [
  { href: '/dashboard/general', icon: UserCog, label: '通用' },
  { href: '/dashboard/activity', icon: Activity, label: '活动' },
  { href: '/dashboard/security', icon: Shield, label: '安全' },
];

export function UserMenu() {
  const { data: user } = useSWR<SessionUser>('/api/user', fetcher);
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    // /api/user now answers 401 after sign-out; clear the cached user instead
    // of keeping stale data from a failed revalidation.
    await mutate('/api/user', null, { revalidate: false });
    router.push('/');
  }

  if (!user) {
    return <Avatar className="size-8" />;
  }

  const initials = (user.name || user.email)
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label="账号菜单"
        >
          <Avatar className="size-8">
            <AvatarImage alt={user.name || user.email} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" size="sm" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="truncate font-medium">{user.name ?? '账号'}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ACCOUNT_ITEMS.map((item) => (
          <DropdownMenuItem key={item.href} asChild>
            <Link href={item.href} className="flex w-full items-center gap-2">
              <item.icon />
              <span className="flex-1">{item.label}</span>
              <ChevronRight className="opacity-50" />
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={(event) => {
            event.preventDefault();
            void handleSignOut();
          }}
        >
          <LogOut />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
