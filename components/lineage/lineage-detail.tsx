'use client';

import {
  BookOpen,
  Heart,
  Network,
  Pencil,
  Printer,
  Search,
  Table2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { EmptyState } from '@/components/console/empty-state';
import { GenealogyCanvas } from '@/components/lineage/canvas/genealogy-canvas';
import {
  generationWord,
  lifeSpan,
  matchesNode,
} from '@/components/lineage/derived';
import { LineageEditDialog } from '@/components/lineage/lineage-edit-dialog';
import {
  LineageIndexProvider,
  useLineageIndex,
} from '@/components/lineage/lineage-index-context';
import { useLineageStore } from '@/components/lineage/lineage-store';
import { NodeActionBar } from '@/components/lineage/node-action-bar';
import type { NodeCommandId } from '@/components/lineage/node-commands';
import {
  NodeContextMenu,
  type NodeContextMenuState,
} from '@/components/lineage/node-context-menu';
import {
  NodeCreateDialog,
  type NodeCreateMode,
} from '@/components/lineage/node-create-dialog';
import { NodeMoveDialog } from '@/components/lineage/node-move-dialog';
import { PersonInspector } from '@/components/lineage/person-inspector';
import { sexLabel } from '@/components/lineage/sex';
import type { FolderOption, NodeView } from '@/components/lineage/types';
import { useInspectorSelection } from '@/components/lineage/use-inspector-selection';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { deleteNodeAction, moveNodeAction } from '@/lib/lineage/actions';
import { shouldAutoOpenRoot } from '@/lib/lineage/auto-root';
import {
  buildDeleteConfirmMessage,
  collectSubtreeIds,
} from '@/lib/lineage/subtree';
import { cn } from '@/lib/utils';

type LineageInfo = {
  id: string;
  name: string;
  surname: string;
  hallCode: string | null;
  region: string | null;
  notes: string | null;
  generationWords: string[] | null;
  nodeCount: number;
  folderId: string | null;
};

type CreateState = { mode: NodeCreateMode; target?: NodeView } | null;

function SexLabel({ sex }: { sex: NodeView['sex'] }) {
  return sexLabel(sex);
}

function SpouseChip({
  spouse,
  onSelect,
  onContextMenu,
}: {
  spouse: NodeView;
  onSelect: (nodeId: string) => void;
  onContextMenu: (node: NodeView, x: number, y: number) => boolean;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onSelect(spouse.id);
      }}
      onContextMenu={(event) => {
        event.stopPropagation();
        if (onContextMenu(spouse, event.clientX, event.clientY)) {
          event.preventDefault();
        }
      }}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
    >
      <Heart className="size-3" />配 {spouse.fullName}
    </button>
  );
}

function NodeRows({
  bloodNodes,
  spousesByBlood,
  showGeneration,
  selectedNodeId,
  onSelect,
  onContextMenu,
}: {
  bloodNodes: NodeView[];
  spousesByBlood: Map<string, NodeView[]>;
  showGeneration: boolean;
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
  onContextMenu: (node: NodeView, x: number, y: number) => boolean;
}) {
  return (
    <TableBody>
      {bloodNodes.map((node) => {
        const spouses = spousesByBlood.get(node.id) ?? [];
        const isSelected =
          selectedNodeId === node.id ||
          spouses.some((spouse) => spouse.id === selectedNodeId);
        return (
          <TableRow
            key={node.id}
            onClick={() => onSelect(node.id)}
            onContextMenu={(event) => {
              if (onContextMenu(node, event.clientX, event.clientY)) {
                event.preventDefault();
              }
            }}
            className={cn('cursor-pointer', isSelected && 'bg-accent/60')}
          >
            {showGeneration ? (
              <TableCell className="tabular-nums">
                第 {node.generation} 世
              </TableCell>
            ) : null}
            <TableCell className="whitespace-normal">
              <div className="font-medium">
                {node.namePrefix ? (
                  <span className="mr-0.5 text-muted-foreground">
                    {node.namePrefix}
                  </span>
                ) : null}
                {node.fullName}
              </div>
              {node.courtesy ? (
                <div className="text-xs text-muted-foreground">
                  字 {node.courtesy}
                </div>
              ) : null}
              {spouses.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {spouses.map((spouse) => (
                    <SpouseChip
                      key={spouse.id}
                      spouse={spouse}
                      onSelect={onSelect}
                      onContextMenu={onContextMenu}
                    />
                  ))}
                </div>
              ) : null}
              {node.biography ? (
                <details className="mt-1 max-w-md text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">行传</summary>
                  <p className="mt-1 whitespace-pre-wrap">{node.biography}</p>
                </details>
              ) : null}
            </TableCell>
            <TableCell>
              <SexLabel sex={node.sex} />
            </TableCell>
            <TableCell className="text-muted-foreground">
              {lifeSpan(node)}
            </TableCell>
          </TableRow>
        );
      })}
    </TableBody>
  );
}

