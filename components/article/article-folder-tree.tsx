'use client';

import { FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  createFolderAction,
  deleteFolderAction,
  renameFolderAction,
} from '@/lib/folder/actions';
import { cn } from '@/lib/utils';
import { FolderDeleteDialog } from './folder-delete-dialog';
import { type ArticleFolderNode, folderTree, UNFILED_FOLDER_ID } from './types';

/**
 * 谱文分类树（FR-002、FR-005）。
 *
 * 「新建 / 重命名」沿用谱系侧栏的行内编辑做法，只有**删除**走确认框——
 * 规格要求删除前必须给出「会连带删掉几个分类、几篇谱文」（SC-005），
 * 而这两个数字只有服务端算得准，所以确认框打开时先读一次预览。
 */

type Editing = {
  id: string;
  value: string;
  original: string;
  parentId: string | null;
};

export function ArticleFolderTree({
  orgId,
  projectId,
  folders,
  unfiledCount,
  selectedFolderId,
  canManage,
  onSelect,
}: {
  orgId: string;
  projectId: string;
  folders: ArticleFolderNode[];
  unfiledCount: number;
  selectedFolderId: string | null;
  canManage: boolean;
  onSelect: (folderId: string | null) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ArticleFolderNode | null>(
    null
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const rows = folderTree(folders);

  function startCreate(parentId: string | null) {
    const id = parentId ? `new:${parentId}` : 'new:root';
    setEditing({ id, value: '', original: '', parentId });
    setRowError(null);
    if (parentId) {
      onSelect(parentId);
    }
  }

  function startRename(folder: ArticleFolderNode) {
    setEditing({
      id: folder.id,
      value: folder.name,
      original: folder.name,
      parentId: folder.parentId,
    });
    setRowError(null);
  }

  async function submitEdit() {
    if (!editing) {
      return;
    }
    const name = editing.value.trim();
    if (!name || name === editing.original) {
      setEditing(null);
      return;
    }

    setPending(editing.id);
    try {
      if (editing.original === '') {
        const formData = new FormData();
        formData.set('orgId', orgId);
        formData.set('projectId', projectId);
        formData.set('kind', '1');
        formData.set('name', name);
        if (editing.parentId) {
          formData.set('parentId', editing.parentId);
        }
        const result = await createFolderAction({}, formData);
        if ('error' in result && result.error) {
          setRowError({ id: editing.id, message: result.error });
          return;
        }
      } else {
        const formData = new FormData();
        formData.set('orgId', orgId);
        formData.set('folderId', editing.id);
        formData.set('name', name);
        const result = await renameFolderAction({}, formData);
        if ('error' in result && result.error) {
          setRowError({ id: editing.id, message: result.error });
          return;
        }
      }
      setEditing(null);
      router.refresh();
    } catch {
      setRowError({ id: editing.id, message: '保存失败，请重试' });
    } finally {
      setPending(null);
    }
  }

  function requestDelete(folder: ArticleFolderNode) {
    setRowError(null);
    setDeleteError(null);
    setDeleteTarget(folder);
  }

  async function confirmDelete(folder: ArticleFolderNode) {
    const formData = new FormData();
    formData.set('orgId', orgId);
    formData.set('folderId', folder.id);
    const result = await deleteFolderAction({}, formData);
    if ('error' in result && result.error) {
      setDeleteError(result.error);
      return;
    }
    setDeleteTarget(null);
    setDeleteError(null);
    onSelect(null);
    router.refresh();
  }

  return (
    <nav aria-label="谱文分类" className="flex flex-col gap-0.5 text-sm">
      <TreeRow
        label="全部谱文"
        count={
          folders.reduce((sum, folder) => sum + folder.count, 0) + unfiledCount
        }
        active={selectedFolderId === null}
        onSelect={() => onSelect(null)}
        canManage={false}
      />
      <TreeRow
        label="未分类"
        count={unfiledCount}
        active={selectedFolderId === UNFILED_FOLDER_ID}
        onSelect={() => onSelect(UNFILED_FOLDER_ID)}
        canManage={false}
      />

      {rows.map(({ folder, depth }) =>
        editing?.id === folder.id ? (
          <EditRow
            key={folder.id}
            depth={depth}
            value={editing.value}
            error={rowError?.id === folder.id ? rowError.message : null}
            pending={pending === folder.id}
            onChange={(value) =>
              setEditing({ ...editing, value: value.slice(0, 100) })
            }
            onSubmit={submitEdit}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <TreeRow
            key={folder.id}
            label={folder.name}
            count={folder.count}
            depth={depth}
            active={selectedFolderId === folder.id}
            onSelect={() => onSelect(folder.id)}
            canManage={canManage}
            error={rowError?.id === folder.id ? rowError.message : null}
            onRename={() => startRename(folder)}
            onDelete={() => requestDelete(folder)}
            onCreateChild={depth < 2 ? () => startCreate(folder.id) : undefined}
          />
        )
      )}

      {editing?.parentId === null ? (
        <EditRow
          depth={0}
          value={editing.value}
          error={rowError?.id === 'new:root' ? rowError.message : null}
          pending={pending === 'new:root'}
          onChange={(value) =>
            setEditing({ ...editing, value: value.slice(0, 100) })
          }
          onSubmit={submitEdit}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      {canManage ? (
        <div className="mt-1 flex items-center gap-1 pl-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => startCreate(null)}
          >
            <FolderPlus /> 新建分类
          </Button>
        </div>
      ) : null}

      <FolderDeleteDialog
        orgId={orgId}
        folder={deleteTarget}
        open={deleteTarget !== null}
        error={deleteError}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        onConfirm={confirmDelete}
      />
    </nav>
  );
}

function TreeRow({
  label,
  count,
  depth = 0,
  active,
  canManage,
  error,
  onSelect,
  onRename,
  onDelete,
  onCreateChild,
}: {
  label: string;
  count: number;
  depth?: number;
  active: boolean;
  canManage: boolean;
  error?: string | null;
  onSelect: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onCreateChild?: () => void;
}) {
  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md pr-1 text-sm',
          active ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 flex-1 truncate py-1.5 text-left"
        >
          {label}
        </button>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {count}
        </span>
        {canManage ? (
          <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {onCreateChild ? (
              <button
                type="button"
                title="新建子分类"
                aria-label={`在「${label}」下新建子分类`}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={onCreateChild}
              >
                <Plus size={12} />
              </button>
            ) : null}
            {onRename ? (
              <button
                type="button"
                title="重命名分类"
                aria-label={`重命名「${label}」`}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={onRename}
              >
                <Pencil size={12} />
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                title="删除分类"
                aria-label={`删除「${label}」`}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                onClick={onDelete}
              >
                <Trash2 size={12} />
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {error ? <p className="pl-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function EditRow({
  depth,
  value,
  error,
  pending,
  onChange,
  onSubmit,
  onCancel,
}: {
  depth: number;
  value: string;
  error: string | null;
  pending: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ paddingLeft: 4 + depth * 14 }} className="py-1 pr-1">
      <Input
        autoFocus
        aria-label="分类名称"
        value={value}
        disabled={pending}
        placeholder="分类名称"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onSubmit();
          }
          if (event.key === 'Escape') {
            onCancel();
          }
        }}
        onBlur={onSubmit}
        className="h-7 text-sm"
      />
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
