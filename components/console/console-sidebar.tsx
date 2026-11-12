'use client';

import {
  BookOpen,
  Boxes,
  FileText,
  Home,
  type LucideIcon,
  Network,
  Settings,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useConsoleScope } from '@/components/console/console-scope';
import { orgDirectoryItems } from '@/components/console/org-directory';
import { OrgPicker } from '@/components/console/org-picker';
import { UserMenu } from '@/components/console/user-menu';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { useSessionUser } from '@/hooks/use-session-user';

type NavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  exact?: boolean;
  count?: number;
};

function SidebarNavGroup({
  items,
  label,
  directory = false,
}: {
  items: NavItem[];
  label?: string;
  directory?: boolean;
}) {
  const pathname = usePathname();
  if (items.length === 0) {
    return null;
  }
  return (
    <SidebarGroup className={directory ? 'px-2 py-0' : undefined}>
      {label ? (
        <SidebarGroupLabel className="h-8 pl-5 text-[11px] font-medium tracking-normal text-[#6a7184]">
          {label}
        </SidebarGroupLabel>
      ) : null}
      <SidebarMenu className={directory ? 'gap-0' : undefined}>
        {items.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <SidebarMenuItem
              key={item.href}
              className={directory ? 'my-0.5' : undefined}
            >
              <SidebarMenuButton
                asChild
                isActive={active}
                tooltip={item.label}
                className={
                  directory
                    ? 'h-8 rounded-md text-[13px] font-semibold text-[#374151] data-[active=true]:bg-[#e7e7e9] data-[active=true]:text-[#1f293a]'
                    : undefined
                }
              >
                <Link href={item.href}>
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
              {item.count === undefined ? null : (
                <SidebarMenuBadge
                  className={
                    directory ? 'font-normal text-[#6a7184]' : undefined
                  }
                >
                  {item.count}
                </SidebarMenuBadge>
              )}
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function DirectoryUser() {
  const { data: user } = useSessionUser();
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <UserMenu avatarClassName="size-6" />
      <div className="min-w-0 flex-1 px-1">
        <div className="truncate text-sm text-[#1f293a]">
          {user?.name || '账号'}
        </div>
        <div className="truncate text-xs text-[#6a7184]">{user?.email}</div>
      </div>
      <ThemeToggle size="icon-sm" className="size-8 shrink-0" />
    </div>
  );
}

export function ConsoleSidebar() {
  const scope = useConsoleScope();
  const activeOrg = scope?.org ?? null;
  const activeProject = scope?.project ?? null;
  const showDirectory = Boolean(activeOrg && !activeProject);

  const orgItems: NavItem[] = activeOrg
    ? orgDirectoryItems(activeOrg).map((item) => ({
        ...item,
        icon: item.href.endsWith('/team')
          ? Users
          : item.href.endsWith('/settings')
            ? Settings
            : Boxes,
      }))
    : [];

  const projectItems: NavItem[] = activeProject
    ? [
        {
          href: `/dashboard/project/${activeProject.ref}`,
          icon: Home,
          label: '概览',
          exact: true,
        },
        {
          href: `/dashboard/project/${activeProject.ref}/lineages`,
          icon: Network,
          label: '谱系',
        },
        {
          href: `/dashboard/project/${activeProject.ref}/articles`,
          icon: FileText,
          label: '谱文',
        },
        {
          href: `/dashboard/project/${activeProject.ref}/books`,
          icon: BookOpen,
          label: '谱书',
        },
        {
          href: `/dashboard/project/${activeProject.ref}/settings`,
          icon: Settings,
          label: '项目设置',
        },
      ]
    : [];

  const items = activeProject ? projectItems : orgItems;

  return (
    <Sidebar
      collapsible="icon"
      className={
        showDirectory ? undefined : 'top-12 bottom-auto h-[calc(100svh-3rem)]'
      }
    >
      {showDirectory ? (
        <SidebarHeader className="h-14 flex-row items-center gap-0 border-b px-2 py-0 group-data-[collapsible=icon]:hidden">
          <OrgPicker variant="directory" />
        </SidebarHeader>
      ) : activeOrg ? null : (
        <SidebarHeader className="gap-0.5 px-4 py-3 group-data-[collapsible=icon]:hidden">
          <span className="truncate text-xs font-semibold">云谱控制台</span>
          <span className="truncate text-xs text-muted-foreground">账号</span>
        </SidebarHeader>
      )}
      <SidebarContent className={showDirectory ? 'pt-2' : undefined}>
        <SidebarNavGroup
          items={items}
          label={showDirectory ? '组织' : undefined}
          directory={showDirectory}
        />
      </SidebarContent>
      {showDirectory ? (
        <SidebarFooter className="border-t px-2 py-1.5 group-data-[collapsible=icon]:hidden">
          <DirectoryUser />
        </SidebarFooter>
      ) : null}
      <SidebarRail />
    </Sidebar>
  );
}
