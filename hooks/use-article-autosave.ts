'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addArticlePageAction,
  deleteArticlePageAction,
  reorderArticlePagesAction,
  saveArticlePageAction,
} from '@/lib/article/actions';
import type { ArticleContent, ArticlePageDoc } from '@/lib/article/doc';
import {
  createSaveState,
  markSaved,
  pendingPageIds,
  type SaveState,
  setPageStatus,
  topBarStatus,
  topBarText,
} from '@/lib/article/save-state';

/**
 * 谱文编辑器的保存中枢（FR-012..FR-016、FR-021..FR-024、FR-037）。
 *
 * 三条硬规矩：
 * 1. **按页提交**：一次请求只带一页，服务端也只改那一页（contracts §1.5）；
 * 2. **回显只对齐本页**：成功后用 `data.page` 覆盖该页，绝不用整篇快照
 *    覆盖其他页的未保存内容（FR-017）；
 * 3. **顶栏按整篇汇总**：任何一页还没保存，就不许显示「已保存」。
 *
 * 状态机本体在 `lib/article/save-state.ts`（纯函数、可单测），这里只做接线。
 */

const AUTOSAVE_DELAY_MS = 2000;

export type ArticleWorkspaceState = {
  pageIds: string[];
  currentPageId: string;
  docOf: (pageId: string) => ArticlePageDoc;
  setCurrentPageId: (pageId: string) => void;
  setDoc: (pageId: string, doc: ArticlePageDoc) => void;
  addPage: () => Promise<void>;
  removePage: (pageId: string) => Promise<void>;
  movePage: (fromId: string, toIndex: number) => Promise<void>;
  saveNow: () => Promise<boolean>;
  saveCurrentPage: () => Promise<boolean>;
  state: SaveState;
  status: ReturnType<typeof topBarStatus>;
  statusText: string;
  hasPending: boolean;
  /** 加页 / 删页 / 排序被服务端拒绝时的中文提示（FR-021、FR-022）。 */
  notice: string | null;
  /** 工具栏（插图、超限）也往同一条提示通道里写中文（FR-037）。 */
  setNotice: (message: string | null) => void;
};

