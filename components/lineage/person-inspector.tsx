'use client';

import { CheckCircle2, Heart, Plus, Save, Trash2, User, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  type CSSProperties,
  useActionState,
  useEffect,
  useRef,
  useState,
} from 'react';
import { generationWord, rankLabel } from '@/components/lineage/derived';
import {
  type LineageIndex,
  useLineageIndex,
} from '@/components/lineage/lineage-index-context';
import type { NodeView } from '@/components/lineage/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ActionState } from '@/lib/auth/types';
import { updateNodeAction } from '@/lib/lineage/actions';

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }
  return <p className="mt-1 text-xs text-destructive">{message}</p>;
}

function EmptyInspector({ width }: { width: number }) {
  return (
    <aside
      style={{ '--inspector-width': `${width}px` } as CSSProperties}
      className="hidden h-full shrink-0 flex-col items-center justify-center border-l border-border bg-card p-6 text-center text-muted-foreground lg:flex lg:w-[var(--inspector-width)]"
    >
      <User size={40} className="mb-3 text-muted-foreground/40" />
      <h3 className="text-sm font-semibold text-foreground">未选择族人</h3>
      <p className="mt-1 max-w-[200px] text-xs">
        在谱系图或世系表中点击任意族人，可在此查看并编辑行传与生卒档案。
      </p>
    </aside>
  );
}

export function PersonInspector({
  orgId,
  lineageId,
  generationWords,
  node,
  canWrite,
  width,
  isResizing,
  onResizeStart,
  onClose,
  onSelectNode,
  onAddChild,
  onAddSpouse,
  onDelete,
}: {
  orgId: string;
  lineageId: string;
  generationWords: string[] | null;
  node: NodeView | null;
  canWrite: boolean;
  width: number;
  isResizing: boolean;
  onResizeStart: () => void;
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
  onAddChild: (nodeId: string) => void;
  onAddSpouse: (nodeId: string) => void;
  onDelete: (target: NodeView) => void;
}) {
  const index = useLineageIndex();

  if (!node) {
    return <EmptyInspector width={width} />;
  }

  return (
    <PersonInspectorForm
      key={node.id}
      orgId={orgId}
      lineageId={lineageId}
      generationWords={generationWords}
      index={index}
      node={node}
      canWrite={canWrite}
      width={width}
      isResizing={isResizing}
      onResizeStart={onResizeStart}
      onClose={onClose}
      onSelectNode={onSelectNode}
      onAddChild={onAddChild}
      onAddSpouse={onAddSpouse}
      onDelete={onDelete}
    />
  );
}

