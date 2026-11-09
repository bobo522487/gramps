#!/usr/bin/env node
/**
 * 运行期角色与授权（部署配置，不属于 schema）。
 *
 * 为什么角色不在基线里：PG 的 `CREATE ROLE` 是**集群级**操作，而迁移基线
 * 描述的是**单个库**的 schema。把角色写进基线的代价在 2026-11-09 兑现了：
 * 口令只能写死成示例值 `app_pw`，本地 PG 放行、Neon 控制面直接拒绝
 * （`insecure password, try including more special characters…`，XX000），
 * 生产重建整段失败。角色 + 口令本来就是「每个环境一份」的配置。
 *
 * 本脚本负责三件事，必须在 `pnpm db:migrate` **之前**跑：
 * 1. 建/更新 `genealogy_app`（LOGIN，口令取 `APP_DB_PASSWORD`）
 * 2. 建/更新认证侧 `auth_service`（NOLOGIN）与 `auth_runtime`（LOGIN）
 * 3. 授权：业务侧 GRANT 由基线负责（基线跑完才有表），认证侧在此授予
 *
 * 用法：
 *   APP_DB_PASSWORD=<强口令> pnpm db:provision-roles          # dry-run
 *   APP_DB_PASSWORD=<强口令> pnpm db:provision-roles --apply
 *
 * `APP_DB_PASSWORD` 未设置且 `genealogy_app` 不存在时直接失败——不静默用弱口令兜底。
 */

import postgres from 'postgres';
import { loadEnv } from './load-env.mjs';

loadEnv();

const apply = process.argv.includes('--apply');
const rolesOnly = process.argv.includes('--roles-only');
const grantsOnly = process.argv.includes('--grants-only');
if (rolesOnly && grantsOnly) {
  console.error('--roles-only 与 --grants-only 不能同时使用。');
  process.exit(1);
}

const databaseUrl =
  process.env.POSTGRES_URL_DIRECT ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_URL ??
  '';

if (!databaseUrl) {
  console.error(
    '拒绝执行：未设置 POSTGRES_URL_DIRECT / POSTGRES_URL_NON_POOLING / POSTGRES_URL。'
  );
  process.exit(1);
}

const appPassword = process.env.APP_DB_PASSWORD ?? '';
const runtimePassword = process.env.AUTH_DB_PASSWORD ?? 'auth';

/** 认证侧可写的三张租户表；其余业务表一律不给。 */
const TENANT_TRIO = ['organization', 'organization_member', 'invite'];

/** PostgreSQL 字符串字面量转义，供 create/alter role 的 password 子句。 */
function literal(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

async function roleExists(name) {
  const [row] = await sql`select 1 as ok from pg_roles where rolname = ${name}`;
  return Boolean(row);
}

/** 建或更新 LOGIN 角色；口令只出现在 SQL 文本的这一处，不进日志。 */
async function upsertLoginRole(name, password) {
  const exists = await roleExists(name);
  if (exists) {
    if (password) {
      await sql.unsafe(
        `alter role "${name}" login nosuperuser nobypassrls password ${literal(password)}`
      );
    }
    return 'updated';
  }
  await sql.unsafe(
    `create role "${name}" login nosuperuser nobypassrls password ${literal(password)}`
  );
  return 'created';
}

async function upsertNologinRole(name) {
  const exists = await roleExists(name);
  await sql.unsafe(
    exists
      ? `alter role "${name}" nologin nosuperuser nobypassrls`
      : `create role "${name}" nologin nosuperuser nobypassrls`
  );
  return exists ? 'updated' : 'created';
}

const authGrants = [
  'REVOKE ALL ON SCHEMA app FROM auth_service',
  'REVOKE ALL ON SCHEMA public FROM auth_service',
  'REVOKE ALL ON SCHEMA auth FROM auth_service',
  'GRANT USAGE ON SCHEMA auth TO auth_service',
  'GRANT USAGE ON SCHEMA app TO auth_service',
  'GRANT USAGE ON SCHEMA public TO auth_service',
  'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO auth_service',
  'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO auth_service',
  ...TENANT_TRIO.map(
    (table) =>
      `GRANT SELECT, INSERT, UPDATE, DELETE ON public.${table} TO auth_service`
  ),
  'ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO auth_service',
  'GRANT auth_service TO auth_runtime',
];

try {
  if (!apply) {
    console.log('# dry-run（加 --apply 才会真的执行）');
    console.log(
      `- genealogy_app: ${appPassword ? 'create/alter（口令来自 APP_DB_PASSWORD）' : '需已存在（APP_DB_PASSWORD 未设置）'}`
    );
    console.log('- auth_service: create/alter（NOLOGIN）');
    console.log('- auth_runtime: create/alter（LOGIN，继承 auth_service）');
    if (!grantsOnly) {
      console.log('- auth_service / auth_runtime 角色');
    }
    if (!rolesOnly) {
      for (const statement of authGrants) console.log(`- ${statement}`);
    }
    await sql.end({ timeout: 5 });
    process.exit(0);
  }

  if (!grantsOnly) {
    if (appPassword) {
      console.log(
        `genealogy_app: ${await upsertLoginRole('genealogy_app', appPassword)}（口令来自 APP_DB_PASSWORD）`
      );
    } else if (await roleExists('genealogy_app')) {
      console.log('genealogy_app: 已存在，未改口令（APP_DB_PASSWORD 未设置）');
    } else {
      console.error(
        'genealogy_app 不存在且未提供 APP_DB_PASSWORD；拒绝用弱口令兜底。'
      );
      await sql.end({ timeout: 5 });
      process.exit(1);
    }

    console.log(`auth_service: ${await upsertNologinRole('auth_service')}`);
    console.log(
      `auth_runtime: ${await upsertLoginRole('auth_runtime', runtimePassword)}`
    );
  }

  // 授权必须在迁移之后：`app` schema 与业务表都是基线建的。
  if (!rolesOnly) {
    for (const statement of authGrants) {
      await sql.unsafe(statement);
    }
  }

  if (rolesOnly) {
    await sql.end({ timeout: 5 });
    process.exit(0);
  }

  const [check] = await sql`
    select
      has_table_privilege('auth_service', 'auth.user', 'SELECT') as auth_user_select,
      has_table_privilege('auth_service', 'public.organization', 'INSERT') as org_insert,
      has_table_privilege('auth_service', 'public.organization_member', 'UPDATE') as member_update,
      has_table_privilege('auth_service', 'public.project', 'SELECT') as project_select
  `;
  console.log(
    `auth_service: auth.user=${check.auth_user_select ? 'rw' : '禁'} · ` +
      `organization=${check.org_insert ? 'rw' : '禁'} · ` +
      `organization_member=${check.member_update ? 'rw' : '禁'} · ` +
      `project=${check.project_select ? 'rw' : '禁'}`
  );
  await sql.end({ timeout: 5 });
} catch (error) {
  const code =
    error && typeof error === 'object' && 'code' in error ? error.code : '';
  console.error(
    `角色 provisioning 失败${code ? `（SQLSTATE ${code}）` : ''}：${error.message}`
  );
  await sql.end({ timeout: 5 });
  process.exit(1);
}
