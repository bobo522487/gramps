'use client';

import { ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useArticleAutosave } from '@/hooks/use-article-autosave';
import type { ArticleContent } from '@/lib/article/doc';
import { ArticleMoveDialog } from './article-card-dialogs';
import { ArticleFolderTree } from './article-folder-tree';
import { ArticleTitleInput } from './article-title-input';
import { TipTapEditor } from './editor/tiptap-editor';
import { PageStrip } from './page-strip';
import { SaveStatus } from './save-status';
import type {
  ArticleFolderNode,
  ArticleRow,
  FolderPickerOption,
} from './types';

/**
 * 谱文编辑器（FR-012 三区 + 极简顶栏、FR-003 切换先保存、FR-016 离开保护）。
 *
 * 顶栏只有：返回、标题、地区、保存状态、「立即保存」、**移动分类**——
 * 没有分享、发布、导出、版式入口（FR-041 / FR-042 / SC-011）。
 *
 * 离开保护走两条路：
 * 1. 应用内跳转（返回、点分类树）：`await saveNow()` 成功才 `router.push`，
 *    失败就停留在当前页并提示（FR-016、FR-003）。
 * 2. 浏览器关闭 / 刷新：只能 `beforeunload` 拦住要求确认，没法等异步保存
 *    （research §14）。
 */

export function ArticleEditorShell({
  orgId,
  projectId,
  projectRef,
  articleId,
  initialTitle,
  projectRegion,
  canWrite,
  canManageFolders,
  initial,
  folders,
  unfiledCount,
  folderOptions,
}: {
  orgId: string;
  projectId: string;
  projectRef: string;
  articleId: string;
  initialTitle: string;
  projectRegion: string;
  canWrite: boolean;
  canManageFolders: boolean;
  initial: ArticleContent;
  folders: ArticleFolderNode[];
  unfiledCount: number;
  folderOptions: FolderPickerOption[];
}) {
  const router = useRouter();
  const ws = useArticleAutosave({ orgId, articleId, initial });
  const [moveOpen, setMoveOpen] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  const listHref = `/dashboard/project/${projectRef}/articles`;

  async function guardedLeave() {
    if (canWrite && ws.hasPending) {
      const ok = await ws.saveNow();
      if (!ok) {
        setLeaveError('还有内容没保存成功，已停留在当前页。');
        return;
      }
    }
    router.push(listHref);
  }

  function selectFolder(folderId: string | null) {
    setSelectedFolderId(folderId);
    if (!canWrite || !ws.hasPending) {
      router.push(listHref);
      return;
    }
    void (async () => {
      const ok = await ws.saveNow();
      if (ok) {
        router.push(listHref);
      } else {
        setLeaveError('还有内容没保存成功，已停留在当前页。');
      }
    })();
  }

  useEffect(() => {
    if (!canWrite) {
      return;
    }
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (ws.hasPending) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [canWrite, ws.hasPending]);

  const currentDoc = ws.docOf(ws.currentPageId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-3 py-2">
        <button
          type="button"
          aria-label="返回谱文列表"
          className="rounded p-1 hover:bg-muted"
          onClick={guardedLeave}
        >
          <ChevronLeft className="size-4" />
        </button>

        <ArticleTitleInput
          orgId={orgId}
          articleId={articleId}
          initialTitle={initialTitle}
        />

        <span className="text-xs text-muted-foreground">
          地区：{projectRegion}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {leaveError ? (
            <span role="alert" className="text-xs text-destructive">
              {leaveError}
            </span>
          ) : null}
          <SaveStatus state={ws.state} onRetry={ws.saveNow} />
          {canWrite ? (
            <>
              <Button
                variant="outline"
                size="xs"
                onClick={() => setMoveOpen(true)}
              >
                移动分类
              </Button>
              <Button
                size="xs"
                onClick={() => void ws.saveNow()}
                disabled={!ws.hasPending}
              >
                立即保存
              </Button>
              {ws.notice ? (
                <span role="alert" className="text-xs text-destructive">
                  {ws.notice}
                </span>
              ) : null}
            </>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 shrink-0 flex-col overflow-y-auto border-r border-border bg-card p-3 lg:flex">
          <ArticleFolderTree
            orgId={orgId}
            projectId={projectId}
            folders={folders}
            unfiledCount={unfiledCount}
            selectedFolderId={selectedFolderId}
            canManage={canManageFolders}
            onSelect={selectFolder}
          />
        </aside>

        <main className="min-w-0 flex-1 overflow-hidden">
          <TipTapEditor
            pageId={ws.currentPageId}
            value={currentDoc}
            onChange={(doc) => ws.setDoc(ws.currentPageId, doc)}
          />
        </main>

        <PageStrip
          pageIds={ws.pageIds}
          currentPageId={ws.currentPageId}
          canWrite={canWrite}
          onSelect={(pageId) => {
            if (pageId === ws.currentPageId) {
              return;
            }
            void (async () => {
              if (canWrite && ws.hasPending) {
                const ok = await ws.saveNow();
                if (!ok) {
                  setLeaveError('还有内容没保存成功，已停留在当前页。');
                  return;
                }
              }
              ws.setCurrentPageId(pageId);
            })();
          }}
          onAdd={ws.addPage}
          onDelete={ws.removePage}
          onReorder={ws.movePage}
        />
      </div>

      <ArticleMoveDialog
        orgId={orgId}
        row={
          {
            id: articleId,
            title: initialTitle,
            folderId: null,
            pageCount: 0,
            lastTouchedAt: '',
          } satisfies ArticleRow
        }
        folders={folderOptions}
        open={moveOpen}
        onOpenChange={setMoveOpen}
        onSaved={() => router.push(listHref)}
      />
    </div>
  );
}
