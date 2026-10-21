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

    expect(rows[0]?.count).toBeGreaterThanOrEqual(2);
  });

  it('creates exactly the ten business tables plus the activity feed', async () => {
    const rows = await getTestSql()<
      { table_name: string }[]
    >`SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`;

    expect(rows.map((row) => row.table_name)).toEqual([
      'activity_logs',
      'article',
      'book',
      'book_catalog',
      'folder',
      'invite',
      'lineage',
      'node',
      'organization',
      'organization_member',
      'project',
    ]);

    const authRows = await getTestSql()<
      { table_name: string }[]
    >`SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'auth' AND table_type = 'BASE TABLE'`;

    expect(authRows.map((row) => row.table_name)).toEqual(['users']);
  });

  it('creates the public-id, membership and invitation indexes', async () => {
    const rows = await getTestSql()<
      { indexname: string }[]
    >`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;

    expect(rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        'uk_organization_slug',
        'uk_project_ref',
        'uk_project_organization_id',
        'uk_org_member_active',
        'uk_org_member_single_owner',
        'uk_invite_token',
        'uk_invite_pending_email',
        'idx_activity_logs_org',
        'idx_activity_logs_user',
        'idx_node_lineage_path',
        'idx_node_search',
        'idx_article_search',
      ])
    );
  });

  it('enables and forces row level security on every exposed table', async () => {
    const rows = await getTestSql()<
      {
        schema: string;
        name: string;
        enabled: boolean;
        forced: boolean;
      }[]
    >`SELECT n.nspname AS schema,
             c.relname AS name,
             c.relrowsecurity AS enabled,
             c.relforcerowsecurity AS forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname IN ('public', 'auth')
      ORDER BY n.nspname, c.relname`;

    expect(rows).toHaveLength(12);
    for (const row of rows) {
      expect(row.enabled, `${row.schema}.${row.name} RLS`).toBe(true);
      expect(row.forced, `${row.schema}.${row.name} FORCE RLS`).toBe(true);
    }
  });

  it('keeps app_rw unable to bypass RLS or touch auth.users and DELETE', async () => {
    const [role] = await getTestSql()<
      { rolsuper: boolean; rolbypassrls: boolean }[]
    >`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_rw'`;

    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });

    const [privileges] = await getTestSql()<
      { can_delete: boolean; can_read_users: boolean }[]
    >`SELECT has_table_privilege('app_rw', 'public.organization', 'DELETE') AS can_delete,
             has_table_privilege('app_rw', 'auth.users', 'SELECT') AS can_read_users`;

    expect(privileges).toEqual({
      can_delete: false,
      can_read_users: false,
    });
  });

  it('installs the required extensions and auth functions', async () => {
    const extensions = await getTestSql()<
      { extname: string }[]
    >`SELECT extname FROM pg_extension ORDER BY extname`;

    expect(extensions.map((row) => row.extname)).toEqual(
      expect.arrayContaining(['ltree', 'pg_trgm', 'btree_gist'])
    );

    const functions = await getTestSql()<{ proname: string }[]>`SELECT p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'auth'`;

    expect(functions.map((row) => row.proname)).toEqual(
      expect.arrayContaining([
        'sign_up',
        'find_user_by_email',
        'get_session_user',
        'update_password',
        'update_profile',
        'soft_delete_user',
        'accept_invite',
        'create_organization',
        'list_org_members',
        'is_user_in_org_by_email',
      ])
    );
  });

  it('keeps activity logs attributable to users without an org', async () => {
    const rows = await getTestSql()<
      { is_nullable: string }[]
    >`SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'activity_logs'
        AND column_name = 'organization_id'`;

    expect(rows[0]?.is_nullable).toBe('YES');
  });
});
