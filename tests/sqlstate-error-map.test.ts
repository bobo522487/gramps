import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LAST_OWNER_MESSAGE,
  ORG_ARCHIVED_MESSAGE,
  PERMISSION_MESSAGE,
  PG_ERROR_MAP,
  pgErrorOf,
} from '@/lib/db/errors';

const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, path), 'utf8');

/** node-postgres 的 SQLSTATE 挂在驱动错误上，应用拿到的是包了一层的错误链。 */
function driverFailure(sqlState: string, message: string) {
  const driverError = Object.assign(new Error(message), { code: sqlState });
  return new Error('Failed query', { cause: driverError });
}

describe('pgErrorOf', () => {
  it('maps a 22023 last-owner failure buried in a cause chain', () => {
    const error = driverFailure('22023', '不能移除最后一个所有者');
    expect(pgErrorOf(error)).toEqual({
      code: 'CONFLICT',
      message: LAST_OWNER_MESSAGE,
    });
  });

  it('maps a 22023 archived-organization failure to its dedicated message', () => {
    const error = driverFailure('22023', '组织已归档或已停用，无需重复操作');
    expect(pgErrorOf(error)).toEqual({
      code: 'CONFLICT',
      message: ORG_ARCHIVED_MESSAGE,
    });
  });

  it('maps 42501 to FORBIDDEN', () => {
    const error = driverFailure('42501', 'permission denied for schema app');
    expect(pgErrorOf(error)).toEqual({
      code: 'FORBIDDEN',
      message: PERMISSION_MESSAGE,
    });
  });

  it('returns null for an unknown SQLSTATE or a plain error', () => {
    expect(pgErrorOf(driverFailure('42P01', 'relation does not exist'))).toBe(
      null
    );
    expect(pgErrorOf(new Error('plain failure'))).toBe(null);
    expect(pgErrorOf(null)).toBe(null);
  });

  it('keeps exactly the four known SQLSTATE keys in the map', () => {
    expect(Object.keys(PG_ERROR_MAP).sort()).toEqual(
      ['22023', '23001', '23505', '42501'].sort()
    );
  });
});

describe('dead P0001 mapping is gone', () => {
  it('no application source still mentions P0001 or isRaisedException', () => {
    const sources = [
      read('../lib/db/errors.ts'),
      read('../lib/auth/errors.ts'),
      read('../lib/org/actions.ts'),
    ].join('\n');
    expect(sources).not.toContain('P0001');
    expect(sources).not.toContain('isRaisedException');
    expect(read('../tests/auth-errors.test.ts')).not.toContain('P0001');
  });
});
