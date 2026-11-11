import { describe, expect, it } from 'vitest';
import {
  constraintOf,
  foreignKeyConstraintOf,
  isForeignKeyViolation,
  isForeignKeyViolationOf,
} from '@/lib/db/errors';
import { isTokenHashCollision } from '@/lib/org/invitations';

const CHILD_CONSTRAINTS = ['lineage_scope_fk', 'node_scope_fk'];

/** node-postgres：RESTRICT 命中时 SQLSTATE 是 23001，约束名在 constraint。 */
function restrictError(constraintName: string) {
  return Object.assign(
    new Error('update or delete on table "project" violates RESTRICT setting'),
    {
      code: '23001',
      constraint: constraintName,
      schema: 'public',
      table: 'lineage',
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
  it('识别 23001 + constraint（经 Drizzle cause 链）', () => {
    const error = wrapped(restrictError('lineage_scope_fk'));

    expect(isForeignKeyViolationOf(error, CHILD_CONSTRAINTS)).toBe(true);
    expect(foreignKeyConstraintOf(error)).toBe('lineage_scope_fk');
    expect(isForeignKeyViolation(error)).toBe(true);
  });

  it('仍识别插入类 FK 违约的 23503 + constraint', () => {
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

describe('唯一冲突的约束名', () => {
  it('从被包裹的错误链里取出 23505 的约束名', () => {
    const driver = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'invite_token_hash_key',
    });

    expect(constraintOf(wrapped(driver), '23505')).toBe(
      'invite_token_hash_key'
    );
    expect(constraintOf(wrapped(driver), '23503')).toBeNull();
  });

  it('邀请 token 撞车只认自己的约束，不认邮箱唯一冲突', () => {
    const tokenCollision = wrapped(
      Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'invite_token_hash_key',
      })
    );
    const emailCollision = wrapped(
      Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'invite_email_unique',
      })
    );

    expect(isTokenHashCollision(tokenCollision)).toBe(true);
    expect(isTokenHashCollision(emailCollision)).toBe(false);
  });
});
