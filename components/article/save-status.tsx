'use client';

import type { SaveState } from '@/lib/article/save-state';
import { topBarStatus, topBarText } from '@/lib/article/save-state';

/**
 * 顶栏的保存状态（FR-014、FR-015、SC-002）。
 *
 * 文案由 `lib/article/save-state.ts` 的纯函数算出来：只要**任意一页**还没存上，
 * 就不许显示「已保存」（FR-014）。失败时给一个重试按钮，重试就是把还脏的页
 * 再提交一遍（FR-015）。
 */

export function SaveStatus({
  state,
  onRetry,
}: {
  state: SaveState;
  onRetry: () => void;
}) {
  const status = topBarStatus(state);
  const text = topBarText(state);

  if (status === 'idle') {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <span
        role="status"
        aria-live="polite"
        className={
          status === 'error'
            ? 'text-xs text-destructive'
            : 'text-xs text-muted-foreground'
        }
      >
        {text}
      </span>
      {status === 'error' ? (
        <button
          type="button"
          className="text-xs underline underline-offset-2"
          onClick={onRetry}
        >
          重试
        </button>
      ) : null}
    </div>
  );
}
