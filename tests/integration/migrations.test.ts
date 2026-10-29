import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
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

    expect(rows[0]?.count).toBeGreaterThanOrEqual(3);
  });

  it('creates exactly the sixteen business tables plus the activity feed', async () => {
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
      'event',
      'family',
      'family_child',
      'family_partner',
      'folder',
      'invite',
      'lineage',
      'node',
      'organization',
      'organization_member',
      'person',
      'person_name',
      'project',
    ]);

    const authRows = await getTestSql()<
      { table_name: string }[]
    >`SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'auth' AND table_type = 'BASE TABLE'`;

    expect(authRows.map((row) => row.table_name).sort()).toEqual([
      'account',
      'session',
      'users',
      'verification',
    ]);
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
        'uk_org_member_organization_user',
        'uk_org_member_single_owner',
        'uk_invite_pending_email',
        'idx_activity_logs_org',
        'idx_activity_logs_user',
        'idx_node_lineage_path',
        // idx_node_search is gone on purpose: ADR 0011 puts person search in
        // the client and keeps trigram only for article (search-boundary.test.ts).
        'idx_article_search',
        // The fact layer: the composite key a person_name hangs off, the key
        // person.primary_name_id points through, and the two partial keys that
        // keep one name type and one legacy node per person/project unique.
        'uk_person_organization_project_id',
        'uk_person_name_organization_person_id',
        'uk_person_name_type_order',
        'uk_person_legacy_node',
        'idx_person_primary_name',
        // The family fact layer: the three-column keys Tasks 6/7 reference,
        // and the two partial keys that keep one live row per person per
        // family on each side of the union.
        'uk_family_organization_project_id',
        'uk_family_partner_organization_project_id',
        'uk_family_child_organization_project_id',
        'uk_family_partner_family_person',
        'uk_family_child_family_person',
        // The event fact layer: the three-column key P4/P6 will reference and
        // the three non-partial lookup indexes (timeline by person, union
        // facts, type rollups). Soft-delete filtering lives in the queries.
        'uk_event_organization_project_id',
        'idx_event_subject',
        'idx_event_family',
        'idx_event_type',
      ])
    );
  });

  it('adds nullable region and notes columns to lineage', async () => {
    const rows = await getTestSql()<
      { column_name: string; is_nullable: string }[]
    >`SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'lineage'
        AND column_name IN ('region', 'notes')
      ORDER BY column_name`;

    expect(rows).toEqual([
      { column_name: 'notes', is_nullable: 'YES' },
      { column_name: 'region', is_nullable: 'YES' },
    ]);
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

    expect(rows).toHaveLength(21);
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
      expect.arrayContaining(['archive_organization', 'has_org_role', 'uid'])
    );
  });

  it('aborts the Better Auth migration when legacy rows exist', async () => {
    const admin = postgres(getTestDatabaseUrl(), {
      max: 1,
      onnotice: () => {},
    });
    const database = `gramps_guard_${randomUUID().replaceAll('-', '').slice(0, 12)}_test`;

    try {
      await admin.unsafe(`create database "${database}"`);
      const tempUrl = new URL(getTestDatabaseUrl());
      tempUrl.pathname = `/${database}`;
      const temp = postgres(tempUrl.toString(), {
        max: 1,
        onnotice: () => {},
      });

      try {
        for (const file of [
          '0000_baseline.sql',
          '0001_auth_rls.sql',
          '0002_app_role_grant.sql',
        ]) {
          const migration = readFileSync(
            join('lib/db/migrations', file),
            'utf8'
          );
          await temp.unsafe(migration);
        }

        await temp`
            insert into auth.users (email, name, password_hash)
            values ('legacy@example.com', 'Legacy', 'legacy-hash')
          `;

        const betterAuth = readFileSync(
          join('lib/db/migrations', '0003_better_auth.sql'),
          'utf8'
        );
        await expect(temp.unsafe(betterAuth)).rejects.toThrow(
          /empty auth\/tenant dataset/
        );
      } finally {
        await temp.end({ timeout: 5 });
      }
    } finally {
      await admin.unsafe(`drop database if exists "${database}" with (force)`);
      await admin.end({ timeout: 5 });
    }
  }, 60_000);

  it('keeps activity logs attributable to users without an org', async () => {
    const rows = await getTestSql()<
      { is_nullable: string }[]
    >`SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'activity_logs'
        AND column_name = 'organization_id'`;

    expect(rows[0]?.is_nullable).toBe('YES');
  });

  it('drops escape-hatch columns that nothing reads or writes', async () => {
    const rows = await getTestSql()<
      { table_name: string; column_name: string }[]
    >`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name = 'node' AND column_name IN ('mother_id', 'attributes'))
          OR (table_name = 'lineage' AND column_name = 'hang_rule'))
      ORDER BY table_name, column_name`;

    expect(rows).toEqual([]);
  });
});
