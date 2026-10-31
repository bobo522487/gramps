'use client';

import { Heart, UserPlus, X } from 'lucide-react';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { generationWord, RANK_LABELS } from '@/components/lineage/derived';
import {
  type LineageIndex,
  useLineageIndex,
} from '@/components/lineage/lineage-index-context';
import type { NodeView } from '@/components/lineage/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ActionState } from '@/lib/auth/types';
import {
  addChildAction,
  addPersonAction,
  addSiblingAction,
  addSpouseAction,
  createRootNodeAction,
} from '@/lib/lineage/actions';

export type NodeCreateMode = 'root' | 'child' | 'sibling' | 'spouse' | 'person';

const COPY: Record<
  NodeCreateMode,
  { title: string; submit: string; description: (target?: string) => string }
> = {
  root: {
    title: '录入始祖',
    submit: '录入始祖',
    description: () => '始祖为谱系第一世，录入后可逐代添加子女与配偶。',
  },
  child: {
    title: '添加子女',
    submit: '添加子女',
    description: (target) =>
      `为「${target}」添加子女，世次自动加一，字辈按谱系字辈表推导。`,
  },
  sibling: {
    title: '添加兄弟',
    submit: '添加兄弟',
    description: (target) =>
      `为「${target}」添加同辈兄弟，世次与父辈保持一致。`,
  },
  spouse: {
    title: '添加配偶',
    submit: '添加配偶',
    description: (target) =>
      `为「${target}」添加配偶，配偶同世次展示，不参与世系路径。`,
  },
  person: {
    title: '新增族人',
    submit: '确定录入',
    description: () => '选择承祧父辈后录入。世次、字辈与排行由谱系树自动推导。',
  },
};

function nextRank(index: LineageIndex, parentId: string | null, sex: number) {
  if (!parentId) {
    return '始祖';
  }
  const siblings = (index.childrenByParent.get(parentId) ?? []).filter(
    (node) => node.sex === sex
  );
  const labels = sex === 1 ? RANK_LABELS.female : RANK_LABELS.male;
  return (
    labels[siblings.length] ??
    `第${siblings.length + 1}${sex === 1 ? '女' : '子'}`
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }
  return <p className="mt-1 text-xs text-destructive">{message}</p>;
}

