import { describe, expect, it } from 'vitest';

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
 * 顶栏保存状态（FR-014、FR-015、SC-002）。
 *
 * 规格口径是「按页提交、整篇汇总」：任何一页没落库，顶栏就不能说「已保存」。
 * 这条判断纯靠状态机就能定，不需要起浏览器——所以它是最便宜也最硬的一道防线。
 */

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';

function fresh(): SaveState {
  return createSaveState([P1, P2, P3]);
}

describe('createSaveState', () => {
  it('新打开的谱文没有任何改动，顶栏不显示「已保存」', () => {
    const state = fresh();
    expect(topBarStatus(state)).toBe('idle');
    expect(pendingPageIds(state)).toEqual([]);
    expect(topBarText(state)).not.toContain('已保存');
  });

  it('未知的页不在跟踪范围内', () => {
    expect(fresh().pages[P1]).toBeDefined();
    expect(fresh().pages.nope).toBeUndefined();
  });
});

describe('topBarStatus 的整篇汇总', () => {
  it('只有一页在保存中，整篇就是「保存中」', () => {
    let state = setPageStatus(fresh(), P2, 'saving');
    expect(topBarStatus(state)).toBe('saving');
    expect(topBarText(state)).toBe('保存中…');

    state = markSaved(state, P2, '2026-11-02T13:00:00.000Z');
    expect(topBarStatus(state)).toBe('saved');
    expect(topBarText(state)).toContain('已保存');
  });

  it('一页已保存、另一页还在改，顶栏不得显示「已保存」（FR-014）', () => {
    let state = setPageStatus(fresh(), P1, 'saving');
    state = markSaved(state, P1, '2026-11-02T13:00:00.000Z');
    expect(topBarStatus(state)).toBe('saved');

    state = setPageStatus(state, P3, 'dirty');
    expect(topBarStatus(state)).toBe('dirty');
    expect(topBarText(state)).not.toContain('已保存');
  });

  it('任一页失败，整篇显示「保存失败」并列出待重试的页（FR-015）', () => {
    let state = setPageStatus(fresh(), P1, 'error');
    state = setPageStatus(state, P2, 'dirty');
    state = markSaved(state, P3, '2026-11-02T13:00:00.000Z');

    expect(topBarStatus(state)).toBe('error');
    expect(topBarText(state)).toContain('保存失败');
    expect(pendingPageIds(state)).toEqual([P1, P2]);
  });

  it('保存中优先于失败：重试期间不再回显旧的失败', () => {
    let state = setPageStatus(fresh(), P1, 'error');
    state = setPageStatus(state, P1, 'saving');
    expect(topBarStatus(state)).toBe('saving');
  });

  it('全部落库后才回到「已保存 · 时间」，时间取最后一次成功', () => {
    let state = setPageStatus(fresh(), P1, 'saving');
    state = markSaved(state, P1, '2026-11-02T13:00:00.000Z');
    // 另一页还没落库，整篇就不能宣称已保存
    state = setPageStatus(state, P2, 'dirty');
    expect(topBarStatus(state)).toBe('dirty');

    state = setPageStatus(state, P2, 'saving');
    state = markSaved(state, P2, '2026-11-02T13:00:05.000Z');
    state = setPageStatus(state, P3, 'saving');
    state = markSaved(state, P3, '2026-11-02T13:00:09.000Z');

    expect(topBarStatus(state)).toBe('saved');
    expect(topBarText(state)).toContain('已保存');
    expect(state.lastSavedAt).toBe('2026-11-02T13:00:09.000Z');
  });

  it('删页后不再跟踪该页，状态按剩下的页汇总', () => {
    let state = setPageStatus(fresh(), P1, 'dirty');
    state = createSaveState([P2, P3], state);
    expect(topBarStatus(state)).toBe('idle');
    expect(state.pages[P1]).toBeUndefined();
  });
});
describe('在途与未落定（FR-016 离开门禁的判据）', () => {
  it('在途的页算「还没落定」，但重试队列里不重复排队', () => {
    let state = createSaveState(['a', 'b']);
    state = setPageStatus(state, 'a', 'saving');
    state = setPageStatus(state, 'b', 'dirty');

    expect(inFlightPageIds(state)).toEqual(['a']);
    expect(hasUnsettled(state)).toBe(true);
    // 重试队列只要没发出的那几页，在途的交给原来的请求。
    expect(pendingPageIds(state)).toEqual(['b']);
  });

  it('全部落库之后不再拦人离开', () => {
    let state = createSaveState(['a']);
    state = setPageStatus(state, 'a', 'saving');
    state = markSaved(state, 'a', '2026-11-02T10:00:00.000Z');

    expect(inFlightPageIds(state)).toEqual([]);
    expect(hasUnsettled(state)).toBe(false);
  });

  it('刚进页面（clean）不该拦住返回', () => {
    expect(hasUnsettled(createSaveState(['a', 'b']))).toBe(false);
  });
});
