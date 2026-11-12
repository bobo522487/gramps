import { describe, expect, it } from 'vitest';
import {
  constraintOf,
  isForeignKeyViolation,
  sqlStateOf,
} from '@/lib/db/errors';
import { isTokenHashCollision } from '@/lib/org/invitations';

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

describe('SAVEPOINT 删除按 SQLSTATE 分类', () => {
  it('识别 23001（经 Drizzle cause 链）并取出约束名供日志', () => {
    const error = wrapped(restrictError('lineage_scope_fk'));

    expect(sqlStateOf(error, '23001')).toBe(true);
    expect(isForeignKeyViolation(error)).toBe(true);
    expect(constraintOf(error, '23001')).toBe('lineage_scope_fk');
  });

  it('仍识别插入类 FK 违约的 23503', () => {
    const driver = Object.assign(new Error('foreign key violation'), {
      code: '23503',
      constraint: 'node_scope_fk',
    });
    const error = wrapped(driver);

    expect(sqlStateOf(error, '23503')).toBe(true);
    expect(constraintOf(error, '23503')).toBe('node_scope_fk');
  });

  it('未登记的约束名也照样按 SQLSTATE 判定 not_empty', () => {
    const error = wrapped(restrictError('new_child_scope_fk'));

    // SAVEPOINT 分支只看 SQLSTATE，不再核对约束名清单；未来新增子表无需登记。
    expect(sqlStateOf(error, '23001')).toBe(true);
    expect(constraintOf(error, '23001')).toBe('new_child_scope_fk');
  });

  it('非 FK 错误不命中 23001 / 23503，且取不出约束名', () => {
    expect(sqlStateOf(new Error('nope'), '23001')).toBe(false);
    expect(sqlStateOf(new Error('nope'), '23503')).toBe(false);
    expect(isForeignKeyViolation(new Error('nope'))).toBe(false);
    expect(constraintOf(new Error('nope'), '23001')).toBeNull();
    expect(constraintOf(null, '23001')).toBeNull();
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
