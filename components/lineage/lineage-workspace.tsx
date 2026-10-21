'use client';

import {
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  Inbox,
  Network,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { EmptyState } from '@/components/console/empty-state';
import { PageHeader } from '@/components/console/page-header';
import { CreateLineageDialog } from '@/components/lineage/create-lineage-dialog';
import { FolderDialog } from '@/components/lineage/folder-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { ActionState } from '@/lib/auth/types';
import { deleteFolderAction } from '@/lib/folder/actions';
import { deleteLineageAction } from '@/lib/lineage/actions';
import { cn } from '@/lib/utils';

export type FolderView = {
  id: string;
  name: string;
  parentId: string | null;
};

export type LineageView = {
  id: string;
  name: string;
  surname: string;
  hallCode: string | null;
  generationWords: string[] | null;
  nodeCount: number;
  folderId: string | null;
  createdAt: string;
};

type FolderDialogState =
  | { mode: 'create'; parentId: string | null }
  | { mode: 'rename'; folder: FolderView }
  | null;

function folderDepth(folder: FolderView, byId: Map<string, FolderView>) {
  let depth = 1;
  let current = folder;
  const seen = new Set<string>([folder.id]);
  while (current.parentId) {
    const parent = byId.get(current.parentId);
    if (!parent || seen.has(parent.id)) {
      break;
    }
    seen.add(parent.id);
    depth += 1;
    current = parent;
  }
  return depth;
}

function DeleteLineageButton({
  orgId,
  lineageId,
  name,
}: {
  orgId: string;
  lineageId: string;
  name: string;
}) {
  const router = useRouter();
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    deleteLineageAction,
    {}
  );

  useEffect(() => {
    if (state.success) {
      router.refresh();
    }
  }, [state.success, router]);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (
          !window.confirm(
            `删除谱系「${name}」？谱系中的人丁会一并归档，且 M1 没有恢复界面。`
          )
        ) {
          event.preventDefault();
        }
      }}
      className="flex flex-col items-end"
    >
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="lineageId" value={lineageId} />
      <Button
        type="submit"
        variant="ghost"
        size="icon-xs"
        disabled={isPending}
        title="删除谱系"
        aria-label="删除谱系"
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 />
      </Button>
      {state.error ? (
        <p className="max-w-40 text-right text-xs text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function DeleteFolderButton({
  orgId,
  folder,
  onDeleted,
}: {
  orgId: string;
  folder: FolderView;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    deleteFolderAction,
    {}
  );

  useEffect(() => {
    if (state.success) {
      onDeleted();
      router.refresh();
    }
  }, [state.success, onDeleted, router]);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (
          !window.confirm(
            `删除分类「${folder.name}」？子分类会一并删除，内容会移入未分类。`
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="folderId" value={folder.id} />
      <Button
        type="submit"
        variant="ghost"
        size="icon-xs"
        disabled={isPending}
        title="删除分类"
        aria-label="删除分类"
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

function FolderTree({
  folders,
  lineages,
  selected,
  onSelect,
}: {
  folders: FolderView[];
  lineages: LineageView[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  const childrenByParent = useMemo(() => {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const map = new Map<string | null, FolderView[]>();
    for (const folder of folders) {
      const parentId =
        folder.parentId && byId.has(folder.parentId) ? folder.parentId : null;
      const bucket = map.get(parentId) ?? [];
      bucket.push(folder);
      map.set(parentId, bucket);
    }
    return map;
  }, [folders]);

  const countByFolder = useMemo(() => {
    const map = new Map<string, number>();
    for (const lineage of lineages) {
      if (lineage.folderId) {
        map.set(lineage.folderId, (map.get(lineage.folderId) ?? 0) + 1);
      }
    }
    return map;
  }, [lineages]);

  const unfiledCount = lineages.filter((lineage) => !lineage.folderId).length;

  function renderNodes(parentId: string | null, depth: number) {
    const nodes = childrenByParent.get(parentId) ?? [];
    return nodes.map((folder) => {
      const children = childrenByParent.get(folder.id) ?? [];
      return (
        <li key={folder.id}>
          <button
            type="button"
            onClick={() => onSelect(folder.id)}
            style={{ paddingLeft: 8 + depth * 14 }}
            className={cn(
              'flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm transition-colors',
              selected === folder.id
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {selected === folder.id ? (
              <FolderOpen className="size-3.5 shrink-0" />
            ) : (
              <FolderIcon className="size-3.5 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            <span className="text-xs tabular-nums">
              {countByFolder.get(folder.id) ?? 0}
            </span>
          </button>
          {children.length > 0 ? (
            <ul>{renderNodes(folder.id, depth + 1)}</ul>
          ) : null}
        </li>
      );
    });
  }

  return (
    <ul className="space-y-0.5">
      <li>
        <button
          type="button"
          onClick={() => onSelect('all')}
          style={{ paddingLeft: 8 }}
          className={cn(
            'flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm transition-colors',
            selected === 'all'
              ? 'bg-primary/10 font-medium text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <Network className="size-3.5 shrink-0" />
          <span className="flex-1">全部谱系</span>
          <span className="text-xs tabular-nums">{lineages.length}</span>
        </button>
      </li>
      {renderNodes(null, 0)}
      <li>
        <button
          type="button"
          onClick={() => onSelect('unfiled')}
          style={{ paddingLeft: 8 }}
          className={cn(
            'flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm transition-colors',
            selected === 'unfiled'
              ? 'bg-primary/10 font-medium text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <Inbox className="size-3.5 shrink-0" />
          <span className="flex-1">未分类</span>
          <span className="text-xs tabular-nums">{unfiledCount}</span>
        </button>
      </li>
    </ul>
  );
}

export function LineageWorkspace({
  orgId,
  projectId,
  projectRef,
  defaultSurname,
  folders,
  lineages,
  canWrite,
  canManageFolders,
}: {
  orgId: string;
  projectId: string;
  projectRef: string;
  defaultSurname: string;
  folders: FolderView[];
  lineages: LineageView[];
  canWrite: boolean;
  canManageFolders: boolean;
}) {
  const [selected, setSelected] = useState('all');
  const [query, setQuery] = useState('');
  const [folderDialog, setFolderDialog] = useState<FolderDialogState>(null);
  const [isLineageDialogOpen, setIsLineageDialogOpen] = useState(false);

  const byId = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders]
  );
  const selectedFolder =
    selected !== 'all' && selected !== 'unfiled'
      ? (byId.get(selected) ?? null)
      : null;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return lineages.filter((lineage) => {
      if (selected === 'unfiled' && lineage.folderId) {
        return false;
      }
      if (selectedFolder && lineage.folderId !== selectedFolder.id) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return (
        lineage.name.toLowerCase().includes(needle) ||
        lineage.surname.toLowerCase().includes(needle) ||
        (lineage.hallCode ?? '').toLowerCase().includes(needle)
      );
    });
  }, [lineages, query, selected, selectedFolder]);

  const selectedTitle =
    selected === 'all'
      ? '全部谱系'
      : selected === 'unfiled'
        ? '未分类'
        : (selectedFolder?.name ?? '谱系');

  const handleFolderDeleted = useCallback(() => setSelected('all'), []);

  return (
    <section className="space-y-4 p-4 lg:p-6">
      <PageHeader
        icon={Network}
        title="谱系"
        description="按分类整理谱系，进入谱系后录入人丁、世次与字辈。"
        badge={<Badge variant="outline">{lineages.length}</Badge>}
        actions={
          canWrite ? (
            <Button
              variant="brand"
              size="xs"
              onClick={() => setIsLineageDialogOpen(true)}
            >
              <Plus />
              新建谱系
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Card size="dense" className="h-fit">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground">
              分类
            </p>
            {canManageFolders ? (
              <Button
                variant="ghost"
                size="icon-xs"
                title="新建分类"
                aria-label="新建分类"
                onClick={() =>
                  setFolderDialog({ mode: 'create', parentId: null })
                }
              >
                <FolderPlus />
              </Button>
            ) : null}
          </div>
          <div className="mt-2">
            <FolderTree
              folders={folders}
              lineages={lineages}
              selected={selected}
              onSelect={setSelected}
            />
          </div>
        </Card>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{selectedTitle}</h2>
              {selectedFolder && canManageFolders ? (
                <>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      setFolderDialog({
                        mode: 'create',
                        parentId: selectedFolder.id,
                      })
                    }
                    disabled={folderDepth(selectedFolder, byId) >= 3}
                    title={
                      folderDepth(selectedFolder, byId) >= 3
                        ? '分类最多支持 3 层'
                        : '新建子分类'
                    }
                  >
                    <FolderPlus />
                    子分类
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title="重命名分类"
                    aria-label="重命名分类"
                    onClick={() =>
                      setFolderDialog({
                        mode: 'rename',
                        folder: selectedFolder,
                      })
                    }
                  >
                    <Pencil />
                  </Button>
                  <DeleteFolderButton
                    orgId={orgId}
                    folder={selectedFolder}
                    onDeleted={handleFolderDeleted}
                  />
                </>
              ) : null}
            </div>
            <div className="relative">
              <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索谱系"
                size="sm"
                aria-label="搜索谱系"
                className="w-48 pl-7"
              />
            </div>
          </div>

          {visible.length === 0 ? (
            <Card size="dense">
              <CardContent>
                <EmptyState
                  icon={Network}
                  title={
                    lineages.length === 0 ? '还没有谱系' : '没有匹配的谱系'
                  }
                  description={
                    lineages.length === 0
                      ? '创建第一个谱系，从录入始祖开始整理家族世系。'
                      : '试试切换分类或清空搜索条件。'
                  }
                  action={
                    lineages.length === 0 && canWrite ? (
                      <Button
                        variant="brand"
                        size="xs"
                        onClick={() => setIsLineageDialogOpen(true)}
                      >
                        <Plus />
                        新建谱系
                      </Button>
                    ) : null
                  }
                />
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {visible.map((lineage) => (
                <Card key={lineage.id} size="dense">
                  <CardContent className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/dashboard/project/${projectRef}/lineages/${lineage.id}`}
                        className="min-w-0 truncate font-medium hover:text-primary"
                      >
                        {lineage.name}
                      </Link>
                      {canWrite ? (
                        <DeleteLineageButton
                          orgId={orgId}
                          lineageId={lineage.id}
                          name={lineage.name}
                        />
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {lineage.surname}氏
                      {lineage.hallCode ? ` · ${lineage.hallCode}` : ''}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">
                        {lineage.nodeCount} 位人丁
                      </Badge>
                      {lineage.generationWords &&
                      lineage.generationWords.length > 0 ? (
                        <span>
                          字辈：{lineage.generationWords.slice(0, 8).join('')}
                          {lineage.generationWords.length > 8 ? '…' : ''}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      创建于 {lineage.createdAt}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {folderDialog ? (
        <FolderDialog
          key={
            folderDialog.mode === 'rename'
              ? `rename-${folderDialog.folder.id}`
              : `create-${folderDialog.parentId ?? 'root'}`
          }
          orgId={orgId}
          projectId={projectId}
          kind={0}
          mode={folderDialog.mode}
          parentId={
            folderDialog.mode === 'create' ? folderDialog.parentId : null
          }
          folder={
            folderDialog.mode === 'rename' ? folderDialog.folder : undefined
          }
          onClose={() => setFolderDialog(null)}
        />
      ) : null}

      {isLineageDialogOpen ? (
        <CreateLineageDialog
          orgId={orgId}
          projectId={projectId}
          projectRef={projectRef}
          defaultSurname={defaultSurname}
          folders={folders}
          defaultFolderId={selectedFolder?.id ?? null}
          onClose={() => setIsLineageDialogOpen(false)}
        />
      ) : null}
    </section>
  );
}
