#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { config } from 'dotenv';
import postgres from 'postgres';

// Keep startup output quiet; dotenv >= 17 logs an injection summary by default.
config({ quiet: true });

const args = process.argv.slice(2);
const skipHttp = args.includes('--skip-http');
const skipDb = args.includes('--skip-db');

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const baseUrl = (
  argValue('--base-url') ??
  process.env.BETTER_AUTH_URL ??
  ''
).replace(/\/+$/, '');
const databaseUrl =
  process.env.POSTGRES_URL_DIRECT ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_URL ??
  '';
const appDatabaseUrl =
  process.env.APP_POSTGRES_URL ?? process.env.APP_DATABASE_URL ?? '';

let failed = false;

function pass(label, detail = '') {
  console.log(`PASS ${label}${detail ? `: ${detail}` : ''}`);
}

function fail(label, detail = '') {
  failed = true;
  console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
}

function skip(label, reason) {
  console.log(`SKIP ${label}: ${reason}`);
}

function check(condition, label, detail = '') {
  if (condition) {
    pass(label, detail);
  } else {
    fail(label, detail);
  }
  return condition;
}

const REQUIRED_HEADERS = [
  ['x-content-type-options', 'nosniff'],
  ['x-frame-options', 'DENY'],
  ['referrer-policy', null],
  ['permissions-policy', null],
  ['content-security-policy-report-only', null],
];

async function fetchPath(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: 'manual',
    ...init,
  });
  return response;
}

function checkSecurityHeaders(label, response) {
  const missing = REQUIRED_HEADERS.filter(
    ([name, expected]) =>
      response.headers.get(name) === null ||
      (expected !== null && response.headers.get(name) !== expected)
  ).map(([name]) => name);

  check(
    missing.length === 0,
    `${label} security headers`,
    missing.length === 0
      ? 'all present'
      : `missing or wrong: ${missing.join(', ')}`
  );
  check(
    response.headers.get('x-powered-by') === null,
    `${label} hides x-powered-by`
  );
}

async function checkHttp() {
  if (!baseUrl) {
    fail('HTTP base URL', 'pass --base-url or set BETTER_AUTH_URL');
    return;
  }

  console.log(`# HTTP checks against ${baseUrl}`);

  try {
    const health = await fetchPath('/api/health');
    check(
      health.status === 200,
      'GET /api/health status',
      `got ${health.status}`
    );
    const healthBody = await health.json().catch(() => null);
    check(
      healthBody?.status === 'ok' && healthBody?.database === 'up',
      'GET /api/health payload',
      JSON.stringify(healthBody)
    );
    checkSecurityHeaders('GET /api/health', health);

    const orgs = await fetchPath('/api/orgs');
    check(
      orgs.status === 401,
      'GET /api/orgs unauthenticated',
      `got ${orgs.status}`
    );
    check(
      Boolean(orgs.headers.get('x-request-id')),
      'GET /api/orgs request id'
    );
    checkSecurityHeaders('GET /api/orgs', orgs);

    const dashboard = await fetchPath('/dashboard');
    const isRedirect = dashboard.status >= 300 && dashboard.status < 400;
    check(isRedirect, 'GET /dashboard redirects', `got ${dashboard.status}`);
    const location = dashboard.headers.get('location') ?? '';
    let target = location;
    try {
      target = new URL(location, baseUrl).pathname;
    } catch {
      // keep the raw header for the failure detail
    }
    check(
      target.startsWith('/sign-in'),
      'GET /dashboard redirect target',
      target || '(missing location)'
    );
    checkSecurityHeaders('GET /dashboard', dashboard);

    for (const path of ['/api/auth/ok', '/api/auth/sign-in/email']) {
      const response = await fetchPath(path);
      check(
        response.status === 404,
        `GET ${path} is not routed`,
        `got ${response.status}`
      );
    }

    const authPost = await fetchPath('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'probe@example.com',
        password: 'probe-password',
      }),
    });
    check(
      authPost.status === 404,
      'POST /api/auth/sign-in/email is not routed',
      `got ${authPost.status}`
    );
  } catch (error) {
    fail(
      'HTTP checks',
      error instanceof Error ? error.message : 'request failed'
    );
  }
}

const BUSINESS_TABLES = [
  'organization',
  'organization_member',
  'invite',
  'project',
  'folder',
  'lineage',
  'node',
  'article',
  'book',
  'book_catalog',
  'activity_logs',
];

const AUTH_TABLES = ['users', 'session', 'account', 'verification'];

const TENANT_TRIGGERS = [
  ['auth', 'users', 'trg_auth_user_created'],
  ['public', 'organization', 'trg_org_slug_immutable'],
  ['public', 'organization_member', 'trg_org_member_last_owner_delete'],
  ['public', 'organization_member', 'trg_org_member_last_owner_update'],
  ['public', 'organization_member', 'trg_org_member_active_org'],
  ['public', 'invite', 'trg_invite_active_org'],
];

