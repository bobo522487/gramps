# 工程协作指南（当前实现）

> **文档状态：当前实现说明** · 最后更新：2026-10-25
> 本文件位于仓库根目录，文件名必须保持 `AGENTS.md`，Agent 会自动将其作为项目指令读取。
> 本文件面向**在当前仓库写代码的人与 AI Agent**。它以现有代码、`package.json` 和 CI 为准。
> 家谱业务层已实现谱系/人丁第一版（画布、世系表、检查器与写流程），谱文/谱书等仍未实现；基础层（UUIDv7、RLS、4 角色、软删）已按 [ADR 0001](docs/decisions/0001-foundation-reset.md) 落地，认证与租户写入已切换到自托管 Better Auth（[ADR 0007](docs/decisions/0007-self-hosted-better-auth.md)）。以 [实现状态](docs/implementation-status.md) 为准。

---

## 1. 项目是什么

当前仓库是一个 **Next.js 组织/项目控制台** 的改造版：

- 组织（organization）→ 项目（project），组织与项目各有独立控制台界面。
- 组织与项目使用 20 位公开 ID（`organization.slug`、`project.ref`）作为 URL；UUIDv7 主键仅内部使用。
- 用户登录、组织成员管理（4 角色）、邀请链接、活动日志。
- 注册、创建组织、接受邀请、成员变更、删除账号等多步写操作在单个数据库事务内完成；失败不会留下半成品数据。
- 数据库已按目标基础层重置，并完成 Better Auth 认证切换：`auth.users/session/account/verification`、RLS、`app_rw` + `auth_service` 双角色边界、业务表软删、复合外键；组织/成员/邀请由 Better Auth organization 插件管理。
- 谱系与人丁已有第一版业务能力：左侧谱系管理（文件夹/谱系树、内联重命名）、分类树、欧式书本布局画布（React Flow）、世系表、搜索定位、字辈提示、始祖/子女/兄弟/配偶、拖拽录入、右侧检查器、编辑/移动/删除、打印视图、按代渲染窗口。
- 界面全部为简体中文，品牌“云谱”，不引入 i18n 框架。
- 营销首页、登录/注册、控制台界面。

它**还不是**完整的家谱编纂产品。以下目标业务能力尚未实现：

- 谱文、富文本编辑、自动保存。
- 谱书、编目编辑器。
- 谱文/谱书分类页面；人丁自定义字段 UI。
- 回收站、编辑锁、分享。

基础层（UUIDv7、`auth` schema、RLS、软删）已按 [ADR 0001](docs/decisions/0001-foundation-reset.md) 落地；谱系/人丁已实现画布、世系表、检查器与写流程，谱文、谱书、分享、回收站、编辑锁尚未实现。如果任务要求实现这些目标业务能力，先读 [PRD](docs/prd.md)、[架构](docs/architect.md)、[数据模型](docs/data-model.md)、[接口](docs/api.md)，并先做实现计划；不要把目标文档里的 `src/modules` 目录当成现状。

技术形态：

| 项 | 当前值 |
|---|---|
| 框架 | Next.js 16.4.3 App Router + React 19.3.1 |
| 语言 | TypeScript 7.0.2（`strict: true`） |
| 运行时 | Node.js 24 LTS · pnpm 12 |
| 数据库 | PostgreSQL + Drizzle ORM（业务 `app_rw`、认证 `auth_service`；本地/CI `postgres.js`，Vercel `pg` + `attachDatabasePool`） |
| 认证 | 自托管 Better Auth 1.7.12（数据库会话 + organization 插件） |
| 界面 | 简体中文（品牌“云谱”），无 i18n 框架 |
| 客户端数据 | TanStack Query 5；RSC 首屏通过 `dehydrate` / `HydrationBoundary` 注入 |
| 客户端 UI 状态 | Zustand 5（仅谱系工作区 UI，不存实体数据） |
| 检查/格式化 | Biome |
| 测试 | Vitest：单测 21 文件/154 用例；真实 PostgreSQL 集成测试 11 文件/122 用例；Playwright E2E 2 条关键路径 |

---

## 2. 开工前必读

| 你要做的事 | 先读 |
|---|---|
| 任何事 | 本文件 + [实现状态](docs/implementation-status.md) |
| 本地跑起来 / 配环境 | [setup.md](docs/setup.md) |
| 改表 / 加迁移 | `lib/db/schema.ts`、`lib/db/migrations/`；基础表已按 [data-model.md](docs/data-model.md) 落地，家谱业务规则仍以目标文档为准 |
| 加页面 / 加 Action / 加 API | [api.md](docs/api.md) 只描述目标契约；当前实现以本文件与代码为准 |
| 讨论家谱目标架构 | [architect.md](docs/architect.md) |
| 目标部署/运维 | [ops-target.md](docs/ops-target.md)（目标蓝图，不可直接执行） |

---

