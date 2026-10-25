'use client';

import { Info } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

/**
 * 只读的继承字段：值来自云谱空间（项目）而非本表单，
 * 因此这里只展示与跳转，不提供输入框。
 */
export function ReadonlyProjectField({
  id,
  label,
  value,
  href,
  canEdit,
  disabledReason,
}: {
  id: string;
  label: string;
  value: string;
  href: string;
  canEdit: boolean;
  disabledReason: string;
}) {
  const shown = value.trim();

  return (
    <div>
      <Label htmlFor={id}>
        {label}
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
          项目信息
        </span>
      </Label>
      <div className="mt-1 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
        <span
          id={id}
          className="min-w-0 flex-1 truncate text-sm text-muted-foreground"
        >
          {shown || '未设置'}
        </span>
        <span className="text-[11px] text-muted-foreground">
          如需修改，请点击
        </span>
        {canEdit ? (
          <Button asChild variant="destructive" size="xs">
            <Link href={href}>修改所属项目基本信息</Link>
          </Button>
        ) : (
          <Button
            type="button"
            variant="destructive"
            size="xs"
            disabled
            title={disabledReason}
          >
            修改所属项目基本信息
          </Button>
        )}
      </div>
      {canEdit ? null : (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Info size={12} className="shrink-0" />
          {disabledReason}
        </p>
      )}
    </div>
  );
}
