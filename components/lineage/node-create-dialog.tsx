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
import type { ActionState } from '@/lib/auth/types';
import {
  addChildAction,
  addSiblingAction,
  addSpouseAction,
  createRootNodeAction,
} from '@/lib/lineage/actions';

export type NodeCreateMode = 'root' | 'child' | 'sibling' | 'spouse';

const COPY: Record<
  NodeCreateMode,
  { title: string; description: (target?: string) => string; submit: string }
> = {
  root: {
    title: '录入始祖',
    description: () => '始祖为谱系第一世，录入后可逐代添加子女。',
    submit: '录入始祖',
  },
  child: {
    title: '添加子女',
    description: (target) =>
      `为「${target}」添加子女，世次自动加一，姓氏默认沿用谱系姓氏。`,
    submit: '添加子女',
  },
  sibling: {
    title: '添加兄弟',
    description: (target) =>
      `为「${target}」添加同辈兄弟，世次与父辈保持一致。`,
    submit: '添加兄弟',
  },
  spouse: {
    title: '添加配偶',
    description: (target) =>
      `为「${target}」添加配偶，配偶与本人同世次，不参与世系路径。`,
    submit: '添加配偶',
  },
};

export function NodeCreateDialog({
  mode,
  orgId,
  lineageId,
  lineageSurname,
  target,
  onClose,
}: {
  mode: NodeCreateMode;
  orgId: string;
  lineageId: string;
  lineageSurname: string;
  target?: NodeView;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    mode === 'root'
      ? createRootNodeAction
      : mode === 'child'
        ? addChildAction
        : mode === 'sibling'
          ? addSiblingAction
          : addSpouseAction,
    {}
  );

  useEffect(() => {
    if (state.nodeId) {
      router.refresh();
      onClose();
    }
  }, [state.nodeId, router, onClose]);

  const copy = COPY[mode];
  const defaultSex =
    mode === 'spouse' && target ? String(target.sex === 0 ? 1 : 0) : '0';

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            {copy.description(target?.fullName)}
          </DialogDescription>
        </DialogHeader>
        <form action={action} noValidate className="space-y-4">
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="lineageId" value={lineageId} />
          {mode === 'child' && target ? (
            <input type="hidden" name="parentId" value={target.id} />
          ) : null}
          {mode === 'sibling' && target ? (
            <input type="hidden" name="siblingOfId" value={target.id} />
          ) : null}
          {mode === 'spouse' && target ? (
            <input type="hidden" name="spouseOfId" value={target.id} />
          ) : null}

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
            <div>
              <Label htmlFor={`${mode}-node-name`}>姓名</Label>
              <Input
                id={`${mode}-node-name`}
                name="name"
                placeholder="名讳"
                maxLength={60}
                autoFocus
              />
              {state.fieldErrors?.name ? (
                <p className="mt-1 text-xs text-destructive">
                  {state.fieldErrors.name}
                </p>
              ) : null}
            </div>
            <div>
              <Label htmlFor={`${mode}-node-surname`}>姓氏</Label>
              <Input
                id={`${mode}-node-surname`}
                name="surname"
                defaultValue={mode === 'spouse' ? '' : lineageSurname}
                placeholder={mode === 'spouse' ? '配偶姓氏' : undefined}
                maxLength={30}
              />
              {state.fieldErrors?.surname ? (
                <p className="mt-1 text-xs text-destructive">
                  {state.fieldErrors.surname}
                </p>
              ) : null}
            </div>
          </div>

          <div>
            <Label>性别</Label>
            <RadioGroup
              name="sex"
              defaultValue={defaultSex}
              className="mt-2 flex gap-5"
            >
              <label
                htmlFor={`${mode}-node-sex-male`}
                className="flex items-center gap-2 text-sm"
              >
                <RadioGroupItem id={`${mode}-node-sex-male`} value="0" />男
              </label>
              <label
                htmlFor={`${mode}-node-sex-female`}
                className="flex items-center gap-2 text-sm"
              >
                <RadioGroupItem id={`${mode}-node-sex-female`} value="1" />女
              </label>
            </RadioGroup>
            {state.fieldErrors?.sex ? (
              <p className="mt-1 text-xs text-destructive">
                {state.fieldErrors.sex}
              </p>
            ) : null}
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
              {isPending ? '保存中…' : copy.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