## 3. 命令速查

```bash
pnpm dev            # 开发服务器（Turbopack）
pnpm build          # 生产构建
pnpm start          # 启动生产构建
pnpm check          # Biome 检查（CI 使用）
pnpm lint           # Biome lint
pnpm format         # Biome 格式化
pnpm fix            # Biome 检查并自动修复
pnpm typecheck      # tsc --noEmit
pnpm test           # 全部单测（不连数据库）
pnpm test:unit      # 同 pnpm test
pnpm test:integration # 真实 PostgreSQL 集成测试，需要 *_test 数据库
pnpm test:coverage  # 单测 + 集成 + V8 覆盖率门槛，需要 *_test 数据库
pnpm test:e2e       # Playwright 关键路径 E2E（本地模式会清空 *_test 库）
pnpm verify:deploy  # HTTP 健康/安全头/鉴权 + 数据库结构/RLS/角色验证
pnpm db:setup       # 交互式创建 .env / 本地 Postgres
pnpm db:seed        # 灌入演示数据（幂等，复用 test@test.com）
pnpm db:generate    # 生成迁移 SQL，必须人工 review
pnpm db:migrate     # 执行迁移
pnpm db:studio      # Drizzle Studio
```

提交前必须全绿：

```bash
pnpm check && pnpm typecheck && pnpm test
```

CI 还会连接 `postgres:18` 服务执行 `pnpm test:coverage`（单测 + 集成 + 覆盖率门槛）、迁移漂移检查、`pnpm build`、`pnpm test:e2e`（production server）与 `pnpm verify:deploy`。

E2E 选择器与外部模式约束见 `tests/e2e/`：外部模式必须同时设置 `E2E_EXTERNAL_SERVER=1` 与 `E2E_ALLOW_EXTERNAL=1`，仅限 staging。

**不存在的命令**：`pnpm db:reset`、ESLint、dependency-cruiser。

---

## 4. 目录与命名

```
app/
├── (marketing)/              # / 首页
├── (login)/                  # /sign-in、/sign-up
├── (dashboard)/dashboard/    # 登录后控制台
│   ├── (account)/            # /dashboard、general、security、activity（无 org scope）
│   ├── join/                 # /dashboard/join?token=... 接受邀请
│   ├── org/[orgSlug]/        # projects、team、settings
│   └── project/[projectRef]/ # overview、lineages（layout 左侧谱系管理；含 [lineageId] 画布/世系表）、articles、books、settings
└── api/
    ├── health/
    ├── orgs/
    ├── orgs/[orgId]/projects/
    └── user/
components/
├── console/                  # 控制台框架、导航、组织/项目选择器、scope context、路由错误边界
├── lineage/                  # 谱系列表/分类树、左侧谱系管理、世系表、人丁对话框、检查器
│   ├── canvas/               # React Flow 欧式书本画布（布局/节点/连线/懒渲染）
│   ├── lineage-store.ts      # zustand：谱系工作区 UI 状态（不存数据库实体）
│   ├── derived.ts            # 谱系索引、排行、字辈、搜索匹配等纯函数
│   ├── lineage-tree.ts       # 文件夹/谱系树构建与搜索过滤
│   ├── lineage-shell.tsx     # 可调宽侧栏 + 移动端抽屉外壳
│   └── lineage-sidebar.tsx   # 参考风格文件夹/谱系管理侧栏
├── org/                      # 组织成员/设置、邀请详情查询
├── project/                  # 项目设置/工作区
├── marketing/                # 营销页组件
├── query-provider.tsx        # TanStack Query Provider + HydrationBoundary
└── ui/                       # shadcn/ui 基础组件
lib/
├── auth/                     # Better Auth 实例、会话 context、access-control、错误映射、限流、schema、actions
├── db/
│   ├── queries/              # 按领域拆分的查询：organizations、invitations、projects、activity、folders、lineages、nodes
│   ├── services.ts           # 项目多步事务流程
│   ├── schema.ts             # Drizzle schema（auth 表 + 业务表）
│   ├── auth-schema.ts        # Better Auth Drizzle adapter 的表映射
│   ├── auth-db.ts            # 认证连接单例（固定 role=auth_service）
│   ├── drizzle.ts            # 业务连接单例（本地 postgres.js / Vercel pg）
│   ├── errors.ts             # PG 错误码识别
│   └── migrations/           # drizzle-kit 迁移
├── folder/                   # 分类树 Server Action 与事务服务
├── genealogy/schemas.ts      # 分类/谱系/人丁 Zod schema
├── lineage/                  # 谱系与人丁 Server Action、事务服务、请求级导航缓存（nav.ts）
├── org/actions.ts            # 组织相关 Server Action
├── project/actions.ts        # 项目相关 Server Action
├── server/request-context.ts # AsyncLocalStorage 请求日志上下文
├── api.ts                    # Route Handler 日志/request_id/500 包装
├── config.ts                 # Zod 环境变量校验
├── errors.ts                 # ActionState 错误码构造
├── ids.ts                    # 20 位公开 ID 生成与校验
├── logger.ts
├── fetcher.ts
├── query-keys.ts             # TanStack Query queryKey 工厂
├── utils.ts
└── ui/status.ts
hooks/                        # use-session-user、use-resizable（侧栏/检查器拖宽）
tests/                        # Vitest 单测 + 真实 PostgreSQL 集成测试
instrumentation.ts            # 启动时校验配置并注册日志上下文
proxy.ts                      # Next 16 路由门禁
```

