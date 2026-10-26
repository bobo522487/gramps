'use client';

import {
  BookOpen,
  Heart,
  MoreHorizontal,
  Move,
  Network,
  Pencil,
  Printer,
  Search,
  Table2,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { EmptyState } from '@/components/console/empty-state';
import { GenealogyCanvas } from '@/components/lineage/canvas/genealogy-canvas';
import { generationWord, lifeSpan } from '@/components/lineage/derived';
import { LineageEditDialog } from '@/components/lineage/lineage-edit-dialog';
import {
  LineageIndexProvider,
  useLineageIndex,
} from '@/components/lineage/lineage-index-context';
import {
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  useLineageStore,
} from '@/components/lineage/lineage-store';
import {
  NodeCreateDialog,
  type NodeCreateMode,
} from '@/components/lineage/node-create-dialog';
import { NodeMoveDialog } from '@/components/lineage/node-move-dialog';
import { PersonInspector } from '@/components/lineage/person-inspector';
import type { FolderOption, NodeView } from '@/components/lineage/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useResizable } from '@/hooks/use-resizable';
import { deleteNodeAction, moveNodeAction } from '@/lib/lineage/actions';
import { shouldAutoOpenRoot } from '@/lib/lineage/auto-root';
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

function subtreeIds(node: NodeView, nodes: NodeView[]): Set<string> {
  const ids = new Set<string>([node.id]);
  const queue = [node.id];
  while (queue.length > 0) {
    const parentId = queue.shift();
    if (!parentId) {
      break;
    }
    for (const candidate of nodes) {
      if (
        candidate.role === 'blood' &&
        candidate.parentId === parentId &&
        !ids.has(candidate.id)
      ) {
        ids.add(candidate.id);
        queue.push(candidate.id);
      }
    }
  }
  for (const candidate of nodes) {
    if (
      candidate.role === 'spouse' &&
      candidate.spouseOfId &&
      ids.has(candidate.spouseOfId)
    ) {
      ids.add(candidate.id);
    }
  }
  return ids;
}

function SexLabel({ sex }: { sex: number }) {
  return sex === 1 ? '女' : '男';
}

function SpouseChip({
  spouse,
  onSelect,
}: {
  spouse: NodeView;
  onSelect: (nodeId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onSelect(spouse.id);
      }}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
    >
      <Heart className="size-3" />配 {spouse.fullName}
    </button>
  );
}

