/**
 * S8 阶段 B · B1：目标态缺失表与 `project` / `folder` 复合主键门禁。
 *
 * 规格唯一真相源是附录 A.2 / A.5（归档于 `gramps-S8-目标DDL.sql`），
 * 批次划分见实施计划 §4「阶段 B 批次划分与待拍板规格」。本文件按 TDD
 * 先于 B1 改动写出（RED）。断言静态读文件、不 import 待改模块，让 RED
 * 表现为断言失败而不是编译失败。
 *
 * 独立评审后加固：除表名 / helper 名外，逐条断言 CHECK 名与表达式、FK 的
 * 列组与目标列组、RESTRICT 删除语义、主键列数组，避免「只留列名空壳」也能
 * 全绿的假阳性。B1 不动 `activity_logs` / auth 三表 / 软删列 / 文章层 /
 * 认证层：那三项规格待负责人拍板，分别在 B2 / B3 / B4 处理。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const exists = (path: string) => existsSync(join(root, path));
const schema = (name: string) => read(`lib/db/schema/${name}.ts`);

describe('S8 阶段 B · B1 目标态结构切片', () => {
  test('B1-1：新增 book-export.ts，按附录 A.5 建表', () => {
    expect(exists('lib/db/schema/book-export.ts')).toBe(true);
    const source = schema('book-export');
    expect(source).toContain("'book_export'");
    expect(source).toContain('bookExports');
    expect(source).toContain('scopedUuid()');
    expect(source).toContain('primaryKey({ columns: [t.projectId, t.id] })');
    expect(source).toContain("'artifact_uri'");
    expect(source).toContain("'checksum'");

    // 附录 A.5 的四条 CHECK：名字 + 关键表达式都要在，删任一条都应转红。
    // 用转义的模板字符串写 `${...}` 字面量，避免 Biome 的
    // noTemplateCurlyInString 把待匹配的 SQL 片段误判成模板插值。
    expect(source).toContain('book_export_cutoff');
    expect(source).toContain(`\${t.factCutoff} <= \${t.exportedAt}`);
    expect(source).toContain('book_export_artifact_uri_not_blank');
    expect(source).toContain(`btrim(\${t.artifactUri}) <> ''`);
    expect(source).toContain('book_export_checksum');
    expect(source).toContain('^[0-9a-f]{64}$');
    expect(source).toContain('book_export_format');
    for (const value of ['pdf', 'typst', 'epub', 'html', 'other']) {
      expect(source).toContain(`'${value}'`);
    }

    // 两条 FK 的列组、目标列组与 RESTRICT 删除语义。
    expect(source).toContain('book_export_book_fk');
    expect(source).toContain('[t.projectId, t.bookId]');
    expect(source).toContain('[books.projectId, books.id]');
    expect(source).toContain('book_export_scope_fk');
    expect(source).toContain('[t.orgId, t.projectId]');
    expect(source).toContain('[projects.orgId, projects.id]');
    expect((source.match(/\.onDelete\('restrict'\)/g) ?? []).length).toBe(2);
  });

  test('B1-2：barrel 导出 book-export 与两个类型', () => {
    const source = schema('index');
    expect(source).toContain("export * from './book-export'");
    expect(source).toContain('export type BookExport');
    expect(source).toContain('export type NewBookExport');
  });

  test('B1-3：project 改 (organization_id,id) 复合主键 + 全局 UNIQUE(id)', () => {
    const source = schema('project');
    const block = source.slice(
      source.indexOf("'project'"),
      source.indexOf("'folder'")
    );
    expect(block).toContain('scopedUuid()');
    expect(block).toContain('primaryKey({ columns: [t.orgId, t.id] })');
    expect(block).toContain("unique('project_id_global').on(t.id)");
    expect(block).not.toContain('uuidPk()');
    // 只断言「约束声明」退役，不因注释里提到旧名字就误判回改。
    expect(block).not.toContain("unique('uk_project_organization_id')");
  });

  test('B1-4：folder 改 (project_id,id) 复合主键，消除 lineage_folder_fk 42830', () => {
    const source = schema('project');
    const block = source.slice(source.indexOf("'folder'"));
    expect(block).toContain('scopedUuid()');
    expect(block).toContain('primaryKey(');
    expect(block).toContain('[t.projectId, t.id]');
    expect(block).not.toContain('uuidPk()');
    // FK 目标列组必须真的与新的复合主键一致。
    expect(schema('lineage')).toContain('[folders.projectId, folders.id]');
  });

  test('B1-5：§8 #2 已随 T47 删除，`book_export` 的 TS 表结构仍在', () => {
    expect(read('docs/data-model.md')).not.toContain('## 8. 重构前的实现差异');
    expect(read('lib/db/schema/book-export.ts')).toContain('bookExport');
  });

  test('B1-6：B0 基线仍含 book_export，未被回改', () => {
    expect(read('lib/db/migrations/0000_target_schema.sql')).toContain(
      'CREATE TABLE book_export'
    );
  });
});