| 对象 | 规则 | 示例 |
|---|---|---|
| 文件 | `kebab-case` | `rate-limit.ts` |
| React 组件文件 | `PascalCase.tsx` 或 `kebab-case.tsx`（现有两种并存） | `members-panel.tsx`、`Button.tsx` |
| 函数 / 变量 | `camelCase` | `getOrgRoleInTx` |
| 类型 | `PascalCase`，不加 `I` 前缀 | `ActionState` |
| 常量 | `SCREAMING_SNAKE` | `ORG_ROLES` |
| 数据库列 | `snake_case` | `org_id`、`organization_id` |

不要为了“以后可能用到”提前拆 `service/repo/module` 目录；当前代码以页面、Action、查询函数为主。

---

## 5. 当前架构与数据流

### 5.1 读

- 页面默认是 Server Component，直接在服务端调用 `lib/db/queries/<domain>.ts`。
- 客户端组件不直接查库；首屏数据由 RSC 以序列化 props / `HydrationBoundary` 提供，交互刷新走 TanStack Query 调用只读 API。
- 组织/项目布局用 `requireOrgContext(orgSlug)` / `requireProjectContext(projectRef)` 解析 scope：内部先 `getSessionUser()`，再用 `getOrgWithRoleBySlug` / `getProjectScopeByRef` 同时按当前用户过滤，失败 `notFound()`。`getSessionUser` 与两个 context helper 用 React `cache()` 做请求级记忆化。
- 页面需要 scope 时调用 `getOrgContext` / `getProjectContext`（返回 `null`）或 `require*Context`（404/重定向）；**不要再自行 `getSessionUser()` + 查询 scope**。
- 页面内的数据查询仍按 UUID `orgId` 过滤；scope 里的 `id` 来自服务端校验过的成员关系。
- 根布局与组织/项目布局用 `QueryClient` + `dehydrate` 生成首屏数据，交给 `components/query-provider.tsx` 的 `QueryProvider`/`HydrationBoundary` 注入客户端缓存；客户端用 `useQuery` 读取 `/api/user`、`/api/orgs`、项目列表，不要在组件里手写 `fetch`。
- 写操作成功后，除 `revalidatePath` 外，按需用 `useQueryClient().invalidateQueries()` 失效对应 `queryKey`；不要再引入 SWR。
- 谱系区的文件夹/谱系列表由 `lib/lineage/nav.ts` 的 `getNavFolders` / `getNavLineages` 用 React `cache()` 包装，`lineages/layout.tsx` 与列表/详情页共享同一次请求的查询结果；新增导航数据也走这里。

### 5.2 写

- 写操作使用 Server Action，放在 `lib/<domain>/actions.ts`。
- 入参用 Zod 校验；认证/组织/项目 schema 在 `lib/auth/schemas.ts`（名字是历史原因），家谱相关 schema 在 `lib/genealogy/schemas.ts`。
- 用 `validatedAction` 或 `validatedActionWithUser` 包装：

```typescript
export const renameOrgAction = validatedActionWithUser(
  renameOrgSchema,
  async (data, _, user) => {
    const result = await renameOrganization({
      userId: user.id,
      orgId: data.orgId,
      name: data.name,
    });

    if (!result.ok) {
      return { error: '组织不存在或你没有权限' };
    }

    revalidatePath('/dashboard', 'layout');
    return { success: '组织已重命名' };
  }
);
```

- 多步写操作（注册、建组织、接受邀请、成员变更、删号）放在 `lib/db/services.ts`，整个流程使用 `withOrg` 或单个事务；不要在 Action 里串联多个独立写操作。事务内必须用 `getOrgRoleInTx()` / 锁定读重新校验权限。
- 权限判断用 `hasPermission(role, '<permission>')`；不要在业务代码里写 `role === 'owner' || role === 'admin'`。
- 返回 `{ error }` / `{ success }` 等 `ActionState` 字段，不把异常堆栈抛给 UI。新代码的错误可带稳定 `code`（见 `lib/errors.ts` 的 `actionError()`）。
- 返回给 UI 的文案一律使用简体中文；内部日志、API JSON 错误保持英文。
- 写成功后按需 `revalidatePath`；组织级变化用 `/dashboard` layout 或 `/dashboard/org/${slug}`，项目设置用 `/dashboard/project/${ref}`。
- 涉及组织/项目/成员的写操作，**必须在服务端做成员/角色校验**，不能只靠按钮禁用或 URL 里的公开 ID。