function PersonInspectorForm({
  orgId,
  lineageId,
  generationWords,
  index,
  node,
  canWrite,
  width,
  isResizing,
  onResizeStart,
  onClose,
  onSelectNode,
  onAddChild,
  onAddSpouse,
  onDelete,
}: {
  orgId: string;
  lineageId: string;
  generationWords: string[] | null;
  index: LineageIndex;
  node: NodeView;
  canWrite: boolean;
  width: number;
  isResizing: boolean;
  onResizeStart: () => void;
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
  onAddChild: (nodeId: string) => void;
  onAddSpouse: (nodeId: string) => void;
  onDelete: (target: NodeView) => void;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    updateNodeAction,
    {}
  );
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!state.nodeId) {
      return;
    }
    router.refresh();
    setSaved(true);
    if (savedTimer.current) {
      window.clearTimeout(savedTimer.current);
    }
    savedTimer.current = window.setTimeout(() => setSaved(false), 2200);
  }, [state.nodeId, router]);

  useEffect(
    () => () => {
      if (savedTimer.current) {
        window.clearTimeout(savedTimer.current);
      }
    },
    []
  );

  const parent = node.parentId ? index.byId.get(node.parentId) : null;
  const spouseOf =
    node.role === 'spouse' && node.spouseOfId
      ? index.byId.get(node.spouseOfId)
      : null;
  const spouses =
    node.role === 'blood' ? (index.spousesByBlood.get(node.id) ?? []) : [];
  const word = generationWord(generationWords, node.generation);
  const rank = rankLabel(index, node);
  const isRoot = node.role === 'blood' && !node.parentId;

  return (
    <>
      <button
        type="button"
        aria-label="关闭族人详情"
        onClick={onClose}
        className="fixed inset-0 z-30 bg-foreground/30 backdrop-blur-sm lg:hidden"
      />
      <aside
        style={{ '--inspector-width': `${width}px` } as CSSProperties}
        className="fixed inset-0 z-40 flex h-full w-full flex-col overflow-hidden bg-card lg:relative lg:inset-auto lg:z-20 lg:h-full lg:w-[var(--inspector-width)] lg:shrink-0 lg:border-l lg:border-border"
      >
        <button
          type="button"
          aria-label="调整族人详情栏宽度"
          onMouseDown={(event) => {
            event.preventDefault();
            onResizeStart();
          }}
          className={`absolute inset-y-0 left-0 z-30 hidden w-1 cursor-col-resize transition-colors hover:bg-primary/40 lg:block ${
            isResizing ? 'bg-primary/50' : 'bg-transparent'
          }`}
        />

        <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/20 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
              {node.fullName.slice(-1)}
            </div>
            <div className="min-w-0">
              <h3 className="flex items-center gap-1.5 truncate text-sm font-bold text-foreground">
                {node.fullName}
                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                  第 {node.generation} 世
                </Badge>
              </h3>
              <span className="text-[10px] text-muted-foreground">
                {node.role === 'spouse' ? '配偶' : rank || '本宗'} ·{' '}
                {node.sex === 1 ? '女' : '男'} ·{' '}
                {node.isAlive ? '在世' : '已故'}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {saved ? (
              <span className="flex items-center gap-1 text-xs font-medium text-primary">
                <CheckCircle2 size={13} /> 已保存
              </span>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              title="关闭详情"
              aria-label="关闭详情"
            >
              <X size={14} />
            </Button>
          </div>
        </div>

        <form
          action={formAction}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="lineageId" value={lineageId} />
          <input type="hidden" name="nodeId" value={node.id} />

          <div className="flex-1 space-y-5 overflow-y-auto p-4 text-xs">
            <section className="space-y-3">
              <h4 className="text-xs font-bold text-muted-foreground">
                基本信息
              </h4>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <Label
                    htmlFor="inspector-name"
                    className="text-[11px] text-muted-foreground"
                  >
                    姓名 *
                  </Label>
                  <Input
                    id="inspector-name"
                    name="name"
                    defaultValue={node.name}
                    maxLength={60}
                    className="mt-1 h-8 text-xs font-semibold"
                  />
                  <FieldError message={state.fieldErrors?.name} />
                </div>
                <div>
                  <Label
                    htmlFor="inspector-surname"
                    className="text-[11px] text-muted-foreground"
                  >
                    姓氏 *
                  </Label>
                  <Input
                    id="inspector-surname"
                    name="surname"
                    defaultValue={node.surname}
                    maxLength={30}
                    className="mt-1 h-8 text-xs"
                  />
                  <FieldError message={state.fieldErrors?.surname} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <Label
                    htmlFor="inspector-courtesy"
                    className="text-[11px] text-muted-foreground"
                  >
                    字 / 号
                  </Label>
                  <Input
                    id="inspector-courtesy"
                    name="courtesy"
                    defaultValue={node.courtesy ?? ''}
                    maxLength={60}
                    className="mt-1 h-8 text-xs"
                  />
                  <FieldError message={state.fieldErrors?.courtesy} />
                </div>
                <div>
                  <Label
                    htmlFor="inspector-prefix"
                    className="text-[11px] text-muted-foreground"
                  >
                    前缀
                  </Label>
                  <Input
                    id="inspector-prefix"
                    name="namePrefix"
                    defaultValue={node.namePrefix ?? ''}
                    maxLength={60}
                    className="mt-1 h-8 text-xs"
                  />
                  <FieldError message={state.fieldErrors?.namePrefix} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <Label
                    htmlFor="inspector-sex"
                    className="text-[11px] text-muted-foreground"
                  >
                    性别
                  </Label>
                  <select
                    id="inspector-sex"
                    name="sex"
                    defaultValue={String(node.sex)}
                    className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                  >
                    <option value="0">男</option>
                    <option value="1">女</option>
                  </select>
                  <FieldError message={state.fieldErrors?.sex} />
                </div>
                <label className="flex items-center gap-2 self-end pb-1.5">
                  <input
                    type="checkbox"
                    name="isAlive"
                    defaultChecked={node.isAlive}
                    className="size-4 rounded border-input accent-primary"
                  />
                  在世
                </label>
              </div>
            </section>

            <section className="space-y-2 border-t border-border/60 pt-3">
              <h4 className="text-xs font-bold text-muted-foreground">
                世系信息
              </h4>
              <dl className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <dt className="text-muted-foreground">世次</dt>
                  <dd className="font-medium text-foreground">
                    第 {node.generation} 世
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">字辈</dt>
                  <dd className="font-medium text-foreground">{word ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">排行</dt>
                  <dd className="font-medium text-foreground">{rank || '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {node.role === 'spouse' ? '所属血亲' : '父祖'}
                  </dt>
                  <dd>
                    {node.role === 'spouse' ? (
                      spouseOf ? (
                        <button
                          type="button"
                          onClick={() => onSelectNode(spouseOf.id)}
                          className="font-medium text-primary hover:underline"
                        >
                          {spouseOf.fullName}
                        </button>
                      ) : (
                        '—'
                      )
                    ) : parent ? (
                      <button
                        type="button"
                        onClick={() => onSelectNode(parent.id)}
                        className="font-medium text-primary hover:underline"
                      >
                        {parent.fullName}（第 {parent.generation} 世）
                      </button>
                    ) : (
                      '始祖'
                    )}
                  </dd>
                </div>
              </dl>
            </section>

            {node.role === 'blood' ? (
              <section className="space-y-2 border-t border-border/60 pt-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-muted-foreground">
                    配偶（{spouses.length}）
                  </h4>
                  {canWrite ? (
                    <button
                      type="button"
                      onClick={() => onAddSpouse(node.id)}
                      className="flex items-center gap-0.5 text-[11px] text-primary hover:underline"
                    >
                      <Plus size={12} /> 添配
                    </button>
                  ) : null}
                </div>
                {spouses.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    暂无配偶记录。
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {spouses.map((spouse) => (
                      <span
                        key={spouse.id}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2 py-1 text-[11px] text-foreground"
                      >
                        <Heart size={11} className="text-primary" />
                        <button
                          type="button"
                          onClick={() => onSelectNode(spouse.id)}
                          className="hover:text-primary hover:underline"
                        >
                          {spouse.fullName}
                        </button>
                        {canWrite ? (
                          <button
                            type="button"
                            onClick={() => onDelete(spouse)}
                            className="text-muted-foreground transition-colors hover:text-destructive"
                            title={`删除配偶 ${spouse.fullName}`}
                            aria-label={`删除配偶 ${spouse.fullName}`}
                          >
                            <Trash2 size={11} />
                          </button>
                        ) : null}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            <section className="space-y-3 border-t border-border/60 pt-3">
              <h4 className="text-xs font-bold text-muted-foreground">生卒</h4>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <Label
                    htmlFor="inspector-birth-text"
                    className="text-[11px] text-muted-foreground"
                  >
                    生辰
                  </Label>
                  <Input
                    id="inspector-birth-text"
                    name="birthText"
                    defaultValue={node.birthText ?? ''}
                    maxLength={60}
                    className="mt-1 h-8 text-xs"
                  />
                  <FieldError message={state.fieldErrors?.birthText} />
                </div>
                <div>
                  <Label
                    htmlFor="inspector-birth-year"
                    className="text-[11px] text-muted-foreground"
                  >
                    生年
                  </Label>
                  <Input
                    id="inspector-birth-year"
                    name="birthYear"
                    type="number"
                    min={1}
                    max={9999}
                    defaultValue={node.birthYear ?? ''}
                    className="mt-1 h-8 text-xs"
                  />
                  <FieldError message={state.fieldErrors?.birthYear} />
                </div>
                <div>
                  <Label
                    htmlFor="inspector-death-text"
                    className="text-[11px] text-muted-foreground"
                  >
                    忌辰
                  </Label>
                  <Input
                    id="inspector-death-text"
                    name="deathText"
                    defaultValue={node.deathText ?? ''}
                    maxLength={60}
                    className="mt-1 h-8 text-xs"
                  />
                  <FieldError message={state.fieldErrors?.deathText} />
                </div>
                <div>
                  <Label
                    htmlFor="inspector-death-year"
                    className="text-[11px] text-muted-foreground"
                  >
                    卒年
                  </Label>
                  <Input
                    id="inspector-death-year"
                    name="deathYear"
                    type="number"
                    min={1}
                    max={9999}
                    defaultValue={node.deathYear ?? ''}
                    className="mt-1 h-8 text-xs"
                  />
                  <FieldError message={state.fieldErrors?.deathYear} />
                </div>
              </div>
            </section>

            <section className="space-y-2 border-t border-border/60 pt-3">
              <h4 className="text-xs font-bold text-muted-foreground">葬地</h4>
              <Input
                name="burialPlace"
                defaultValue={node.burialPlace ?? ''}
                maxLength={100}
                placeholder="葬地位置及坐向"
                className="h-8 text-xs"
                aria-label="葬地"
              />
              <FieldError message={state.fieldErrors?.burialPlace} />
            </section>

            <section className="space-y-2 border-t border-border/60 pt-3">
              <h4 className="text-xs font-bold text-muted-foreground">行传</h4>
              <Textarea
                name="biography"
                defaultValue={node.biography ?? ''}
                rows={4}
                maxLength={2000}
                placeholder="生平事略、功名、迁徙等"
                className="text-xs"
                aria-label="行传"
              />
              <FieldError message={state.fieldErrors?.biography} />
            </section>

            {state.error ? (
              <p className="text-sm text-destructive">{state.error}</p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-muted/20 p-3">
            <div>
              {canWrite && node.role === 'blood' ? (
                <Button
                  type="button"
                  variant="soft"
                  size="sm"
                  onClick={() => onAddChild(node.id)}
                >
                  <Plus /> 为其添子
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {canWrite && !isRoot ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => onDelete(node)}
                  title="删除该人丁"
                  aria-label="删除该人丁"
                >
                  <Trash2 />
                </Button>
              ) : null}
              {canWrite ? (
                <Button
                  type="submit"
                  variant="brand"
                  size="sm"
                  disabled={isPending}
                >
                  <Save /> {isPending ? '保存中…' : '保存档案'}
                </Button>
              ) : null}
            </div>
          </div>
        </form>
      </aside>
    </>
  );
}
