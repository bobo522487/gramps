/**
 * S8 阶段 A · 第 1 批：旧回填模型产物退役门禁。
 *
 * D2（无生产存量）已确认，回填 / 对账是旧模型的产物：事实层不再是 `node`
 * 的回填快照。本文件按 TDD 先于代码改动写出（RED），删除动作落地后转绿。
 * T10–T13 的 schema 与写入层改写属「阶段 A′」，不在本批范围，见实施计划 §3.1。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const exists = (path: string) => existsSync(join(root, path));

const RETIRED = [
  'data/backfill-fact-layer.ts',
  'data/reconcile-fact-layer.ts',
  'data/exit-codes.ts',
  'lib/db/backfill/fact-layer.ts',
  'lib/db/backfill/fact-layer-rules.ts',
  'lib/db/backfill/reconcile-fact-layer.ts',
  'tests/integration/fact-backfill.test.ts',
  'tests/integration/fact-reconcile.test.ts',
  'tests/integration/fact-cli.test.ts',
];

describe('S8 stage A · 旧回填模型产物已退役', () => {
  test('回填 / 对账 CLI、实现与只测它们的集成测试都不再存在', () => {
    expect(RETIRED.filter(exists)).toEqual([]);
  });

  test('package.json 不再暴露 data:*:fact 入口', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<
      string,
      string
    >;
    expect(
      Object.keys(scripts).filter((key) => key.startsWith('data:'))
    ).toEqual([]);
  });

  test('lib/db/backfill/ 目录已清空', () => {
    expect(exists('lib/db/backfill')).toBe(false);
  });

  test('架构文档不再指向已删除的回填 CLI', () => {
    expect(read('docs/architecture.md')).not.toContain(
      'data/backfill-fact-layer.ts'
    );
  });

  test('防零断言：事实层 schema 仍在（本批不改表结构）', () => {
    expect(read('lib/db/schema/person.ts')).toContain('pgTable(');
    expect(read('lib/db/schema/family.ts')).toContain('pgTable(');
    expect(read('lib/db/schema/event.ts')).toContain('pgTable(');
  });
});