### 5.3 认证与会话

```
proxy.ts（乐观门禁：getSessionCookie 只检查 better-auth.session_token 是否存在）
   ↓
getSessionUser()（权威校验：auth.api.getSession 查数据库会话，按请求缓存）
   ↓
页面 / Action / API Route 内的组织成员校验
```

- 认证由自托管 Better Auth 负责：`lib/auth/better-auth.ts` 创建单例，核心表在 `auth` schema；密码由 Better Auth 以 scrypt 存储，应用不接触哈希。
- `getSessionUser()` 只返回 `SessionUser`（`{ id, name, email }`）或 `null`；**不要直接 `Response.json(session.user)`**。对外出口（API、TanStack Query hydration、客户端组件 props）只传 `SessionUser`。
- 会话是数据库会话：7 天过期、1 天滑动续期、关闭 cookie cache；撤销即时生效，不需要自建会话版本字段。
- 不创建 `app/api/auth/[...all]/route.ts`，也不引入浏览器 auth client；所有认证/租户写操作只从 Server Action 调 `auth.api.*`。
- 邮箱验证关闭、无找回密码；改邮箱入口已移除（`user.changeEmail.enabled = false`）。邮箱只读，不要新增改邮箱表单。
- 修改密码走 `auth.api.changePassword({ revokeOtherSessions: true })`：当前会话保留，其他设备立即失效。
- 删除账号走 `auth.api.deleteUser`；删除前在应用层检查该用户是否是任何组织的唯一 owner，若是则要求先转让或归档。
- 账号区布局 `app/(dashboard)/dashboard/(account)/layout.tsx` 统一 `requireUser()`（内部 `redirect('/sign-in')`）；账号页不要各自猜认证状态。
- **两个连接不能混用**：业务查询用 `APP_POSTGRES_URL`（登录角色 `app` → `withOrg` 内 `SET LOCAL ROLE app_rw`）；认证用 `AUTH_POSTGRES_URL`（登录角色 `auth_runtime` → 连接初始化固定 `role=auth_service`）。
- `proxy.ts` 只是乐观门禁，**不是授权边界**；不要只靠它保护资源。
- Cookie 使用 `Secure`；本地开发请使用 `http://localhost:3000`，不要用 IP/非 localhost 域名。

### 5.4 组织隔离

- 隔离有**三层**：应用层按成员关系过滤、`withOrg` 事务内的 RLS（`app_rw`）、复合外键。三层都要有；不要因为“有 RLS”就省略 `orgId` 条件。
- 每个组织级查询都必须带 `org_id`/`orgId` 条件，并通过 `withOrg(userId, fn)` 执行：

```typescript
// ✅
getProjectById(userId, projectId, orgId);

// ❌ 仅按 projectId 查，随后再判断
getProjectById(projectId);
```

- `withOrg` 在事务内执行 `SET LOCAL ROLE app_rw` 并设置 `request.jwt.claims`；不要用会话级 `SET`（会污染连接池），也不要在 `app_rw` 之外直接跑组织级 SQL。
- `organization`/`organization_member`/`invite` 的写权限属于 Better Auth 的 `auth_service`；业务代码不要用 `withOrg` 写这三张表，也不要直接操作 `auth` schema。
- URL 里的 `[orgSlug]` / `[projectRef]` 是 20 位公开 ID；`requireOrgContext` / `requireProjectContext` 先用 `isPublicId()` 校验格式，再用 `getOrgWithRoleBySlug` / `getProjectScopeByRef` 同时按当前用户过滤。非成员、不存在的 ID 一律 404。
- 公开 ID 不是授权凭证：能猜到 slug/ref 不等于能访问，解析查询必须带 `userId`。
- Server Action 的 `orgId` / `projectId` 是 UUID 字符串，来自服务端 scope，不要新增按公开 ID 写入的入口。
- 不要信任客户端传来的角色；角色只从数据库成员关系读取，并用 `hasPermission()` 检查权限字符串。

### 5.5 数据访问

