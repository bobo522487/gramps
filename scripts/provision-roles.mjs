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

/**
 * 当前连接能否改这个角色？
 *
 * `ALTER ROLE x …` 要求执行者是 x 的成员，或拥有 CREATEROLE / 超级用户。
 * 注意 PG 的角色**没有「属主」概念**（`pg_roles` 里没有 rolowner 列）——
 * 只有「谁创建的」，那是审计信息，不决定权限。真正决定 alter 权限的是：
 * 超级用户、CREATEROLE、或者是目标角色的成员。
 *
 * Neon 上 `auth_service` / `auth_runtime` 可能由控制面角色创建，
 * 迁移连接不在其成员里，alter 直接 42501。本地 PG 用超级用户连接，
 * 永远看不出来——这是「本地全绿、生产必红」的第二处。
 */
async function canAlter(name) {
  const [row] = await sql`
    select pg_has_role(current_user, ${name}, 'MEMBER') as member,
           (select rolsuper from pg_roles where rolname = current_user) as super,
           (select rolcreaterole from pg_roles where rolname = current_user) as createrole
    from pg_roles r where r.rolname = ${name}
  `;
  if (!row) return { ok: true, reason: 'not-exists' };
  if (row.super || row.createrole || row.member)
    return { ok: true, reason: '' };
  return {
    ok: false,
    reason: `当前连接不是 ${name} 的成员，且无 CREATEROLE / 超级用户权限`,
  };
}

/** 建或更新 LOGIN 角色；口令只出现在 SQL 文本的这一处，不进日志。 */
async function upsertLoginRole(name, password) {
  const exists = await roleExists(name);
  if (exists) {
    const gate = await canAlter(name);
    if (!gate.ok) return `已存在，跳过（无权改：${gate.reason}）`;
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
  if (exists) {
    const gate = await canAlter(name);
    if (!gate.ok) return `已存在，跳过（无权改：${gate.reason}）`;
  }
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
      const outcome = await upsertLoginRole('genealogy_app', appPassword);
      console.log(`genealogy_app: ${outcome}（口令来自 APP_DB_PASSWORD）`);
      // 改不动口令就必须停：应用侧连接串里的口令来自同一份 secret，
      // 两边不一致就是全线 28P01，而且要到运行时才暴露。
      if (outcome.startsWith('已存在，跳过')) {
        console.error(
          '拒绝继续：genealogy_app 的口令无法更新，应用侧连接会与库里不一致（28P01）。'
        );
        await sql.end({ timeout: 5 });
        process.exit(1);
      }
    } else if (await roleExists('genealogy_app')) {
      console.log('genealogy_app: 已存在，未改口令（APP_DB_PASSWORD 未设置）');
    } else {
      console.error(
        'genealogy_app 不存在且未提供 APP_DB_PASSWORD；拒绝用弱口令兜底。'
      );
      await sql.end({ timeout: 5 });
      process.exit(1);
    }

    // 认证侧两个角色改不动不算致命：授权才是权限矩阵的实质，
    // 角色存在与否由下面的 grants 阶段和 verify-deployment 兜。
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
  if (code === '42501') {
    console.error(
      [
        '42501 是权限问题，不是 SQL 写错。ALTER / GRANT ROLE 要求执行者是目标角色',
        '的成员或其属主，或超级用户。托管库上先跑 `node scripts/diagnose-drizzle-state.mjs`',
        '看「→ ALTER <role>: 可/不可」那一行，再决定：换连接角色、或把该角色的',
        '成员资格授予迁移连接（GRANT <role> TO <migration_role> WITH ADMIN OPTION）。',
      ].join('\n')
    );
  }
  await sql.end({ timeout: 5 });
  process.exit(1);
}
