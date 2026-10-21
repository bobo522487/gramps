'use client';

import {
  ArrowLeft,
  Heart,
  MoreHorizontal,
  Move,
  Pencil,
  Printer,
  Search,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { EmptyState } from '@/components/console/empty-state';
import { PageHeader } from '@/components/console/page-header';
import { LineageEditDialog } from '@/components/lineage/lineage-edit-dialog';
import { NodeCreateDialog } from '@/components/lineage/node-create-dialog';
import { NodeEditDialog } from '@/components/lineage/node-edit-dialog';
import { NodeMoveDialog } from '@/components/lineage/node-move-dialog';
import type { NodeView } from '@/components/lineage/types';
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
import { deleteNodeAction } from '@/lib/lineage/actions';

type FolderOption = {
  id: string;
  name: string;
  parentId: string | null;
};

type LineageInfo = {
  id: string;
  name: string;
  surname: string;
  hallCode: string | null;
  generationWords: string[] | null;
  nodeCount: number;
  folderId: string | null;
};

type CreateState =
  | { mode: 'root' }
  | { mode: 'child' | 'sibling' | 'spouse'; node: NodeView }
  | null;

function generationWord(
  words: string[] | null,
  generation: number
): string | null {
  return words?.[generation - 1] ?? null;
}

function lifeSpan(node: NodeView): string {
  const birth = node.birthText ?? node.birthYear?.toString() ?? '';
  const death = node.isAlive
    ? ''
    : (node.deathText ?? node.deathYear?.toString() ?? '');
  if (!birth && !death) {
    return node.isAlive ? '在世' : '—';
  }
  return `${birth || '?'} — ${death || (node.isAlive ? '' : '?')}`.trim();
}

function subtreeCount(node: NodeView, nodes: NodeView[]): number {
  const bloodIds = new Set<string>([node.id]);
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
        !bloodIds.has(candidate.id)
      ) {
        bloodIds.add(candidate.id);
        queue.push(candidate.id);
      }
    }
  }
  let total = bloodIds.size;
  for (const candidate of nodes) {
    if (
      candidate.role === 'spouse' &&
      candidate.spouseOfId &&
      bloodIds.has(candidate.spouseOfId)
    ) {
      total += 1;
    }
  }
  return total;
}

function SexLabel({ sex }: { sex: number }) {
  return sex === 1 ? '女' : '男';
}

function SpouseChip({
  spouse,
  canWrite,
  onEdit,
  onDelete,
}: {
  spouse: NodeView;
  canWrite: boolean;
  onEdit: (node: NodeView) => void;
  onDelete: (node: NodeView) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-surface-subtle px-2 py-0.5 text-xs text-muted-foreground">
      <Heart className="size-3" />配 {spouse.fullName}
      {canWrite ? (
        <>
          <button
            type="button"
            onClick={() => onEdit(spouse)}
            className="hover:text-foreground"
            title="编辑配偶"
            aria-label={`编辑配偶 ${spouse.fullName}`}
          >
            <Pencil className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(spouse)}
            className="hover:text-destructive"
            title="删除配偶"
            aria-label={`删除配偶 ${spouse.fullName}`}
          >
            <Trash2 className="size-3" />
          </button>
        </>
      ) : null}
    </span>
  );
}

