#!/usr/bin/env node
/**
 * 认证侧运行期角色与授权（T32 修订规格的部署侧落地）。
 *
 * 基线 `0000_target_schema.sql` **只管业务侧**：它创建 `genealogy_app` 并
 * 授予 public 全表 DML + app.* 函数 EXECUTE。认证侧刻意不在基线里，
 * 原因是 `auth.*` 四表没有 RLS（PG18 实测），把它的创建与授权塞进业务基线
 * 会让「谁能读密码哈希」这件事散落在两个地方。
 *
 * 代价是：谁执行 `pnpm db:migrate`，谁就得负责把认证侧补齐。生产迁移 job 与
 * CI 都调这一个脚本，保证两条路径同一张权限矩阵，不再各写一份 SQL。
 *
 * 权限矩阵（与 tests/helpers/runtime-roles.ts 一致）：
 *
 * | 主体 | auth.* | organization / organization_member / invite | 其余业务表 |
 * | genealogy_app | 禁 | 读写（基线 GRANT） | 读写（RLS） |
 * | auth_service | 读写 | 读写 | 禁 |
 *
 * 必须 `--apply` 才动库；默认 dry-run 只打印将要执行的授权。
 */

import postgres from 'postgres';
import { loadEnv } from './load-env.mjs';

loadEnv();

const apply = process.argv.includes('--apply');

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

/** 认证侧可写的三张租户表；其余业务表一律不给。 */
const TENANT_TRIO = ['organization', 'organization_member', 'invite'];

const statements = [
  // 角色是集群级对象，建过就跳过。
  `DO $$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_service') THEN
       CREATE ROLE auth_service NOLOGIN NOSUPERUSER NOBYPASSRLS;
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_runtime') THEN
       CREATE ROLE auth_runtime LOGIN PASSWORD 'auth' NOSUPERUSER NOBYPASSRLS;
     END IF;
   END $$`,
  'GRANT auth_service TO auth_runtime',
  // 先收回再授予：重复执行不会累积历史权限。
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
];

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

try {
  if (!apply) {
    console.log('# dry-run（加 --apply 才会真的执行）');
    for (const statement of statements) {
      console.log(`- ${statement.split('\n')[0].trim()}`);
    }
    await sql.end({ timeout: 5 });
    process.exit(0);
  }

  for (const statement of statements) {
    // 租户表随基线建；基线没跑过时这三条会报 42P01，直接失败比静默跳过好。
    await sql.unsafe(statement);
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
    `认证侧授权失败${code ? `（SQLSTATE ${code}）` : ''}：${error.message}`
  );
  await sql.end({ timeout: 5 });
  process.exit(1);
}
