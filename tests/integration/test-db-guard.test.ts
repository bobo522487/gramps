import { describe, expect, it } from 'vitest';
import { getTestDatabaseUrl } from '../helpers/db';

/**
 * 从随 B0 退役的 `migrations.test.ts` 中保留的通用守卫：它测的是
 * `getTestDatabaseUrl()` 对非 `_test` 库名的拒绝，与旧迁移模型无关，
 * 目标态仍在用，全仓没有第二处覆盖。
 */
describe('test database guard', () => {
  it('refuses a database name that does not end with _test', () => {
    const original = process.env.TEST_POSTGRES_URL;
    process.env.TEST_POSTGRES_URL =
      'postgres://user:pass@localhost:5432/gramps';
    try {
      expect(() => getTestDatabaseUrl()).toThrow(/_test/);
    } finally {
      if (original === undefined) {
        delete process.env.TEST_POSTGRES_URL;
      } else {
        process.env.TEST_POSTGRES_URL = original;
      }
    }
  });
});