export function useArticleAutosave({
  orgId,
  articleId,
  initial,
}: {
  orgId: string;
  articleId: string;
  /** 首次挂载的服务端快照；之后 RSC 再下发也不会回灌编辑器（FR-017）。 */
  initial: ArticleContent;
}): ArticleWorkspaceState {
  const [pages, setPages] = useState<Record<string, ArticlePageDoc>>(() =>
    Object.fromEntries(initial.pages.map((page) => [page.id, page.doc]))
  );
  const [pageIds, setPageIds] = useState<string[]>(() =>
    initial.pages.map((page) => page.id)
  );
  const [currentPageId, setCurrentPageId] = useState<string>(
    initial.pages[0]?.id ?? ''
  );
  const [state, setState] = useState<SaveState>(() =>
    createSaveState(initial.pages.map((page) => page.id))
  );

  const [notice, setNotice] = useState<string | null>(null);
  const timers = useRef(new Map<string, number>());
  const docsRef = useRef(pages);
  docsRef.current = pages;

  const clearTimer = useCallback((pageId: string) => {
    const timer = timers.current.get(pageId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(pageId);
    }
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) {
        window.clearTimeout(timer);
      }
      pending.clear();
    };
  }, []);

  const submitPage = useCallback(
    async (pageId: string): Promise<boolean> => {
      const doc = docsRef.current[pageId];
      if (!doc) {
        return false;
      }
      setState((current) => setPageStatus(current, pageId, 'saving'));
      const result = await saveArticlePageAction({
        orgId,
        articleId,
        pageId,
        doc,
      });
      const saved = 'data' in result ? result.data : undefined;
      if (!saved) {
        // 失败要带原因（FR-015）：服务端返回的就是中文文案，直接冒到顶栏。
        setNotice(errorMessage(result));
        setState((current) => setPageStatus(current, pageId, 'error'));
        return false;
      }
      // 只对齐这一页：服务端可能因白名单清洗改过节点，其余页保持用户手里的版本。
      setPages((current) => ({ ...current, [pageId]: saved.page.doc }));
      setState((current) => markSaved(current, pageId, saved.savedAt));
      return true;
    },
    [articleId, orgId]
  );

  const saveCurrentPage = useCallback(async () => {
    clearTimer(currentPageId);
    setState((current) => setPageStatus(current, currentPageId, 'dirty'));
    return submitPage(currentPageId);
  }, [clearTimer, currentPageId, submitPage]);

  const saveNow = useCallback(async () => {
    for (const [pageId, timer] of timers.current) {
      window.clearTimeout(timer);
      timers.current.delete(pageId);
      setState((current) => setPageStatus(current, pageId, 'dirty'));
    }
    const queue = pendingPageIds(state);
    if (queue.length === 0) {
      return true;
    }
    let allOk = true;
    for (const pageId of queue) {
      allOk = (await submitPage(pageId)) && allOk;
    }
    return allOk;
  }, [state, submitPage]);

  const setDoc = useCallback(
    (pageId: string, doc: ArticlePageDoc) => {
      setPages((current) => ({ ...current, [pageId]: doc }));
      setState((current) => setPageStatus(current, pageId, 'dirty'));
      clearTimer(pageId);
      timers.current.set(
        pageId,
        window.setTimeout(() => {
          timers.current.delete(pageId);
          void submitPage(pageId);
        }, AUTOSAVE_DELAY_MS)
      );
    },
    [clearTimer, submitPage]
  );

  const addPage = useCallback(async () => {
    const ok = await saveNow();
    if (!ok) {
      return;
    }
    const result = await addArticlePageAction({ orgId, articleId });
    const added = 'data' in result ? result.data : undefined;
    if (!added) {
      setNotice(errorMessage(result));
      return;
    }
    setNotice(null);
    const emptyDoc: ArticlePageDoc = { type: 'doc', content: [] };
    setPages((current) => ({ ...current, [added.pageId]: emptyDoc }));
    setPageIds(added.pageOrder);
    setCurrentPageId(added.pageId);
    setState((current) => createSaveState(added.pageOrder, current));
  }, [articleId, orgId, saveNow]);

  const removePage = useCallback(
    async (pageId: string) => {
      clearTimer(pageId);
      const result = await deleteArticlePageAction({
        orgId,
        articleId,
        pageId,
      });
      const reordered = 'data' in result ? result.data : undefined;
      if (!reordered) {
        setNotice(errorMessage(result));
        return;
      }
      setNotice(null);
      setPages((current) => {
        const next = { ...current };
        delete next[pageId];
        return next;
      });
      setPageIds(reordered.pageOrder);
      setState((current) => createSaveState(reordered.pageOrder, current));
      if (currentPageId === pageId) {
        setCurrentPageId(reordered.pageOrder[0] ?? '');
      }
    },
    [articleId, clearTimer, currentPageId, orgId]
  );

  const movePage = useCallback(
    async (fromId: string, toIndex: number) => {
      const next = pageIds.filter((id) => id !== fromId);
      next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, fromId);
      if (next.join('|') === pageIds.join('|')) {
        return;
      }
      setPageIds(next);
      const result = await reorderArticlePagesAction({
        orgId,
        articleId,
        pageIds: next,
      });
      const moved = 'data' in result ? result.data : undefined;
      if (moved) {
        setPageIds(moved.pageOrder);
        setState((current) => createSaveState(moved.pageOrder, current));
        setNotice(null);
      } else {
        setNotice(errorMessage(result));
      }
    },
    [articleId, orgId, pageIds]
  );

  const docOf = useCallback(
    (pageId: string): ArticlePageDoc =>
      docsRef.current[pageId] ?? { type: 'doc', content: [] },
    []
  );

  const status = useMemo(() => topBarStatus(state), [state]);
  const statusText = useMemo(() => topBarText(state), [state]);
  const hasPending = useMemo(() => pendingPageIds(state).length > 0, [state]);

  return {
    pageIds,
    currentPageId,
    docOf,
    setCurrentPageId,
    setDoc,
    addPage,
    removePage,
    movePage,
    saveNow,
    saveCurrentPage,
    state,
    status,
    statusText,
    hasPending,
    notice,
    setNotice,
  };
}

function errorMessage(result: unknown): string {
  if (typeof result === 'object' && result !== null && 'error' in result) {
    const error = (result as { error?: unknown }).error;
    if (typeof error === 'string') {
      return error;
    }
  }
  return '操作没有保存成功，请重试。';
}