function safeDbError(error) {
  if (error && typeof error === 'object' && 'code' in error) {
    return `SQLSTATE ${error.code}`;
  }
  return 'database error (details suppressed)';
}

async function checkRuntimeRls() {
  if (!appDatabaseUrl) {
    skip(
      'runtime RLS checks',
      'set APP_POSTGRES_URL to connect as the login role'
    );
    return;
  }

  const app = postgres(appDatabaseUrl, { max: 1, onnotice: () => {} });
  try {
    const [current] = await app`select current_user as role`;
    pass('runtime connects', current?.role ?? 'unknown');

    try {
      const [row] = await app`
        select count(*)::int as count from organization
      `;
      check(
        row?.count === 0,
        'runtime sees no organizations without JWT claims',
        `got ${row?.count}`
      );
    } catch (error) {
      fail(
        'runtime RLS query',
        `${safeDbError(error)} — is the login role a member of app_rw?`
      );
    }

    let denied = false;
    try {
      await app`select 1 from auth.users limit 1`;
    } catch (error) {
      denied =
        Boolean(error) &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === '42501';
    }
    check(denied, 'runtime cannot read auth.users');
  } catch (error) {
    fail('runtime connection', safeDbError(error));
  } finally {
    await app.end({ timeout: 5 });
  }
}

