# 0007. 自托管 Better Auth + Neon PostgreSQL

- **状态**：已接受
- **日期**：2026-10-23
- **可逆性**：**单向门**（身份数据、数据库角色边界与所有认证入口都随之改变；回退需要迁移身份数据并重做租户写权限）
- **相关**：[实现状态](../implementation-status.md) · [07-运行视图-关键流程](../architecture/07-运行视图-关键流程.md) · [数据模型](../data-model.md) · [部署蓝图](../ops-target.md) · [ADR 0001](./0001-foundation-reset.md) · [ADR 0006](./0006-rls-isolation.md)

---

## 背景

基础层重置后，认证是自建的：`bcrypt` 校验密码、`jose` 签发 HS256 JWT Cookie、`auth.users.token_version` 负责撤销；注册、登录查询、会话校验、改密、邀请接受都由 `auth` schema 下的 `SECURITY DEFINER` 函数完成。组织邀请是另一套自研 token：只存 SHA-256 哈希、7 天过期、一次性。

在迁移到 Vercel + Neon PostgreSQL 时，这套自建认证暴露了三个问题：

1. **组织能力不足**。邀请、成员角色、组织切换都要自己维护；目标产品需要 owner/admin/editor/viewer 四角色与邀请链接，继续自研意味着持续维护一套认证领域模型。
2. **会话与撤销耦合在业务表上**。JWT 无状态，撤销依赖 `token_version` 递增；改密、删号、踢出设备的语义都要手写，且 `auth.users` 被软删列和自定义函数包裹。
3. **部署面变大**。`auth.users` 的读写依赖 `SECURITY DEFINER` 函数与迁移角色 `BYPASSRLS` 的隐含前提，Neon 的 owner/运行时角色分离让这个前提更难保证。

项目**没有生产数据**，开发/预发库可以一次性重建，因此可以放弃“在线迁移旧认证数据”，直接替换认证实现。

## 决策

采用**自托管 Better Auth 1.7.12**，数据库仍是 Neon PostgreSQL：

1. **身份与会话由 Better Auth 负责**。`better-auth@1.7.12` + `@better-auth/drizzle-adapter@1.7.12`，核心表放在 `auth` schema：`auth.users`、`auth.session`、`auth.account`、`auth.verification`。
2. **组织、成员、邀请与权限用 organization 插件**。复用现有 `public.organization`、`public.organization_member`、`public.invite`（物理表名 `invite`）；角色为 `owner`/`admin`/`editor`/`viewer`，权限字符串由 `ac`/`roles` 定义。
3. **数据库会话，不用 JWT 自签会话**。7 天过期、1 天 `updateAge`、关闭 cookie cache；`auth.api.getSession()` 每次查库，撤销立即生效。
4. **不暴露 `/api/auth/*`**。不创建 `app/api/auth/[...all]/route.ts`，也不引入浏览器 auth client；所有认证/租户写操作只从 Server Action 调 `auth.api.*`，避免绕过“最后 owner / 不能移除自己 / 管理员不能管理管理员 / 活动日志 / 中文错误”等应用规则。
5. **数据库角色分离**：
   - `app_rw`（NOLOGIN、NOBYPASSRLS）继续承担业务表读写，但**失去** `organization`/`organization_member`/`invite` 的写权限与 `invite` 的读权限；
   - 新增 `auth_service`（NOLOGIN、NOBYPASSRLS）承担身份与租户写入，并拥有全部 `SECURITY DEFINER` 函数；
   - 登录角色 `app` 继承 `app_rw`，`auth_runtime` 继承 `auth_service`；认证连接在每个连接初始化时固定 `role=auth_service`。
6. **`withOrg` 与业务 RLS 不变**。业务查询仍在事务内 `SET LOCAL ROLE app_rw` 并注入 `request.jwt.claims`；组织隔离仍是应用层 `org_id` 过滤 + RLS + 复合外键三层。
7. **租户表硬删除**。`organization_member` 与 `invite` 去掉软删列，成员移除、邀请接受/取消由 Better Auth 执行物理删除；`organization` 保留 `deleted_at` 表示归档，归档走 `auth.archive_organization()`。最后一个 owner 由触发器兜底。
8. **邀请两段式、可恢复**。邀请链接是 `${BETTER_AUTH_URL}/sign-up?invite=<invitation.id>`：未登录先注册（注册后跳 `/dashboard/join?invite=...`），已登录直接进 join 页；接受失败不删除账号，可重试或从链接重新进入。邀请 7 天过期，重新邀请会取消旧的 pending 邀请。
9. **关闭邮件相关能力**。不启用邮箱验证、不提供找回密码、移除改邮箱入口；邀请链接手动复制发送，不接邮件通道。
10. **一次性重置开发/预发认证与租户数据**。迁移 `0003_better_auth` 在检测到旧 `auth.users` 或 `organization` 数据时中止，要求重建数据库，不静默删除数据。

