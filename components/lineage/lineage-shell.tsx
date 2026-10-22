'use client';

import { PanelLeft } from 'lucide-react';
import { useRef, useState } from 'react';
import { LineageSidebar } from '@/components/lineage/lineage-sidebar';
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useLineageStore,
} from '@/components/lineage/lineage-store';
import type {
  TreeFolderInput,
  TreeLineageInput,
} from '@/components/lineage/lineage-tree';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { useResizable } from '@/hooks/use-resizable';
import { cn } from '@/lib/utils';

type LineageShellProps = {
  orgId: string;
  projectId: string;
  projectRef: string;
  defaultSurname: string;
  folders: TreeFolderInput[];
  lineages: TreeLineageInput[];
  canWrite: boolean;
  canManageFolders: boolean;
  children: React.ReactNode;
};

export function LineageShell({
  orgId,
  projectId,
  projectRef,
  defaultSurname,
  folders,
  lineages,
  canWrite,
  canManageFolders,
  children,
}: LineageShellProps) {
  const sidebarWidth = useLineageStore((state) => state.sidebarWidth);
  const setSidebarWidth = useLineageStore((state) => state.setSidebarWidth);
  const [mobileOpen, setMobileOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);

  const { isResizing, startResizing } = useResizable({
    value: sidebarWidth,
    minWidth: SIDEBAR_MIN_WIDTH,
    maxWidth: SIDEBAR_MAX_WIDTH,
    edge: 'left',
    onChange: setSidebarWidth,
    leftOffset: () => shellRef.current?.getBoundingClientRect().left ?? 0,
  });

  const sidebarProps = {
    orgId,
    projectId,
    projectRef,
    defaultSurname,
    folders,
    lineages,
    canWrite,
    canManageFolders,
  };

  return (
    <div
      ref={shellRef}
      className="flex h-full min-h-0 overflow-hidden print:block print:h-auto print:overflow-visible"
    >
      <aside
        className="hidden shrink-0 border-r border-border bg-card lg:flex"
        style={{ width: sidebarWidth }}
      >
        <LineageSidebar {...sidebarProps} />
      </aside>
      <button
        type="button"
        aria-label="调整谱系管理栏宽度"
        onMouseDown={startResizing}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            setSidebarWidth(sidebarWidth - 16);
          }
          if (event.key === 'ArrowRight') {
            setSidebarWidth(sidebarWidth + 16);
          }
        }}
        className={cn(
          'hidden w-1 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-primary/40 lg:block print:hidden',
          isResizing && 'bg-primary/60'
        )}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible">
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2 lg:hidden print:hidden">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMobileOpen(true)}
          >
            <PanelLeft />
            谱系管理
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto print:overflow-visible">
          {children}
        </div>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-[280px] gap-0 p-0 sm:max-w-[320px]"
        >
          <SheetTitle className="sr-only">谱系管理</SheetTitle>
          <SheetDescription className="sr-only">
            浏览、搜索与切换谱系
          </SheetDescription>
          <LineageSidebar
            {...sidebarProps}
            onNavigate={() => setMobileOpen(false)}
            onDismiss={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
