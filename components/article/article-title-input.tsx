'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { updateArticleTitleAction } from '@/lib/article/actions';
import {
  ARTICLE_TITLE_MAX_LENGTH,
  ARTICLE_TITLE_MIN_LENGTH,
} from '@/lib/article/constants';

/**
 * 顶栏里的谱文标题（FR-001、FR-010）。
 *
 * 标题是谱文的必要字段，空或超 60 字时**就近提示、不得静默回退旧值**
 * （FR-001 / US1-AC11）。失焦或回车才提交，提交失败也保留用户手里的文字。
 */

export function ArticleTitleInput({
  orgId,
  articleId,
  initialTitle,
  onPendingChange,
}: {
  orgId: string;
  articleId: string;
  initialTitle: string;
  /**
   * 把「标题正在保存」告诉外面的离开保护（FR-016）：标题是失焦即存的独立
   * 字段，正文没脏但标题在飞的时候刷新，一样会丢。
   */
  onPendingChange?: (pending: boolean) => void;
}) {
  const [value, setValue] = useState(initialTitle);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const latest = useRef(initialTitle);

  useEffect(() => {
    setValue(initialTitle);
    latest.current = initialTitle;
    setError(null);
  }, [initialTitle]);

  async function submit() {
    const title = value.trim();
    if (title.length < ARTICLE_TITLE_MIN_LENGTH) {
      setError('请填写谱文标题');
      return;
    }
    if (title.length > ARTICLE_TITLE_MAX_LENGTH) {
      setError('标题最多 60 个字');
      return;
    }
    if (title === latest.current) {
      setError(null);
      return;
    }
    setPending(true);
    onPendingChange?.(true);
    const result = await updateArticleTitleAction({
      orgId,
      articleId,
      title,
    });
    setPending(false);
    onPendingChange?.(false);
    if ('error' in result && result.error) {
      setError(result.error);
      return;
    }
    setError(null);
    latest.current = title;
  }

  return (
    <div className="flex flex-col gap-0.5">
      <Input
        aria-label="谱文标题"
        value={value}
        maxLength={ARTICLE_TITLE_MAX_LENGTH}
        aria-invalid={error !== null}
        disabled={pending}
        className="h-8 w-56 text-sm font-medium"
        onChange={(event) => {
          setValue(event.target.value);
          if (error) {
            setError(null);
          }
        }}
        onBlur={submit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      {error ? (
        <span className="text-[11px] text-destructive">{error}</span>
      ) : null}
    </div>
  );
}
