/**
 * 谱文顶栏的保存状态机（FR-014、FR-015、SC-002）。
 *
 * 规格口径：**按页提交、整篇汇总**——每次只提交改动的那一页，但顶栏说的
 * 「已保存」指的是整篇。所以这里唯一要紧的不变量是：
 * 只要还有任何一页处于 `dirty` / `saving` / `error`，就绝不显示「已保存」。
 *
 * 纯函数、无副作用、不依赖 React，方便在服务端与单测里同一份判定。
 */

export type PageSaveStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'error';

export type TopBarStatus = 'idle' | 'dirty' | 'saving' | 'error' | 'saved';

export type SaveState = {
  /** 页标识 → 该页状态。页被删掉后由 `createSaveState` 收敛掉。 */
  readonly pages: Readonly<Record<string, PageSaveStatus>>;
  /** 整篇最后一次**成功**保存的时间（ISO 字符串）；从未成功过为 null。 */
  readonly lastSavedAt: string | null;
};

/** 还没落库的页：待提交或待重试。`saving` 不算——它已经在路上了。 */
const PENDING: ReadonlySet<PageSaveStatus> = new Set(['dirty', 'error']);

export function createSaveState(
  pageIds: readonly string[],
  previous?: SaveState
): SaveState {
  const pages: Record<string, PageSaveStatus> = {};
  for (const id of pageIds) {
    // 加页/删页/重排后保留其余页的在途状态，不能把「还在保存中」洗成干净。
    const carried = previous?.pages[id];
    pages[id] = carried === 'saved' ? 'clean' : (carried ?? 'clean');
  }
  return {
    pages,
    lastSavedAt: previous?.lastSavedAt ?? null,
  };
}

export function setPageStatus(
  state: SaveState,
  pageId: string,
  status: PageSaveStatus
): SaveState {
  if (!(pageId in state.pages)) {
    // 未跟踪的页（例如另一端刚加过）直接忽略：调用方会按服务端页序重建状态。
    return state;
  }
  if (state.pages[pageId] === status) {
    return state;
  }
  return {
    ...state,
    pages: { ...state.pages, [pageId]: status },
  };
}

/** 该页落库成功：整篇的「已保存」时间以最后一次成功为准。 */
export function markSaved(state: SaveState, pageId: string, savedAt: string) {
  const next = setPageStatus(state, pageId, 'saved');
  if (next === state) {
    return state.lastSavedAt === savedAt
      ? state
      : { ...state, lastSavedAt: savedAt };
  }
  return {
    ...next,
    lastSavedAt:
      state.lastSavedAt === null || state.lastSavedAt < savedAt
        ? savedAt
        : state.lastSavedAt,
  };
}

/** 按建谱文时的页序返回待提交/待重试的页。 */
export function pendingPageIds(state: SaveState): string[] {
  return Object.keys(state.pages).filter((id) => PENDING.has(state.pages[id]!));
}

export function topBarStatus(state: SaveState): TopBarStatus {
  const statuses = Object.values(state.pages);
  if (statuses.includes('saving')) {
    return 'saving';
  }
  if (statuses.includes('error')) {
    return 'error';
  }
  if (statuses.includes('dirty')) {
    return 'dirty';
  }
  // 有过成功保存且此刻没有待提交的页，才算整篇「已保存」。
  return state.lastSavedAt === null ? 'idle' : 'saved';
}

const TIME_FORMAT = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Shanghai',
});

/** 顶栏文案。`idle` 返回空串：没动过就不占地方（FR-014 只要不显示「已保存」）。 */
export function topBarText(state: SaveState): string {
  switch (topBarStatus(state)) {
    case 'saving':
      return '保存中…';
    case 'error':
      return '保存失败，可重试';
    case 'dirty':
      return '有未保存的改动';
    case 'saved':
      return `已保存 · ${TIME_FORMAT.format(new Date(state.lastSavedAt!))}`;
    case 'idle':
      return '';
  }
}
