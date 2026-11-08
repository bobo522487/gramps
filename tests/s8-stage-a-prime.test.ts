/**
 * S8 阶段 A′：目标态数据模型门禁。
 *
 * 规格唯一真相源是附录 A.3 / A.4（归档于 `gramps-S8-目标DDL.sql`），不是
 * `docs/data-model.md` 的散文、也不是重构前的列形状。本文件按 TDD 先于代码
 * 改动写出（RED），A′ 逐任务计划见实施计划 §3.2。
 *
 * 断言一律读文件源码，不 import 待改模块：让 RED 表现为「断言失败」而不是
 * 「编译失败」，才能精确指出哪一条规格没兑现。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const schema = (name: string) => read(`lib/db/schema/${name}.ts`);
const absent = (source: string, pattern: RegExp) =>
  expect(source, `不应出现 ${pattern}`).not.toMatch(pattern);

describe('S8 阶段 A′ · 事实层与谱系层按附录 A 落地', () => {
  test('A′1：shared.ts 提供不带列级主键的 scopedUuid', () => {
    expect(schema('shared')).toContain('scopedUuid');
  });

  test('A′2：person / person_name 只留目标态列，且是复合主键', () => {
    const source = schema('person');
    absent(
      source,
      /legacy_node_id|primary_name_id|living_status|living_status_locked|privacy_level|name_status|merged_into_id|sort_key|full_name|sort_order|custom_type|name_prefix|name_suffix|surname_prefix|pinyin|romanized|deleted_at|updated_at|created_by/
    );
    expect(source).toContain("'is_primary'");
    expect(source).toContain("'value'");
    expect(source).toContain('primaryKey(');
    expect(source).toContain("'given'");
  });

  test('A′2：family_* 带四列母亲外键与成对 CHECK', () => {
    const source = schema('family');
    expect(source).toContain('family_child_mother_pair');
    expect(source).toContain('family_partner_role_unique');
    expect(source).toContain("'mother_person_id'");
    expect(source).toContain("'mother_role'");
    absent(
      source,
      /partner_order|parentage_type|union_type|deleted_at|updated_at|created_by/
    );
  });

  test('A′2：event 是双主体 CHECK + 生卒各一条', () => {
    const source = schema('event');
    expect(source).toContain('num_nonnulls');
    expect(source).toContain('event_one_birth');
    expect(source).toContain('event_one_death');
    expect(source).toContain("'date_sort'");
    absent(
      source,
      /event_kind|event_type|attribute_event_type|deleted_at|updated_at|created_by/
    );
  });

  test('A′2：node 无身份列，闭包由生成列 + 自引用外键保证', () => {
    const source = schema('lineage');
    absent(
      source,
      /spouse_of_id|spouseOfId|'generation'|'is_alive'|node_type|'request_id'|'created_by'|'updated_at'|'deleted_at'|ck_node_generation_gte_tree_depth|ck_node_spouse_has_no_path|nodeLabel\(/
    );
    expect(source).toContain('parent_path');
    expect(source).toContain('nlevel(');
    expect(source).toContain('subpath(');
    expect(source).toContain('node_path_format');
  });

  test('A′4：常量值域收敛到附录 A 的三组', () => {
    const source = read('lib/genealogy/constants.ts');
    expect(source).toContain('PERSON_NAME_TYPE_VALUES');
    expect(source).toContain("'given'");
    expect(source).toContain("'milk'");
    absent(
      source,
      /LIVING_STATUS_VALUES|PRIVACY_LEVEL_VALUES|NAME_STATUS_VALUES|PARTNER_ROLE_VALUES|PARTNER_STATUS_VALUES|PARENTAGE_TYPE_VALUES|UNION_TYPE_VALUES|EVENT_TYPE_VALUES|ATTRIBUTE_EVENT_TYPE_VALUES|DATE_PRECISION_VALUES|CALENDAR_VALUES|'temple'/
    );
  });

  test('A′6：查询层提供事实层 → NodeView 投影', () => {
    expect(read('lib/db/queries/nodes.ts')).toContain('toNodeViewRows');
  });

  test('A′7：写入层不再按 UUID 段或 sort 排位置', () => {
    const source = read('lib/lineage/node-services.ts');
    absent(
      source,
      /insertCoSpouse|nextSort|adjustNodeCount|nodeLabel\(|spouseOfId|requestId/
    );
    expect(source).toContain('personNames');
  });

  test('A′10：安全回归的「事实层写边界」断言已反转', () => {
    absent(
      read('tests/security-regressions.test.ts'),
      /fact-layer write boundary/
    );
  });

  test('A′11：术语表不再把事实层写成单向回填快照', () => {
    absent(read('docs/glossary.md'), /单向回填快照/);
  });

  test('防零断言：四份 schema 仍是 pgTable 定义', () => {
    for (const name of ['person', 'family', 'event', 'lineage']) {
      expect(schema(name), name).toContain('pgTable(');
    }
  });
});
