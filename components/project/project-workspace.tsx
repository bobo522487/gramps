'use client';

import { FolderKanban, Plus, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';
import { EmptyState } from '@/components/console/empty-state';
import { PageHeader } from '@/components/console/page-header';
import { StatusPill } from '@/components/console/status-pill';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ActionState } from '@/lib/auth/types';
import { deleteProjectAction } from '@/lib/project/actions';
import { regionLabel, statusLabel } from '@/lib/ui/status';

export type ProjectView = {
  id: number;
  name: string;
  ref: string;
  region: string;
  status: string;
  health: string;
  /** Display date, e.g. 2026-10-16. */
  createdAt: string;
  /** Full timestamp: day granularity is too coarse to order "newest first". */
  createdAtIso: string;
};

const STATUS_FILTERS = ['ALL', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const;
const SORTS = {
  name: (a: ProjectView, b: ProjectView) =>
    a.name.localeCompare(b.name, 'zh-CN'),
  created: (a: ProjectView, b: ProjectView) =>
    b.createdAtIso.localeCompare(a.createdAtIso),
  status: (a: ProjectView, b: ProjectView) => a.status.localeCompare(b.status),
};

function DeleteProjectButton({
  orgId,
  projectId,
}: {
  orgId: number;
  projectId: number;
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
  isOwner,
}: {
  orgId: number;
  projects: ProjectView[];
  isOwner: boolean;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>('ALL');
  const [sort, setSort] = useState<keyof typeof SORTS>('name');
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects
      .filter((project) => {
        if (status !== 'ALL' && project.status !== status) {
          return false;
        }
        if (!needle) {
          return true;
        }
        return (
          project.name.toLowerCase().includes(needle) ||
          project.ref.toLowerCase().includes(needle)
        );
      })
      .sort(SORTS[sort]);
  }, [projects, query, status, sort]);

  return (
    <section className="p-4 lg:p-6">
      <PageHeader
        icon={FolderKanban}
        title="项目"
        description="项目隶属于当前组织，用于承载谱系、谱文与谱书。"
        badge={<Badge variant="outline">{projects.length}</Badge>}
        actions={
          <Button
            variant="brand"
            size="xs"
            onClick={() => setIsNewProjectOpen(true)}
          >
            <Plus />
            新建项目
          </Button>
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索项目"
            size="sm"
            aria-label="搜索项目"
            className="w-48 pl-7"
          />
        </div>
        <Tabs
          value={status}
          onValueChange={(value) =>
            setStatus(value as (typeof STATUS_FILTERS)[number])
          }
        >
          <TabsList size="sm">
            {STATUS_FILTERS.map((item) => (
              <TabsTrigger key={item} value={item}>
                {item === 'ALL' ? '全部' : statusLabel(item)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select
          value={sort}
          onValueChange={(value) => setSort(value as keyof typeof SORTS)}
        >
          <SelectTrigger size="sm" className="w-32" aria-label="项目排序">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">名称</SelectItem>
            <SelectItem value="created">最新</SelectItem>
            <SelectItem value="status">状态</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {visible.length === 0 ? (
        <Card size="dense" className="mt-4">
          <CardContent>
            <EmptyState
              icon={FolderKanban}
              title={projects.length === 0 ? '还没有项目' : '没有匹配的项目'}
              description={
                projects.length === 0
                  ? '创建第一个项目，开始整理谱系、谱文与谱书。'
                  : '尝试调整状态筛选或清空搜索。'
              }
              action={
                projects.length === 0 ? (
                  <Button
                    variant="brand"
                    size="xs"
                    onClick={() => setIsNewProjectOpen(true)}
                  >
                    <Plus />
                    创建项目
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
                  {isOwner ? (
                    <DeleteProjectButton orgId={orgId} projectId={project.id} />
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill
                    value={project.status}
                    pulse={project.status === 'ACTIVE'}
                  />
                  <StatusPill value={project.health} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {regionLabel(project.region)} ·{' '}
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
