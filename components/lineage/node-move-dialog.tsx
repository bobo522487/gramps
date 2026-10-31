'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useState } from 'react';
import type { NodeView } from '@/components/lineage/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ActionState } from '@/lib/auth/types';
import { moveNodeAction } from '@/lib/lineage/actions';

function descendantsOf(node: NodeView, nodes: NodeView[]) {
  const childrenByParent = new Map<string, NodeView[]>();
  for (const candidate of nodes) {
    if (candidate.role !== 'blood' || !candidate.parentId) {
      continue;
    }
    const bucket = childrenByParent.get(candidate.parentId) ?? [];
    bucket.push(candidate);
    childrenByParent.set(candidate.parentId, bucket);
  }

  const result = new Set<string>([node.id]);
  const queue = [node];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    for (const child of childrenByParent.get(current.id) ?? []) {
      if (!result.has(child.id)) {
        result.add(child.id);
        queue.push(child);
      }
    }
  }
  return result;
}

export function NodeMoveDialog({
  orgId,
  lineageId,
  node,
  nodes,
  onClose,
}: {
  orgId: string;
  lineageId: string;
  node: NodeView;
  nodes: NodeView[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    moveNodeAction,
    {}
  );
  const [parentId, setParentId] = useState('');

  const candidates = useMemo(() => {
    const excluded = descendantsOf(node, nodes);
    return nodes
      .filter(
        (candidate) => candidate.role === 'blood' && !excluded.has(candidate.id)
      )
      .sort(
        (left, right) =>
          left.generation - right.generation || left.sort - right.sort
      );
  }, [node, nodes]);

  useEffect(() => {
    if (state.nodeId) {
      router.refresh();
      onClose();
    }
  }, [state.nodeId, router, onClose]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>移动人丁</DialogTitle>
          <DialogDescription>
            将「{node.fullName}
            」及其子孙移动到新的父辈下，世次与路径会重新计算。
          </DialogDescription>
        </DialogHeader>
        <form action={action} noValidate className="space-y-4">
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="lineageId" value={lineageId} />
          <input type="hidden" name="nodeId" value={node.id} />
          <input type="hidden" name="newParentId" value={parentId} />

          <div>
            <Label htmlFor="move-node-parent">新的父辈</Label>
            {candidates.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                没有可选的父辈。始祖不能移动，也不能移动到自己的子孙下。
              </p>
            ) : (
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger id="move-node-parent" className="mt-2">
                  <SelectValue placeholder="选择新的父辈" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.fullName}（第 {candidate.generation} 世）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {state.error ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                取消
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant="brand"
              disabled={isPending || !parentId}
            >
              {isPending ? '移动中…' : '确认移动'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