type LineageDetailProps = {
  orgId: string;
  lineage: LineageInfo;
  nodes: NodeView[];
  folders: FolderOption[];
  canWrite: boolean;
};

/**
 * Owns the single lineage index for this subtree: the canvas, the inspector,
 * the create dialog and the detail table read it from context instead of each
 * rebuilding the same maps over the same array.
 */
export function LineageDetail(props: LineageDetailProps) {
  return (
    <LineageIndexProvider nodes={props.nodes}>
      <LineageDetailInner {...props} />
    </LineageIndexProvider>
  );
}

function LineageDetailInner({
  orgId,
  lineage,
  nodes,
  folders,
  canWrite,
}: LineageDetailProps) {
  const router = useRouter();

  const view = useLineageStore((state) => state.view);
  const setView = useLineageStore((state) => state.setView);
  const selectedNodeId = useLineageStore((state) => state.selectedNodeId);
  const personQuery = useLineageStore((state) => state.personQuery);
  const setPersonQuery = useLineageStore((state) => state.setPersonQuery);
  const notice = useLineageStore((state) => state.notice);
  const setNotice = useLineageStore((state) => state.setNotice);
  const requestFocus = useLineageStore((state) => state.requestFocus);
  const initializeForLineage = useLineageStore(
    (state) => state.initializeForLineage
  );
  const {
    markInspectorDirty,
    requestSelectNode,
    confirmDiscard,
    clearSelection,
    discardConfirm,
    setDiscardConfirm,
    setSelectedNodeRaw,
  } = useInspectorSelection();
  const [createDialog, setCreateDialog] = useState<CreateState>(null);
  const [moveNode, setMoveNode] = useState<NodeView | null>(null);
  const [contextMenu, setContextMenu] = useState<NodeContextMenuState | null>(
    null
  );
  const [editLineage, setEditLineage] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<NodeView | null>(null);
  const [, startDelete] = useTransition();
  const autoRootOpened = useRef(false);

  useEffect(() => {
    initializeForLineage(lineage.id);
  }, [initializeForLineage, lineage.id]);

  const index = useLineageIndex();
  const bloodNodes = index.blood;
  const spousesByBlood = index.spousesByBlood;
  const hasRoot = bloodNodes.length > 0;

  // 新建谱系后直接引导录入始祖：每次进入空谱系弹一次，不写进 URL。
  useEffect(() => {
    if (
      shouldAutoOpenRoot({
        nodeCount: bloodNodes.length,
        alreadyOpened: autoRootOpened.current,
        canWrite,
      })
    ) {
      autoRootOpened.current = true;
      setCreateDialog({ mode: 'root' });
    }
  }, [bloodNodes.length, canWrite]);

  const selectedNode = useMemo(
    () => (selectedNodeId ? (index.byId.get(selectedNodeId) ?? null) : null),
    [index, selectedNodeId]
  );

  useEffect(() => {
    if (selectedNodeId && !index.byId.has(selectedNodeId)) {
      clearSelection();
    }
  }, [clearSelection, index, selectedNodeId]);

  const deferredQuery = useDeferredValue(personQuery);
  const isSearching = deferredQuery.trim().length > 0;
  const visibleBlood = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    if (!needle) {
      return bloodNodes;
    }
    return bloodNodes.filter((node) => {
      const hit = (n: NodeView) => matchesNode(n, needle);
      return hit(node) || (spousesByBlood.get(node.id) ?? []).some(hit);
    });
  }, [bloodNodes, deferredQuery, spousesByBlood]);

  const groups = useMemo(() => {
    if (isSearching) {
      return [];
    }
    const map = new Map<number, NodeView[]>();
    for (const node of visibleBlood) {
      const bucket = map.get(node.generation) ?? [];
      bucket.push(node);
      map.set(node.generation, bucket);
    }
    return [...map.entries()].sort((left, right) => left[0] - right[0]);
  }, [visibleBlood, isSearching]);

  const handlePrint = useCallback(() => {
    setView('table');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.print());
    });
  }, [setView]);

  const handleDelete = useCallback(
    (node: NodeView) => {
      if (node.role === 'blood' && !node.parentId) {
        setNotice('始祖不可删除，请删除整个谱系');
        return;
      }
      setDeleteTarget(node);
    },
    [setNotice]
  );

  const confirmDelete = useCallback(() => {
    const node = deleteTarget;
    if (!node) {
      return;
    }
    const ids = collectSubtreeIds(node, nodes);
    setDeleteTarget(null);
    setNotice(null);
    startDelete(async () => {
      const formData = new FormData();
      formData.set('orgId', orgId);
      formData.set('lineageId', lineage.id);
      formData.set('nodeId', node.id);
      const result = await deleteNodeAction({}, formData);
      if ('error' in result && result.error) {
        setNotice(result.error);
        return;
      }
      if (selectedNodeId && ids.has(selectedNodeId)) {
        clearSelection();
      }
      router.refresh();
    });
  }, [
    clearSelection,
    deleteTarget,
    lineage.id,
    nodes,
    orgId,
    router,
    selectedNodeId,
    setNotice,
  ]);

  const handleMove = useCallback(
    async (nodeId: string, newParentId: string) => {
      const formData = new FormData();
      formData.set('orgId', orgId);
      formData.set('lineageId', lineage.id);
      formData.set('nodeId', nodeId);
      formData.set('newParentId', newParentId);
      const result = await moveNodeAction({}, formData);
      if ('error' in result && result.error) {
        setNotice(result.error);
        return;
      }
      setNotice(null);
      router.refresh();
    },
    [lineage.id, orgId, router, setNotice]
  );

  function openCreate(mode: 'child' | 'sibling' | 'spouse', node: NodeView) {
    setCreateDialog({ mode, target: node });
  }

  function openContextMenu(node: NodeView, x: number, y: number): boolean {
    // 只读角色右键不接管浏览器原生菜单：没有可执行命令时什么都不发生。
    if (!canWrite) {
      return false;
    }
    requestSelectNode(node.id);
    setContextMenu({ node, x, y });
    return true;
  }

  // 底部快捷条与右键菜单共用同一张命令表，这里只做一次分派。
  function runCommand(id: NodeCommandId) {
    const node = selectedNode;
    if (!node) {
      return;
    }
    if (id === 'add-child' || id === 'add-sibling' || id === 'add-spouse') {
      openCreate(
        id === 'add-child'
          ? 'child'
          : id === 'add-sibling'
            ? 'sibling'
            : 'spouse',
        node
      );
      return;
    }
    if (id === 'move') {
      setMoveNode(node);
      return;
    }
    handleDelete(node);
  }

  function handleCreated(nodeId: string) {
    clearSelection();
    setSelectedNodeRaw(nodeId);
    requestFocus(nodeId);
    router.refresh();
    setCreateDialog(null);
  }

  const deleteConfirmMessage = deleteTarget
    ? buildDeleteConfirmMessage(
        deleteTarget,
        collectSubtreeIds(deleteTarget, nodes).size
      )
    : '';

  // 未选中人丁时不渲染任何东西；选中后从右侧滑出抽屉（FR-012）。
  const inspector = selectedNode ? (
    <Sheet
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) {
          requestSelectNode(null);
        }
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        showOverlay={false}
        onInteractOutside={(event) => event.preventDefault()}
        className="w-full gap-0 p-0 print:hidden sm:max-w-md"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{selectedNode.fullName} 的族人档案</SheetTitle>
        </SheetHeader>
        <PersonInspector
          orgId={orgId}
          lineageId={lineage.id}
          generationWords={lineage.generationWords}
          node={selectedNode}
          canWrite={canWrite}
          onClose={() => requestSelectNode(null)}
          onSelectNode={(nodeId) => requestSelectNode(nodeId)}
          onDirtyChange={markInspectorDirty}
          onAddChild={(nodeId) => {
            const target = index.byId.get(nodeId);
            if (target) {
              openCreate('child', target);
            }
          }}
          onAddSpouse={(nodeId) => {
            const target = index.byId.get(nodeId);
            if (target) {
              openCreate('spouse', target);
            }
          }}
          onDelete={handleDelete}
        />
      </SheetContent>
    </Sheet>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col print:block">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 lg:px-4 print:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BookOpen size={16} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold text-foreground">
              {lineage.name}
            </h1>
            <p className="truncate text-[11px] text-muted-foreground">
              {lineage.surname}氏
              {lineage.hallCode ? ` · ${lineage.hallCode}` : ''}
              {lineage.region ? ` · ${lineage.region}` : ''} · 共{' '}
              {bloodNodes.length} 位族人
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasRoot ? (
            <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
              <button
                type="button"
                onClick={() => setView('canvas')}
                className={cn(
                  'flex h-7 items-center gap-1 rounded-md px-2.5 text-xs transition-colors',
                  view === 'canvas'
                    ? 'bg-card font-medium text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Network size={13} /> 谱系图
              </button>
              <button
                type="button"
                onClick={() => setView('table')}
                className={cn(
                  'flex h-7 items-center gap-1 rounded-md px-2.5 text-xs transition-colors',
                  view === 'table'
                    ? 'bg-card font-medium text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Table2 size={13} /> 世系表
              </button>
            </div>
          ) : null}

          {canWrite ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setEditLineage(true)}
            >
              <Pencil />
              编辑谱系
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="icon-sm"
            onClick={handlePrint}
            title="打印世系表"
            aria-label="打印世系表"
          >
            <Printer />
          </Button>
        </div>
      </header>

      <div className="hidden shrink-0 px-4 py-3 print:block">
        <h1 className="text-lg font-bold text-foreground">{lineage.name}</h1>
        <p className="text-xs text-muted-foreground">
          {lineage.surname}氏{lineage.hallCode ? ` · ${lineage.hallCode}` : ''}
          {lineage.region ? ` · ${lineage.region}` : ''} · 共{' '}
          {bloodNodes.length} 位族人
        </p>
      </div>

      {!hasRoot ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
          <Card size="dense">
            <EmptyState
              icon={Users}
              title="还没有始祖"
              description="先录入始祖，作为第一世，再逐代添加子女与配偶。"
              action={
                canWrite ? (
                  <Button
                    variant="brand"
                    size="xs"
                    onClick={() => setCreateDialog({ mode: 'root' })}
                  >
                    <UserPlus />
                    录入始祖
                  </Button>
                ) : null
              }
            />
          </Card>
        </div>
      ) : view === 'canvas' ? (
        <div className="flex min-h-0 flex-1 print:hidden">
          <div className="min-h-0 min-w-0 flex-1">
            <GenealogyCanvas
              lineageId={lineage.id}
              generationWords={lineage.generationWords}
              canWrite={canWrite}
              onCreateChild={(parentId) => {
                const target = index.byId.get(parentId);
                if (target) {
                  openCreate('child', target);
                }
              }}
              onCreateSpouse={(bloodId) => {
                const target = index.byId.get(bloodId);
                if (target) {
                  openCreate('spouse', target);
                }
              }}
              onCreatePerson={() => setCreateDialog({ mode: 'person' })}
              onSelectNode={requestSelectNode}
              onEditNode={(nodeId) => requestSelectNode(nodeId)}
              onNodeContextMenu={(nodeId, x, y) => {
                const target = index.byId.get(nodeId);
                return target ? openContextMenu(target, x, y) : false;
              }}
              onMoveNode={handleMove}
              onPrint={handlePrint}
            />
          </div>
          {inspector}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto print:overflow-visible">
            <div className="space-y-3 p-4 print:p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
                <div className="flex flex-wrap items-center gap-2">
                  {isSearching ? (
                    <Badge variant="outline">
                      {visibleBlood.length} 条匹配
                    </Badge>
                  ) : (
                    <Badge variant="outline">共 {groups.length} 世</Badge>
                  )}
                  {lineage.generationWords &&
                  lineage.generationWords.length > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      字辈：{lineage.generationWords.join(' ')}
                    </span>
                  ) : null}
                </div>
                <div className="relative">
                  <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={personQuery}
                    onChange={(event) => setPersonQuery(event.target.value)}
                    placeholder="搜索姓名、字号、生卒、葬地或配偶"
                    size="sm"
                    aria-label="搜索人丁"
                    className="w-56 pl-7"
                  />
                </div>
              </div>

              {notice ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive print:hidden">
                  <span>{notice}</span>
                  <button
                    type="button"
                    onClick={() => setNotice(null)}
                    aria-label="关闭提示"
                    className="rounded p-0.5 hover:bg-destructive/10"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : null}

              {visibleBlood.length === 0 ? (
                <Card size="dense">
                  <EmptyState
                    icon={Search}
                    title="没有匹配的人丁"
                    description="试试其他姓名、字号、生卒、葬地，或清空搜索条件。"
                  />
                </Card>
              ) : isSearching ? (
                <Card size="dense">
                  <Table size="dense">
                    <TableHeader>
                      <TableRow>
                        <TableHead>世次</TableHead>
                        <TableHead>姓名</TableHead>
                        <TableHead>性别</TableHead>
                        <TableHead>生卒</TableHead>
                      </TableRow>
                    </TableHeader>
                    <NodeRows
                      bloodNodes={visibleBlood}
                      spousesByBlood={spousesByBlood}
                      showGeneration
                      selectedNodeId={selectedNodeId}
                      onSelect={(nodeId) => requestSelectNode(nodeId)}
                      onContextMenu={openContextMenu}
                    />
                  </Table>
                </Card>
              ) : (
                groups.map(([generation, generationNodes]) => {
                  const word = generationWord(
                    lineage.generationWords,
                    generation
                  );
                  return (
                    <Card
                      key={generation}
                      size="dense"
                      className="break-inside-avoid"
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold">
                          第 {generation} 世
                        </h2>
                        {word ? (
                          <Badge variant="outline">字辈 · {word}</Badge>
                        ) : null}
                        <span className="text-xs text-muted-foreground">
                          {generationNodes.length} 人
                        </span>
                      </div>
                      <Table size="dense">
                        <TableHeader>
                          <TableRow>
                            <TableHead>姓名</TableHead>
                            <TableHead>性别</TableHead>
                            <TableHead>生卒</TableHead>
                          </TableRow>
                        </TableHeader>
                        <NodeRows
                          bloodNodes={generationNodes}
                          spousesByBlood={spousesByBlood}
                          showGeneration={false}
                          selectedNodeId={selectedNodeId}
                          onSelect={(nodeId) => requestSelectNode(nodeId)}
                          onContextMenu={openContextMenu}
                        />
                      </Table>
                    </Card>
                  );
                })
              )}
            </div>
          </div>
          {inspector}
        </div>
      )}

      <ConfirmDialog
        open={discardConfirm !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDiscardConfirm(null);
          }
        }}
        title="放弃未保存的修改？"
        description="族人档案有未保存的修改。关闭或切换后这些修改会丢失。"
        confirmLabel="放弃修改"
        cancelLabel="继续编辑"
        destructive
        onConfirm={confirmDiscard}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        title="确认删除人丁"
        description={deleteConfirmMessage}
        confirmLabel="删除"
        cancelLabel="取消"
        destructive
        onConfirm={confirmDelete}
      />

      {createDialog ? (
        <NodeCreateDialog
          key={
            createDialog.target
              ? `${createDialog.mode}-${createDialog.target.id}`
              : createDialog.mode
          }
          mode={createDialog.mode}
          orgId={orgId}
          lineageId={lineage.id}
          lineageSurname={lineage.surname}
          generationWords={lineage.generationWords}
          target={createDialog.target}
          onCreated={handleCreated}
          onClose={() => setCreateDialog(null)}
        />
      ) : null}

      {moveNode ? (
        <NodeMoveDialog
          key={moveNode.id}
          orgId={orgId}
          lineageId={lineage.id}
          node={moveNode}
          nodes={nodes}
          onClose={() => setMoveNode(null)}
        />
      ) : null}

      {editLineage ? (
        <LineageEditDialog
          orgId={orgId}
          lineage={lineage}
          folders={folders}
          onClose={() => setEditLineage(false)}
        />
      ) : null}

      {/* 抽屉覆盖右侧固定宽度，给底部快捷条让位，否则按钮点不到（E2E 实测被拦截）。 */}
      <div className={cn('print:hidden', selectedNode && 'sm:pr-[28rem]')}>
        <NodeActionBar
          node={selectedNode}
          canWrite={canWrite}
          onCommand={runCommand}
        />
      </div>

      <NodeContextMenu
        state={contextMenu}
        canWrite={canWrite}
        onCommand={runCommand}
        onDismiss={() => setContextMenu(null)}
      />
    </div>
  );
}
