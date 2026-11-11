import { describe, expect, it } from 'vitest';
import { getTestSql } from '../helpers/db';

/**
 * 目标态 node 的索引与列形状（S8 阶段 C 收口）。
 *
 * 前身是 spouse-sort-index.test.ts：旧模型的 node 带配偶边（role /
 * spouse_of_id / generation / sort / deleted_at / name / surname / full_name /
 * sex / created_by），nextSpouseSort 按 spouse_of_id 求 max(sort)，因此需要
 * idx_node_spouse_sort 部分索引，并用 200 行配偶夹具 EXPLAIN 验证计划命中。
 *
 * 目标态（附录 A.4）把这些全部退役：
 * - 婚姻关系落 family + family_partner，node 不再有配偶边。配偶写入已不存在；
 *   本文件只断言 path / display_name 列仍在。
 * - 世代由 nlevel(path) 派生、排序由末段稀疏号派生，都不再存列。
 * - 层级索引用 node_path_gist（gist(project_id, path)）+ node_path_unique。
 *
 * 旧两个用例在目标态语义失效（idx_node_spouse_sort 不存在、insert 旧列直接
 * 42703），按「不留已知坏测试」整体改写为下面的目标态正反例，而不是把
 * 断言翻成 false 糊过去。目标态性能验收归阶段 D / T40 的 EXPLAIN 用例。
 */
const NODE_INDEXES = [
  'node_one_primary',
  'node_path_gist',
  'node_path_unique',
  'node_person_idx',
] as const;

const RETIRED_SPOUSE_COLUMNS = [
  'spouse_of_id',
  'generation',
  'sort',
  'role',
  'deleted_at',
  'name',
  'surname',
  'full_name',
  'sex',
  'created_by',
] as const;

describe('target-model node indexes', () => {
  it('declares the four target-model indexes and the composite primary key', async () => {
    const rows = await getTestSql()<
      { indexname: string }[]
    >`select indexname from pg_indexes
      where schemaname = 'public' and tablename = 'node'`;
    const names = rows.map((row) => row.indexname).sort();
    for (const index of NODE_INDEXES) {
      expect(names, index).toContain(index);
    }
    expect(names).toContain('node_pkey');
    expect(names).not.toContain('idx_node_spouse_sort');
  });

  it('keeps node_path_gist on the (project_id, path) prefix', async () => {
    const [row] = await getTestSql()<
      { indexdef: string }[]
    >`select indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'node'
        and indexname = 'node_path_gist'`;
    expect(row?.indexdef).toMatch(/USING gist \(project_id, path\)/);
  });

  it('rejects the old spouse-sort columns entirely', async () => {
    const rows = await getTestSql()<
      { column_name: string }[]
    >`select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'node'`;
    const columns = new Set(rows.map((row) => row.column_name));
    for (const column of RETIRED_SPOUSE_COLUMNS) {
      expect(columns.has(column), column).toBe(false);
    }
    // 目标态仍保留 path / parent_path 生成列与 display_name。
    expect(columns.has('path')).toBe(true);
    expect(columns.has('parent_path')).toBe(true);
    expect(columns.has('display_name')).toBe(true);
  });

  it('moves spouse ordering into family_partner', async () => {
    const rows = await getTestSql()<
      { indexname: string }[]
    >`select indexname from pg_indexes
      where schemaname = 'public' and tablename = 'family_partner'`;
    const names = rows.map((row) => row.indexname);
    expect(names).toContain('family_partner_person_idx');
    expect(names).toContain('family_partner_role_unique');
  });
});
