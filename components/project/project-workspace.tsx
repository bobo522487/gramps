'use client';

import { Box, Plus, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/components/console/empty-state';
import { CreateProjectDialog } from '@/components/project/create-project-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ActionState } from '@/lib/auth/types';
import { deleteProjectAction } from '@/lib/project/actions';

export type ProjectView = {
  id: string;
  name: string;
  ref: string;
  themeName: string | null;
  surname: string | null;
  hallCode: string | null;
  countriesRegions: string | null;
  /** Display date, e.g. 2026-10-16. */
  createdAt: string;
  /** Full timestamp: day granularity is too coarse to order "newest first". */
  createdAtIso: string;
};

const SORTS = {
  name: (a: ProjectView, b: ProjectView) =>
    a.name.localeCompare(b.name, 'zh-CN'),
  created: (a: ProjectView, b: ProjectView) =>
    b.createdAtIso.localeCompare(a.createdAtIso),
};

function DeleteProjectButton({
  orgId,
  projectId,
}: {
  orgId: string;
  projectId: string;
}) {
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    deleteProjectAction,
    {}
  );

  return (
    <form action={action} className="flex flex-col items-end">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="projectId" value={projectId} />
      <Button
        type="submit"
        variant="ghost"
        size="icon-xs"
        disabled={isPending}
        title="删除项目"
        aria-label="删除项目"
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 />
      </Button>
      {state.error ? (
        <p className="text-xs text-destructive">{state.error}</p>
      ) : null}
    </form>
  );
}

export function ProjectWorkspace({
  orgId,
  orgName,
  projects,
  canManage,
}: {
  orgId: string;
  orgName: string;
  projects: ProjectView[];
  canManage: boolean;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<keyof typeof SORTS>('name');
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() !== 'k' ||
        !(event.metaKey || event.ctrlKey)
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"]')) {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects
      .filter((project) => {
        if (!needle) {
          return true;
        }
        return (
          project.name.toLowerCase().includes(needle) ||
          project.ref.toLowerCase().includes(needle) ||
          project.themeName?.toLowerCase().includes(needle) ||
          project.surname?.toLowerCase().includes(needle)
        );
      })
      .sort(SORTS[sort]);
  }, [projects, query, sort]);

  return (
    <section className="min-h-full bg-background">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background px-4">
        <p className="hidden shrink-0 text-sm sm:block">
          <span className="font-medium">{orgName}</span>
          <span className="px-1.5 text-muted-foreground">/</span>
          <span className="text-muted-foreground">云谱空间</span>
        </p>
        <div className="relative mx-auto w-full max-w-[308px]">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索云谱空间"
            aria-label="搜索云谱空间"
            className="h-8 rounded-md border-[#e7e7e9] bg-white pr-14 pl-8 text-sm shadow-none"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
            Ctrl K
          </kbd>
        </div>
        {canManage ? (
          <Button
            variant="brand"
            size="sm"
            className="h-8 shrink-0 rounded-lg px-2.5 font-semibold"
            onClick={() => setIsNewProjectOpen(true)}
          >
            <Plus />
            新建空间
          </Button>
        ) : (
          <span className="w-8 shrink-0" />
        )}
      </header>

      <div className="px-6 py-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-sm font-medium">云谱空间</h1>
            <p className="text-xs text-muted-foreground">当前组织</p>
          </div>
          <Select
            value={sort}
            onValueChange={(value) => setSort(value as keyof typeof SORTS)}
          >
            <SelectTrigger size="sm" className="w-28" aria-label="空间排序">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">名称</SelectItem>
              <SelectItem value="created">最新</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {visible.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed">
            <EmptyState
              icon={Box}
              title={
                projects.length === 0 ? '还没有云谱空间' : '没有匹配的空间'
              }
              description={
                projects.length === 0
                  ? '创建第一个云谱空间，开始整理谱系、谱文与谱书。'
                  : '试试清空搜索条件。'
              }
              action={
                projects.length === 0 && canManage ? (
                  <Button
                    variant="brand"
                    size="xs"
                    onClick={() => setIsNewProjectOpen(true)}
                  >
                    <Plus />
                    创建空间
                  </Button>
                ) : null
              }
            />
          </div>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-3">
            {visible.map((project) => (
              <li key={project.id} className="group relative w-[369px]">
                <Link
                  href={`/dashboard/project/${project.ref}`}
                  className="flex h-[66px] items-center gap-3 rounded-xl bg-[#f9f9fa] px-3 outline-none hover:bg-[#f3f3f4] focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#e8eeff] text-[#3366ff]">
                    <Box className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {project.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {project.themeName ?? '云谱空间'}
                    </span>
                  </span>
                </Link>
                {canManage ? (
                  <div className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <DeleteProjectButton orgId={orgId} projectId={project.id} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <CreateProjectDialog
        orgId={orgId}
        open={isNewProjectOpen}
        onOpenChange={setIsNewProjectOpen}
      />
    </section>
  );
}