## 后果

### 正面

- 认证与租户领域模型不再自研：注册、登录、会话、改密、删号、组织、成员、邀请、角色权限由 Better Auth 提供，应用只保留产品级规则与中文错误映射。
- 数据库会话使撤销即时生效：改密、删号、移除成员不需要 `token_version` 或 token 重签。
- 写权限边界更小：`app_rw` 不能写组织/成员/邀请，认证故障不会扩大成业务数据越权；`auth_service` 不能读业务表。
- 组织隔离仍是三层，业务查询路径与 `withOrg` 不变，家谱模块不需要感知认证实现。
- 邀请链接与 Better Auth 的邀请状态一致，过期、重复邀请、邮箱不匹配由插件统一处理。

### 负面（必须诚实写）

- **认证库成为核心依赖**。Better Auth 的 schema、adapter 行为与升级节奏会影响登录；`organization.metadata` 必须是 `text`（adapter 会先 `JSON.stringify`），升级时需重新核对映射。
- **两个连接、四个角色**。部署必须创建 `app`/`auth_runtime` 登录角色并正确授权，否则运行期 RLS 或认证写入会失败；本地/CI 已由脚本与验证器覆盖，但真实 Neon/Vercel 仍需人工核对。
- **认证连接不能用 Neon pooler**。连接通过启动参数固定 `role=auth_service`，PgBouncer 会以 `08P01 unsupported startup parameter in options: role` 拒绝；`AUTH_POSTGRES_URL` 必须指向 direct（unpooled）endpoint，业务连接仍可 pooled。`lib/config.ts` 在启动时拒绝 `-pooler.` 主机名，避免上线后首次登录才暴露。
- **没有邮件能力**。邮箱不验证、密码不能自助找回、邮箱不能修改；忘记密码只能人工处理，这是明确接受的产品缺口。
- **硬删除不可恢复**。成员移除、邀请取消、账号删除都是物理删除；`organization` 仅归档。回收站不覆盖这些表。
- **不能直接使用 Better Auth 的 HTTP 端点**。组织插件的 HTTP API 被有意关闭，未来若要接浏览器客户端或第三方集成，需要重新评估绕过应用规则的风险。
- **每次会话校验查库**。关闭 cookie cache 换取即时撤销，代价是每个请求多一次 `auth.session` 查询。

### 中性

- 密码哈希从 `bcrypt` 改为 Better Auth 默认的 `scrypt`；旧哈希不迁移（无生产数据）。
- `proxy.ts` 仍是乐观门禁：只检查是否存在 `better-auth.session_token` Cookie，权威校验在 `getSessionUser()`。
- 现有 4 个只读 Route Handler 不变；认证相关 Route Handler 数量为 0。

## 放弃的方案

| 方案 | 为什么不够好 |
|---|---|
| Neon 托管 Auth | 组织邀请/多租户/角色能力不在托管 Auth 范围内，仍要自研；且会把身份数据放到 Neon 的托管服务，增加供应商耦合 |
| 继续自建 bcrypt + JWT | 组织、邀请、成员、角色都要继续自研；JWT 撤销语义与数据库会话重复；部署角色分离后 `SECURITY DEFINER` 前提更难保证 |
| Auth.js / NextAuth | 组织插件与成员邀请需要大量自定义 adapter；与现有 Drizzle schema 的贴合度低于 Better Auth organization 插件 |
| 外部 IdP（Clerk/Auth0 等） | 引入外部身份供应商与计费；家谱产品的组织模型仍需自建；数据驻留与迁移成本更高 |
| 暴露 `/api/auth/[...all]` 并使用浏览器 auth client | 会绕过应用层“最后 owner / 管理员边界 / 活动日志”等规则；Server Action 已自带 CSRF 与同源保护 |
| 保留 JWT 会话、只换组织插件 | 撤销仍依赖 `token_version`；与 Better Auth 的会话模型并存会形成两套真相 |

## 重估触发条件

1. 需要**邮箱验证、找回密码、改邮箱、2FA 或 SSO**：当前明确关闭，出现需求时先补邮件通道，再评估 Better Auth 的对应插件。
2. Better Auth 出现**破坏性升级**或 organization 插件语义变化：先在一个 Neon 分支验证 schema/adapter 兼容性，再升级。
3. 出现**跨组织协作、字段级权限或审计级身份日志**：现有组织边界与 `auth_service` 写权限需要重新设计。
4. 需要**浏览器端 auth client、第三方集成或移动端**：必须重新评估是否开放 `/api/auth/*`，以及如何保留应用级预检。
5. **多区域/只读副本**上线：数据库会话与 `FORCE RLS` 的读一致性需要重新验证。
