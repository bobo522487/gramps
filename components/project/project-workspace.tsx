'use client';

import { FolderKanban, Plus, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';
import { EmptyState } from '@/components/console/empty-state';
import { PageHeader } from '@/components/console/page-header';
import { CreateProjectDialog } from '@/components/project/create-project-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
  projects,
  canManage,
}: {
  orgId: string;
  projects: ProjectView[];
  canManage: boolean;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<keyof typeof SORTS>('name');
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);

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
    <section className="p-4 lg:p-6">
      <PageHeader
        icon={FolderKanban}
        title="云谱空间"
        description="空间隶属于当前组织，用于承载谱系、谱文与谱书。"
        badge={<Badge variant="outline">{projects.length}</Badge>}
        actions={
          canManage ? (
            <Button
              variant="brand"
              size="xs"
              onClick={() => setIsNewProjectOpen(true)}
            >
              <Plus />
              新建空间
            </Button>
          ) : null
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索空间"
            size="sm"
            aria-label="搜索空间"
            className="w-48 pl-7"
          />
        </div>
        <Select
          value={sort}
          onValueChange={(value) => setSort(value as keyof typeof SORTS)}
        >
          <SelectTrigger size="sm" className="w-32" aria-label="空间排序">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">名称</SelectItem>
            <SelectItem value="created">最新</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {visible.length === 0 ? (
        <Card size="dense" className="mt-4">
          <CardContent>
            <EmptyState
              icon={FolderKanban}
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
          </CardContent>
        </Card>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((project) => (
            <Card key={project.id} size="dense">
              <CardContent className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/dashboard/project/${project.ref}`}
                    className="min-w-0 truncate font-medium hover:text-primary"
                  >
                    {project.name}
                  </Link>
                  {canManage ? (
                    <DeleteProjectButton orgId={orgId} projectId={project.id} />
                  ) : null}
                </div>
                <p className="text-sm">
                  {project.themeName ?? '未填写主题名'}
                  {project.hallCode ? ` · ${project.hallCode}` : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  {project.surname ? `${project.surname}氏` : '未填写姓氏'} ·{' '}
                  {project.countriesRegions ?? '未填写地区'} ·{' '}
                  <span className="font-mono">{project.ref}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  创建于 {project.createdAt}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateProjectDialog
        orgId={orgId}
        open={isNewProjectOpen}
        onOpenChange={setIsNewProjectOpen}
      />
    </section>
  );
}
