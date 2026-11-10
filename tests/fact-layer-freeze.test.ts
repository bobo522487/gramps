/**
 * S8 阶段 A · 事实层冻结已解除。
 *
 * 旧冻结（六表列名快照 / 业务代码不得 import 事实层 / journal 基线 `0027`
 * 之后不得有事实层 DDL）随 D2「无生产存量」与回填 CLI 退役一并删除：
 * 阶段 A′ 会让业务代码直接写事实层，钉住现状列形状只会挡住重构。
 *
 * 本文件只保留跨阶段仍成立的两条结构性约束，**不复制**现状列名清单，
 * 也不再断言迁移基线——阶段 B 的 B0 会整体重建基线并重置 journal。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const exists = (path: string) => existsSync(join(root, path));

const FACT_TABLES = [
  'person',
  'person_name',
  'family',
  'family_partner',
  'family_child',
  'event',
].sort();

/** 从全部 schema 文件派生物理表名，避免硬编码一份会失真的表清单。 */
function factTables(): string[] {
  return readdirSync(join(root, 'lib/db/schema'))
    .filter((file) => file.endsWith('.ts'))
    .flatMap((file) =>
      [...read(`lib/db/schema/${file}`).matchAll(/pgTable\(\s*'([a-z_]+)'/g)]
        .map((match) => match[1])
        .filter((name) => /^(?:person|family|event)/.test(name))
    )
    .sort();
}

describe('S8 阶段 A · 事实层冻结已解除', () => {
  test('六张事实层表仍在（防零断言）', () => {
    expect(factTables()).toEqual(FACT_TABLES);
  });

  test('回填 / 对账入口已全部退役', () => {
    expect(exists('lib/db/backfill')).toBe(false);
    const scripts = JSON.parse(read('package.json')).scripts as Record<
      string,
      string
    >;
    expect(
      Object.keys(scripts).filter((key) => key.startsWith('data:'))
    ).toEqual([]);
  });
});
