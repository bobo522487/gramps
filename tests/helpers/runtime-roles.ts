import type { Sql } from 'postgres';

/**
 * 集成测试的运行期角色与权限矩阵（S8 阶段 C · T32 修订规格）。
 *
 * 目标态两个角色面：
 *
 * - `genealogy_app`：基线 A.0 创建的 **LOGIN** 角色，业务连接直接以它登录。
 *   `lib/db/drizzle.ts` 在 withOrg 事务里 `SET LOCAL ROLE genealogy_app` 只是
 *   把角色钉死（SET ROLE 到自身是 no-op），不再是旧模型里「切成 app_rw 收窄
 *   权限」的动作。基线给它 public 全表 DML、app schema USAGE + 函数 EXECUTE，
 *   RLS 对它生效（NOBYPASSRLS、非表属主）。**不给 auth schema 任何权限**。
 * - `auth_service`：**NOLOGIN** 独立角色。认证连接经 `auth_runtime` 登录并用
 *   `-c role=auth_service` 固定，只读写 auth.* 与 organization /
 *   organization_member / invite 三张表。
 *
 * 为什么认证侧必须独立（PG18 干净库实测）：auth.user / auth.session /
 * auth.account / auth.verification 全部 relrowsecurity=f、relforcerowsecurity=f，
 * 而 public 业务表全部 rls=t。把认证侧也统一成 genealogy_app 并补 auth GRANT，
 * 业务运行期角色就能无 RLS 直读 auth.account.password 与 auth.session token ——
 * 这是安全退化，不是单纯补权限。所以 T32 规格由「运行期角色全量统一」修订为
 * 「业务侧统一 genealogy_app、认证侧保留独立非属主角色」。
 *
 * 基线自己管 genealogy_app 的授权（GRANT 段 1011–1035 行）；auth_service 是
 * 部署期角色、基线不建，测试库要在这里复刻**同一张认证侧矩阵**。
 *
 * | 主体 | auth.* | 组织 / 成员 / 邀请 | 业务表 |
 * | --- | --- | --- | --- |
 * | `genealogy_app` | 全禁 | 读写（基线 GRANT，RLS + SECDEF 守卫） | 读写（RLS） |
 * | `auth_service` | 读写 | 读写 | 禁 |
 *
 * 必须在 `migrate()` **之后**执行：`resetAndMigrate` 每次都
 * `drop schema public/auth cascade`，权限随 schema 一起丢，所以授权不是一次性动作。
 */
export async function grantRuntimeRoles(sql: Sql): Promise<void> {
  // 角色是集群级的，建过就跳过（幂等）。NOLOGIN：只从登录角色 SET ROLE 过去。
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_service') THEN
        CREATE ROLE auth_service NOLOGIN;
      END IF;
    END $$;
  `);

  // 先清空再逐项授予，避免上一次运行留下的过宽授权残留（drop schema 会清
  // 表级权限，但角色成员关系与 schema 级权限是集群 / 库级，不会被 drop 清掉）。
  await sql.unsafe('REVOKE ALL ON SCHEMA app FROM auth_service');
  await sql.unsafe('REVOKE ALL ON SCHEMA public FROM auth_service');
  await sql.unsafe('REVOKE ALL ON SCHEMA auth FROM auth_service');

  await sql.unsafe('GRANT USAGE ON SCHEMA auth TO auth_service');
  await sql.unsafe('GRANT USAGE ON SCHEMA app TO auth_service');
  await sql.unsafe('GRANT USAGE ON SCHEMA public TO auth_service');
  await sql.unsafe(
    'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO auth_service'
  );

  // --- auth_service：身份与租户写入 ---
  await sql.unsafe(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO auth_service'
  );
  for (const tablename of ['organization', 'organization_member', 'invite']) {
    await sql.unsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON public.${tablename} TO auth_service`
    );
  }
  // 兜底：后续批次新建的 auth 表自动继承（默认权限按执行 GRANT 的角色生效）。
  await sql.unsafe(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO auth_service'
  );

  // genealogy_app 的业务表授权由基线 GRANT 段负责：migrate() 重建 schema 后
  // 自动生效，这里不再复刻，避免测试库与基线出现两张不一致的权限矩阵。
}
