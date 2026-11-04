'use client';

import type { ReactNode } from 'react';

type ToggleButtonProps = {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
};

/** 工具栏开关按钮：aria-pressed 反映激活态（FR-007 / FR-008 / FR-009）。 */
export function ToggleButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: ToggleButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      className={`rounded px-2 py-1 ${active ? 'bg-primary/10 text-primary' : 'hover:bg-muted disabled:opacity-40'}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** 组间分隔线（FR-002）。 */
export function Separator() {
  return <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />;
}
