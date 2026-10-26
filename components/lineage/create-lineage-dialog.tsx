'use client';

import { GitBranch } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { ReadonlyProjectField } from '@/components/lineage/readonly-project-field';
import { type FolderOption, folderOptions } from '@/components/lineage/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { ActionState } from '@/lib/auth/types';
import { createLineageAction } from '@/lib/lineage/actions';
import {
  MAX_LINEAGE_HALL_CODE_LENGTH,
  MAX_LINEAGE_NAME_LENGTH,
  MAX_LINEAGE_NOTES_LENGTH,
  MAX_LINEAGE_REGION_LENGTH,
} from '@/lib/lineage/constants';
import {
  canSubmitLineage,
  hasInheritedSurname,
  resolveSelectedFolderId,
} from '@/lib/lineage/create-form';

function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-destructive">
      *
    </span>
  );
}

export function CreateLineageDialog({
  orgId,
  projectId,
  projectRef,
  projectThemeName,
  projectSurname,
  projectRegion,
  canProjectWrite,
  folders,
  defaultFolderId,
  onClose,
}: {
  orgId: string;
  projectId: string;
  projectRef: string;
  projectThemeName: string;
  projectSurname: string;
  projectRegion: string;
  canProjectWrite: boolean;
  folders: FolderOption[];
  defaultFolderId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    createLineageAction,
    {}
  );
  const options = useMemo(() => folderOptions(folders), [folders]);

  const hasFolders = options.length > 0;
  const fallbackFolderId = defaultFolderId ?? options[0]?.id ?? '';
  const [folderId, setFolderId] = useState(fallbackFolderId);
  const [name, setName] = useState('');
  const [region, setRegion] = useState(projectRegion);
  const [hallCode, setHallCode] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // 分类可能在弹窗打开期间被删掉，提交值必须对着当前列表校验。
  const effectiveFolderId = resolveSelectedFolderId(options, folderId);

  // 预填的地区不算「用户改过」，否则一打开弹窗就必然触发放弃确认。
  const isDirty =
    name.trim().length > 0 ||
    region !== projectRegion ||
    hallCode.trim().length > 0 ||
    notes.trim().length > 0 ||
    effectiveFolderId !== resolveSelectedFolderId(options, fallbackFolderId);

  const surnameMissing = !hasInheritedSurname(projectSurname);
  const canSubmit =
    !surnameMissing &&
    canSubmitLineage({
      name,
      region,
      folderId: hasFolders ? effectiveFolderId : 'default',
    });

  useEffect(() => {
    if (state.lineageId) {
      router.refresh();
      router.push(
        `/dashboard/project/${projectRef}/lineages/${state.lineageId}`
      );
      onClose();
    }
  }, [state.lineageId, projectRef, router, onClose]);

  function requestClose() {
    if (isDirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : requestClose())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <GitBranch size={18} />
            </div>
            <div className="min-w-0">
              <DialogTitle>创建谱系</DialogTitle>
              <DialogDescription>
                谱系归属当前云谱空间，创建后即可录入始祖。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form action={action} noValidate className="space-y-3">
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="projectId" value={projectId} />
          <input
            type="hidden"
            name="folderId"
            value={hasFolders ? effectiveFolderId : ''}
          />

          <div>
            <Label htmlFor="lineage-name">
              谱系名称
              <RequiredMark />
            </Label>
            <Input
              id="lineage-name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="请输入谱系名称，限长24个字"
              maxLength={MAX_LINEAGE_NAME_LENGTH}
              aria-invalid={Boolean(state.fieldErrors?.name)}
              aria-describedby={
                state.fieldErrors?.name
                  ? 'lineage-name-error lineage-name-count'
                  : 'lineage-name-count'
              }
            />
            <div className="mt-1 flex items-start justify-between gap-2">
              {state.fieldErrors?.name ? (
                <p id="lineage-name-error" className="text-xs text-destructive">
                  {state.fieldErrors.name}
                </p>
              ) : (
                <span />
              )}
              <span
                id="lineage-name-count"
                className="shrink-0 text-xs text-muted-foreground"
              >
                {name.length}/{MAX_LINEAGE_NAME_LENGTH}
              </span>
            </div>
          </div>

          <div>
            {hasFolders ? (
              <Label htmlFor="lineage-folder">
                所属分类
                <RequiredMark />
              </Label>
            ) : (
              <p className="text-sm leading-none font-medium">所属分类</p>
            )}
            {hasFolders ? (
              <Select value={folderId} onValueChange={setFolderId}>
                <SelectTrigger id="lineage-folder" size="default">
                  <SelectValue placeholder="选择分类" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="mt-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                项目还没有分类，创建后将自动归入「默认分类」。
              </p>
            )}
            {canProjectWrite && hasFolders ? (
              <p className="mt-1 text-xs text-muted-foreground">
                需要新分类？请在左侧谱系管理里新建文件夹。
              </p>
            ) : null}
          </div>

          <ReadonlyProjectField
            id="lineage-theme-name"
            label="主题名"
            value={projectThemeName}
            href={`/dashboard/project/${projectRef}/settings`}
            canEdit={canProjectWrite}
            disabledReason="只有所有者或管理员可以修改项目基本信息"
          />

          <ReadonlyProjectField
            id="lineage-surname"
            label="姓氏"
            value={projectSurname}
            href={`/dashboard/project/${projectRef}/settings`}
            canEdit={canProjectWrite}
            disabledReason="只有所有者或管理员可以修改项目基本信息"
          />

          {surnameMissing ? (
            <p
              role="alert"
              className="rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive"
            >
              该项目未填写姓氏，无法创建谱系。请所有者或管理员先完善项目基本信息。
            </p>
          ) : null}

          <div>
            <Label htmlFor="lineage-region">
              地区
              <RequiredMark />
            </Label>
            <Input
              id="lineage-region"
              name="region"
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              placeholder="例如：中国/北京/东城"
              maxLength={MAX_LINEAGE_REGION_LENGTH}
              aria-invalid={Boolean(state.fieldErrors?.region)}
              aria-describedby={
                state.fieldErrors?.region ? 'lineage-region-error' : undefined
              }
            />
            {state.fieldErrors?.region ? (
              <p
                id="lineage-region-error"
                className="mt-1 text-xs text-destructive"
              >
                {state.fieldErrors.region}
              </p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="lineage-hall">郡望堂号</Label>
            <Input
              id="lineage-hall"
              name="hallCode"
              value={hallCode}
              onChange={(event) => setHallCode(event.target.value)}
              placeholder="请输入郡望堂号"
              maxLength={MAX_LINEAGE_HALL_CODE_LENGTH}
            />
            {state.fieldErrors?.hallCode ? (
              <p className="mt-1 text-xs text-destructive">
                {state.fieldErrors.hallCode}
              </p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="lineage-notes">备注</Label>
            <Textarea
              id="lineage-notes"
              name="notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="请输入谱系备注"
              maxLength={MAX_LINEAGE_NOTES_LENGTH}
              className="min-h-16"
              aria-invalid={Boolean(state.fieldErrors?.notes)}
              aria-describedby={
                state.fieldErrors?.notes ? 'lineage-notes-error' : undefined
              }
            />
            {state.fieldErrors?.notes ? (
              <p
                id="lineage-notes-error"
                className="mt-1 text-xs text-destructive"
              >
                {state.fieldErrors.notes}
              </p>
            ) : null}
          </div>

          {state.error ? (
            <p
              role="alert"
              className="rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive"
            >
              {state.error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="outline" onClick={requestClose}>
              取消
            </Button>
            <Button
              type="submit"
              variant="brand"
              disabled={isPending || !canSubmit}
            >
              {isPending ? '创建中…' : '确定'}
            </Button>
          </div>
        </form>

        {confirmDiscard ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/80 p-4 backdrop-blur-xs">
            <div className="w-full max-w-xs rounded-lg border border-border bg-surface p-4 shadow-lg">
              <p className="text-sm font-medium text-foreground">
                放弃已填内容？
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                关闭后本次填写的内容不会保存。
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDiscard(false)}
                >
                  继续编辑
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={onClose}
                >
                  放弃
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
