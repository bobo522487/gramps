'use client';

import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  GitBranch,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { CreateLineageDialog } from '@/components/lineage/create-lineage-dialog';
import { useLineageStore } from '@/components/lineage/lineage-store';
import {
  buildLineageTree,
  filterLineageTree,
  type LineageTreeFolder,
  type TreeFolderInput,
  type TreeLineageInput,
} from '@/components/lineage/lineage-tree';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  createFolderAction,
  deleteFolderAction,
  renameFolderAction,
} from '@/lib/folder/actions';
import {
  deleteLineageAction,
  updateLineageAction,
} from '@/lib/lineage/actions';
import { cn } from '@/lib/utils';

export type LineageSidebarProps = {
  orgId: string;
  projectId: string;
  projectRef: string;
  defaultSurname: string;
  folders: TreeFolderInput[];
  lineages: TreeLineageInput[];
  canWrite: boolean;
  canManageFolders: boolean;
  onNavigate?: () => void;
  onDismiss?: () => void;
};

type EditingState = {
  kind: 'folder' | 'lineage';
  id: string;
  value: string;
  original: string;
};

type RowError = { id: string; message: string };

export function LineageSidebar({
  orgId,
  projectId,
  projectRef,
  defaultSurname,
  folders,
  lineages,
  canWrite,
  canManageFolders,
  onNavigate,
  onDismiss,
}: LineageSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const basePath = `/dashboard/project/${projectRef}/lineages`;

  const collapsedFolderIds = useLineageStore(
    (state) => state.collapsedFolderIds
  );
  const toggleFolder = useLineageStore((state) => state.toggleFolder);

  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [rowError, setRowError] = useState<RowError | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [createLineage, setCreateLineage] = useState<{
    folderId: string | null;
  } | null>(null);

  const skipBlurRef = useRef(false);
  const savingRef = useRef(false);

  const tree = useMemo(
    () => filterLineageTree(buildLineageTree(folders, lineages), query),
    [folders, lineages, query]
  );

  const activeLineageId = useMemo(() => {
    const prefix = `${basePath}/`;
    if (!pathname.startsWith(prefix)) {
      return null;
    }
    const rest = pathname.slice(prefix.length);
    return rest.split('/')[0] || null;
  }, [basePath, pathname]);

  function handleNavigate(lineageId: string) {
    router.push(`${basePath}/${lineageId}`);
    onNavigate?.();
  }

  function nextFolderName() {
    const count = folders.filter((folder) =>
      folder.name.startsWith('新建文件夹')
    ).length;
    return count === 0 ? '新建文件夹' : `新建文件夹 ${count + 1}`;
  }

  async function handleCreateFolder(parentId: string | null) {
    if (pendingId) {
      return;
    }
    setGlobalError(null);
    setRowError(null);
    const name = nextFolderName();
    setPendingId(parentId ?? 'root');
    try {
      const formData = new FormData();
      formData.set('orgId', orgId);
      formData.set('projectId', projectId);
      formData.set('kind', '0');
      formData.set('name', name);
      if (parentId) {
        formData.set('parentId', parentId);
      }
      const result = await createFolderAction({}, formData);
      if ('error' in result) {
        setGlobalError(result.error ?? '新建文件夹失败，请重试');
        return;
      }
      if (!result.folderId) {
        setGlobalError('新建文件夹失败，请重试');
        return;
      }
      if (parentId && collapsedFolderIds.includes(parentId)) {
        toggleFolder(parentId);
      }
      setEditing({
        kind: 'folder',
        id: result.folderId,
        value: name,
        original: name,
      });
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function handleSaveRename() {
    const current = editing;
    if (!current || savingRef.current) {
      return;
    }
    const name = current.value.trim();
    if (!name) {
      setEditing(null);
      return;
    }
    if (name === current.original) {
      setEditing(null);
      return;
    }

    savingRef.current = true;
    setPendingId(current.id);
    setRowError(null);
    try {
      const formData = new FormData();
      formData.set('orgId', orgId);
      formData.set('name', name);
      if (current.kind === 'folder') {
        formData.set('folderId', current.id);
      } else {
        formData.set('lineageId', current.id);
      }
      const result =
        current.kind === 'folder'
          ? await renameFolderAction({}, formData)
          : await updateLineageAction({}, formData);
      if ('error' in result && result.error) {
        setRowError({ id: current.id, message: result.error });
        return;
      }
      setEditing(null);
      router.refresh();
    } catch {
      setRowError({ id: current.id, message: '保存失败，请重试' });
    } finally {
      savingRef.current = false;
      setPendingId(null);
    }
  }

  async function handleDeleteLineage(lineage: TreeLineageInput) {
    if (
      !window.confirm(
        `删除谱系「${lineage.name}」？谱系中的人丁会一并归档，且没有恢复界面。`
      )
    ) {
      return;
    }
    setRowError(null);
    setPendingId(lineage.id);
    try {
      const formData = new FormData();
      formData.set('orgId', orgId);
      formData.set('lineageId', lineage.id);
      const result = await deleteLineageAction({}, formData);
      if ('error' in result && result.error) {
        setRowError({ id: lineage.id, message: result.error });
        return;
      }
      if (activeLineageId === lineage.id) {
        router.push(basePath);
        onNavigate?.();
      }
      router.refresh();
    } catch {
      setRowError({ id: lineage.id, message: '删除失败，请重试' });
    } finally {
      setPendingId(null);
    }
  }

  async function handleDeleteFolder(folder: TreeFolderInput) {
    if (
      !window.confirm(
        `删除文件夹「${folder.name}」？子文件夹会一并删除，其中的谱系将移入未分类。`
      )
    ) {
      return;
    }
    setRowError(null);
    setPendingId(folder.id);
    try {
      const formData = new FormData();
      formData.set('orgId', orgId);
      formData.set('folderId', folder.id);
      const result = await deleteFolderAction({}, formData);
      if ('error' in result && result.error) {
        setRowError({ id: folder.id, message: result.error });
        return;
      }
      router.refresh();
    } catch {
      setRowError({ id: folder.id, message: '删除失败，请重试' });
    } finally {
      setPendingId(null);
    }
  }

  function renderRenameInput(current: EditingState) {
    return (
      <Input
        value={current.value}
        onChange={(event) =>
          setEditing({ ...current, value: event.target.value })
        }
        onBlur={() => {
          if (skipBlurRef.current) {
            skipBlurRef.current = false;
            return;
          }
          void handleSaveRename();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void handleSaveRename();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            skipBlurRef.current = true;
            setEditing(null);
          }
        }}
        size="sm"
        maxLength={100}
        aria-label="重命名"
        autoFocus
        className="h-5 rounded border-primary px-1 text-xs"
      />
    );
  }

  function renderLineage(lineage: TreeLineageInput, depth: number) {
    const active = lineage.id === activeLineageId;
    const isEditing = editing?.kind === 'lineage' && editing.id === lineage.id;
    const indent = 10 + depth * 14;

    return (
      <div key={`lineage-${lineage.id}`}>
        <div
          className={cn(
            'group mx-1 flex h-8 items-center rounded-md pr-1 text-xs transition-colors',
            active
              ? 'bg-accent font-semibold text-accent-foreground shadow-2xs'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          )}
        >
          {isEditing ? (
            <div
              className="flex min-w-0 flex-1 items-center gap-1"
              style={{ paddingLeft: indent }}
            >
              <span className="w-3.5 shrink-0" />
              <GitBranch size={14} className="shrink-0 text-primary" />
              {renderRenameInput(editing)}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => handleNavigate(lineage.id)}
              style={{ paddingLeft: indent }}
              className="flex h-full min-w-0 flex-1 items-center gap-1 text-left"
            >
              <span className="w-3.5 shrink-0" />
              <GitBranch
                size={14}
                className={cn(
                  'shrink-0',
                  active ? 'text-primary' : 'text-primary/70'
                )}
              />
              <span className="min-w-0 flex-1 truncate">{lineage.name}</span>
              <span className="mr-1 shrink-0 rounded bg-muted/60 px-1 text-[10px] text-muted-foreground">
                {lineage.nodeCount}人
              </span>
            </button>
          )}
          {canWrite && !isEditing ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title="谱系操作"
                  aria-label="谱系操作"
                  className="rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
                >
                  <MoreVertical size={12} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" size="sm">
                <DropdownMenuItem
                  onSelect={() =>
                    setEditing({
                      kind: 'lineage',
                      id: lineage.id,
                      value: lineage.name,
                      original: lineage.name,
                    })
                  }
                >
                  <Pencil size={12} /> 重命名
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => void handleDeleteLineage(lineage)}
                >
                  <Trash2 size={12} /> 删除谱系
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {rowError?.id === lineage.id ? (
          <p className="px-4 pb-1 text-[11px] text-destructive">
            {rowError.message}
          </p>
        ) : null}
      </div>
    );
  }

  function renderFolder(folder: LineageTreeFolder) {
    const folderId = folder.folder.id;
    const collapsed = collapsedFolderIds.includes(folderId);
    const open = query.trim().length > 0 || !collapsed;
    const isEditing = editing?.kind === 'folder' && editing.id === folderId;
    const indent = 10 + folder.depth * 14;
    const canAddSubfolder = canManageFolders && folder.depth < 2;

    return (
      <div key={`folder-${folderId}`}>
        <div
          className={cn(
            'group mx-1 flex h-8 items-center rounded-md pr-1 text-xs transition-colors',
            'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          )}
        >
          {isEditing ? (
            <div
              className="flex min-w-0 flex-1 items-center gap-1"
              style={{ paddingLeft: indent }}
            >
              {open ? (
                <ChevronDown size={13} className="shrink-0" />
              ) : (
                <ChevronRight size={13} className="shrink-0" />
              )}
              <FolderOpen
                size={14}
                className="shrink-0 fill-amber-500/20 text-amber-500"
              />
              {renderRenameInput(editing)}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => toggleFolder(folderId)}
              style={{ paddingLeft: indent }}
              className="flex h-full min-w-0 flex-1 items-center gap-1 text-left"
            >
              {open ? (
                <ChevronDown size={13} className="shrink-0" />
              ) : (
                <ChevronRight size={13} className="shrink-0" />
              )}
              {open ? (
                <FolderOpen
                  size={14}
                  className="shrink-0 fill-amber-500/20 text-amber-500"
                />
              ) : (
                <FolderIcon
                  size={14}
                  className="shrink-0 fill-amber-500/20 text-amber-500"
                />
              )}
              <span className="min-w-0 flex-1 truncate">
                {folder.folder.name}
              </span>
              {folder.lineageCount > 0 ? (
                <span className="mr-1 shrink-0 rounded-full bg-muted/50 px-1.5 font-mono text-[10px]">
                  {folder.lineageCount}
                </span>
              ) : null}
            </button>
          )}
          {!isEditing && (canWrite || canManageFolders) ? (
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              {canWrite ? (
                <button
                  type="button"
                  title="在此文件夹下新建谱系"
                  aria-label="在此文件夹下新建谱系"
                  onClick={() => setCreateLineage({ folderId })}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Plus size={12} />
                </button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title="文件夹操作"
                    aria-label="文件夹操作"
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <MoreVertical size={12} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" size="sm">
                  {canWrite ? (
                    <DropdownMenuItem
                      onSelect={() => setCreateLineage({ folderId })}
                    >
                      <Plus size={12} /> 新建谱系
                    </DropdownMenuItem>
                  ) : null}
                  {canAddSubfolder ? (
                    <DropdownMenuItem
                      onSelect={() => void handleCreateFolder(folderId)}
                    >
                      <FolderPlus size={12} /> 新建子文件夹
                    </DropdownMenuItem>
                  ) : null}
                  {canManageFolders ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() =>
                          setEditing({
                            kind: 'folder',
                            id: folderId,
                            value: folder.folder.name,
                            original: folder.folder.name,
                          })
                        }
                      >
                        <Pencil size={12} /> 重命名
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => void handleDeleteFolder(folder.folder)}
                      >
                        <Trash2 size={12} /> 删除文件夹
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>
        {rowError?.id === folderId ? (
          <p className="px-4 pb-1 text-[11px] text-destructive">
            {rowError.message}
          </p>
        ) : null}
        {open ? (
          <div>
            {folder.children.map(renderFolder)}
            {folder.lineages.map(({ lineage }) =>
              renderLineage(lineage, folder.depth + 1)
            )}
          </div>
        ) : null}
      </div>
    );
  }

  const hasTreeItems = tree.folders.length > 0 || tree.unfiled.length > 0;

  return (
    <div className="flex h-full min-h-0 w-full select-none flex-col overflow-hidden bg-card text-foreground">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-muted/10 px-4">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-primary" />
          <span className="font-semibold text-sm text-foreground">
            谱系管理
          </span>
        </div>
        <div className="flex items-center gap-1">
          {canManageFolders ? (
            <button
              type="button"
              onClick={() => void handleCreateFolder(null)}
              disabled={pendingId !== null}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              title="新建文件夹"
              aria-label="新建文件夹"
            >
              <FolderPlus size={15} />
            </button>
          ) : null}
          {canWrite ? (
            <button
              type="button"
              onClick={() => setCreateLineage({ folderId: null })}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="新建谱系"
              aria-label="新建谱系"
            >
              <Plus size={16} />
            </button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="关闭"
              aria-label="关闭谱系管理"
            >
              <X size={15} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 mb-2 flex shrink-0 flex-col px-3">
        {canWrite ? (
          <Button
            variant="soft"
            size="sm"
            className="h-8 w-full justify-start text-xs font-semibold"
            onClick={() => setCreateLineage({ folderId: null })}
          >
            <Plus size={14} className="mr-1" /> 新建谱系
          </Button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mb-1.5 flex shrink-0 items-center justify-between px-4 py-1 text-xs font-bold text-muted-foreground uppercase">
          <div className="flex items-center gap-1.5">
            <span>谱系卷册</span>
            <span className="rounded-full bg-muted px-1.5 font-mono text-[10px]">
              {lineages.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {canManageFolders ? (
              <button
                type="button"
                onClick={() => void handleCreateFolder(null)}
                disabled={pendingId !== null}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                title="新建文件夹"
                aria-label="新建文件夹"
              >
                <FolderPlus size={13} />
              </button>
            ) : null}
            {canWrite ? (
              <button
                type="button"
                onClick={() => setCreateLineage({ folderId: null })}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="新建谱系"
                aria-label="新建谱系"
              >
                <Plus size={13} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="mb-2 shrink-0 px-3">
          <div className="group relative">
            <Search
              size={12}
              className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索谱系或文件夹..."
              size="sm"
              aria-label="搜索谱系或文件夹"
              className="bg-muted/40 pl-7"
            />
          </div>
        </div>

        {globalError ? (
          <p className="mx-3 mb-2 rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
            {globalError}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4">
          {hasTreeItems ? (
            <>
              {tree.folders.map(renderFolder)}
              {tree.unfiled.map(({ lineage }) => renderLineage(lineage, 0))}
            </>
          ) : (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              <p>{query.trim() ? '暂无匹配谱系' : '还没有谱系'}</p>
              {canWrite && !query.trim() ? (
                <button
                  type="button"
                  onClick={() => setCreateLineage({ folderId: null })}
                  className="mt-2 text-[11px] text-primary underline underline-offset-2"
                >
                  点击新建谱系
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {createLineage ? (
        <CreateLineageDialog
          orgId={orgId}
          projectId={projectId}
          projectRef={projectRef}
          defaultSurname={defaultSurname}
          folders={folders}
          defaultFolderId={createLineage.folderId}
          onClose={() => setCreateLineage(null)}
        />
      ) : null}
    </div>
  );
}