function NodeActions({
  node,
  canWrite,
  isDeleting,
  onSelect,
  onCreate,
  onMove,
  onDelete,
}: {
  node: NodeView;
  canWrite: boolean;
  isDeleting: boolean;
  onSelect: (nodeId: string) => void;
  onCreate: (mode: 'child' | 'sibling' | 'spouse', node: NodeView) => void;
  onMove: (node: NodeView) => void;
  onDelete: (node: NodeView) => void;
}) {
  if (!canWrite) {
    return null;
  }
  const isRoot = !node.parentId;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={isDeleting}
          title="人丁操作"
          aria-label={`${node.fullName} 的操作`}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" size="sm">
        <DropdownMenuItem onSelect={() => onSelect(node.id)}>
          <BookOpen />
          查看档案
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onCreate('child', node)}>
          <UserPlus />
          添加子女
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isRoot}
          onSelect={() => onCreate('sibling', node)}
        >
          <Users />
          添加兄弟
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onCreate('spouse', node)}>
          <Heart />
          添加配偶
        </DropdownMenuItem>
        <DropdownMenuItem disabled={isRoot} onSelect={() => onMove(node)}>
          <Move />
          移动
        </DropdownMenuItem>
        {isRoot ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onDelete(node)}
            >
              <Trash2 />
              删除
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NodeRows({
  bloodNodes,
  spousesByBlood,
  canWrite,
  isDeleting,
  showGeneration,
  selectedNodeId,
  onSelect,
  onCreate,
  onMove,
  onDelete,
}: {
  bloodNodes: NodeView[];
  spousesByBlood: Map<string, NodeView[]>;
  canWrite: boolean;
  isDeleting: boolean;
  showGeneration: boolean;
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
  onCreate: (mode: 'child' | 'sibling' | 'spouse', node: NodeView) => void;
  onMove: (node: NodeView) => void;
  onDelete: (node: NodeView) => void;
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
            <TableCell
              className="text-right print:hidden"
              onClick={(event) => event.stopPropagation()}
            >
              <NodeActions
                node={node}
                canWrite={canWrite}
                isDeleting={isDeleting}
                onSelect={onSelect}
                onCreate={onCreate}
                onMove={onMove}
                onDelete={onDelete}
              />
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
  const setSelectedNode = useLineageStore((state) => state.setSelectedNode);
  const tableQuery = useLineageStore((state) => state.tableQuery);
  const setTableQuery = useLineageStore((state) => state.setTableQuery);
  const notice = useLineageStore((state) => state.notice);
  const setNotice = useLineageStore((state) => state.setNotice);
  const requestFocus = useLineageStore((state) => state.requestFocus);
  const initializeForLineage = useLineageStore(
    (state) => state.initializeForLineage
  );
  const inspectorWidth = useLineageStore((state) => state.inspectorWidth);
  const setInspectorWidth = useLineageStore((state) => state.setInspectorWidth);

  const inspectorResize = useResizable({
    value: inspectorWidth,
    minWidth: INSPECTOR_MIN_WIDTH,
    maxWidth: INSPECTOR_MAX_WIDTH,
    edge: 'right',
    onChange: setInspectorWidth,
  });

  const [createDialog, setCreateDialog] = useState<CreateState>(null);
  const [moveNode, setMoveNode] = useState<NodeView | null>(null);
  const [editLineage, setEditLineage] = useState(false);
  const [isDeleting, startDelete] = useTransition();
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
      setSelectedNode(null);
    }
  }, [index, selectedNodeId, setSelectedNode]);

  const visibleBlood = useMemo(() => {
    const needle = tableQuery.trim().toLowerCase();
    if (!needle) {
      return bloodNodes;
    }
    return bloodNodes.filter((node) => {
      const spouses = spousesByBlood.get(node.id) ?? [];
      return (
        node.fullName.toLowerCase().includes(needle) ||
        (node.courtesy ?? '').toLowerCase().includes(needle) ||
        (node.namePrefix ?? '').toLowerCase().includes(needle) ||
        (node.biography ?? '').toLowerCase().includes(needle) ||
        spouses.some((spouse) => spouse.fullName.toLowerCase().includes(needle))
      );
    });
  }, [bloodNodes, tableQuery, spousesByBlood]);

  const groups = useMemo(() => {
    if (tableQuery.trim()) {
      return [];
    }
    const map = new Map<number, NodeView[]>();
    for (const node of visibleBlood) {
      const bucket = map.get(node.generation) ?? [];
      bucket.push(node);
      map.set(node.generation, bucket);
    }
    return [...map.entries()].sort((left, right) => left[0] - right[0]);
  }, [visibleBlood, tableQuery]);

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
      const ids = subtreeIds(node, nodes);
      const count = ids.size;
      const message =
        count > 1
          ? `删除「${node.fullName}」及其子孙？共 ${count} 位人丁会归档。`
          : `删除「${node.fullName}」？该人丁会归档。`;
      if (!window.confirm(message)) {
        return;
      }
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
          setSelectedNode(null);
        }
        router.refresh();
      });
    },
    [
      lineage.id,
      nodes,
      orgId,
      router,
      selectedNodeId,
      setNotice,
      setSelectedNode,
    ]
  );

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

  function handleCreated(nodeId: string) {
    setSelectedNode(nodeId);
    requestFocus(nodeId);
    router.refresh();
    setCreateDialog(null);
  }

  const inspector = (
    <PersonInspector
      orgId={orgId}
      lineageId={lineage.id}
      generationWords={lineage.generationWords}
      node={selectedNode}
      canWrite={canWrite}
      width={inspectorWidth}
      isResizing={inspectorResize.isResizing}
      onResizeStart={inspectorResize.startResizing}
      onClose={() => setSelectedNode(null)}
      onSelectNode={setSelectedNode}
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
  );

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
              {lineage.nodeCount} 位族人
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
          {lineage.nodeCount} 位族人
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
              nodes={nodes}
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
              onEditNode={(nodeId) => setSelectedNode(nodeId)}
              onDeleteNode={(nodeId) => {
                const target = index.byId.get(nodeId);
                if (target) {
                  handleDelete(target);
                }
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
                  {tableQuery.trim() ? (
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
                    value={tableQuery}
                    onChange={(event) => setTableQuery(event.target.value)}
                    placeholder="搜索姓名、字号或配偶"
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
                    description="试试其他姓名、字号，或清空搜索条件。"
                  />
                </Card>
              ) : tableQuery.trim() ? (
                <Card size="dense">
                  <Table size="dense">
                    <TableHeader>
                      <TableRow>
                        <TableHead>世次</TableHead>
                        <TableHead>姓名</TableHead>
                        <TableHead>性别</TableHead>
                        <TableHead>生卒</TableHead>
                        <TableHead className="text-right print:hidden">
                          操作
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <NodeRows
                      bloodNodes={visibleBlood}
                      spousesByBlood={spousesByBlood}
                      canWrite={canWrite}
                      isDeleting={isDeleting}
                      showGeneration
                      selectedNodeId={selectedNodeId}
                      onSelect={setSelectedNode}
                      onCreate={openCreate}
                      onMove={setMoveNode}
                      onDelete={handleDelete}
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
                            <TableHead className="text-right print:hidden">
                              操作
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <NodeRows
                          bloodNodes={generationNodes}
                          spousesByBlood={spousesByBlood}
                          canWrite={canWrite}
                          isDeleting={isDeleting}
                          showGeneration={false}
                          selectedNodeId={selectedNodeId}
                          onSelect={setSelectedNode}
                          onCreate={openCreate}
                          onMove={setMoveNode}
                          onDelete={handleDelete}
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
    </div>
  );
}