async function checkDb() {
  if (!databaseUrl) {
    fail(
      'database URL',
      'set POSTGRES_URL_DIRECT, POSTGRES_URL_NON_POOLING or POSTGRES_URL'
    );
    return;
  }

  console.log('# database checks');
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

  try {
    const [version] = await sql`show server_version_num`;
    const versionNumber = Number(version?.server_version_num ?? 0);
    check(
      versionNumber >= 180000,
      'PostgreSQL 18+',
      `server_version_num=${versionNumber}`
    );

    const tables = await sql`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    `;
    const byName = new Map(tables.map((row) => [row.relname, row]));
    const missingTables = BUSINESS_TABLES.filter((name) => !byName.has(name));
    check(
      missingTables.length === 0,
      'business tables exist',
      missingTables.length === 0
        ? `${BUSINESS_TABLES.length} tables`
        : missingTables.join(', ')
    );
    const unprotected = BUSINESS_TABLES.filter((name) => {
      const row = byName.get(name);
      return !row?.relrowsecurity || !row?.relforcerowsecurity;
    });
    check(
      unprotected.length === 0,
      'RLS enabled and forced',
      unprotected.length === 0 ? 'all business tables' : unprotected.join(', ')
    );

    const authTables = await sql`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'auth' and c.relkind = 'r'
    `;
    const authByName = new Map(authTables.map((row) => [row.relname, row]));
    const missingAuthTables = AUTH_TABLES.filter(
      (name) => !authByName.has(name)
    );
    check(
      missingAuthTables.length === 0,
      'auth tables exist',
      missingAuthTables.length === 0
        ? `${AUTH_TABLES.length} tables`
        : missingAuthTables.join(', ')
    );
    const unprotectedAuth = AUTH_TABLES.filter((name) => {
      const row = authByName.get(name);
      return !row?.relrowsecurity || !row?.relforcerowsecurity;
    });
    check(
      unprotectedAuth.length === 0,
      'auth tables FORCE RLS',
      unprotectedAuth.length === 0
        ? 'all auth tables'
        : unprotectedAuth.join(', ')
    );

    // F5: every business-table policy must go through auth.has_org_role().
    // A bare `organization_id IN (SELECT ... FROM organization_member)` policy
    // is the failure mode data-model.md used to recommend, and it cannot express
    // "read includes viewer, write excludes viewer" (ADR 0006).
    const policies = await sql`
      select policyname, tablename, roles::text[] as roles, qual, with_check
      from pg_policies
      where schemaname = 'public'
    `;
    const appRwPolicies = policies.filter((policy) =>
      (policy.roles ?? []).includes('app_rw')
    );
    // Strong form: every app_rw policy MUST call has_org_role. Checking only
    // for the bad text `organization_member` would accept USING (true), which
    // is the more dangerous bypass (branch review Minor 3).
    const notViaHasOrgRole = appRwPolicies.filter((policy) => {
      const expression = `${policy.qual ?? ''} ${policy.with_check ?? ''}`;
      return !/auth\.has_org_role\(/i.test(expression);
    });
    check(
      notViaHasOrgRole.length === 0,
      'every app_rw policy calls auth.has_org_role',
      notViaHasOrgRole.length === 0
        ? `${appRwPolicies.length} policies via has_org_role`
        : notViaHasOrgRole
            .map((policy) => `${policy.tablename}.${policy.policyname}`)
            .join(', ')
    );

    const journal = JSON.parse(
      readFileSync(
        new URL('../lib/db/migrations/meta/_journal.json', import.meta.url),
        'utf8'
      )
    );
    const expectedMigrations = journal.entries.length;
    const [migrations] = await sql`
      select count(*)::int as count from drizzle.__drizzle_migrations
    `;
    check(
      (migrations?.count ?? 0) === expectedMigrations,
      'migrations match journal',
      `${migrations?.count ?? 0}/${expectedMigrations}`
    );

    const roles = await sql`
      select rolname, rolsuper, rolbypassrls, rolcanlogin
      from pg_roles
      where rolname in ('app_rw', 'auth_service')
    `;
    const roleByName = new Map(roles.map((row) => [row.rolname, row]));
    for (const role of ['app_rw', 'auth_service']) {
      const row = roleByName.get(role);
      check(Boolean(row), `${role} role exists`);
      if (!row) {
        continue;
      }
      check(row.rolsuper === false, `${role} is not superuser`);
      check(row.rolbypassrls === false, `${role} cannot bypass RLS`);
      check(row.rolcanlogin === false, `${role} is NOLOGIN`);
    }

    const [privileges] = await sql`
      select
        has_table_privilege('auth_service', 'auth.users', 'SELECT') as auth_users_select,
        has_table_privilege('auth_service', 'auth.users', 'INSERT') as auth_users_insert,
        has_table_privilege('auth_service', 'public.organization', 'INSERT') as auth_org_insert,
        has_table_privilege('auth_service', 'public.organization_member', 'UPDATE') as auth_member_update,
        has_table_privilege('app_rw', 'auth.users', 'SELECT') as app_auth_users_select,
        has_table_privilege('app_rw', 'public.organization', 'INSERT') as app_org_insert,
        has_table_privilege('app_rw', 'public.organization', 'UPDATE') as app_org_update,
        has_table_privilege('app_rw', 'public.organization_member', 'UPDATE') as app_member_update,
        has_table_privilege('app_rw', 'public.invite', 'SELECT') as app_invite_select,
        has_table_privilege('auth_service', 'public.project', 'SELECT') as auth_project_select
    `;
    check(
      privileges?.auth_users_select === true &&
        privileges?.auth_users_insert === true &&
        privileges?.auth_org_insert === true &&
        privileges?.auth_member_update === true,
      'auth_service owns identity and tenant writes'
    );
    check(
      privileges?.app_auth_users_select === false &&
        privileges?.app_org_insert === false &&
        privileges?.app_org_update === false &&
        privileges?.app_member_update === false &&
        privileges?.app_invite_select === false,
      'app_rw cannot read auth or write tenant tables'
    );
    check(
      privileges?.auth_project_select === false,
      'auth_service cannot read business tables'
    );

    const triggers = await sql`
      select n.nspname, c.relname, t.tgname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal
    `;
    const triggerKeys = new Set(
      triggers.map((row) => `${row.nspname}.${row.relname}.${row.tgname}`)
    );
    const missingTriggers = TENANT_TRIGGERS.filter(
      ([schema, table, trigger]) =>
        !triggerKeys.has(`${schema}.${table}.${trigger}`)
    );
    check(
      missingTriggers.length === 0,
      'auth and tenant triggers installed',
      missingTriggers.length === 0
        ? `${TENANT_TRIGGERS.length} triggers`
        : missingTriggers
            .map(([, table, trigger]) => `${table}.${trigger}`)
            .join(', ')
    );

    const [app] = await sql`
      select rolbypassrls from pg_roles where rolname = 'app'
    `;
    if (!app) {
      skip('app login role', 'not provisioned (created out of band)');
    } else {
      check(app.rolbypassrls === false, 'app cannot bypass RLS');
      const [membership] = await sql`
        select pg_has_role('app', 'app_rw', 'MEMBER') as member
      `;
      check(membership?.member === true, 'app is a member of app_rw');
    }

    const [authRuntime] = await sql`
      select rolbypassrls from pg_roles where rolname = 'auth_runtime'
    `;
    if (!authRuntime) {
      skip('auth runtime login role', 'not provisioned (created out of band)');
    } else {
      check(
        authRuntime.rolbypassrls === false,
        'auth_runtime cannot bypass RLS'
      );
      const [membership] = await sql`
        select pg_has_role('auth_runtime', 'auth_service', 'MEMBER') as member
      `;
      check(
        membership?.member === true,
        'auth_runtime is a member of auth_service'
      );
    }
  } catch (error) {
    fail('database checks', safeDbError(error));
  } finally {
    await sql.end({ timeout: 5 });
  }

  await checkRuntimeRls();
}

if (!skipHttp) {
  await checkHttp();
}

if (!skipDb) {
  await checkDb();
}

if (failed) {
  console.log('\nDeployment verification failed.');
  process.exitCode = 1;
} else {
  console.log('\nDeployment verification passed.');
}
