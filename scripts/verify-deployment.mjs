#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { loadEnv } from './load-env.mjs';

loadEnv();

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

// 部署自检的输出会被人读，也会被脚本 grep。`1 triggers` / `1 policies` 这种
// 单复数错乱说明文案是拼出来的而不是算的，顺手修掉——失败分支里的逗号列表
// 已经长得离谱，一并按「单项直接打，多项计数 + 列举」收敛。
function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function listed(items, render) {
  return items.length === 1
    ? render(items[0])
    : `${items.length}: ${items.map(render).join(', ')}`;
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
  'person',
  'person_name',
  'family',
  'family_partner',
  'family_child',
  'event',
  'article',
  'book',
  'book_catalog',
  'book_export',
];

const AUTH_TABLES = ['user', 'session', 'account', 'verification'];

// Guards that are not the tenant-immutability family. Target state keeps
// exactly one: registration must create the personal organization inside the
// same transaction as the user row (see docs/data-model.md §9 — Better Auth's
// `databaseHooks.user.create.after` runs *after* commit, so a hook cannot roll
// back a half-created account).
//
// `slug` immutability, the last-owner rules and the active-organization
// invariants deliberately have **no trigger**: §9 registers them as
// write-path contracts, and `app.accept_invite` / `app.create_organization`
// are the only writers. The former three triggers were part of the old
// implementation and are not in the target baseline.
const TENANT_TRIGGERS = [['auth', 'user', 'trg_auth_user_created']];

