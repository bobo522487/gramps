'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import type { ActionState } from '@/lib/auth/types';
import { updateNodeAction } from '@/lib/lineage/actions';

export function NodeEditDialog({
  orgId,
  lineageId,
  node,
  onClose,
}: {
  orgId: string;
  lineageId: string;
  node: NodeView;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    updateNodeAction,
    {}
  );

  useEffect(() => {
    if (state.nodeId) {
      router.refresh();
      onClose();
    }
  }, [state.nodeId, router, onClose]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>编辑人丁</DialogTitle>
          <DialogDescription>
            第 {node.generation} 世 · {node.role === 'spouse' ? '配偶' : '本宗'}
          </DialogDescription>
        </DialogHeader>
        <form action={action} noValidate className="space-y-4">
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="lineageId" value={lineageId} />
          <input type="hidden" name="nodeId" value={node.id} />

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_100px_120px]">
            <div>
              <Label htmlFor="edit-node-name">姓名</Label>
              <Input
                id="edit-node-name"
                name="name"
                defaultValue={node.name}
                maxLength={60}
              />
              {state.fieldErrors?.name ? (
                <p className="mt-1 text-xs text-destructive">
                  {state.fieldErrors.name}
                </p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="edit-node-surname">姓氏</Label>
              <Input
                id="edit-node-surname"
                name="surname"
                defaultValue={node.surname}
                maxLength={30}
              />
            </div>
            <div>
              <Label>性别</Label>
              <RadioGroup
                name="sex"
                defaultValue={String(node.sex)}
                className="mt-2 flex gap-4"
              >
                <label
                  htmlFor="edit-node-sex-male"
                  className="flex items-center gap-2 text-sm"
                >
                  <RadioGroupItem id="edit-node-sex-male" value="0" />男
                </label>
                <label
                  htmlFor="edit-node-sex-female"
                  className="flex items-center gap-2 text-sm"
                >
                  <RadioGroupItem id="edit-node-sex-female" value="1" />女
                </label>
              </RadioGroup>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="edit-node-prefix">前缀</Label>
              <Input
                id="edit-node-prefix"
                name="namePrefix"
                defaultValue={node.namePrefix ?? ''}
                placeholder="如：讳、字"
                maxLength={60}
              />
            </div>
            <div>
              <Label htmlFor="edit-node-courtesy">字号</Label>
              <Input
                id="edit-node-courtesy"
                name="courtesy"
                defaultValue={node.courtesy ?? ''}
                placeholder="如：字伯玉"
                maxLength={60}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="edit-node-birth-text">生辰</Label>
              <Input
                id="edit-node-birth-text"
                name="birthText"
                defaultValue={node.birthText ?? ''}
                placeholder="如：光绪二十年"
                maxLength={60}
              />
            </div>
            <div>
              <Label htmlFor="edit-node-birth-year">生年</Label>
              <Input
                id="edit-node-birth-year"
                name="birthYear"
                type="number"
                min={1}
                max={9999}
                defaultValue={node.birthYear ?? ''}
                placeholder="如：1894"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="edit-node-death-text">忌辰</Label>
              <Input
                id="edit-node-death-text"
                name="deathText"
                defaultValue={node.deathText ?? ''}
                placeholder="如：民国十年"
                maxLength={60}
              />
            </div>
            <div>
              <Label htmlFor="edit-node-death-year">卒年</Label>
              <Input
                id="edit-node-death-year"
                name="deathYear"
                type="number"
                min={1}
                max={9999}
                defaultValue={node.deathYear ?? ''}
                placeholder="如：1921"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <Label htmlFor="edit-node-burial">葬地</Label>
              <Input
                id="edit-node-burial"
                name="burialPlace"
                defaultValue={node.burialPlace ?? ''}
                maxLength={100}
              />
            </div>
            <label
              htmlFor="edit-node-alive"
              className="mt-1 flex items-center gap-2 self-end pb-2 text-sm sm:mt-0"
            >
              <input
                id="edit-node-alive"
                name="isAlive"
                type="checkbox"
                defaultChecked={node.isAlive}
                className="size-4 rounded border-input accent-primary"
              />
              在世
            </label>
          </div>

          <div>
            <Label htmlFor="edit-node-biography">行传</Label>
            <Textarea
              id="edit-node-biography"
              name="biography"
              defaultValue={node.biography ?? ''}
              rows={4}
              maxLength={2000}
              placeholder="生平事略、功名、迁徙等"
            />
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
            <Button type="submit" variant="brand" disabled={isPending}>
              {isPending ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