- 查询集中在 `lib/db/queries/<domain>.ts`（organizations、invitations、projects、activity、folders、lineages、nodes）；不要在页面里拼 SQL。
- 使用 Drizzle；迁移由 `drizzle-kit generate` 生成。当前迁移是重置后的 `0000_baseline` + `0001_auth_rls` + `0002_app_role_grant` + `0003_better_auth`；`drizzle.config.ts` 优先使用 `POSTGRES_URL_DIRECT`。
- 主键是 PostgreSQL 18 `uuidv7()` 生成的 UUID；20 位公开 `slug`/`ref` 只用于 URL，不进入外键。
- 公开 ID 由 `lib/ids.ts` 的 `generatePublicId()` 生成，插入时依赖唯一索引；项目创建遇到 `ref` 冲突时每次重试重新生成，最多尝试 3 次。
- 数据库约束：成员 `(organization_id, user_id)` 唯一、单组织仅一个 `owner`（部分唯一索引）、角色 `CHECK`、待处理邀请 `(organization_id, lower(email))` 部分唯一、`auth.users` 活动邮箱唯一。捕获 `23505`/`23514`/`23503` 时转换为中文提示，不要吞掉或重试成重复数据。
- 业务表（project、folder、lineage、node、article、book、book_catalog、activity_logs 等）有 `deleted_at` 软删列；`organization` 的 `deleted_at` 表示归档。`organization_member` 与 `invite` 是**硬删除**，不要假设成员移除或邀请接受可恢复。
- `invite` 由 Better Auth 管理：链接是邀请 ID（7 天过期、一次性、禁止邀请 `owner`），重新邀请会取消旧的 pending 邀请；不要恢复自研的 token 哈希字段或 `auth.accept_invite()`。
- 不要从业务查询访问 `auth.*`：运行时角色 `app_rw` 没有表权限；认证读写只通过 Better Auth（`auth_service` 连接）完成，业务代码不要 import `lib/db/auth-db.ts`。

### 5.6 API Route

当前 4 个 Route Handler：

| 路由 | 说明 |
|---|---|
| `GET /api/health` | 数据库 `SELECT 1`；健康 200、不可用 503；不要求登录 |
| `GET /api/orgs` | 当前用户的组织列表，DTO 为 `{ id, name, slug, role }` |
| `GET /api/orgs/[orgId]/projects` | 组织内项目列表，先校验成员；DTO 为 `{ id, name, ref }` |
| `GET /api/user` | 当前用户，DTO 为 `{ id, name, email }` |

三个业务路由未登录时都返回 `401 { error: 'Unauthorized' }`；`lib/fetcher.ts` 对非 2xx 抛错，错误对象带 `status`。所有路由用 `withApiLogging()` 包装：生成/透传 `x-request-id`、记录 `duration_ms`、异常返回 JSON 500。TanStack Query 以这些只读路由作为客户端刷新通道；客户端退出登录时要同时清空 `queryKeys.user` 与 `queryKeys.orgs` 缓存。

认证相关 Route Handler 数量为 0：**不要新增 `app/api/auth/*`**，认证与租户写只走 Server Action 内的 `auth.api.*`。

新增 API Route 时：

1. 用 `withApiLogging('<route-name>', handler)` 导出 `GET`/`POST`。
2. `getSessionUser()`，未登录返回 401。
3. 校验路径参数与请求体（Zod）。
4. 组织级资源先 `getOrgRole`，非成员返回 403/404。
5. 返回显式 DTO，不返回整行数据库记录。
6. 不要把 Server Action 的逻辑复制两份；能复用 query 就复用。

---

## 6. 编码约定

### 6.1 类型与校验

- `strict: true`；避免 `any`。
- 外部输入（表单、URL、API body）用 Zod。
- 领域类型从 `lib/db/schema.ts` 的 `$inferSelect` / `$inferInsert` 派生。
- 不用 `as` 强行断言未知数据。

### 6.2 错误与状态

- Server Action 返回 `ActionState`：`error`、`success`、`fieldErrors` 等。
- 不要回显密码字段（测试会检查）。
- 返回给 UI 的错误与成功文案使用简体中文；不要把数据库错误、堆栈直接展示。
- API Route 使用明确状态码和英文 JSON 错误体。
- 使用 Server Action + Zod 的表单加 `noValidate`，让中文 Zod 消息生效，避免浏览器英文原生校验。

### 6.3 日志

```typescript
import { logger } from '@/lib/logger';

logger.warn('organization access denied', { orgId, userId });
logger.error('failed to update project', error);
```

- `lib/logger.ts` 输出结构化 JSON；服务端日志会自动带上当前请求的 `request_id`、`user_id` 等上下文（`lib/server/request-context.ts`）。API 日志还包含 `duration_ms`。
- 不要在业务代码里散落 `console.log`；`lib/logger.ts` 内部除外。
- 不要记录密码、token、身份证、完整住址。

### 6.4 React

- 默认 Server Component；需要交互才加 `'use client'`。
- 表单使用 Server Action + `useActionState`/`useTransition`。
- 全局 UI 状态库仅允许 **zustand**，且只用于谱系工作区的 UI 状态（视图、选中、折叠、搜索、筛选、渲染窗口、侧栏宽度），见 `components/lineage/lineage-store.ts`；其余场景不引入 Redux/Jotai。
- 服务端数据缓存统一用 **TanStack Query**：RSC 首屏注入 + 客户端 `useQuery`；queryKey 统一从 `lib/query-keys.ts` 取，写后用 `invalidateQueries`。不要把服务端实体放进 Zustand，也不要再引入 SWR。
- zustand store 不存数据库实体数组（谱系、人丁、文件夹仍来自 RSC props + Server Action），不做 persist；文件只被客户端组件引用。
- 设计令牌与状态样式：不要在页面里写裸色值（`tests/design-system.test.ts` 会检查）；优先用 `components/ui` 与 `lib/ui/status.ts`。