// Every organization-scoped table must carry `trg_<table>_tenant_immutable`.
// The list is the inventory the integration test asserts too, so a new table
// that forgets the trigger fails here before it reaches production.
// `activity_logs` retired in B2a; `book_export` arrived with B1's appendix A.5.
const TENANT_IMMUTABLE_TABLES = [
  'organization_member',
  'invite',
  'project',
  'folder',
  'lineage',
  'node',
  'person',
  'person_name',
  'family',
  'family_partner',
  'family_child',
  'event',
  'article',
  'book',
  'book_catalog',
  'book_export',
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
      await app`select 1 from auth.user limit 1`;
    } catch (error) {
      denied =
        Boolean(error) &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === '42501';
    }
    check(denied, 'runtime cannot read auth.user');
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
        ? plural(BUSINESS_TABLES.length, 'table', 'tables')
        : listed(missingTables, (name) => name)
    );
    const unprotected = BUSINESS_TABLES.filter((name) => {
      const row = byName.get(name);
      return !row?.relrowsecurity || !row?.relforcerowsecurity;
    });
    check(
      unprotected.length === 0,
      'RLS enabled and forced',
      unprotected.length === 0
        ? `all ${plural(BUSINESS_TABLES.length, 'table', 'tables')}`
        : listed(unprotected, (name) => name)
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
        ? plural(AUTH_TABLES.length, 'table', 'tables')
        : listed(missingAuthTables, (name) => name)
    );
    const unprotectedAuth = AUTH_TABLES.filter((name) => {
      const row = authByName.get(name);
      return !row?.relrowsecurity || !row?.relforcerowsecurity;
    });
    check(
      unprotectedAuth.length === 0,
      'auth tables FORCE RLS',
      unprotectedAuth.length === 0
        ? plural(AUTH_TABLES.length, 'table', 'tables')
        : listed(unprotectedAuth, (name) => name)
    );

    // F5（目标态）：每张业务表有且只有一条 `org_isolation` 策略，且可见性
    // 表达式必须来自 `app.visible_org_array()`。
    //
    // 历史坑：旧版这里断言「每条策略都调某个角色判定函数」。目标基线里
    // 那个函数已经不存在（B2a 换成 app.visible_org_array + SET LOCAL ROLE，
    // 角色判定归应用服务），这条断言会在 CI 里恒定失败，
    // 或者更糟——被人改成 `|| true` 悄悄放行。所以断言直接锚定目标态的
    // 表达式本体，而不是「调用了某个函数」这种间接条件。
    //
    // 反向断言的另一半：策略必须 FOR ALL 而不是拆成 FOR SELECT / FOR INSERT，
    // 且 USING 与 WITH CHECK 同时存在——只写 USING 的 INSERT 会被静默放行
    // （WITH CHECK 缺省回退到 USING，但 `INSERT ... RETURNING` 的可见性
    // 与准入是两套判定，拆开写必然漂移）。
    const policies = await sql`
      select policyname, tablename, cmd, roles::text[] as roles, qual, with_check
      from pg_policies
      where schemaname = 'public'
    `;
    const appRwPolicies = policies.filter((policy) =>
      (policy.roles ?? []).includes('app_rw')
    );
    const notOrgIsolation = appRwPolicies.filter((policy) => {
      if (policy.policyname !== 'org_isolation' || policy.cmd !== 'ALL') {
        return true;
      }
      if (!policy.qual || !policy.with_check) {
        return true;
      }
      return !(
        /app\.visible_org_array\(\)/i.test(policy.qual) &&
        /app\.visible_org_array\(\)/i.test(policy.with_check)
      );
    });
    check(
      notOrgIsolation.length === 0,
      'every app_rw policy is the target-state org_isolation policy',
      notOrgIsolation.length === 0
        ? plural(appRwPolicies.length, 'policy', 'policies')
        : listed(
            notOrgIsolation,
            (policy) => `${policy.tablename}.${policy.policyname}`
          )
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
        has_table_privilege('auth_service', 'auth.user', 'SELECT') as auth_user_select,
        has_table_privilege('auth_service', 'auth.user', 'INSERT') as auth_user_insert,
        has_table_privilege('auth_service', 'public.organization', 'INSERT') as auth_org_insert,
        has_table_privilege('auth_service', 'public.organization_member', 'UPDATE') as auth_member_update,
        has_table_privilege('app_rw', 'auth.user', 'SELECT') as app_auth_user_select,
        has_table_privilege('app_rw', 'public.organization', 'INSERT') as app_org_insert,
        has_table_privilege('app_rw', 'public.organization', 'UPDATE') as app_org_update,
        has_table_privilege('app_rw', 'public.organization_member', 'UPDATE') as app_member_update,
        has_table_privilege('app_rw', 'public.invite', 'SELECT') as app_invite_select,
        has_table_privilege('app_rw', 'public.invite', 'INSERT') as app_invite_insert,
        has_table_privilege('app_rw', 'public.invite', 'UPDATE') as app_invite_update,
        has_table_privilege('auth_service', 'public.project', 'SELECT') as auth_project_select
    `;
    check(
      privileges?.auth_user_select === true &&
        privileges?.auth_user_insert === true &&
        privileges?.auth_org_insert === true &&
        privileges?.auth_member_update === true,
      'auth_service owns identity and tenant writes'
    );
    check(
      privileges?.app_auth_user_select === false &&
        privileges?.app_org_insert === false &&
        privileges?.app_org_update === false &&
        privileges?.app_member_update === false,
      'app_rw cannot read auth or write tenant tables'
    );
    // `invite` 的 SELECT 在 B2b 反转为**必须可读**。
    //
    // 自建 token 邀请之后，成员管理页、重发与撤销都要业务层自己读这张表；
    // 旧前提「邀请走 Better Auth API、业务层不读它」已经不成立。写权限
    // 仍然不给：写入只能走附录 A.7 的 ON CONFLICT 路径与 `app.accept_invite`。
    check(
      privileges?.app_invite_select === true &&
        privileges?.app_invite_insert === false &&
        privileges?.app_invite_update === false,
      'app_rw can read pending invitations (member console), not write them'
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
      'registration trigger installed',
      missingTriggers.length === 0
        ? plural(TENANT_TRIGGERS.length, 'trigger', 'triggers')
        : listed(
            missingTriggers,
            ([schema, table, trigger]) => `${schema}.${table}.${trigger}`
          )
    );

    const missingImmutable = TENANT_IMMUTABLE_TABLES.filter(
      (table) =>
        !triggerKeys.has(`public.${table}.trg_${table}_tenant_immutable`)
    );
    check(
      missingImmutable.length === 0,
      'tenant columns immutable on every organization-scoped table',
      missingImmutable.length === 0
        ? plural(TENANT_IMMUTABLE_TABLES.length, 'trigger', 'triggers')
        : listed(missingImmutable, (table) => table)
    );

    // Target state has no soft delete, so a closed organization's row stays in
    // the table. The only writer of organization_member for invitations is
    // app.accept_invite, and the predicate must live in its body (docs/data-model.md §9)
    // — there is no trg_invite_active_org trigger in the target baseline.
    const [acceptInvite] = await sql`
      select pg_get_functiondef('app.accept_invite(text)'::regprocedure) as body
    `;
    check(
      /status\s*<>\s*'closed'/.test(acceptInvite?.body ?? ''),
      'accept_invite rejects invitations to closed organizations',
      acceptInvite?.body ? 'predicate present' : 'function not found'
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
