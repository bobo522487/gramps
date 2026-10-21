'use client';

import { Box, Check, ChevronsUpDown, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  useConsoleProjects,
  useConsoleScope,
} from '@/components/console/console-scope';
import { CreateProjectDialog } from '@/components/project/create-project-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ProjectPicker() {
  const scope = useConsoleScope();
  const orgId = scope?.org.id ?? null;
  const projectId = scope?.project?.id ?? null;
  const { data: projects } = useConsoleProjects(orgId);
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [query, setQuery] = useState('');

  const active =
    projects?.find((project) => project.id === projectId) ??
    scope?.project ??
    null;
  const filtered = useMemo(() => {
    const list = projects ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return list;
    }
    return list.filter(
      (project) =>
        project.name.toLowerCase().includes(needle) ||
        project.ref.toLowerCase().includes(needle)
    );
  }, [projects, query]);

  if (!orgId || !active) {
    return null;
  }

  return (
    <>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(next) => {
          setMenuOpen(next);
          if (!next) {
            setQuery('');
          }
        }}
      >
        <div className="flex min-w-0 items-center">
          <Link
            href={`/dashboard/project/${active.ref}`}
            className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Box className="size-4 shrink-0 text-muted-foreground" />
            <span className="max-w-[120px] truncate sm:max-w-[200px]">
              {active.name}
            </span>
          </Link>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              aria-label="切换项目"
            >
              <ChevronsUpDown className="size-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
        </div>
        <DropdownMenuContent align="start" size="sm" className="w-60">
          <DropdownMenuSearch
            value={query}
            onValueChange={setQuery}
            onEnter={() => {
              const target = filtered[0];
              if (target) {
                setMenuOpen(false);
                router.push(`/dashboard/project/${target.ref}`);
              }
            }}
            placeholder="搜索项目"
          />
          <DropdownMenuGroup>
            {filtered.map((project) => (
              <DropdownMenuItem key={project.id} asChild>
                <Link
                  href={`/dashboard/project/${project.ref}`}
                  className="flex w-full items-center gap-2"
                >
                  <span className="flex-1 truncate">{project.name}</span>
                  {project.id === projectId ? (
                    <Check className="size-3.5 text-primary" />
                  ) : null}
                </Link>
              </DropdownMenuItem>
            ))}
            {filtered.length === 0 ? (
              <DropdownMenuLabel className="text-muted-foreground font-normal">
                没有匹配的项目
              </DropdownMenuLabel>
            ) : null}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setMenuOpen(false);
              setIsCreateOpen(true);
            }}
          >
            <Plus />
            新建项目
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateProjectDialog
        orgId={orgId}
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
      />
    </>
  );
}
