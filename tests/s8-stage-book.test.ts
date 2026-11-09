/**
 * S8 阶段 B/C 交界：`book` 表 TS↔基线零漂移收口（book 漂移消除）。
 *
 * 规格唯一真相源是 `lib/db/migrations/0000_target_schema.sql` 的 `book` 表
 * （494–508 行）。此前 TS `books`（content.ts）比基线多出
 * `name` / `surname` / `hall_code` / `volume_no` / `author` / `compiled_at` /
 * `cover_spec` / `back_cover_spec` / `sort` / `created_by` 共 10 列，基线反而有
 * TS 缺失的 `edition_text` / `compiler_text`，导致工厂 `createBook` 按 TS 列插入
 * 时撞基线库报 `42703 column "name" does not exist`，几乎全量集成测试级联失败。
 *
 * 本文件静态断言 TS `books` 已逐列追平基线（不 import 待测模块，S8 门禁纪律）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const schema = (name: string) => read(`lib/db/schema/${name}.ts`);
const migration = () => read('lib/db/migrations/0000_target_schema.sql');

function block(source: string, table: string, next?: string) {
  const start = findTableStart(source, table);
  if (start < 0) throw new Error(`找不到 pgTable('${table}'`);
  const end = next ? findTableStart(source, next, start + 1) : -1;
  return source.slice(start, end < 0 ? undefined : end);
}

function findTableStart(source: string, table: string, from = 0): number {
  const pattern = new RegExp(`(?:pgTable|\\.table)\\(\\s*'${table}'`);
  const rest = source.slice(from);
  const match = pattern.exec(rest);
  return match ? from + match.index : -1;
}

describe('S8 阶段 B/C · book 表 TS↔基线零漂移', () => {
  const ts = block(schema('content'), 'book', 'book_catalog');

  test('BOOK-1：TS books 已删除基线没有的 10 个列', () => {
    // 这些列只存在于旧 TS schema，基线 book 没有，必须整体退役。
    expect(ts).not.toContain("name: text('name')");
    expect(ts).not.toContain("surname: text('surname')");
    expect(ts).not.toContain("hallCode: text('hall_code')");
    expect(ts).not.toContain("volumeNo: text('volume_no')");
    expect(ts).not.toContain("author: text('author')");
    expect(ts).not.toContain("compiledAt: text('compiled_at')");
    expect(ts).not.toContain("coverSpec: jsonb('cover_spec')");
    expect(ts).not.toContain("backCoverSpec: jsonb('back_cover_spec')");
    expect(ts).not.toContain("sort: integer('sort')");
    expect(ts).not.toContain("createdBy: uuid('created_by')");
  });

  test('BOOK-2：TS books 补齐基线独有、可空的 edition_text / compiler_text', () => {
    expect(ts).toContain("editionText: text('edition_text')");
    expect(ts).toContain("compilerText: text('compiler_text')");
  });

  test('BOOK-3：TS books 删除基线没有的唯一约束（uk_book_name / uk_book_organization_id）', () => {
    expect(ts).not.toContain("unique('uk_book_name')");
    expect(ts).not.toContain("unique('uk_book_organization_id')");
  });

  test('BOOK-4：TS books 增补基线独有的 book_folder_idx 索引', () => {
    expect(ts).toContain("index('book_folder_idx')");
  });

  test('BOOK-5：基线 book 自身仍是 8 列 + 主键 + 两个 FK（未被动过）', () => {
    const sql = migration();
    const start = sql.indexOf('CREATE TABLE book (');
    const end = sql.indexOf(');', start);
    const blockSql = sql.slice(start, end);
    expect(blockSql).toContain('title           text NOT NULL');
    expect(blockSql).toContain('edition_text    text');
    expect(blockSql).toContain('compiler_text   text');
    expect(blockSql).not.toContain('name');
    expect(blockSql).not.toContain('cover_spec');
  });
});
