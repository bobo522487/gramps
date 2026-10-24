'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StarRating } from '@/components/ui/star-rating';
import { Textarea } from '@/components/ui/textarea';
import type { ActionState } from '@/lib/auth/types';
import { createProjectAction } from '@/lib/project/actions';
import {
  DEFAULT_PROJECT_IMPORTANCE,
  DEFAULT_PROJECT_STATUS,
  MAX_PROJECT_NAME_LENGTH,
  MAX_PROJECT_NOTES_LENGTH,
  MAX_PROJECT_REGIONS_LENGTH,
  MAX_PROJECT_SURNAME_LENGTH,
  MAX_PROJECT_THEME_NAME_LENGTH,
  PROJECT_STATUS_OPTIONS,
  type ProjectStatus,
} from '@/lib/project/constants';
import { queryKeys } from '@/lib/query-keys';

function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-destructive">
      *
    </span>
  );
}

export function CreateProjectDialog({
  orgId,
  open,
  onOpenChange,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建云谱项目</DialogTitle>
          <DialogDescription>
            项目隶属于当前组织；姓氏与主题名创建后不可修改。
          </DialogDescription>
        </DialogHeader>
        {/* Remounted on every open so a cancelled draft never leaks back in. */}
        <CreateProjectForm orgId={orgId} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function CreateProjectForm({
  orgId,
  onOpenChange,
}: {
  orgId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    createProjectAction,
    {}
  );

  const [name, setName] = useState('');
  const [surname, setSurname] = useState('');
  const [countriesRegions, setCountriesRegions] = useState('');
  const [themeName, setThemeName] = useState('');
  const [status, setStatus] = useState<ProjectStatus>(DEFAULT_PROJECT_STATUS);
  const [importance, setImportance] = useState(DEFAULT_PROJECT_IMPORTANCE);
  const [notes, setNotes] = useState('');

  const canSubmit =
    name.trim().length > 0 &&
    surname.trim().length > 0 &&
    countriesRegions.trim().length > 0 &&
    themeName.trim().length > 0;

  useEffect(() => {
    if (state.projectRef) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects(orgId),
      });
      onOpenChange(false);
      router.push(`/dashboard/project/${state.projectRef}`);
      router.refresh();
    }
  }, [state.projectRef, orgId, queryClient, router, onOpenChange]);

  return (
    <form action={action} noValidate className="space-y-4">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="importance" value={importance} />
      <div>
        <Label htmlFor="project-name">
          项目名
          <RequiredMark />
        </Label>
        <Input
          id="project-name"
          name="name"
          placeholder="例如：颍川陈氏云谱"
          maxLength={MAX_PROJECT_NAME_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {state.fieldErrors?.name ? (
          <p className="mt-1 text-xs text-destructive">
            {state.fieldErrors.name}
          </p>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="project-surname">
            姓氏
            <RequiredMark />
          </Label>
          <Input
            id="project-surname"
            name="surname"
            placeholder="陈"
            maxLength={MAX_PROJECT_SURNAME_LENGTH}
            value={surname}
            onChange={(event) => setSurname(event.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">创建后不可修改</p>
          {state.fieldErrors?.surname ? (
            <p className="mt-1 text-xs text-destructive">
              {state.fieldErrors.surname}
            </p>
          ) : null}
        </div>
        <div>
          <Label htmlFor="project-theme-name">
            主题名
            <RequiredMark />
          </Label>
          <Input
            id="project-theme-name"
            name="themeName"
            placeholder="义门陈氏宗谱"
            maxLength={MAX_PROJECT_THEME_NAME_LENGTH}
            value={themeName}
            onChange={(event) => setThemeName(event.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">创建后不可修改</p>
          {state.fieldErrors?.themeName ? (
            <p className="mt-1 text-xs text-destructive">
              {state.fieldErrors.themeName}
            </p>
          ) : null}
        </div>
      </div>
      <div>
        <Label htmlFor="project-regions">
          地区
          <RequiredMark />
        </Label>
        <Input
          id="project-regions"
          name="countriesRegions"
          placeholder="中国福建"
          maxLength={MAX_PROJECT_REGIONS_LENGTH}
          value={countriesRegions}
          onChange={(event) => setCountriesRegions(event.target.value)}
        />
        {state.fieldErrors?.countriesRegions ? (
          <p className="mt-1 text-xs text-destructive">
            {state.fieldErrors.countriesRegions}
          </p>
        ) : null}
      </div>
      <div>
        <Label htmlFor="project-status">状态</Label>
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as ProjectStatus)}
        >
          <SelectTrigger id="project-status" aria-label="状态">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROJECT_STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>重要等级</Label>
        <StarRating value={importance} onChange={setImportance} />
      </div>
      <div>
        <Label htmlFor="project-notes">备注</Label>
        <Textarea
          id="project-notes"
          name="notes"
          placeholder="可填写项目背景、编纂计划等"
          maxLength={MAX_PROJECT_NOTES_LENGTH}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        {state.fieldErrors?.notes ? (
          <p className="mt-1 text-xs text-destructive">
            {state.fieldErrors.notes}
          </p>
        ) : null}
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            取消
          </Button>
        </DialogClose>
        <Button
          type="submit"
          variant="brand"
          disabled={isPending || !canSubmit}
        >
          {isPending ? '创建中…' : '确定'}
        </Button>
      </DialogFooter>
    </form>
  );
}
