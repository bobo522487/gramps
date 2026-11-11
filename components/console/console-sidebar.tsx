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
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
}: {
  items: NavItem[];
  label?: string;
}) {
  const pathname = usePathname();
  if (items.length === 0) {
    return null;
  }
  return (
    <SidebarGroup>
      {label ? (
        <SidebarGroupLabel className="text-[11px] tracking-wide text-muted-foreground">
          {label}
        </SidebarGroupLabel>
      ) : null}
      <SidebarMenu>
        {items.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={active}
                tooltip={item.label}
                className="data-[active=true]:bg-sky-100 data-[active=true]:text-foreground"
              >
                <Link href={item.href}>
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
              {item.count === undefined ? null : (
                <SidebarMenuBadge>{item.count}</SidebarMenuBadge>
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
  if (!user) {
    return null;
  }
  const initials = (user.name || user.email).slice(0, 2).toUpperCase();
  return (
    <Link
      href="/dashboard/general"
      className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <Avatar size="sm" className="bg-sky-500 text-white">
        <AvatarFallback className="bg-sky-500 text-[10px] text-white">
          {initials}
        </AvatarFallback>
      </Avatar>
      <span className="truncate text-xs text-muted-foreground">
        {user.email}
      </span>
    </Link>
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
      className="top-12 bottom-auto h-[calc(100svh-3rem)]"
    >
      {showDirectory ? (
        <SidebarHeader className="px-2 py-3 group-data-[collapsible=icon]:hidden">
          <OrgPicker variant="directory" />
        </SidebarHeader>
      ) : activeOrg ? null : (
        <SidebarHeader className="gap-0.5 px-4 py-3 group-data-[collapsible=icon]:hidden">
          <span className="truncate text-xs font-semibold">云谱控制台</span>
          <span className="truncate text-xs text-muted-foreground">账号</span>
        </SidebarHeader>
      )}
      <SidebarContent>
        <SidebarNavGroup
          items={items}
          label={showDirectory ? '组织' : undefined}
        />
      </SidebarContent>
      {showDirectory ? (
        <SidebarFooter className="border-t group-data-[collapsible=icon]:hidden">
          <DirectoryUser />
        </SidebarFooter>
      ) : null}
      <SidebarRail />
    </Sidebar>
  );
}
