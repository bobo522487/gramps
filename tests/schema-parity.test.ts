import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  globalUniqueIssues,
  indexParityIssues,
} from '../scripts/schema-parity.mjs';

const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, path), 'utf8');

// 最小假快照：只留一张复合主键内容表，形状与
// lib/db/migrations/meta/0000_snapshot.json 的 public.* 条目一致。
const snap = {
  tables: {
    'public.folder': {
      compositePrimaryKeys: {
        folder_pk: { name: 'folder_pk', columns: ['project_id', 'id'] },
      },
      uniqueConstraints: {
        folder_id_global: {
          name: 'folder_id_global',
          columns: ['id'],
        },
      },
      indexes: {
        folder_order_idx: {
          name: 'folder_order_idx',
          columns: ['project_id', 'seq'],
        },
      },
    },
  },
};

describe('schema parity 执行者', () => {
  it('缺少全局唯一约束时点名该表', () => {
    expect(globalUniqueIssues(snap, [])).toContain('folder');
  });

  it('约束存在时无 issue', () => {
    expect(
      globalUniqueIssues(snap, [
        { table: 'folder', name: 'folder_id_global', columns: ['id'] },
      ])
    ).toEqual([]);
  });

  it('TS 有而库无的索引被点名', () => {
    expect(indexParityIssues(snap, [])).toContain('folder_order_idx');
  });

  it('verifyParity 真的接上了这两个执行者', () => {
    const source = read('../scripts/verify-target-schema.mjs');
    expect(source).toContain('globalUniqueIssues(');
    expect(source).toContain('indexParityIssues(');
    expect(source).toContain('pg_indexes');
    expect(source).toContain("contype = 'u'");
  });
});
