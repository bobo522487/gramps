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
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';

type NavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  exact?: boolean;
};

function SidebarNavGroup({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  if (items.length === 0) {
    return null;
  }
  return (
    <SidebarGroup>
      <SidebarMenu>
        {items.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                <Link href={item.href}>
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}

export function ConsoleSidebar() {
  const scope = useConsoleScope();
  const activeOrg = scope?.org ?? null;
  const activeProject = scope?.project ?? null;

  const orgItems: NavItem[] = activeOrg
    ? [
        {
          href: `/dashboard/org/${activeOrg.slug}`,
          icon: Boxes,
          label: '项目',
          exact: true,
        },
        {
          href: `/dashboard/org/${activeOrg.slug}/team`,
          icon: Users,
          label: '团队',
        },
        {
          href: `/dashboard/org/${activeOrg.slug}/settings`,
          icon: Settings,
          label: '组织设置',
        },
      ]
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
      {activeOrg ? null : (
        <SidebarHeader className="gap-0.5 px-4 py-3 group-data-[collapsible=icon]:hidden">
          <span className="truncate text-xs font-semibold">云谱控制台</span>
          <span className="truncate text-xs text-muted-foreground">账号</span>
        </SidebarHeader>
      )}
      <SidebarContent>
        <SidebarNavGroup items={items} />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
