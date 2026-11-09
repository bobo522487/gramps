/**
 * S8 阶段 B · B3：谱书层 `ltree` 闭包（T25）与 article 正文收敛（T27）。
 *
 * 规格唯一真相源是附录 A.5（`article` / `book` / `book_catalog`），落定于
 * `lib/db/migrations/0000_target_schema.sql`（DDL 唯一落点，G0 ①）。本文件做
 * 静态断言，不 import 待测模块（S8 门禁纪律），与其它 s8-stage-* 同风格。
 *
 * T25：`book_catalog` 去 `parent_id` / `section` / `sort` / `hide` / `created_by`
 * / `deleted_at`，改 `path ltree` + `project_id` 列，主键 `(project_id, id)`，
 * 约束与索引名逐一对齐基线 518–550 行。
 * T27：`article` 的 `content` jsonb + `plain_text` + `created_by` 已收敛为
 * `body` text（分页文档包 ArticleContent 的文本化序列化）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const exists = (path: string) => existsSync(join(root, path));
const schema = (name: string) => read(`lib/db/schema/${name}.ts`);

/**
 * 从 `pgTable('table'` 切到下一张表的起点（实现同 s8-stage-b2a，锚定建表调用
 * 形态，避免被注释里的表名截断）。`book_catalog` 是 content.ts 最后一表，
 * 不传 next 时取到文件末尾。
 */
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

/** 去掉行注释与块注释，供「不许出现某字符串」这类断言使用。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

describe('S8 阶段 B · B3 ltree 闭包与正文收敛', () => {
  test('B3-1：book_catalog 改 path ltree + project_id，主键 (project_id,id)', () => {
    const catalog = block(schema('content'), 'book_catalog');
    // path ltree + 生成列 parent_path（表达式与基线 526–529 行一致）。
    expect(catalog).toContain("ltree('path')");
    expect(catalog).toContain('parentPath');
    expect(catalog).toContain('generatedAlwaysAs');
    expect(catalog).toContain('subpath(path, 0, nlevel(path) - 1)');
    // 主键与租户键。
    expect(catalog).toContain('projectId: uuid(');
    expect(catalog).toContain('primaryKey({ columns: [t.projectId, t.id] })');
    expect(catalog).toContain('scopedUuid()');
    // 旧列与旧排序口径整体退役。
    expect(catalog).not.toContain('parentId');
    expect(catalog).not.toContain("'section'");
    expect(catalog).not.toContain("'sort'");
    expect(catalog).not.toContain("'hide'");
    expect(catalog).not.toContain("'created_by'");
    expect(catalog).not.toContain("'deleted_at'");
  });

  test('B3-2：约束 / 索引名与基线 518–550 行一一对应', () => {
    const catalog = block(schema('content'), 'book_catalog');
    // CHECK（path 格式 + 内容互斥，互斥违规 → 23514）。
    expect(catalog).toContain("'book_catalog_path_format'");
    expect(catalog).toContain("'book_catalog_one_content'");
    // UNIQUE（路径唯一 + 谱文 / 谱系各只挂一次）。
    expect(catalog).toContain("'book_catalog_path_unique'");
    expect(catalog).toContain("'book_catalog_article_once'");
    expect(catalog).toContain("'book_catalog_lineage_once'");
    // FK（含自引用父路径 FK）。
    expect(catalog).toContain("'book_catalog_book_fk'");
    expect(catalog).toContain("'book_catalog_article_fk'");
    expect(catalog).toContain("'book_catalog_lineage_fk'");
    expect(catalog).toContain("'book_catalog_scope_fk'");
    expect(catalog).toContain("'book_catalog_parent_fk'");
    // 索引（GiST 路径 + 两个内容索引）。
    expect(catalog).toContain("'book_catalog_path_gist'");
    expect(catalog).toContain("'book_catalog_article_idx'");
    expect(catalog).toContain("'book_catalog_lineage_idx'");
    // 旧约束 / 索引名整体退役（T25 验证明确点名 fk_catalog_parent_same_book）。
    expect(catalog).not.toContain('fk_catalog_parent_same_book');
    expect(catalog).not.toContain('uk_book_catalog_org_book_id');
    expect(catalog).not.toContain('ck_catalog_section');
    expect(catalog).not.toContain('ck_catalog_one_target');
    expect(catalog).not.toContain('idx_catalog_book');
    expect(catalog).not.toContain('idx_catalog_article');
    expect(catalog).not.toContain('idx_catalog_lineage');
  });

  test('B3-3：查询层三处不再按 book_catalog 软删过滤', () => {
    for (const path of [
      'lib/article/mutations.ts',
      'lib/db/queries/articles.ts',
      'lib/lineage/services.ts',
    ]) {
      expect(stripComments(read(path)), path).not.toContain(
        'bookCatalogs.deletedAt'
      );
    }
    // 工厂不再传 section / createdBy，改传 projectId + path。
    const factory = read('tests/helpers/factories.ts');
    expect(factory).toContain('projectId: params.projectId');
    expect(factory).toMatch(/path:\s*params\.path/);
    const factoryStart = factory.indexOf('createCatalogItem');
    const factoryEnd = factory.indexOf('/**', factoryStart);
    const catalogFactory = factory.slice(
      factoryStart,
      factoryEnd < 0 ? undefined : factoryEnd
    );
    expect(catalogFactory).not.toContain('createdBy');
    expect(catalogFactory).not.toContain('section');
    expect(exists('tests/helpers/factories.ts')).toBe(true);
  });

  test('B3-4：article 正文收敛为 body text，旧结构三列全退役（T27 收口）', () => {
    const article = block(schema('content'), 'article', 'book');
    expect(article).toContain("text('body')");
    expect(article).not.toContain("jsonb('content')");
    expect(article).not.toContain("'plain_text'");
    expect(article).not.toContain("'created_by'");
  });
});
