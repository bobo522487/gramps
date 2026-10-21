'use client';

import { FolderKanban } from 'lucide-react';
import Link from 'next/link';
import { useConsoleScope } from '@/components/console/console-scope';
import { OrgPicker } from '@/components/console/org-picker';
import { ProjectPicker } from '@/components/console/project-picker';
import { UserMenu } from '@/components/console/user-menu';
import { ThemeToggle } from '@/components/theme-toggle';
import { SidebarTrigger } from '@/components/ui/sidebar';

export function ConsoleNavbar() {
  const scope = useConsoleScope();
  const homeHref = scope ? `/dashboard/org/${scope.org.slug}` : '/dashboard';

  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b bg-surface px-2 md:h-12 md:gap-2 md:px-3">
      <SidebarTrigger className="md:hidden" />
      <Link
        href={homeHref}
        className="flex items-center gap-2 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label={scope ? '返回组织首页' : '云谱控制台'}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <FolderKanban className="size-3.5" />
        </span>
        <span className="hidden text-sm font-bold sm:inline">云谱</span>
      </Link>
      {scope ? (
        <>
          <span aria-hidden="true" className="px-0.5 text-muted-foreground">
            /
          </span>
          <OrgPicker />
          {scope.project ? (
            <div className="hidden min-w-0 items-center gap-1 sm:flex">
              <span aria-hidden="true" className="px-0.5 text-muted-foreground">
                /
              </span>
              <ProjectPicker />
            </div>
          ) : null}
        </>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <ThemeToggle size="icon-sm" />
        <UserMenu />
      </div>
    </header>
  );
}
