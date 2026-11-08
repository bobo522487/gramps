import type { Sql } from 'postgres';

/**
 * 集成测试的运行期角色与权限矩阵。
 *
 * 基线（附录 A.0）只建 `genealogy_app`，而应用运行期会切到另外两个角色：
 *
 * - `app_rw`：`lib/db/drizzle.ts` 在 `withOrg` 事务里 `SET LOCAL ROLE app_rw`
 *   之后才发业务查询，RLS 对它有实际约束力。
 * - `auth_service`：`lib/db/auth-db.ts` 用连接参数 `-c role=auth_service` 固定
 *   认证连接的角色，让 Better Auth 读写 `auth.*`。
 *
 * 生产环境由部署流程建这两个角色，`scripts/verify-deployment.mjs` 会逐项验收
 * 权限矩阵。测试库没有，所以要在这里复刻**同一张矩阵**——两处必须一致，
 * 否则测试通过的形状和上线后的形状不是同一个东西。
 *
 * 必须在 `migrate()` **之后**执行：`resetAndMigrate` 每次都
 * `drop schema public/auth cascade`，权限随 schema 一起丢，所以授权不是一次性动作。
 *
 * 矩阵（与 verify-deployment.mjs 的 privileges 断言一一对应）：
 *
 * | 主体 | auth.* | organization | organization_member | invite | 业务表 (project 等) |
 * | --- | --- | --- | --- | --- | --- |
 * | `app_rw` | 全禁 | 只读 | 只读 | **全禁** | 读写（RLS 约束） |
 * | `auth_service` | 读写 | 写 | 写 | 写 | 禁 |
 *
 * `app_rw` 对 `organization` / `organization_member` 只读、对 `invite` 完全无权限，
 * 是刻意的：这三张表的写入必须走 SECURITY DEFINER 函数（`app.create_organization`、
 * `app.accept_invite`）或认证侧，否则越权写入只能靠 RLS 静默过滤成 0 行，
 * 调用方看不出自己被拦了。给成表级权限就再也报不出 42501。
 *
 * `invite` 连 SELECT 都不给：邀请列表走 Better Auth 的 `listInvitations`（auth_service
 * 连接），业务层没有任何查询读这张表，而它带邮箱与 token 哈希，按最小权限不该暴露。
 * 这与 `scripts/verify-deployment.mjs` 的 `app_invite_select === false` 断言一致。
 */
export async function grantRuntimeRoles(sql: Sql): Promise<void> {
  // 角色是集群级的，建过就跳过（幂等）。NOLOGIN：只从超级用户 SET ROLE 过去。
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
        CREATE ROLE app_rw NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_service') THEN
        CREATE ROLE auth_service NOLOGIN;
      END IF;
    END $$;
  `);

  // 先清空再逐项授予，避免上一次运行留下的过宽授权残留（drop schema 会清表级
  // 权限，但角色成员关系与 schema 级权限是集群 / 库级，不会被 drop 清掉）。
  //
  // `REVOKE genealogy_app FROM app_rw` 是**自愈**，不是可有可无的清理：
  // `SET LOCAL ROLE app_rw` 的语义是收窄权限，一旦 app_rw 反过来成为登录角色
  // genealogy_app 的成员，它就继承了「ALL TABLES 读写」，下面所有 REVOKE 全部
  // 失效——实测表现是 organization 的越权 UPDATE 不报 42501、而是被 RLS 静默
  // 过滤成 0 行，调用方看不出自己被拦了。角色成员关系是集群级的，drop schema
  // 不清它，所以每次重建都必须显式剥掉。
  //
  // 但 `REVOKE <不存在的角色>` 与 `GRANT` 不对称：实测 PG18 下
  // `revoke t_gone from app_rw` 直接 **ERROR: role "t_gone" does not exist**，
  // 而 `grant t_gone to app_rw` 只是 WARNING。裸写这一句意味着一个全新集群
  // （`genealogy_app` 还没建）上整个 setup 在这里中断，所有集成测试连带失败。
  // 先探一下再决定要不要发。
  const [genealogyAppExists] = await sql<{ exists: boolean }[]>`
    select exists(select 1 from pg_roles where rolname = 'genealogy_app') as exists
  `;
  if (genealogyAppExists?.exists) {
    await sql.unsafe('REVOKE genealogy_app FROM app_rw');
  }
  await sql.unsafe('REVOKE ALL ON SCHEMA app FROM app_rw');
  await sql.unsafe('REVOKE ALL ON SCHEMA public FROM app_rw');
  await sql.unsafe('REVOKE ALL ON SCHEMA app FROM auth_service');
  await sql.unsafe('REVOKE ALL ON SCHEMA public FROM auth_service');
  await sql.unsafe('REVOKE ALL ON SCHEMA auth FROM auth_service');

  await sql.unsafe('GRANT USAGE ON SCHEMA app TO app_rw');
  await sql.unsafe('GRANT USAGE ON SCHEMA public TO app_rw');
  await sql.unsafe('GRANT USAGE ON SCHEMA auth TO auth_service');
  await sql.unsafe('GRANT USAGE ON SCHEMA app TO auth_service');
  await sql.unsafe('GRANT USAGE ON SCHEMA public TO auth_service');

  // 隔离函数：两个角色都要能调（app_rw 走 RLS 谓词，auth_service 建组织 / 收邀请）。
  await sql.unsafe('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_rw');
  await sql.unsafe(
    'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO auth_service'
  );

  // --- app_rw：业务表读写 ---
  // 业务表 = public 下除 organization / organization_member / invite 之外的表。
  // 用显式列表而不是 ALL TABLES，才能让上面那几张表保持受限。
  const tenantReadOnly = new Set(['organization_member', 'organization']);
  const noAccess = new Set(['invite']);
  const tables = await sql<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public'
  `;
  for (const { tablename } of tables) {
    if (noAccess.has(tablename)) continue;
    if (tenantReadOnly.has(tablename)) {
      await sql.unsafe(`GRANT SELECT ON public.${tablename} TO app_rw`);
    } else {
      await sql.unsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON public.${tablename} TO app_rw`
      );
    }
  }

  // --- auth_service：身份与租户写入 ---
  await sql.unsafe(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO auth_service'
  );
  // Better Auth 的 organization 插件直接读写 organization / organization_member /
  // invite 三张 public 表，所以认证侧对它们要写权限；业务表一律不给。
  for (const tablename of ['organization', 'organization_member', 'invite']) {
    await sql.unsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON public.${tablename} TO auth_service`
    );
  }

  // 兜底：后续批次新建的表自动继承（默认权限按「执行 GRANT 的角色」生效）。
  await sql.unsafe(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw'
  );
  await sql.unsafe(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO auth_service'
  );
}
