/**
 * 认证侧（`auth_service`）的权限矩阵：一张按顺序执行的语句表。
 *
 * 顺序即语义：**所有回收都排在第一条授予之前**。`REVOKE ALL ON SCHEMA` 只作用
 * 于 schema 上的 USAGE / CREATE，收不回表级授权——ADR 0020 之前认证侧是
 * 「运行期角色全量统一」，迁移过的旧库上 `auth_service` 可能还留着 public 全表
 * DML，只 revoke schema 的话它会原样活下来，矩阵就只是文档。所以回收按 schema
 * 内的每一类对象各来一次（表 / 序列 / 函数），并且只针对 `auth_service`，
 * 不碰 `genealogy_app`（它的授权归基线 A.0 管）。
 *
 * 默认权限（ALTER DEFAULT PRIVILEGES）刻意只保留 `auth` 那一条正向授权：
 * - 基线的 `ALTER DEFAULT PRIVILEGES IN SCHEMA public` 授给 `genealogy_app`，
 *   从未授给 `auth_service`（历史脚本也没有，`git log -S` 可查），所以
 *   public / app 侧没有历史 DEFAULT ACL 需要收回，不写对称的 REVOKE。
 * - 默认权限是「追加」的，只影响此后新建的对象，改不了已存在的表。
 * - 若将来真有认证侧默认授权需要收回，先用 `pg_default_acl` 核对再补，别为了
 *   对称乱加。
 */

/** 认证侧可写的三张租户表；其余业务表一律不给。 */
export const TENANT_TABLES = ['organization', 'organization_member', 'invite'];

/**
 * 认证侧触及的三个 schema：`auth` 全表读写、`app` 函数 EXECUTE、`public` 三张
 * 租户表。`drizzle` 等其它 schema 不在矩阵内，也不做无差别回收——`auth_service`
 * 从未被授过，硬收回反而可能误伤将来的显式授权。
 */
const AUTH_SCHEMAS = ['auth', 'app', 'public'];

export const authGrants = [
  // --- 1. 收回 ---
  ...AUTH_SCHEMAS.map(
    (schema) => `REVOKE ALL ON SCHEMA ${schema} FROM auth_service`
  ),
  ...AUTH_SCHEMAS.map(
    (schema) => `REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM auth_service`
  ),
  ...AUTH_SCHEMAS.map(
    (schema) =>
      `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schema} FROM auth_service`
  ),
  ...AUTH_SCHEMAS.map(
    (schema) =>
      `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${schema} FROM auth_service`
  ),
  // --- 2. 授予 ---
  'GRANT USAGE ON SCHEMA auth TO auth_service',
  'GRANT USAGE ON SCHEMA app TO auth_service',
  'GRANT USAGE ON SCHEMA public TO auth_service',
  'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO auth_service',
  'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO auth_service',
  ...TENANT_TABLES.map(
    (table) =>
      `GRANT SELECT, INSERT, UPDATE, DELETE ON public.${table} TO auth_service`
  ),
  'ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO auth_service',
  'GRANT auth_service TO auth_runtime',
];
