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
// write-path contracts, guarded inside the SECURITY DEFINER writers —
// `app.accept_invite` / `app.create_organization` plus the B4 tenant/member
// writers (`app.rename_organization`, `app.archive_organization`,
// `app.remove_org_member`, `app.set_org_member_role`). The former three
// triggers were part of the old implementation and are not in the target baseline.
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
        `${safeDbError(error)} — is APP_POSTGRES_URL pointing at genealogy_app?`
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
    // 目标态（§8 #9 / 门禁 C-5）：public 业务表启用 RLS，但**不**启用
    // FORCE RLS。表属主是迁移角色，业务连接以非属主的 genealogy_app 登录，
    // RLS 对它已生效；FORCE 反而会连属主一起约束，挡住切换日的迁移路径。
    const unprotected = BUSINESS_TABLES.filter((name) => {
      const row = byName.get(name);
      return !row?.relrowsecurity || row?.relforcerowsecurity === true;
    });
    check(
      unprotected.length === 0,
      'RLS enabled (FORCE RLS deliberately off)',
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
    // auth.* 四表在目标态**没有** RLS：它们由认证侧独立角色 auth_service
    // 独占访问，业务角色 genealogy_app 连 USAGE ON SCHEMA auth 都没有。
    // 这正是 T32 规格由「全量统一」修订为「认证侧独立」的原因。若以后给
    // auth.* 加了 RLS 却没同步角色矩阵，这条先报出来，别让隔离假设漂移。
    const authWithRls = AUTH_TABLES.filter((name) => {
      const row = authByName.get(name);
      return row?.relrowsecurity === true || row?.relforcerowsecurity === true;
    });
    check(
      authWithRls.length === 0,
      'auth tables stay RLS-free (credential isolation via roles)',
      authWithRls.length === 0
        ? plural(AUTH_TABLES.length, 'table', 'tables')
        : listed(authWithRls, (name) => name)
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
    // T32 revised: the business role is genealogy_app (the baseline LOGIN
    // role). RLS policies are created FOR ALL, so pg_policies.roles resolves
    // to '{public}'; keep filtering on the role name for deployments that
    // explicitly grant the policy to genealogy_app, and fall back to all
    // public-schema policies so the shape check still runs.
    const allPublicPolicies = policies.filter(
      (policy) =>
        (policy.roles ?? []).includes('genealogy_app') ||
        (policy.roles ?? []).includes('public')
    );
    const notOrgIsolation = allPublicPolicies.filter((policy) => {
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
      'every public policy is the target-state org_isolation policy',
      notOrgIsolation.length === 0
        ? plural(allPublicPolicies.length, 'policy', 'policies')
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

    // T32 revised: genealogy_app is the LOGIN business role created by the
    // single baseline; auth_service stays a separate NOLOGIN role because
    // auth.* has no RLS and a shared role could read credential tables.
    const roles = await sql`
      select rolname, rolsuper, rolbypassrls, rolcanlogin
      from pg_roles
      where rolname in ('genealogy_app', 'auth_service')
    `;
    const roleByName = new Map(roles.map((row) => [row.rolname, row]));
    for (const role of ['genealogy_app', 'auth_service']) {
      const row = roleByName.get(role);
      check(Boolean(row), `${role} role exists`);
      if (!row) {
        continue;
      }
      check(row.rolsuper === false, `${role} is not superuser`);
      // NOBYPASSRLS is load-bearing: the target state deliberately does not
      // enable FORCE ROW LEVEL SECURITY, so RLS is the only visibility
      // boundary on public tables.
      check(
        row.rolbypassrls === false,
        `${role} cannot bypass RLS (NOBYPASSRLS)`
      );
    }
    check(
      roleByName.get('genealogy_app')?.rolcanlogin === true,
      'genealogy_app is the LOGIN business role'
    );
    check(
      roleByName.get('auth_service')?.rolcanlogin === false,
      'auth_service is NOLOGIN (only inherited by auth_runtime)'
    );

    const [privileges] = await sql`
      select
        has_table_privilege('auth_service', 'auth.user', 'SELECT') as auth_user_select,
        has_table_privilege('auth_service', 'auth.user', 'INSERT') as auth_user_insert,
        has_table_privilege('auth_service', 'public.organization', 'INSERT') as auth_org_insert,
        has_table_privilege('auth_service', 'public.organization_member', 'UPDATE') as auth_member_update,
        has_table_privilege('auth_service', 'public.project', 'SELECT') as auth_project_select,
        has_table_privilege('genealogy_app', 'public.invite', 'SELECT') as app_invite_select,
        has_table_privilege('genealogy_app', 'public.organization', 'UPDATE') as app_org_update,
        has_schema_privilege('genealogy_app', 'auth', 'USAGE') as app_auth_schema_usage,
        has_table_privilege('genealogy_app', 'auth.user', 'SELECT') as app_auth_user_select,
        has_table_privilege('genealogy_app', 'auth.account', 'SELECT') as app_auth_account_select
    `;
    check(
      privileges?.auth_user_select === true &&
        privileges?.auth_user_insert === true &&
        privileges?.auth_org_insert === true &&
        privileges?.auth_member_update === true,
      'auth_service owns identity and tenant writes'
    );
    check(
      privileges?.app_invite_select === true &&
        privileges?.app_org_update === true,
      'genealogy_app has the baseline public DML grant (RLS + SECDEF guard writes)'
    );
    // 安全边界：auth.user / auth.session / auth.account / auth.verification
    // 在目标态全部 relrowsecurity=false。业务角色一旦拿到 auth schema 权限，
    // 就能无 RLS 直读密码哈希与会话 token —— 三类权限必须同时为 false。
    check(
      privileges?.app_auth_schema_usage === false &&
        privileges?.app_auth_user_select === false &&
        privileges?.app_auth_account_select === false,
      'genealogy_app cannot reach auth.* (credential tables have no RLS)'
    );
    // 邀请写入不再靠表级权限收窄：签发走 A.7 的 ON CONFLICT，撤销是置
    // status，接受邀请与成员写走 app.* SECURITY DEFINER 函数。
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

    const [businessRole] = await sql`
      select rolbypassrls from pg_roles where rolname = 'genealogy_app'
    `;
    if (!businessRole) {
      skip(
        'genealogy_app login role',
        'not provisioned (created by the target baseline)'
      );
    } else {
      check(
        businessRole.rolbypassrls === false,
        'genealogy_app cannot bypass RLS'
      );
      // The business role must never inherit the auth-side role: that would
      // grant it auth.* access without RLS.
      const [crossMembership] = await sql`
        select pg_has_role('genealogy_app', 'auth_service', 'MEMBER') as member
      `;
      check(
        crossMembership?.member === false,
        'genealogy_app is not a member of auth_service'
      );
    }

    // RB-5 (docs/runbooks/README.md §6): the old 0006_statement_timeouts
    // migration pinned three timeouts via rolconfig, but it was retired with
    // the B0 baseline squash. Report the gap explicitly instead of letting
    // the runbook assume verify:deploy already checks it.
    const [roleConfig] = await sql`
      select rolconfig from pg_roles where rolname = 'genealogy_app'
    `;
    const timeouts = (roleConfig?.rolconfig ?? []).filter((entry) =>
      /^(statement_timeout|idle_in_transaction_session_timeout|lock_timeout)=/.test(
        String(entry)
      )
    );
    if (timeouts.length === 3) {
      pass('rolconfig timeouts', timeouts.join(', '));
    } else {
      skip(
        'rolconfig timeouts',
        'target baseline sets none (0006_statement_timeouts retired); RB-5 stays open for T34/G1'
      );
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