### 6.5 样式

- Tailwind v4 + shadcn/ui。
- 新基础组件先放 `components/ui/`。
- 控制台布局用 `components/console/`。
- 不要在页面里用大量原子类重新实现已有组件。

### 6.6 安全

- 密码由 Better Auth 以 scrypt 哈希存储；不要读取、回显或复制 `auth.account.password`。
- 不把密码哈希、`BETTER_AUTH_SECRET` 传给客户端。
- 重定向只允许同源绝对路径（现有登录逻辑已做）。
- 公开 API 需要限流时用 `checkRateLimit`，并注意它是进程内实现。

---

## 7. 数据规则

| # | 规则 |
|---|---|
| 1 | 组织级查询必须带 `orgId` 并通过 `withOrg` 执行，不能只按子资源 ID 查 |
| 2 | 组织级写操作必须先 `hasPermission()`；事务流程在事务内锁定读重新校验角色 |
| 3 | 角色是 `owner` / `admin` / `editor` / `viewer`；业务代码检查权限字符串，不要直接比较角色名 |
| 4 | 主键是 UUIDv7；20 位公开 ID 只用于 URL |
| 5 | RLS 是兜底，不是替代品；应用层仍必须按成员关系过滤 |
| 6 | 业务表都有 `deleted_at` 软删；查询默认 `isNull(deletedAt)`，没有回收站 UI。`organization_member` 与 `invite` 是硬删除 |
| 7 | 表结构变更走 Drizzle 迁移，不手改数据库；RLS/角色/函数写在 custom migration |
| 8 | 迁移生成后必须人工 review；迁移与业务代码分开提交 |
| 9 | 不要在迁移里夹带数据修复逻辑；迁移必须能在空库一次执行 |
| 10 | 新表如果属于组织范围，必须带 `organization_id` 并在所有查询中过滤 |
| 11 | 公开 ID（slug/ref）查询必须同时按 `userId` 过滤，不能先查后判 |
| 12 | 多步写必须使用单个事务；失败时不能留下半成品数据 |
| 13 | 邮箱只读：不要新增改邮箱入口；账号资料更新只改 `name` |
| 14 | 不要绕过唯一约束/`CHECK` 直接写库；冲突转换为中文 `ActionState` |
| 15 | 不要直接读写 `auth.*`；认证路径只走 Better Auth（`auth_service` 连接），业务查询只走 `withOrg`（`app_rw`） |

### 7.1 加一张表的顺序

```text
1. lib/db/schema.ts 增加 Drizzle 定义（UUIDv7 主键、org_id、软删列、复合外键）
2. pnpm db:generate → 人工 review SQL
3. RLS/GRANT/函数追加到 custom migration，并补隔离断言
4. pnpm db:migrate
5. lib/db/queries/<domain>.ts 增加带 orgId、通过 withOrg 执行的查询
6. 更新 setup.md / implementation-status.md 的当前状态
7. 需要时补 Vitest 覆盖组织隔离；涉及真实 SQL、约束或事务的行为放进 `tests/integration`
```

---

## 8. 禁止清单

| # | 禁止 | 原因 |
|---|---|---|
| 1 | 未经计划直接实现尚未完成的家谱业务功能（谱文/谱书/分享/回收站等） | 目标规则尚未落地，避免半成品；先读目标文档并写实现计划 |
| 2 | 信任客户端传来的 `orgId` / `projectId` / 公开 ID / 角色 | 越权 |
| 3 | 返回完整用户行或密码哈希 | 信息泄露 |
| 4 | 存储明文密码 | 泄露即灾难 |
| 5 | 只靠 `proxy.ts` 做授权 | 它只是门禁 |
| 6 | 在客户端组件读取服务端密钥 | 进入 bundle |
| 7 | 在谱系工作区之外引入 zustand，或在 store 里存实体数据/做持久化 | 数据源与权限仍以服务端为准；工作区 UI 状态是唯一例外 |
| 8 | 新增后台任务/队列/定时器 | 当前部署模型没有消费者或调度器 |
| 9 | 直接套用目标设计的分层规则 | 目标用 Biome `noRestrictedImports` 约束；当前尚未配置同等规则 |
| 10 | 直接套用 `src/modules`、`*.service.ts`、`*.repo.ts` 结构 | 当前目录不是这样 |
| 11 | 在页面/组件里写裸色值 | 设计令牌测试会失败 |
| 12 | 在 Server Action 返回值里回显密码 | 安全测试会失败 |
| 13 | 把目标设计的“软删/回收站”当成已有能力 | 当前业务删除不可恢复 |

