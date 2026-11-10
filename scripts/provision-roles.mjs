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
 * 口令只来自 `APP_DB_PASSWORD` / `AUTH_DB_PASSWORD`，两个角色同一口径：没给就
 * 跳过改口令并打印原因，脚本里没有任何默认口令。
 */

import postgres from 'postgres';
import { authGrants } from './lib/auth-grants.mjs';
import { ensureRole } from './lib/role-provisioning.mjs';
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
// 与 APP_DB_PASSWORD 同一口径：没给就是「本次不改口令」，**不给默认值**。
// 曾经这里是 `?? 'auth'`，等于在缺变量的机器上把 auth_runtime 的口令静默改成
// 4 字符弱口令，而该角色读得到 auth.user 的密码哈希与会话 token。
const runtimePassword = process.env.AUTH_DB_PASSWORD ?? '';

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

// 认证侧权限矩阵整表在 scripts/lib/auth-grants.mjs：先收回（schema + 表 / 序列 /
// 函数三类对象）再授予，顺序即语义，单测按行为断言顺序与覆盖面。

try {
  if (!apply) {
    console.log('# dry-run（加 --apply 才会真的执行）');
    console.log(
      `- genealogy_app: ${appPassword ? 'create/alter（口令来自 APP_DB_PASSWORD）' : '需已存在（APP_DB_PASSWORD 未设置）'}`
    );
    console.log('- auth_service: create/alter（NOLOGIN）');
    console.log(
      `- auth_runtime: ${runtimePassword ? 'create/alter（LOGIN，继承 auth_service，口令来自 AUTH_DB_PASSWORD）' : '需已存在（AUTH_DB_PASSWORD 未设置，不会改口令）'}`
    );
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
    const app = await ensureRole(sql, 'genealogy_app', {
      login: true,
      password: appPassword || null,
    });
    console.log(
      `genealogy_app: ${app.status}${appPassword ? '（口令来自 APP_DB_PASSWORD）' : '（APP_DB_PASSWORD 未设置，未改口令）'}`
    );

    // 口令必须与 APP_DB_PASSWORD 一致，否则应用侧连接全线 28P01，
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
    const svc = await ensureRole(sql, 'auth_service', { login: false });
    console.log(`auth_service: ${svc.status}`);
    // 口径与 genealogy_app 一致：没有 AUTH_DB_PASSWORD 就跳过改口令并说清原因，
    // 绝不拿默认值兜底（缺变量不致命，合规判定仍交给 verify-deployment）。
    const rt = await ensureRole(sql, 'auth_runtime', {
      login: true,
      password: runtimePassword || null,
    });
    console.log(
      `auth_runtime: ${rt.status}${runtimePassword ? '（口令来自 AUTH_DB_PASSWORD）' : '（AUTH_DB_PASSWORD 未设置，未改口令）'}`
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
