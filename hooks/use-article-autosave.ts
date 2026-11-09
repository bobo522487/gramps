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
  hasUnsettled,
  inFlightPageIds,
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
 * 1. **按页提交**：一次请求只带一页，服务端也只改那一页；
 * 2. **回显只对齐本页**：成功后用 `data.page` 覆盖该页，绝不用整篇快照
 *    覆盖其他页的未保存内容（FR-017）；
 * 3. **顶栏按整篇汇总**：任何一页还没保存，就不许显示「已保存」。
 *
 * 状态机本体在 `lib/article/save-state.ts`（纯函数、可单测），这里只做接线。
 */

const AUTOSAVE_DELAY_MS = 2000;

/**
 * 一次保存请求的等待上限（FR-014：发起后不迟于 3 秒给出「已保存」或「保存失败」，
 * 不许长期停在「保存中」）。超时只改状态，不取消请求——真回来的那份结果
 * 会因为「已经不是发出去的那一版」而被丢弃。
 */
const SAVE_DEADLINE_MS = 3000;

/** `saveNow` 最多补几轮：防止用户一直在打字导致永远走不完。 */
const SAVE_ROUNDS = 3;

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
  /** 还有没落定的页吗（含在途）——离开保护与「立即保存」按钮的判据。 */
  hasPending: boolean;
  /** 此刻在途的页数（>0 时顶栏显示「保存中」）。 */
  inFlightCount: number;
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
  // 在途请求：pageId → 那次提交。`saveNow` 要等它，不能只看有没有「待提交」。
  const inFlight = useRef(new Map<string, Promise<boolean>>());
  // `saveNow` 是 async 的，不能读渲染期的 `state` 闭包（那会是在途请求之前的旧值）。
  const stateRef = useRef(state);
  stateRef.current = state;

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

  const runSubmit = useCallback(
    async (pageId: string, doc: ArticlePageDoc): Promise<boolean> => {
      const result = await withDeadline(
        saveArticlePageAction({ orgId, articleId, pageId, doc }),
        SAVE_DEADLINE_MS
      );
      if (result === TIMED_OUT) {
        // 顶栏不许卡在「保存中」（FR-014）：到点就翻成失败，用户可重试（FR-015）。
        setNotice('这一页的保存没有及时响应，可以点「立即保存」重试。');
        setState((current) => setPageStatus(current, pageId, 'error'));
        return false;
      }
      const saved = 'data' in result ? result.data : undefined;
      if (!saved) {
        // 失败要带原因（FR-015）：服务端返回的就是中文文案，直接冒到顶栏。
        setNotice(errorMessage(result));
        setState((current) => setPageStatus(current, pageId, 'error'));
        return false;
      }
      if (docsRef.current[pageId] !== doc) {
        // 请求在途时用户又敲了字：这份回显是旧版本，盖上去就是吞输入。
        // 保持「待提交」，下一轮把新的发出去（FR-014、FR-017）。
        setState((current) => setPageStatus(current, pageId, 'dirty'));
        return true;
      }
      // 只对齐这一页：服务端可能因白名单清洗改过节点，其余页保持用户手里的版本。
      setPages((current) => ({ ...current, [pageId]: saved.page.doc }));
      setState((current) => markSaved(current, pageId, saved.savedAt));
      return true;
    },
    [articleId, orgId]
  );

  const submitPage = useCallback(
    async (pageId: string): Promise<boolean> => {
      const running = inFlight.current.get(pageId);
      if (running) {
        return running;
      }
      const doc = docsRef.current[pageId];
      if (!doc) {
        return false;
      }
      setState((current) => setPageStatus(current, pageId, 'saving'));
      const task = runSubmit(pageId, doc).finally(() => {
        if (inFlight.current.get(pageId) === settled) {
          inFlight.current.delete(pageId);
        }
      });
      const settled = task;
      inFlight.current.set(pageId, settled);
      return settled;
    },
    [runSubmit]
  );

  const saveCurrentPage = useCallback(async () => {
    clearTimer(currentPageId);
    setState((current) => setPageStatus(current, currentPageId, 'dirty'));
    return submitPage(currentPageId);
  }, [clearTimer, currentPageId, submitPage]);

  const saveNow = useCallback(async (): Promise<boolean> => {
    for (const [pageId, timer] of timers.current) {
      window.clearTimeout(timer);
      timers.current.delete(pageId);
      setState((current) => setPageStatus(current, pageId, 'dirty'));
      stateRef.current = setPageStatus(stateRef.current, pageId, 'dirty');
    }
    for (let round = 0; round < SAVE_ROUNDS; round += 1) {
      const running = [...inFlight.current.values()];
      if (running.length > 0) {
        // 在途的先等回来（FR-016：应用内切换必须等保存结果）。
        await Promise.all(running);
      }
      const queue = pendingPageIds(stateRef.current);
      if (queue.length === 0) {
        break;
      }
      for (const pageId of queue) {
        await submitPage(pageId);
      }
    }
    return (
      inFlight.current.size === 0 &&
      pendingPageIds(stateRef.current).length === 0
    );
  }, [submitPage]);

  const setDoc = useCallback(
    (pageId: string, doc: ArticlePageDoc) => {
      setPages((current) => ({ ...current, [pageId]: doc }));
      setState((current) => setPageStatus(current, pageId, 'dirty'));
      stateRef.current = setPageStatus(stateRef.current, pageId, 'dirty');
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
      const previous = pageIds;
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
        stateRef.current = createSaveState(moved.pageOrder, stateRef.current);
        setNotice(null);
      } else {
        // 失败要把顺序还回去：屏幕上的次序必须等于库里的次序，
        // 否则下一次保存/加页会以错的顺序提交（FR-023）。
        setPageIds(previous);
        setState((current) => createSaveState(previous, current));
        stateRef.current = createSaveState(previous, stateRef.current);
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
  // 离开门禁看「有没有还没落定的页」，包含在途的那几页（FR-016）。
  const hasPending = useMemo(() => hasUnsettled(state), [state]);
  const inFlightCount = useMemo(() => inFlightPageIds(state).length, [state]);

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
    inFlightCount,
    notice,
    setNotice,
  };
}

/** 超时哨兵：与 Action 的返回值区分开，不需要额外的异常类型。 */
const TIMED_OUT = Symbol('save-timeout');
type Timeout = typeof TIMED_OUT;

function withDeadline<T>(task: Promise<T>, ms: number): Promise<T | Timeout> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(TIMED_OUT), ms);
    task.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        window.clearTimeout(timer);
        resolve(TIMED_OUT);
      }
    );
  });
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
