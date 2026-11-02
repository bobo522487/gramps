'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ArticleFolderTree } from './article-folder-tree';
import { ArticleList } from './article-list';
import { NewArticleDialog } from './new-article-dialog';
import {
  type ArticleFolderNode,
  type ArticleRow,
  type FolderPickerOption,
  UNFILED_FOLDER_ID,
} from './types';

/**
 * 谱文列表页（FR-002、FR-003、FR-008、FR-010、FR-011、FR-052）。
 *
 * 左：分类树（带篇数，点选即过滤）；右：列表（标题搜索、行内菜单）。
 * 窄屏时左树收到顶部按钮里的 Sheet 里；区域三区里的「左」即是这棵分类树。
 */

export function ArticleWorkspace({
  orgId,
  projectId,
  projectRef,
  projectRegion,
  canWrite,
  canManageFolders,
  folders,
  unfiledCount,
  rows,
  folderOptions,
}: {
  orgId: string;
  projectId: string;
  projectRef: string;
  projectRegion: string;
  canWrite: boolean;
  canManageFolders: boolean;
  folders: ArticleFolderNode[];
  unfiledCount: number;
  rows: ArticleRow[];
  folderOptions: FolderPickerOption[];
}) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  function select(folderId: string | null) {
    setSelectedFolderId(folderId);
    setSheetOpen(false);
  }

  const sidebar = (
    <ArticleFolderTree
      orgId={orgId}
      projectId={projectId}
      folders={folders}
      unfiledCount={unfiledCount}
      selectedFolderId={selectedFolderId}
      canManage={canManageFolders}
      onSelect={select}
    />
  );

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-card p-3 lg:flex">
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="lg:hidden">
                分类
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-3">
              <SheetTitle className="sr-only">谱文分类</SheetTitle>
              <SheetDescription className="sr-only">
                按分类筛选谱文
              </SheetDescription>
              {sidebar}
            </SheetContent>
          </Sheet>
          <div className="flex-1" />
          {canWrite ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus /> 新建谱文
            </Button>
          ) : null}
        </div>

        <ArticleList
          orgId={orgId}
          projectRef={projectRef}
          rows={rows}
          selectedFolderId={selectedFolderId}
          folderOptions={folderOptions}
          canWrite={canWrite}
        />
      </div>

      <NewArticleDialog
        orgId={orgId}
        projectId={projectId}
        projectRef={projectRef}
        projectRegion={projectRegion}
        canProjectWrite={canManageFolders}
        folders={folders}
        defaultFolderId={
          selectedFolderId && selectedFolderId !== UNFILED_FOLDER_ID
            ? selectedFolderId
            : null
        }
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  );
}