---

## 9. 任务配方

### 9.1 加一个 Server Action

```text
1. lib/auth/schemas.ts 定义 Zod schema
2. 对应 domain：lib/<org|project>/actions.ts 或新建 lib/<domain>/actions.ts
3. 用 validatedActionWithUser 包装
4. 校验用户与组织权限（getOrgRoleInTx / hasPermission）
5. 单步 CRUD 调 lib/db/queries/<domain>.ts（内部用 withOrg）；多步写放进 lib/db/services.ts 的单个事务，并在事务内锁定读重新校验权限
6. 写 activity log（如属于业务动作）
7. revalidatePath
8. 返回 ActionState；预期失败返回中文文案，不抛异常
9. 补测试：未登录、越权、成功路径；涉及真实 SQL 或事务的行为补 `tests/integration`
```

### 9.2 加一个页面

```text
1. 组织页放在 app/(dashboard)/dashboard/org/[orgSlug]/...；
   project 页放在 app/(dashboard)/dashboard/project/[projectRef]/...；
   账号页放在 app/(dashboard)/dashboard/(account)/...
2. page.tsx 是 RSC；用 requireOrgContext / requireProjectContext（内部含会话与成员校验）
3. 布局负责解析 scope，页面复用 context，不要重复查询
4. 数据查询必须带 UUID orgId，并通过 withOrg
5. 交互部分拆成 'use client' 子组件，只收 props
6. 需要时加 loading.tsx / error.tsx
7. 更新导航（components/console/console-sidebar.tsx）
```

### 9.3 加一个 API Route

```text
1. app/api/.../route.ts，用 withApiLogging 包装导出
2. getSessionUser()；401
3. Zod 校验参数/请求体
4. 组织资源：getOrgRole；403/404
5. 查询必须带 orgId
6. 返回显式 DTO
7. 补 Vitest（401/403/404/成功）
```

### 9.4 改认证

```text
1. 先读 lib/auth/better-auth.ts、lib/auth/context.ts、lib/db/auth-db.ts 与 ADR 0007
2. 认证/租户写只从 Server Action 调 auth.api.*；不要新增 /api/auth/* 或浏览器 auth client
3. 会话是数据库会话：撤销走 Better Auth（changePassword revokeOtherSessions、deleteUser、removeMember），不要自建会话版本字段
4. 修改密码保留当前会话、撤销其他会话；删除账号前检查该用户是否为唯一 owner
5. 邀请是两段式：/sign-up?invite=<id> → /dashboard/join?invite=<id>；接受失败不删除账号
6. 认证连接必须固定 role=auth_service；业务查询必须走 withOrg/app_rw
7. 更新 tests/integration/better-auth.test.ts 与 tests/e2e/critical-path.spec.ts；涉及真实 SQL/RLS 的改动补集成测试
8. 不要在 proxy.ts 里做需要数据库的校验
```

---

## 10. 提交与评审

### 10.1 Commit

```text
<type>(<scope>): <描述>

feat(project): 增加谱系占位页
fix(auth): 修正限流窗口判断
refactor(db): 收敛组织查询
docs(setup): 对齐当前环境变量
```

