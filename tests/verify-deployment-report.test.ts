import { describe, expect, test } from 'vitest';
import {
  describeMissing,
  describeWrong,
} from '../scripts/lib/deployment-report.mjs';

/**
 * 回归测试用于 2026-11-09 生产迁移 job 的误读事故：校验脚本把
 * 「17 张表全都不合规」渲染成 `FAIL RLS enabled: 17: organization, ...`，
 * 读起来像「17 张表全都不存在」，导致排查方向跑偏。三类结论必须各说各的。
 */
const TABLE = ['table', 'tables'] as const;
const ROLE = ['role', 'roles'] as const;

describe('verify-deployment 报错文案', () => {
  test('缺失类：明确说 missing，不与「不合规」混淆', () => {
    expect(describeMissing(['book_export'], TABLE)).toBe(
      'missing 1 table: book_export'
    );
    expect(describeMissing(['a', 'b'], TABLE)).toBe('missing 2 tables: a, b');
  });

  test('不合规类：全都不合规时说 all，且不出现 missing', () => {
    const all = ['organization', 'project', 'folder'];
    const text = describeWrong(all, all.length, TABLE);
    expect(text).toBe('all 3 tables: organization, project, folder');
    expect(text).not.toContain('missing');
  });

  test('不合规类：部分不合规说 N of M，单复数正确', () => {
    expect(describeWrong(['folder'], 3, TABLE)).toBe('1 of 3 tables: folder');
    expect(describeWrong(['folder', 'node'], 3, TABLE)).toBe(
      '2 of 3 tables: folder, node'
    );
    expect(describeWrong(['genealogy_app'], 1, ROLE)).toBe(
      'all 1 role: genealogy_app'
    );
  });

  test('渲染函数生效：可以按行对象取名', () => {
    expect(
      describeWrong(
        [{ name: 'p1' }, { name: 'p2' }],
        2,
        ['policy', 'policies'],
        (r) => r.name
      )
    ).toBe('all 2 policies: p1, p2');
  });
});