export function NodeCreateDialog({
  mode,
  orgId,
  lineageId,
  lineageSurname,
  generationWords,
  target,
  onCreated,
  onClose,
}: {
  mode: NodeCreateMode;
  orgId: string;
  lineageId: string;
  lineageSurname: string;
  generationWords: string[] | null;
  target?: NodeView;
  onCreated: (nodeId: string, spouseId?: string) => void;
  onClose: () => void;
}) {
  const index = useLineageIndex();
  const action =
    mode === 'root'
      ? createRootNodeAction
      : mode === 'child'
        ? addChildAction
        : mode === 'sibling'
          ? addSiblingAction
          : mode === 'spouse'
            ? addSpouseAction
            : addPersonAction;
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    action,
    {}
  );
  const handled = useRef<string | null>(null);

  const hasRoot = index.blood.length > 0;
  const [parentId, setParentId] = useState(() => {
    if (mode === 'child') {
      return target?.id ?? '';
    }
    if (mode === 'spouse') {
      return '';
    }
    if (mode === 'person') {
      return target?.id ?? index.roots[0]?.id ?? '';
    }
    return '';
  });
  const [sex, setSex] = useState(() => {
    if (mode === 'spouse' && target) {
      return target.sex === 0 ? 1 : 0;
    }
    return 0;
  });

  useEffect(() => {
    if (!state.nodeId || handled.current === state.nodeId) {
      return;
    }
    handled.current = state.nodeId;
    onCreated(state.nodeId, state.spouseId);
  }, [state.nodeId, state.spouseId, onCreated]);

  const generation =
    mode === 'root'
      ? 1
      : mode === 'child'
        ? (target?.generation ?? 0) + 1
        : mode === 'sibling' || mode === 'spouse'
          ? (target?.generation ?? 1)
          : (index.byId.get(parentId)?.generation ?? 0) + 1;
  const word = generationWord(generationWords, generation);
  const rank =
    mode === 'spouse'
      ? '配'
      : mode === 'child'
        ? nextRank(index, target?.id ?? null, sex)
        : mode === 'sibling'
          ? nextRank(index, target?.parentId ?? null, sex)
          : mode === 'person'
            ? nextRank(index, parentId || null, sex)
            : '始祖';

  const copy = COPY[mode];
  const isSpouseMode = mode === 'spouse';
  const canCoRecordSpouse = !isSpouseMode;
  const parentOptions = useMemo(
    () =>
      index.blood
        .slice()
        .sort(
          (left, right) =>
            left.generation - right.generation || left.sort - right.sort
        ),
    [index.blood]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/20 px-5 py-4">
          <div className="flex items-center gap-2">
            {isSpouseMode ? (
              <Heart size={18} className="text-primary" />
            ) : (
              <UserPlus size={18} className="text-primary" />
            )}
            <div>
              <h2 className="text-sm font-bold text-foreground">
                {copy.title}
                {target ? ` · ${target.fullName}` : ''}
              </h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {copy.description(target?.fullName)}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            title="关闭"
            aria-label="关闭"
          >
            <X size={14} />
          </Button>
        </div>

        <form
          action={formAction}
          noValidate
          className="flex-1 space-y-4 overflow-y-auto p-5 text-xs"
        >
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="lineageId" value={lineageId} />
          {mode === 'child' && target ? (
            <input type="hidden" name="parentId" value={target.id} />
          ) : null}
          {mode === 'sibling' && target ? (
            <input type="hidden" name="siblingOfId" value={target.id} />
          ) : null}
          {isSpouseMode && target ? (
            <input type="hidden" name="spouseOfId" value={target.id} />
          ) : null}
          {mode === 'person' ? (
            <input type="hidden" name="parentId" value={parentId} />
          ) : null}

          {mode === 'person' ? (
            <div>
              <Label
                htmlFor="create-node-parent"
                className="text-[11px] text-muted-foreground"
              >
                承祧父辈
              </Label>
              <select
                id="create-node-parent"
                value={parentId}
                onChange={(event) => setParentId(event.target.value)}
                className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
              >
                {!hasRoot ? (
                  <option value="">无父祖（录入为始祖第一世）</option>
                ) : null}
                {parentOptions.map((person) => (
                  <option key={person.id} value={person.id}>
                    第 {person.generation} 世 · {person.fullName}
                    {person.courtesy ? `（字${person.courtesy}）` : ''}
                  </option>
                ))}
              </select>
              <FieldError message={state.fieldErrors?.parentId} />
            </div>
          ) : null}

          <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted/20 p-2.5 text-center">
            <div>
              <div className="text-[10px] text-muted-foreground">世次</div>
              <div className="mt-0.5 font-serif text-sm font-semibold text-foreground">
                第 {generation} 世
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">字辈</div>
              <div className="mt-0.5 font-serif text-sm font-semibold text-foreground">
                {word ?? '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">排行</div>
              <div className="mt-0.5 font-serif text-sm font-semibold text-foreground">
                {rank}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label
                htmlFor="create-node-name"
                className="text-[11px] text-muted-foreground"
              >
                姓名 *
              </Label>
              <Input
                id="create-node-name"
                name="name"
                defaultValue={isSpouseMode ? '氏' : ''}
                placeholder={isSpouseMode ? '如：氏、秀英' : '名讳，如：伯康'}
                maxLength={60}
                className="mt-1 h-8 text-xs font-semibold"
                autoFocus
              />
              <FieldError message={state.fieldErrors?.name} />
            </div>
            <div>
              <Label
                htmlFor="create-node-surname"
                className="text-[11px] text-muted-foreground"
              >
                姓氏{isSpouseMode ? ' *' : ''}
              </Label>
              <Input
                id="create-node-surname"
                name="surname"
                defaultValue={isSpouseMode ? '' : lineageSurname}
                placeholder={isSpouseMode ? '配偶姓氏，如：王' : '姓氏'}
                maxLength={30}
                className="mt-1 h-8 text-xs"
              />
              <FieldError message={state.fieldErrors?.surname} />
            </div>
          </div>

          <div>
            <Label className="text-[11px] text-muted-foreground">性别</Label>
            {isSpouseMode ? (
              <>
                <input type="hidden" name="sex" value={sex} />
                <p className="mt-1 h-8 rounded-md border border-input bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
                  {sex === 1 ? '女' : '男'}（配偶与本人性别相反）
                </p>
              </>
            ) : (
              <div className="mt-1 flex h-8 items-center gap-5">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="sex"
                    value="0"
                    checked={sex === 0}
                    onChange={() => setSex(0)}
                    className="accent-primary"
                  />
                  男
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="sex"
                    value="1"
                    checked={sex === 1}
                    onChange={() => setSex(1)}
                    className="accent-primary"
                  />
                  女
                </label>
              </div>
            )}
            <FieldError message={state.fieldErrors?.sex} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label
                htmlFor="create-node-courtesy"
                className="text-[11px] text-muted-foreground"
              >
                字 / 号
              </Label>
              <Input
                id="create-node-courtesy"
                name="courtesy"
                placeholder="如：子安"
                maxLength={60}
                className="mt-1 h-8 text-xs"
              />
              <FieldError message={state.fieldErrors?.courtesy} />
            </div>
            <div>
              <Label
                htmlFor="create-node-prefix"
                className="text-[11px] text-muted-foreground"
              >
                前缀
              </Label>
              <Input
                id="create-node-prefix"
                name="namePrefix"
                placeholder="如：讳、字"
                maxLength={60}
                className="mt-1 h-8 text-xs"
              />
              <FieldError message={state.fieldErrors?.namePrefix} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              name="isAlive"
              className="size-4 rounded border-input accent-primary"
            />
            在世（默认按已故录入）
          </label>

          {canCoRecordSpouse ? (
            <fieldset className="space-y-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-[11px] text-muted-foreground">
                同录配偶（可留空）
              </legend>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label
                    htmlFor="create-node-spouse-surname"
                    className="text-[11px] text-muted-foreground"
                  >
                    配偶姓氏
                  </Label>
                  <Input
                    id="create-node-spouse-surname"
                    name="spouseSurname"
                    placeholder="如：王"
                    maxLength={30}
                    className="mt-1 h-8 text-xs"
                  />
                  <FieldError message={state.fieldErrors?.spouseSurname} />
                </div>
                <div>
                  <Label
                    htmlFor="create-node-spouse-name"
                    className="text-[11px] text-muted-foreground"
                  >
                    配偶名讳
                  </Label>
                  <Input
                    id="create-node-spouse-name"
                    name="spouseName"
                    placeholder="如：氏（组合为王氏）"
                    maxLength={60}
                    className="mt-1 h-8 text-xs"
                  />
                  <FieldError message={state.fieldErrors?.spouseName} />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                配偶姓氏与名讳需同时填写；只填姓氏时可在名讳处填「氏」。
              </p>
            </fieldset>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label
                htmlFor="create-node-birth-text"
                className="text-[11px] text-muted-foreground"
              >
                生辰
              </Label>
              <Input
                id="create-node-birth-text"
                name="birthText"
                placeholder="如：明永乐元年癸未四月初八日"
                maxLength={60}
                className="mt-1 h-8 text-xs"
              />
              <FieldError message={state.fieldErrors?.birthText} />
            </div>
            <div>
              <Label
                htmlFor="create-node-birth-year"
                className="text-[11px] text-muted-foreground"
              >
                生年
              </Label>
              <Input
                id="create-node-birth-year"
                name="birthYear"
                type="number"
                min={1}
                max={9999}
                placeholder="如：1403"
                className="mt-1 h-8 text-xs"
              />
              <FieldError message={state.fieldErrors?.birthYear} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label
                htmlFor="create-node-death-text"
                className="text-[11px] text-muted-foreground"
              >
                忌辰
              </Label>
              <Input
                id="create-node-death-text"
                name="deathText"
                placeholder="如：明正统十年"
                maxLength={60}
                className="mt-1 h-8 text-xs"
              />
              <FieldError message={state.fieldErrors?.deathText} />
            </div>
            <div>
              <Label
                htmlFor="create-node-death-year"
                className="text-[11px] text-muted-foreground"
              >
                卒年
              </Label>
              <Input
                id="create-node-death-year"
                name="deathYear"
                type="number"
                min={1}
                max={9999}
                placeholder="如：1445"
                className="mt-1 h-8 text-xs"
              />
              <FieldError message={state.fieldErrors?.deathYear} />
            </div>
          </div>

          <div>
            <Label
              htmlFor="create-node-burial"
              className="text-[11px] text-muted-foreground"
            >
              葬地
            </Label>
            <Input
              id="create-node-burial"
              name="burialPlace"
              placeholder="如：桐梓凤凰山，坐东向西"
              maxLength={100}
              className="mt-1 h-8 text-xs"
            />
            <FieldError message={state.fieldErrors?.burialPlace} />
          </div>

          <div>
            <Label
              htmlFor="create-node-biography"
              className="text-[11px] text-muted-foreground"
            >
              行传
            </Label>
            <Textarea
              id="create-node-biography"
              name="biography"
              rows={3}
              maxLength={2000}
              placeholder="生平事略、功名、迁徙等"
              className="mt-1 text-xs"
            />
            <FieldError message={state.fieldErrors?.biography} />
          </div>

          {state.error ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}

          <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              取消
            </Button>
            <Button
              type="submit"
              variant="brand"
              size="sm"
              className="px-5"
              disabled={isPending}
            >
              {isPending ? '保存中…' : copy.submit}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