`type`：`feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `perf`
`scope`：`auth` / `org` / `project` / `db` / `ui` / `docs` / `ci`

一个 commit 只做一件事。迁移与业务代码分开提交。

### 10.2 PR 自查

- [ ] `pnpm check && pnpm typecheck && pnpm test` 全绿
- [ ] 涉及真实 SQL / 约束 / 成员隔离的改动补了 `pnpm test:integration`
- [ ] 多步写/事务流程有集成测试，失败路径不会留下半成品数据
- [ ] CI 的 `pnpm test:coverage`、`pnpm test:e2e`、`pnpm verify:deploy` 与迁移漂移检查能通过
- [ ] 新增的组织级查询/写入都带 `orgId` 且做了成员校验
- [ ] 公开 ID 查询带 `userId` 过滤，非成员返回 404
- [ ] 没有返回密码哈希
- [ ] 新增/修改表有迁移，迁移已人工 review
- [ ] 没有把家谱业务页面/写流程做成半成品；新组织级表已启用 RLS
- [ ] 安全相关路径有测试（越权、密码回显、限流）
- [ ] 文档同步：行为/命令变化 → `setup.md` / `implementation-status.md`

### 10.3 评审关注顺序

1. **越权**：能否通过猜 ID 访问别的组织。
2. **信息泄露**：是否返回了整行用户/密钥/内部错误。
3. **认证语义**：`getSessionUser()` 是否通过 `auth.api.getSession` 做权威校验；数据库会话撤销是否正确。
4. **错误处理**：401/403/404 是否合理。
5. **迁移**：是否可重复、可回滚、是否影响现有数据。
6. 命名与风格。

---

## 11. 陷阱

| # | 陷阱 | 现象 | 正确做法 |
|---|---|---|---|
| 1 | 只靠 `proxy.ts` 保护 | 绕过路由直接调 Action/API | 每个入口都 `getSessionUser()` + 成员校验 |
| 2 | 按子资源 ID 直接查 | 跨组织读取 | 查询同时带 `orgId` |
| 3 | 返回整行 `session.user` | 身份字段/内部数据泄露 | 显式 `SessionUser` DTO |
| 4 | 只信 Cookie 存在 | 伪造/过期会话通过 | `getSessionUser()` 调 `auth.api.getSession` 查库 |
| 5 | 绕过 Better Auth 直接写 `auth.*` | 会话/密码/成员状态不一致 | 只用 `auth.api.*` 写认证与租户数据 |
| 6 | 在客户端判断角色 | 改前端即可越权 | 服务端 `hasPermission` |
| 7 | 依赖内存限流做安全边界 | 重启清零、多实例失效 | 视为辅助；生产换共享存储 |
| 8 | 把 `.env` 改成 `.env.local` | 变量读不到 | 当前 dotenv 读取 `.env`；Next 会额外加载 `.env.local` |
| 9 | 在页面写裸色值 | 设计系统测试失败 | 用 token/组件 |
| 10 | 在 Server Action 回显密码 | 安全回归测试失败 | 不在 `ActionState` 放密码 |
| 11 | 删除组织/成员无备份 | 成员/邀请是硬删除，直接清库不可恢复 | 操作前确认；生产走工单/备份 |
| 12 | 以为 RLS 可以替代应用层过滤 | 只靠策略时用户会看到自己所有组织的数据 | 查询仍带 `orgId` 并通过 `withOrg` |
| 13 | 只按公开 ID 查组织/项目 | 猜到 slug/ref 即可跨组织读取 | 查询同时带 `userId`，失败一律 404 |
| 14 | 混用业务连接与认证连接 | 以 `app_rw` 写 `auth.*` 失败，或绕过 RLS 读业务表 | 业务 `APP_POSTGRES_URL`、认证 `AUTH_POSTGRES_URL`，不要互换 |
| 15 | 新增 `/api/auth/*` 或浏览器 auth client | 绕过“最后 owner / 管理员边界 / 活动日志” | 认证入口只保留 Server Action |
| 16 | 只靠应用层判断最后一个 owner | 直接删成员仍可产生无主组织 | 触发器兜底 + 应用层预检 |

---

## 12. 目标架构现状

基础层已按 [ADR 0001](docs/decisions/0001-foundation-reset.md) 落地，认证已按 [ADR 0007](docs/decisions/0007-self-hosted-better-auth.md) 切换到自托管 Better Auth，**不要再次重置**：

- 已实现：UUIDv7、`auth.users/session/account/verification`、Better Auth 组织插件、11 张组织级业务表、业务表软删、复合外键、RLS + `app_rw`/`auth_service`、`withOrg`、4 角色 + 权限字符串、邀请链接（邀请 ID、7 天过期）。
- 已实现（业务）：谱系/人丁、分类树 UI 与对应 Action、欧式书本画布与按代渲染窗口。
- 目标业务功能尚未实现：谱文、谱书、谱文/谱书分类接入、人丁自定义字段 UI、分享、回收站、编辑锁。
- 已明确不做：邮箱验证、找回密码、改邮箱、邮件发送、`/api/auth/*`。
- 目录与分层仍是当前的 `app/` + `components/` + `lib/`；没有 `src/modules`、`*.service.ts`/`*.repo.ts`，也没有 Biome `noRestrictedImports`。
- 目标接口以 RSC + Server Action 为主；当前 4 个只读 Route Handler 是过渡，见 §5.6。
- 部署：Vercel + 自定义域名 + Neon PostgreSQL 18+；生产驱动已接入（`process.env.VERCEL` 时用 `pg` + `attachDatabasePool`）；生产必须提供 `APP_POSTGRES_URL`（`app`）与 `AUTH_POSTGRES_URL`（`auth_runtime`）；本地/CI 用 `postgres.js`；本地 Docker 只跑 PostgreSQL + `next dev`。**本地生产模式已用 `pnpm verify:deploy` 全项验证**；真实 Vercel/Neon 部署仍未执行（无凭据），云端验证入口为 `verify:deploy` 与 external E2E（[部署蓝图](docs/ops-target.md)）。

实现家谱业务功能时：

1. 先读 [PRD](docs/prd.md) / [架构](docs/architect.md) / [数据模型](docs/data-model.md) / [接口](docs/api.md)。
2. 先写实现计划；表已存在，重点是业务规则、Action 与页面。
3. 不要在同一 PR 里混入业务功能与基础层改动。
4. 更新 [实现状态](docs/implementation-status.md)。
