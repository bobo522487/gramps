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

const TILES = [
  { bg: '#e0f5ff', fg: '#004869' },
  { bg: '#ffe1f6', fg: '#68024c' },
  { bg: '#feede1', fg: '#5d2702' },
  { bg: '#e8eeff', fg: '#3366ff' },
  { bg: '#e7f8ee', fg: '#067647' },
];

function tileFor(id: string) {
  let hash = 0;
  for (const char of id) {
    hash = (hash + char.charCodeAt(0)) % TILES.length;
  }
  return TILES[hash] ?? TILES[0];
}

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
      <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background px-2 sm:px-4">
        <p className="hidden min-w-0 flex-1 truncate text-sm sm:block">
          <span className="text-muted-foreground">{orgName}</span>
          <span className="px-1.5 text-muted-foreground">/</span>
          <span className="font-semibold">云谱空间</span>
        </p>
        <div className="relative w-full max-w-[420px] flex-none">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索云谱空间"
            aria-label="搜索云谱空间"
            className="h-9 rounded-lg border-[#e7e7e9] bg-white pr-16 pl-8 text-sm shadow-none"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
            Ctrl K
          </kbd>
        </div>
        <div className="hidden flex-1 sm:block" />
      </header>

      <div className="mx-auto w-full max-w-5xl px-4 py-4 md:px-6">
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate text-[13px] leading-5 font-semibold">
            云谱空间
          </h1>
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
          ) : null}
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
          <ul className="mt-4 flex flex-col gap-3">
            {visible.map((project) => {
              const tile = tileFor(project.id);
              return (
                <li key={project.id} className="group relative">
                  <Link
                    href={`/dashboard/project/${project.ref}`}
                    className="flex h-16 items-stretch overflow-hidden rounded-xl border border-[#e7e7e9] outline-none hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <span
                      className="flex w-16 shrink-0 items-center justify-center"
                      style={{ backgroundColor: tile.bg, color: tile.fg }}
                    >
                      <Box className="size-6" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-3 pr-12">
                      <span className="block truncate text-sm font-medium">
                        {project.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {project.themeName ?? '云谱空间'}
                      </span>
                    </span>
                  </Link>
                  {canManage ? (
                    <div className="absolute top-1/2 right-3 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <DeleteProjectButton
                        orgId={orgId}
                        projectId={project.id}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
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
