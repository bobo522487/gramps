import { describe, expect, it } from 'vitest';
import {
  foreignKeyConstraintOf,
  isForeignKeyViolation,
  isForeignKeyViolationOf,
} from '@/lib/db/errors';

const CHILD_CONSTRAINTS = ['lineage_scope_fk', 'node_scope_fk'];

/** postgres.js：ON DELETE RESTRICT 命中时是 23001，字段叫 constraint_name。 */
function restrictError(constraintName: string) {
  return Object.assign(
    new Error('update or delete on table "project" violates RESTRICT setting'),
    {
      code: '23001',
      constraint_name: constraintName,
      schema_name: 'public',
      table_name: 'lineage',
    }
  );
}

/** Drizzle 把驱动异常包一层，SQLSTATE 只在 cause 上。 */
function wrapped(error: unknown) {
  return new Error('Failed query: delete from "project" ...', {
    cause: error,
  });
}

describe('project 子表 FK 违约分类', () => {
  it('识别 postgres.js 的 23001 + constraint_name（经 Drizzle cause 链）', () => {
    const error = wrapped(restrictError('lineage_scope_fk'));

    expect(isForeignKeyViolationOf(error, CHILD_CONSTRAINTS)).toBe(true);
    expect(foreignKeyConstraintOf(error)).toBe('lineage_scope_fk');
    expect(isForeignKeyViolation(error)).toBe(true);
  });

  it('仍识别 node-postgres 的 23503 + constraint', () => {
    const driver = Object.assign(new Error('foreign key violation'), {
      code: '23503',
      constraint: 'node_scope_fk',
    });
    const error = wrapped(driver);

    expect(isForeignKeyViolationOf(error, CHILD_CONSTRAINTS)).toBe(true);
    expect(foreignKeyConstraintOf(error)).toBe('node_scope_fk');
  });

  it('未登记的约束不算 not_empty，但要能取出名字用于报错', () => {
    const error = wrapped(restrictError('new_child_scope_fk'));

    expect(isForeignKeyViolationOf(error, CHILD_CONSTRAINTS)).toBe(false);
    expect(foreignKeyConstraintOf(error)).toBe('new_child_scope_fk');
  });

  it('非 FK 错误返回 false / null', () => {
    expect(isForeignKeyViolationOf(new Error('nope'), CHILD_CONSTRAINTS)).toBe(
      false
    );
    expect(foreignKeyConstraintOf(new Error('nope'))).toBeNull();
    expect(foreignKeyConstraintOf(null)).toBeNull();
  });
});
