import { describe, expect, it } from 'vitest';
import { getTestDatabaseUrl, getTestSql } from '../helpers/db';

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

describe('migrations', () => {
  it('applies every migration on a fresh database', async () => {
    const rows = await getTestSql()<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`;

    expect(rows[0]?.count).toBeGreaterThanOrEqual(6);
  });

  it('creates the current business tables', async () => {
    const rows = await getTestSql()<
      { table_name: string }[]
    >`SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;

    expect(rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        'users',
        'organizations',
        'org_members',
        'projects',
        'activity_logs',
        'invitations',
      ])
    );
  });

  it('creates the public-id and org-scoped project indexes', async () => {
    const rows = await getTestSql()<
      { indexname: string }[]
    >`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;

    expect(rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        'organizations_slug_idx',
        'projects_ref_idx',
        'projects_org_slug_idx',
      ])
    );
  });
});
