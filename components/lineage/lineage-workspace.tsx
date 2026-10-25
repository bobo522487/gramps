'use client';

import { Network, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState } from '@/components/console/empty-state';
import { PageHeader } from '@/components/console/page-header';
import { CreateLineageDialog } from '@/components/lineage/create-lineage-dialog';
import type { TreeFolderInput } from '@/components/lineage/lineage-tree';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

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

export function LineageWorkspace({
  orgId,
  projectId,
  projectRef,
  projectThemeName,
  projectSurname,
  projectRegion,
  canProjectWrite,
  folders,
  lineages,
  canWrite,
}: {
  orgId: string;
  projectId: string;
  projectRef: string;
  projectThemeName: string;
  projectSurname: string;
  projectRegion: string;
  canProjectWrite: boolean;
  folders: TreeFolderInput[];
  lineages: LineageView[];
  canWrite: boolean;
}) {
  const [isLineageDialogOpen, setIsLineageDialogOpen] = useState(false);

  return (
    <section className="space-y-4 p-4 lg:p-6">
      <PageHeader
        icon={Network}
        title="谱系"
        description="从左侧管理文件夹与谱系，进入谱系后录入人丁、世次与字辈。"
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

      {lineages.length === 0 ? (
        <Card size="dense">
          <CardContent>
            <EmptyState
              icon={Network}
              title="还没有谱系"
              description="创建第一个谱系，从录入始祖开始整理家族世系。"
              action={
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
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {lineages.map((lineage) => (
            <Card key={lineage.id} size="dense">
              <CardContent className="space-y-3">
                <Link
                  href={`/dashboard/project/${projectRef}/lineages/${lineage.id}`}
                  className="block min-w-0 truncate font-medium hover:text-primary"
                >
                  {lineage.name}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {lineage.surname}氏
                  {lineage.hallCode ? ` · ${lineage.hallCode}` : ''}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{lineage.nodeCount} 位人丁</Badge>
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

      {isLineageDialogOpen ? (
        <CreateLineageDialog
          orgId={orgId}
          projectId={projectId}
          projectRef={projectRef}
          projectThemeName={projectThemeName}
          projectSurname={projectSurname}
          projectRegion={projectRegion}
          canProjectWrite={canProjectWrite}
          folders={folders}
          defaultFolderId={null}
          onClose={() => setIsLineageDialogOpen(false)}
        />
      ) : null}
    </section>
  );
}
