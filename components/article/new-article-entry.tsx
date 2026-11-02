'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { NewArticleDialog } from './new-article-dialog';
import type { ArticleFolderNode } from './types';

/**
 * 「新建谱文」入口按钮 + 弹窗（FR-008：列表页与云谱空间总览两处都能建）。
 *
 * 总览页只有事实卡，没有列表；把新建动作抽成组件后，两个页面共用同一份表单
 * 与同一套校验，避免规格里的「两处新建入口」长成两份实现。
 */

export function NewArticleEntry({
  orgId,
  projectId,
  projectRef,
  projectRegion,
  canProjectWrite,
  folders,
  size = 'sm',
}: {
  orgId: string;
  projectId: string;
  projectRef: string;
  projectRegion: string;
  canProjectWrite: boolean;
  folders: ArticleFolderNode[];
  size?: 'sm' | 'default';
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}>
        <Plus /> 新建谱文
      </Button>
      <NewArticleDialog
        orgId={orgId}
        projectId={projectId}
        projectRef={projectRef}
        projectRegion={projectRegion}
        canProjectWrite={canProjectWrite}
        folders={folders}
        defaultFolderId={null}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
