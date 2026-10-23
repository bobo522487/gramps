#!/usr/bin/env node
import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config();

const args = process.argv.slice(2);
const skipHttp = args.includes('--skip-http');
const skipDb = args.includes('--skip-db');

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const baseUrl = (argValue('--base-url') ?? process.env.BASE_URL ?? '').replace(
  /\/+$/,
  ''
);
const databaseUrl =
  process.env.POSTGRES_URL_DIRECT ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_URL ??
  '';
const appDatabaseUrl =
  process.env.APP_DATABASE_URL ?? process.env.APP_POSTGRES_URL ?? '';

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
    fail('HTTP base URL', 'pass --base-url or set BASE_URL');
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
      'set APP_DATABASE_URL to connect as the login role'
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
      return !row || !row.relrowsecurity || !row.relforcerowsecurity;
    });
    check(
      unprotected.length === 0,
      'RLS enabled and forced',
      unprotected.length === 0 ? 'all business tables' : unprotected.join(', ')
    );

    const [migrations] = await sql`
      select count(*)::int as count from drizzle.__drizzle_migrations
    `;
    check(
      (migrations?.count ?? 0) >= 3,
      'migrations applied',
      `${migrations?.count ?? 0} rows`
    );

    const [appRw] = await sql`
      select rolbypassrls from pg_roles where rolname = 'app_rw'
    `;
    check(Boolean(appRw), 'app_rw role exists');
    check(
      appRw?.rolbypassrls === false,
      'app_rw cannot bypass RLS',
      appRw ? `rolbypassrls=${appRw.rolbypassrls}` : 'role missing'
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
