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

/**
 * 读角色当前属性。
 *
 * 2026-11-09 生产实测的教训：Neon 对 `ALTER ROLE` 的限制**比原生 PG 严**——
 * `pg_has_role(…,'MEMBER')` / `rolcreaterole` 全判「可」，真跑仍 42501；
 * 但同一事务里 `ALTER ROLE … PASSWORD '…'` 却能过。
 * 也就是说托管库只放行改口令，不放行改属性。
 *
 * 对策不是去猜哪句能过，而是**只改真正需要改的**：属性本来就对就别发这条
 * 语句。生产上这两个角色是控制面建的，LOGIN / NOSUPERUSER / NOBYPASSRLS
 * 本来就是正确配置，于是整段 ALTER 可以完全跳过。
 */
async function describeRole(name) {
  const [row] = await sql`
    select rolcanlogin, rolsuper, rolbypassrls
    from pg_roles where rolname = ${name}
  `;
  return row ?? null;
}

/** 需要改的属性和目标值，空数组表示已经合规。 */
function roleFixups(current, want) {
  const fixes = [];
  if (current.rolcanlogin !== want.login) {
    fixes.push(want.login ? 'login' : 'nologin');
  }
  if (current.rolsuper !== false) fixes.push('nosuperuser');
  if (current.rolbypassrls !== false) fixes.push('nobypassrls');
  return fixes;
}

/**
 * 建角色或把它修到目标属性。
 *
 * 已存在且属性合规 → 直接返回 `ok（属性已合规）`，不发 ALTER（见 describeRole）。
 * 已存在且属性不合规 → 尝试修；改不动就如实报「修不了」，由调用方决定是否致命。
 */
async function ensureRole(name, { login, password }) {
  const current = await describeRole(name);
  if (!current) {
    const attrs = `${login ? 'login' : 'nologin'} nosuperuser nobypassrls`;
    const pwd = password ? ` password ${literal(password)}` : '';
    await sql.unsafe(`create role "${name}" ${attrs}${pwd}`);
    return { status: 'created', canSetPassword: Boolean(password) };
  }

  const fixes = roleFixups(current, { login });
  if (fixes.length > 0) {
    try {
      await sql.unsafe(`alter role "${name}" ${fixes.join(' ')}`);
    } catch (error) {
      // 属性改不动不是致命的：可能是托管库禁止，也可能角色本就该这样。
      // 真正的合规判定交给 verify-deployment.mjs，那里会红。
      const code = error?.code ?? '?';
      return {
        status: `属性不合规且改不动（需要 ${fixes.join(' ')}，SQLSTATE ${code}）`,
        canSetPassword: false,
      };
    }
  }

  // 属性已合规，剩下的只有口令。托管库通常允许这一条。
  if (password) {
    try {
      await sql.unsafe(`alter role "${name}" password ${literal(password)}`);
      return { status: 'ok（属性已合规，口令已更新）', canSetPassword: true };
    } catch (error) {
      const code = error?.code ?? '?';
      return {
        status: `属性已合规，但口令改不动（SQLSTATE ${code}）`,
        canSetPassword: false,
      };
    }
  }
  return { status: 'ok（属性已合规）', canSetPassword: false };
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
    const app = await ensureRole('genealogy_app', {
      login: true,
      password: appPassword || null,
    });
    console.log(`genealogy_app: ${app.status}（口令来自 APP_DB_PASSWORD）`);

    // 口令必须与 APPLY_DB_PASSWORD 一致，否则应用侧连接全线 28P01，
    // 而且只在运行时才暴露。改不动就停，但只在给了口令、确实需要改时才算失败。
    if (appPassword && !app.canSetPassword) {
      console.error(
        '拒绝继续：genealogy_app 的口令无法更新，应用侧连接会与库里不一致（28P01）。'
      );
      await sql.end({ timeout: 5 });
      process.exit(1);
    }

    // 认证侧两个角色改不动属性不算致命：授权才是权限矩阵的实质，
    // 角色属性是否合规由 verify-deployment.mjs 兜底判定。
    const svc = await ensureRole('auth_service', { login: false });
    console.log(`auth_service: ${svc.status}`);
    const rt = await ensureRole('auth_runtime', {
      login: true,
      password: runtimePassword,
    });
    console.log(`auth_runtime: ${rt.status}`);
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