function NodeActions({
  node,
  canWrite,
  isDeleting,
  onCreate,
  onEdit,
  onMove,
  onDelete,
}: {
  node: NodeView;
  canWrite: boolean;
  isDeleting: boolean;
  onCreate: (mode: 'child' | 'sibling' | 'spouse', node: NodeView) => void;
  onEdit: (node: NodeView) => void;
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
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" size="sm">
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
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onEdit(node)}>
          <Pencil />
          编辑
        </DropdownMenuItem>
        <DropdownMenuItem disabled={isRoot} onSelect={() => onMove(node)}>
          <Move />
          移动
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(node)}>
          <Trash2 />
          删除
        </DropdownMenuItem>
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
  onCreate,
  onEdit,
  onMove,
  onDelete,
}: {
  bloodNodes: NodeView[];
  spousesByBlood: Map<string, NodeView[]>;
  canWrite: boolean;
  isDeleting: boolean;
  showGeneration: boolean;
  onCreate: (mode: 'child' | 'sibling' | 'spouse', node: NodeView) => void;
  onEdit: (node: NodeView) => void;
  onMove: (node: NodeView) => void;
  onDelete: (node: NodeView) => void;
}) {
  return (
    <TableBody>
      {bloodNodes.map((node) => {
        const spouses = spousesByBlood.get(node.id) ?? [];
        return (
          <TableRow key={node.id}>
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
                      canWrite={canWrite}
                      onEdit={onEdit}
                      onDelete={onDelete}
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
            <TableCell className="text-right">
              <NodeActions
                node={node}
                canWrite={canWrite}
                isDeleting={isDeleting}
                onCreate={onCreate}
                onEdit={onEdit}
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

export function LineageDetail({
  orgId,
  projectRef,
  lineage,
  nodes,
  folders,
  canWrite,
}: {
  orgId: string;
  projectRef: string;
  lineage: LineageInfo;
  nodes: NodeView[];
  folders: FolderOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [createDialog, setCreateDialog] = useState<CreateState>(null);
  const [editNode, setEditNode] = useState<NodeView | null>(null);
  const [moveNode, setMoveNode] = useState<NodeView | null>(null);
  const [editLineage, setEditLineage] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [isDeleting, startDelete] = useTransition();

  const bloodNodes = useMemo(
    () => nodes.filter((node) => node.role === 'blood'),
    [nodes]
  );
  const spousesByBlood = useMemo(() => {
    const map = new Map<string, NodeView[]>();
    for (const node of nodes) {
      if (node.role !== 'spouse' || !node.spouseOfId) {
        continue;
      }
      const bucket = map.get(node.spouseOfId) ?? [];
      bucket.push(node);
      map.set(node.spouseOfId, bucket);
    }
    return map;
  }, [nodes]);

  const visibleBlood = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return bloodNodes;
    }
    return bloodNodes.filter((node) => {
      const spouses = spousesByBlood.get(node.id) ?? [];
      return (
        node.fullName.toLowerCase().includes(needle) ||
        (node.courtesy ?? '').toLowerCase().includes(needle) ||
        (node.biography ?? '').toLowerCase().includes(needle) ||
        spouses.some((spouse) => spouse.fullName.toLowerCase().includes(needle))
      );
    });
  }, [bloodNodes, query, spousesByBlood]);

  const groups = useMemo(() => {
    if (query.trim()) {
      return [];
    }
    const map = new Map<number, NodeView[]>();
    for (const node of visibleBlood) {
      const bucket = map.get(node.generation) ?? [];
      bucket.push(node);
      map.set(node.generation, bucket);
    }
    return [...map.entries()].sort((left, right) => left[0] - right[0]);
  }, [visibleBlood, query]);

  function handleDelete(node: NodeView) {
    const count = node.role === 'blood' ? subtreeCount(node, nodes) : 1;
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
      router.refresh();
    });
  }

  function openCreate(mode: 'child' | 'sibling' | 'spouse', node: NodeView) {
    setCreateDialog({ mode, node });
  }

  const hasRoot = bloodNodes.length > 0;

  return (
    <section className="space-y-4 p-4 lg:p-6">
      <PageHeader
        icon={Users}
        title={lineage.name}
        description={`${lineage.surname}氏${
          lineage.hallCode ? ` · ${lineage.hallCode}` : ''
        } · ${lineage.nodeCount} 位人丁`}
        badge={<Badge variant="outline">谱系</Badge>}
        actions={
          <>
            <Button asChild variant="ghost" size="xs" className="print:hidden">
              <Link href={`/dashboard/project/${projectRef}/lineages`}>
                <ArrowLeft />
                返回谱系
              </Link>
            </Button>
            <Button
              variant="outline"
              size="xs"
              className="print:hidden"
              onClick={() => window.print()}
            >
              <Printer />
              打印
            </Button>
            {canWrite ? (
              <Button
                variant="brand"
                size="xs"
                className="print:hidden"
                onClick={() => setEditLineage(true)}
              >
                <Pencil />
                编辑谱系
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex items-center gap-2">
          {hasRoot ? (
            <Badge variant="outline">
              {groups.length > 0
                ? `共 ${groups.length} 世`
                : `${visibleBlood.length} 条匹配`}
            </Badge>
          ) : null}
          {lineage.generationWords && lineage.generationWords.length > 0 ? (
            <span className="text-xs text-muted-foreground">
              字辈：{lineage.generationWords.join(' ')}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索姓名、字号或配偶"
              size="sm"
              aria-label="搜索人丁"
              className="w-56 pl-7"
            />
          </div>
        </div>
      </div>

      {notice ? (
        <p className="text-sm text-destructive print:hidden">{notice}</p>
      ) : null}

      {!hasRoot ? (
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
      ) : visibleBlood.length === 0 ? (
        <Card size="dense">
          <EmptyState
            icon={Search}
            title="没有匹配的人丁"
            description="试试其他姓名、字号，或清空搜索条件。"
          />
        </Card>
      ) : query.trim() ? (
        <Card size="dense">
          <Table size="dense">
            <TableHeader>
              <TableRow>
                <TableHead>世次</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead>性别</TableHead>
                <TableHead>生卒</TableHead>
                <TableHead className="text-right print:hidden">操作</TableHead>
              </TableRow>
            </TableHeader>
            <NodeRows
              bloodNodes={visibleBlood}
              spousesByBlood={spousesByBlood}
              canWrite={canWrite}
              isDeleting={isDeleting}
              showGeneration
              onCreate={openCreate}
              onEdit={setEditNode}
              onMove={setMoveNode}
              onDelete={handleDelete}
            />
          </Table>
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map(([generation, generationNodes]) => {
            const word = generationWord(lineage.generationWords, generation);
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
                  {word ? <Badge variant="outline">字辈 · {word}</Badge> : null}
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
                    onCreate={openCreate}
                    onEdit={setEditNode}
                    onMove={setMoveNode}
                    onDelete={handleDelete}
                  />
                </Table>
              </Card>
            );
          })}
        </div>
      )}

      {createDialog ? (
        <NodeCreateDialog
          key={
            createDialog.mode === 'root'
              ? 'root'
              : `${createDialog.mode}-${createDialog.node.id}`
          }
          mode={createDialog.mode}
          orgId={orgId}
          lineageId={lineage.id}
          lineageSurname={lineage.surname}
          target={createDialog.mode === 'root' ? undefined : createDialog.node}
          onClose={() => setCreateDialog(null)}
        />
      ) : null}

      {editNode ? (
        <NodeEditDialog
          key={editNode.id}
          orgId={orgId}
          lineageId={lineage.id}
          node={editNode}
          onClose={() => setEditNode(null)}
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
    </section>
  );
}
