# 实现状态

> **文档状态：当前实现说明** · 最后更新：2026-10-30
> 需求目标来自 [PRD](./prd.md)；当前代码结构见 [01-架构总览](./architecture/01-架构总览.md)；目标数据模型与接口契约见 [数据模型](./data-model.md)、[接口](./api.md)。
> 本文件只描述**代码里真实存在什么**，不描述计划。

| 项 | 值 |
|---|---|
| 文档版本 | 2.2 |
| 文档状态 | 当前实现说明 |
| 最后更新 | 2026-10-30 |
| 部署状态 | 目标为 Vercel + 自定义域名 + Neon PostgreSQL 18+；生产驱动已接入（`VERCEL` 环境用 `pg` + `attachDatabasePool`），本地/CI 用 `postgres.js`。**本地生产模式已用 `verify:deploy` 全项验证**；真实 Vercel/Neon 未部署（无凭据），云端入口已就绪 |

---

## 1. 当前实现基线

| 项 | 值 | 证据 |
|---|---|---|
| 框架 | Next.js 16.4.3、React 19.3.1 | `package.json` |
| 语言 | TypeScript 7.0.2（Go 原生实现，无 `@typescript/native-preview`）；`strict` + `verbatimModuleSyntax` / `noImplicitReturns` / `noFallthroughCasesInSwitch` / `noUncheckedSideEffectImports`；`isolatedModules` 已由 `verbatimModuleSyntax` 覆盖并删除 | `tsconfig.json`、[ADR 0012](./decisions/0012-typescript7-compiler-flags.md) |
| 运行时 | Node.js 24 LTS、pnpm 12.15.0、TypeScript 7.0.2 | `.nvmrc`、`package.json`（`packageManager` / `engines`）、CI |
| 数据库 | PostgreSQL 18 + Drizzle 0.45.4；本地/CI `postgres.js`，Vercel 环境 `pg` + `attachDatabasePool` | `lib/db/drizzle.ts`、`lib/db/schema/index.ts` |
| 主键 | UUIDv7（`uuidv7()`）；20 位公开 `slug`/`ref` 仅用于 URL | `lib/db/schema/index.ts`、`lib/ids.ts` |
| 认证 | 自托管 Better Auth 1.7.12：邮箱 + 密码，scrypt；BETTER_AUTH_SECRET；不暴露 `/api/auth/*` | `lib/auth/better-auth.ts`、`lib/db/migrations/0003_better_auth.sql` |
| 会话 | 数据库会话，Cookie `better-auth.session_token`，7 天有效、`updateAge` 1 天 | `lib/auth/better-auth.ts`、`proxy.ts` |
| 会话撤销 | `auth.api.getSession` 查库；`getSessionUser()` 按请求缓存；改密/删号/删会话即时生效 | `lib/auth/context.ts` |
| 角色 | `owner` / `admin` / `editor` / `viewer` + 9 个权限字符串 | `lib/auth/permissions.ts` |
| 数据隔离 | 应用层成员过滤 + `withOrg` 事务内 RLS（`app_rw`）+ 复合外键 | `lib/db/drizzle.ts`、`0001_auth_rls.sql` |
| 界面 | 简体中文，品牌“云谱”；无 i18n 框架 | `app/layout.tsx`、各页面组件 |
| 客户端数据 | TanStack Query 5；RSC 首屏 `dehydrate` / `HydrationBoundary` 注入，客户端 `useQuery` 调用只读 API，写后 `invalidateQueries`；首屏数据以 RSC 为唯一来源，单个 hook 不设 `refetchOnMount`，新鲜度统一由 `createQueryClient` 的 `staleTime` 决定 | `components/query-provider.tsx`、`lib/query-keys.ts`、`hooks/use-session-user.ts`、`tests/first-paint-data.test.ts`、[ADR 0013](./decisions/0013-next-react-runtime-layer.md) |
| 谱系画布 | `@xyflow/react` 12 + zustand 5.0.16（zustand 仅存谱系工作区 UI 状态，不存实体数据） | `components/lineage/canvas/`、`components/lineage/lineage-store.ts` |
| 数据表 | 17 张组织级业务表 + 4 张 `auth.*` 表 | 见 §1.1 |
| Route Handler | 4 个 | 见 §1.3 |
| 配置与日志 | Zod 启动校验；结构化日志自动带 `request_id`/`user_id`；API 记录 `duration_ms` | `lib/config.ts`、`instrumentation.ts`、`lib/server/request-context.ts`、`lib/api.ts` |
| 代码检查 | Biome | `biome.json`、`package.json` |
| 测试 | Vitest 单测 + 真实 PostgreSQL 集成测试（文件数/用例数以 `pnpm test`、`pnpm test:integration` 输出为准，不在此手抄）；Playwright E2E 2 条关键路径；`test:coverage` 合并采集 V8 覆盖率并检查门槛 | `tests/`、`package.json` |
| CI | Node 24 / pnpm 12；`pnpm check` → `typecheck` → `test:coverage`（`postgres:18`，上传 `coverage/`）→ 迁移漂移检查 → `build` → `test:e2e`（production server）→ `verify:deploy` | `.github/workflows/ci.yml` |

**版本选择（2026-10-25）**：Next.js 16.4.3、Drizzle 0.45.4、Better Auth 1.7.12、Playwright 1.64.1 已是当前最新稳定版；Drizzle 1.0 RC、Better Auth 1.8 beta、Playwright 1.65 alpha 不作为基线。运行时使用 Node 24 LTS，而不是 Node 26 Current；PostgreSQL 18 是当前可用的最新稳定大版本（19 尚无稳定镜像）。

### 1.1 当前数据表

迁移文件清单以 `lib/db/migrations/meta/_journal.json` 为准，**本文不重复枚举**——手抄的清单曾经三次与实际不符（D-24）。重置基线（Drizzle 生成）之后依次是：RLS 与角色、`app_rw` 授权、Better Auth、项目身份与元数据列、删除旧项目列、运行期超时、节点层级派生、树边复合外键、删除零读写列。

| 表 | 说明 |
|---|---|
| `auth.users` / `auth.session` / `auth.account` / `auth.verification` | Better Auth 核心表；密码以 scrypt 存在 `auth.account`；`app_rw` 无表权限，只有 `auth_service` 可读写 |
| `organization` | 组织；`slug` 为 20 位公开 ID；`status` 为 `active/suspended/closed` |
| `organization_member` | 成员与角色；`(organization_id, user_id)` 唯一；单组织仅一个 `owner`；**硬删除** |
| `invite` | Better Auth organization 插件的邀请；7 天过期、一次性、禁止邀请 `owner`；**硬删除** |
| `project` | 云谱空间；`ref` 为 20 位公开 ID；字段为 `name`/`surname`/`theme_name`/`hall_code`/`countries_regions`/`status`/`importance`/`notes` |
| `folder` | 分类树（`kind` 0/1/2）；谱系分类已有 UI/Action，谱文/谱书分类待接入 |
| `lineage` / `node` | 谱系与人丁；欧式书本画布、世系表、左侧谱系管理、搜索定位、字辈提示、增删改移、检查器、按代渲染窗口已实现 |
| `person` / `person_name` | 人丁事实层：人丁与多姓名（谱名、字、号、讳……）；`primary_name_id` 是不可延迟的复合外键，所以带主名的人丁要三步写入；无查询层、无 UI |
| `family` / `family_partner` / `family_child` | 事实层：家庭、配偶（`blood`/`spouse`）、子女（`parentage_type`）；「至多一个 `blood` 配偶」由 `app.check_family_blood_side()` 触发器执行；无查询层、无 UI |
| `event` | 事实层：事件（生、卒、葬、婚、迁、职业……）与属性；日期七列语义见[数据模型 §6.8](./data-model.md#68-event事件)；无查询层、无 UI |
| `article` | 谱文（表已存在，无业务 UI） |
| `book` / `book_catalog` | 谱书与编目（表已存在，无业务 UI） |
| `activity_logs` | 产品活动流；账号级事件 `organization_id` 为空；不是审计表 |

除 `activity_logs`（产品活动流）外，组织级业务表都有 `deleted_at` 软删列；`organization_member` 与 `invite` 例外（硬删除）；没有回收站 UI。共 16 张业务表，加上 `activity_logs` 是 17 张。事实层六张表全部软删，且都只有 `SELECT`/`INSERT`/`UPDATE` 授权——没有 `DELETE`，物理删除只能走运维（[数据模型 §11.3](./data-model.md#113-整组恢复运维手册)）。

数据库层还有：

- `app_rw`（NOLOGIN、NOBYPASSRLS、无 `auth.*` 表权限、无业务表 `DELETE`、无组织/成员/邀请写权限）。
- `auth_service`（NOLOGIN、NOBYPASSRLS）：拥有 `auth.*` 与组织/成员/邀请的写权限；Better Auth 连接固定 `role=auth_service`。
- 运行时超时（`0006`）：`app_rw` 设置 `statement_timeout=10s` / `idle_in_transaction_session_timeout=30s` / `lock_timeout=5s`；`auth_service` 设置前两项。
- 登录角色 `app`（成员 `app_rw`）与 `auth_runtime`（成员 `auth_service`）；生产分别用于业务连接与认证连接。
- `auth` schema 的 `SECURITY DEFINER` 辅助函数：`auth.has_org_role()`、`auth.archive_organization()` 等；旧的自研认证函数已在 `0003` 删除。
- 注册触发器 `trg_auth_user_created` / `handle_new_user()`：创建 `auth.users` 时自动建立个人组织与 `owner` 成员关系。
- 最后 owner 保护触发器 `trg_org_member_last_owner_delete` / `trg_org_member_last_owner_update`。
- `FORCE ROW LEVEL SECURITY`：`app_rw` 以及表属主都受策略约束；迁移角色通过 `SET LOCAL ROLE app_rw` 降权后查询。
- 扩展 `ltree`、`pg_trgm`、`btree_gist`；GiST 用于 `node` 的 `path` 索引。`pg_trgm` 保留给 `article`（`idx_article_search`，FR-ART-5）；`node` 搜索在客户端，`idx_node_search` 已在 `0013` 删除（[ADR 0011](./decisions/0011-search-boundary-node-client-article-trgm.md)）。
- `0014`：手写 custom migration 新增 `idx_node_spouse_sort`（B-tree，部分于 `deleted_at IS NULL`，列 `(organization_id, spouse_of_id)`），服务 `nextSpouseSort` 的 `max(sort)` 查询，避免配偶写入在 `FOR UPDATE` 锁内扫描整谱系；同 0013 的思路——每个索引都有消费者。它只活在迁移里，不进 `lib/db/schema/`（Drizzle schema 已按域拆分），与 `idx_node_search` 一致。
- `0002_app_role_grant` 与 `0003_better_auth`：登录角色存在时补 `GRANT app_rw TO app` / `GRANT auth_service TO auth_runtime`；角色创建仍属本地/运维步骤。
- `0015`：租户列不可变（[ADR 0016](./decisions/0016-tenant-columns-immutable.md)）。`app` schema 的 `app.forbid_tenant_move()` + 16 个 `trg_<table>_tenant_immutable`（`organization_member`、`invite`、`project`、`folder`、`lineage`、`node`、`person`、`person_name`、`family`、`family_partner`、`family_child`、`event`、`article`、`book`、`book_catalog`、`activity_logs`）挡住「双组织用户把行搬到另一个组织」——RLS 的 `WITH CHECK` 只看新值，policy 无法比较新旧行。改归属列报 SQLSTATE `42501`；结构关系列（`parent_id`、`spouse_of_id`、`folder_id` 等）保持可写。`USAGE`/`EXECUTE` 同时授 `app_rw` 与 `auth_service`。新增组织级表必须挂这个触发器，`tests/integration/tenant-immutability.test.ts` 断言精确的 16 张表。
- `P0`（2026-10-29）：`lib/db/schema.ts`（688 行）拆成 `lib/db/schema/{shared,auth,org,project,lineage,content,activity,relations,index}.ts`，`drizzle.config.ts` 指向 `lib/db/schema/index.ts`；`arch:check` 的 F6 单文件 400 行豁免名单从 8 条降到 7 条（拆完的目录不再需要豁免）；`pnpm db:generate` 报告无漂移。
- `P1`（2026-10-29/30）：事实层六张表落库——`0016`/`0017`（`person`、`person_name`）、`0018`/`0019`（`family`、`family_partner`、`family_child`）、`0020`–`0023`（`event`），全部 `ENABLE` + `FORCE ROW LEVEL SECURITY`、三策略、无 `DELETE` 授权，并各挂租户列不可变触发器；`0018` 给 `project` 加 `allow_consanguineous_marriage`；`0019` 加 `app.check_family_blood_side()`（至多一个 `blood` 配偶，下界故意不约束）。
- `P1`：回填与对账已实现。`lib/db/backfill/fact-layer.ts` + `fact-layer-rules.ts`（单事务、只写事实层、`person.legacy_node_id` 作锚点），CLI `data/backfill-fact-layer.ts`（`pnpm data:backfill:fact --org <uuid>`）；`lib/db/backfill/reconcile-fact-layer.ts` 从 `node` 重算十四项计数再与事实层比较（`RECONCILE_CHECKS`：人数、出生名、字号名、`primary_name` 指针、`person` 软删、家庭、配偶、子女边、孤儿子女、生/卒/葬事件、无内容事件、事件主体；其中家庭/配偶/子女边是把回填的分层约定重写一遍，只能发现实现漂移，见[数据模型 §6.9](./data-model.md#69-六张事实层表的共同规则)），CLI `data/reconcile-fact-layer.ts`（`pnpm data:reconcile:fact`）。两个脚本以迁移角色直连、启动时断言 `rolsuper`/`rolbypassrls`，只能人工执行（[数据模型 §1.5](./data-model.md#15-两条硬约定)）。
- **事实层还没有读写路径**：`node` 仍是唯一读源与唯一写目标。读写切换、DTO 变更、`node` 冻结与退役属于另一份计划 `2026-11-XX-p1-read-write-switch.md`（尚未编写）；本仓库当前没有任何页面、Action 或查询函数读 `person`/`family`/`event`。

### 1.2 公开 ID 与控制台路由

- `organization.slug` 与 `project.ref` 是 20 位 `[0-9a-z]` 公开 ID，由 `lib/ids.ts` 生成，各自有唯一索引；UUIDv7 主键仅内部使用。
- 控制台地址：`/dashboard/org/[orgSlug]`（Projects / Team / Org settings）与 `/dashboard/project/[projectRef]`（Overview / Lineages / Articles / Books / Project settings）。
- `requireOrgContext(orgSlug)` / `requireProjectContext(projectRef)` 在 `lib/auth/context.ts` 中解析 URL：先取 `getSessionUser()`，再用 `getOrgWithRoleBySlug(userId, slug)` / `getProjectScopeByRef(userId, ref)` 同时按当前用户过滤；非成员或不存在的公开 ID 返回 404。两个 helper 与 `getSessionUser` 都用 React `cache()` 做请求级记忆化。
- 邀请链接指向 `/sign-up?invite=<invitation.id>`；已登录用户从 `/dashboard/join?invite=<invitation.id>` 接受邀请。
- 迁移重置策略、数据与 URL 的取舍见 [ADR 0001](./decisions/0001-foundation-reset.md)。

### 1.3 当前 Route Handler

- `GET /api/health`（数据库 `SELECT 1`；正常 200、不可用 503）
- `GET /api/orgs`
- `GET /api/orgs/[orgId]/projects`
- `GET /api/user`（DTO 仅为 `{ id, name, email }`）

三个业务路由未登录时都返回 `401 { error: 'Unauthorized' }`；组织级项目列表先校验成员，非成员返回 403，`orgId` 不是合法 UUID 时返回 404；项目 DTO 为 `{ id, name, ref }`。客户端 `lib/fetcher.ts` 对非 2xx 响应抛错，错误对象带 `status`。所有路由通过 `withApiLogging()` 导出：生成或透传 `x-request-id`，记录 `duration_ms`，未捕获异常返回 JSON 500。

### 1.4 测试与 CI

- `pnpm test:unit`（`pnpm test`）：不连接数据库；文件数/用例数以命令输出为准。
- `pnpm test:integration`：连接名称以 `_test` 结尾的独立 PostgreSQL（数量以输出为准）；`globalSetup` 先丢弃旧 schema/扩展，再从空库执行全部迁移；每个测试用例开始前清空业务表与 `auth.users`。
- `pnpm test:coverage`：单测 + 集成的合并 V8 覆盖率，输出 `text`/`json-summary`/`lcov`；全局门槛 lines/statements 60、functions 55、branches 50，关键服务层（`lib/db/queries/**`、`lib/project/services.ts`、`lib/lineage/node-services.ts`）lines 70、functions 60。
- `pnpm test:e2e`：Playwright + Chromium 两条串行关键路径（注册 → 建项目 → 文件夹/谱系 → 始祖 → 子女 → 检查器持久化 → 侧栏搜索/折叠；邀请 → 登出 → 登录 → 接受邀请）；本地模式会重置 `_test` 库，外部模式需 `E2E_EXTERNAL_SERVER=1` + `E2E_ALLOW_EXTERNAL=1`。
- `pnpm verify:deploy`：HTTP 健康/安全头/鉴权与数据库结构/RLS/角色检查；本地生产模式全项 PASS。
- 集成测试覆盖：迁移结构/RLS/授权、约束、公开 ID 成员过滤、RLS 无 claims 与跨组织拒绝、注册/邀请/建组织/成员变更/删号事务、Server Action 行为、API 契约、项目 `ref` 冲突重试、健康检查、分类/谱系/人丁树语义（四种录入模式、同录配偶与详情、移动子树、软删、始祖删除保护、`node_count`、搜索）、组织级查询的软删/排序/搜索转义。
- 单元测试覆盖配置、请求上下文、权限矩阵、会话、ID、限流、fetcher、设计系统、书本布局/折叠/懒渲染窗口、谱系索引与搜索匹配、侧栏树、zustand 工作区 store、人丁创建 schema。
- CI 使用 `postgres:18-alpine` service，执行覆盖率与迁移漂移检查（`pnpm db:generate` 后迁移目录必须无变化），构建后跑 production-mode E2E 与部署验证。
- `tests/security-regressions.test.ts` 与 `tests/design-system.test.ts` 仍保留源码字符串断言，但关键安全与数据完整性行为已由集成测试覆盖。

### 1.5 当前代码结构

顶层就是 `app/` + `components/` + `lib/`，没有 `src/modules`，也没有 `*.service.ts` / `*.repo.ts`。依赖方向见 [03-逻辑视图-模块设计](./architecture/03-逻辑视图-模块设计.md)。

```
app/
├── (marketing)/              # / 首页
├── (login)/                  # /sign-in、/sign-up
├── (dashboard)/dashboard/    # 登录后控制台
│   ├── (account)/            # /dashboard、general、security、activity（无 org scope）
│   ├── join/                 # /dashboard/join?token=... 接受邀请
│   ├── org/[orgSlug]/        # projects、team、settings
│   └── project/[projectRef]/ # overview、lineages（layout 左侧谱系管理；含 [lineageId] 画布/世系表）、articles、books、settings
└── api/                      # health、orgs、orgs/[orgId]/projects、user（见 §1.3）
components/
├── console/                  # 控制台框架、导航、组织/项目选择器、scope context、路由错误边界
├── lineage/                  # 谱系列表/分类树、左侧谱系管理、世系表、人丁对话框、检查器
│   ├── canvas/               # React Flow 欧式书本画布（布局/节点/连线/懒渲染）
│   ├── lineage-store.ts      # zustand：谱系工作区 UI 状态（不存数据库实体）
│   ├── derived.ts            # 谱系索引、排行、字辈、搜索匹配等纯函数
│   ├── lineage-tree.ts       # 文件夹/谱系树构建与搜索过滤
│   ├── lineage-shell.tsx     # 可调宽侧栏 + 移动端抽屉外壳
│   └── lineage-sidebar.tsx   # 文件夹/谱系管理侧栏
├── org/                      # 组织成员/设置、邀请详情查询
├── project/                  # 项目设置/工作区
├── marketing/                # 营销页组件
├── query-provider.tsx        # TanStack Query Provider + HydrationBoundary
└── ui/                       # shadcn/ui 基础组件
lib/
├── auth/                     # Better Auth 实例、会话 context、access-control、错误映射、限流、schema、actions
├── db/
│   ├── backfill/             # 事实层回填与对账（fact-layer.ts、fact-layer-rules.ts、reconcile-fact-layer.ts）
│   ├── queries/              # 按领域拆分：organizations、invitations、projects、activity、folders、lineages、nodes
│   ├── services.ts           # 项目多步事务流程
│   ├── schema/               # Drizzle schema 按域拆分：shared、auth、org、project、lineage、content、activity、relations、index
│   ├── auth-schema.ts        # Better Auth Drizzle adapter 的表映射
│   ├── auth-db.ts            # 认证连接单例（固定 role=auth_service）
│   ├── drizzle.ts            # 业务连接单例（本地 postgres.js / Vercel pg）
│   ├── errors.ts             # PG 错误码识别
│   └── migrations/           # drizzle-kit 迁移（清单见 _journal.json）
├── folder/                   # 分类树 Server Action 与事务服务
├── genealogy/schemas.ts      # 分类/谱系/人丁 Zod schema
├── lineage/                  # 谱系与人丁 Server Action、事务服务、请求级导航缓存（nav.ts）
├── org/actions.ts            # 组织相关 Server Action
├── project/actions.ts        # 项目相关 Server Action
├── server/request-context.ts # AsyncLocalStorage 请求日志上下文
├── api.ts                    # Route Handler 日志/request_id/500 包装
├── config.ts                 # Zod 环境变量校验（唯一可读 process.env 的文件）
├── errors.ts                 # ActionState 错误码构造
├── ids.ts                    # 20 位公开 ID 生成与校验
├── query-keys.ts             # TanStack Query queryKey 工厂
└── ui/status.ts              # 枚举/角色/区域 → 中文文案与状态样式
hooks/                        # use-session-user、use-resizable（侧栏/检查器拖宽）
data/                         # 运维 CLI：backfill-fact-layer、reconcile-fact-layer（不经应用运行时，用迁移角色直连）
tests/                        # Vitest 单测 + 真实 PostgreSQL 集成测试 + Playwright E2E
instrumentation.ts            # 启动时校验配置并注册日志上下文
proxy.ts                      # Next 16 路由门禁（乐观，不是授权边界）
```

不为了「以后可能用到」提前拆 `service/repo/module` 目录；当前代码以页面、Action、查询函数为主。

---

## 2. 模块状态

状态含义：✅ 已实现；🟡 部分实现或语义不同；⬜ 未实现；➕ 目标外已有。

| 模块 | 目标（PRD） | 当前实现 | 状态 |
|---|---|---|---|
| 认证 | 即时登录（无邮件确认）、数据库会话、改密、进程内限流、4 角色 | 自托管 Better Auth：注册/登录/登出、改密（撤销其他会话）、删号、内存限流；无邮箱验证、找回密码、改邮箱 | ✅ |
| 组织与成员 | 默认组织（触发器）、邀请链接 7 天、角色管理、组织停用 | 默认组织（注册触发器）、建组织、多组织、Better Auth invitation、4 角色与权限矩阵、移除成员、最后一个 owner 触发器保护、归档组织 | ✅ |
| 云谱空间 | 谱系/谱文/谱书三棵分类树 | 目标字段的 `project`、20 位 `ref`、项目创建冲突重试；谱系分类树已可用，谱文/谱书仍是占位页 | 🟡 部分 |
| 谱系与人丁 | `FR-LIN-1` ~ `FR-LIN-13` | 左侧谱系管理、欧式书本画布、世系表、搜索定位、字辈提示、始祖/子女/兄弟/配偶、拖拽录入、检查器、编辑/移动/删除、打印视图、按代渲染窗口；人丁自定义字段 UI 未实现 | 🟡 部分 |
| 人丁事实层 | 目标：`person`/`family`/`event` 成为唯一读写源，`node` 退役 | 六张表 + RLS + 租户触发器 + 回填 + 十项对账已落地；**读写仍全部走 `node`**，没有查询函数、DTO 或 UI；读写切换属于 `2026-11-XX-p1-read-write-switch.md`（未编写） | 🟡 部分 |
| 谱文 | `FR-ART-1` ~ `FR-ART-5` | 表存在；无页面、无 Action | ⬜ 未实现 |
| 谱书与编目 | `FR-BOOK-1` ~ `FR-BOOK-8` | 表存在；无页面、无 Action | ⬜ 未实现 |
| 分类树 | `folder` | 谱系分类已实现（三级、删除子树并解绑内容）；谱文/谱书分类未接入 | 🟡 部分 |
| 审计 / 活动记录 | 目标设计不建审计表；关键动作写结构化日志 | 可变的 `activity_logs`；账号级事件 `org_id` 为空 | ➕ 目标外已有 |
| 界面语言 | 简体中文 | 全站中文，品牌“云谱”；无 i18n 框架 | ✅ |
| 工程工具链 | Biome + Vitest + Playwright E2E | Biome + Vitest（单测 + 真实 PostgreSQL 集成测试 + 合并覆盖率门槛）+ Playwright 关键路径 E2E + 部署验证脚本 | ✅ |

---

## 3. 关键 FR 差异

只列会被误判为“已实现”的项。未列出的 `FR-LIN-*`、`FR-ART-*`、`FR-BOOK-*` 全部为 ⬜。

### 3.1 认证

| FR | 状态 | 当前行为 / 差异 |
|---|---|---|
| `FR-AUTH-1` 邮箱密码注册 | 🟡 | 注册可用，注册后直接登录；密码只校验长度 8–100，不要求字母 + 数字 |
| `FR-AUTH-2` 邮箱密码登录 | ✅ | 登录路径与目标一致 |
| `FR-AUTH-3` 会话保持 | ✅ | Better Auth 数据库会话：7 天过期、`updateAge` 1 天；`getSessionUser()` 调 `auth.api.getSession` 查库 |
| `FR-AUTH-4` 登出 | ✅ | `auth.api.signOut` 删除当前数据库会话并清 Cookie；其它设备会话不受影响 |
| `FR-AUTH-5` 登录失败限流 | ✅ | 登录 10 次/15 分钟（IP + 邮箱）的进程内滑窗；重启清零、多实例不共享，与目标的 best-effort 语义一致 |
| `FR-AUTH-6` 修改密码 | ✅ | 登录态可改密，验证旧密码后调用 `changePassword({ revokeOtherSessions: true })`；当前会话保留，其他设备立即失效 |

额外已有：修改密码、删除账号、账号安全页、活动日志。

### 3.2 组织与成员

| FR | 状态 | 当前行为 / 差异 |
|---|---|---|
| `FR-ORG-1` 注册即得默认组织 | ✅ | `auth.api.signUpEmail` 由注册触发器 `trg_auth_user_created` 在同一事务内创建个人组织与 `owner` 成员关系；机制是 `SECURITY DEFINER` 函数 |
| `FR-ORG-2` 新建额外组织 | ✅ | 单事务写入组织、owner 成员与活动日志；slug 由服务端生成（20 位 `[0-9a-z]`） |
| `FR-ORG-3` 多组织切换 | ✅ | 一个账号可属于多个组织，控制台顶部提供组织切换 |
| `FR-ORG-4` 邀请成员 | ✅ | Better Auth invitation：邀请 ID、7 天过期、一次性、禁止邀请 `owner`；重新邀请会取消旧的 pending 邀请 |
| `FR-ORG-5` 修改成员角色 | 🟡 | 支持 owner/admin 修改成员角色；没有转让所有权（`org.transfer` 权限已定义，无 Action/UI） |
| `FR-ORG-6` 移除成员 | ✅ | owner/admin 可移除成员；事务内锁定成员并拒绝移除最后一个 owner，也不能移除自己 |
| `FR-ORG-7` 组织设置 | ✅ | 改名仅 owner（服务端校验）；slug 不可修改；归档有二次确认 |
| `FR-ORG-8` 组织停用 | 🟡 | 归档写入 `status='closed'` + `deleted_at`（`auth.archive_organization`），同时作废待处理邀请；schema 支持 `suspended`，但没有独立的停用入口 |

### 3.3 云谱空间

| FR | 状态 | 当前行为 / 差异 |
|---|---|---|
| `FR-PROJ-1` 创建云谱空间 | ✅ | 弹窗采集项目名、姓氏、地区、主题名、状态、重要等级与备注；姓氏与主题名创建后不可修改；项目名 ≤24 字符；20 位 `ref` 由服务端生成且用于 URL |
| `FR-PROJ-2` 多个云谱空间 | ✅ | 一个组织可建多个 project |
| `FR-PROJ-3` 分类管理 | 🟡 | 谱系分类已有三级树、重命名、删除并解绑内容；谱文/谱书分类页仍为占位 |

### 3.4 谱系与人丁

| FR | 状态 | 当前行为 / 差异 |
|---|---|---|
| `FR-LIN-1` 创建谱系 | ✅ | 名称（≤24 字）、所属分类、地区、郡望堂号、备注；姓氏与主题名继承云谱空间、只读；字辈改在「编辑谱系」维护；项目无分类时同事务建「默认分类」；创建后进入画布并自动弹出录入始祖 |
| `FR-LIN-2` 录入始祖 | ✅ | 空谱系可录入第一个血亲节点，世次 1、深度 0；可同录详情与一位配偶 |
| `FR-LIN-3` 添加配偶 | ✅ | 配偶 `path` 为空，`spouse_of_id` 指向血亲；创建人丁时可同录配偶，移动子树时同步世次/深度 |
| `FR-LIN-4` 添加兄弟 | ✅ | 继承父节点，世次与兄弟一致；始祖不能添加兄弟 |
| `FR-LIN-5` 添加子女 | ✅ | 世次 +1，可连续添加；只有血亲节点能作为父辈；录入表单按父辈预填世次/排行/字辈 |
| `FR-LIN-6` 编辑人丁信息 | 🟡 | 姓名、前缀、字号、性别、生卒、葬地、行传、在世状态；自定义 `attributes` 尚未提供 UI |
| `FR-LIN-7` 删除人丁 | ✅ | 子树与配偶一次软删，`node_count` 同步；始祖不可删除；无回收站 |
| `FR-LIN-8` 移动人丁 | ✅ | 事务内重算子树 `path`/`generation`，拒绝移动始祖与成环；画布可拖拽连线改父 |
| `FR-LIN-9` 谱系图交互 | ✅ | 单一 `book_ltr` 欧式书本布局：世代列/表头、折叠展开、平移缩放、点选/双击编辑、搜索定位、居中、小地图、拖拽录入、连线改父 |
| `FR-LIN-10` 按代加载 | ✅ | 页面仍一次读取全部节点；超过 500 人时画布首屏渲染 5 世，向右平移或按钮每次追加 5 世，并开启 `onlyRenderVisibleElements` |
| `FR-LIN-11` 人丁搜索 | ✅ | 画布搜索匹配姓名/字号/前缀/生卒/葬地/行传/配偶并定位节点（配偶命中定位其血亲）；世系表保留过滤 |
| `FR-LIN-12` 字辈提示 | ✅ | 世次分组、画布表头与节点徽标展示字辈；录入表单按世次预填字辈 |
| `FR-LIN-13` 世系表视图 | ✅ | 按世次分组、与画布共用检查器、打印视图；无 CSV/PDF 导出 |

---

## 4. 目标外已有能力

这些功能在代码中存在，但 PRD 明确不在 M1 范围，或没有在目标设计中定义：

- 账号安全页（改密、删号）与活动日志页。
- 营销页 `/`。
- 控制台 UI 设计令牌、组织/项目两套侧边栏、顶部组织/项目选择器、成员面板、邀请链接复制。

---

## 5. 已知实现风险

1. **最后一个 owner 保护有数据库触发器兜底**：`trg_org_member_last_owner_delete` / `trg_org_member_last_owner_update` 阻止通过 Better Auth 删除或降级最后一个 owner；但直接以迁移角色写库仍可绕过，应用层也做预检。
2. **RLS 依赖运行期角色分离**：生产业务连接必须使用非表属主的 `app` 角色（`GRANT app_rw`），认证连接必须使用 `auth_runtime`（连 `auth_service`），否则 `FORCE RLS` 的兜底语义会被削弱。本地/CI 用超级用户迁移后 `SET LOCAL ROLE app_rw`，这一点已在集成测试中覆盖，但真实 Neon/Vercel 部署尚未验证。
3. **限流是进程内内存实现**：重启清零，多实例不共享；目标设计接受这一 best-effort 限制，不把它当作安全边界。
4. **邀请不发送邮件**：链接需要人工复制转发；这是目标设计允许的 M1 形态。
5. **无自助密码找回**：目标设计与当前实现都没有邮件通道；忘记密码只能由运维人工重置（更新 `auth.account.password` 并删除会话）。
6. **`activity_logs` 不是审计表**：记录可被修改（无软删列）；日志保留期外的逐条追溯依赖备份与 PITR，无法回答细粒度“谁改了什么”。
7. **软删没有回收站 UI**：数据仍在库内，但用户无法恢复；生产清库前必须确认备份。
8. **注册触发器会为每个用户创建个人组织**：被邀请注册的用户同时拥有个人组织与邀请方组织；组织切换器需要覆盖这一情形。
9. **E2E 只覆盖两条关键路径**：Playwright 覆盖注册→建项目→谱系→录入→检查器→侧栏，以及邀请→登出→登录→接受邀请；没有全量 CRUD 矩阵与视觉回归。控件文案变化会直接破坏测试，选择器因此优先使用 role/aria-label。
10. **云端部署验证未执行**：`verify:deploy` 与 external E2E 已就绪，但本机无 Vercel/Neon 凭据；本地生产模式已验证，真实 Vercel/Neon 行为（尤其 `pg` + `attachDatabasePool`、`auth_service` 连接与 pooled/direct 连接分离）仍待 staging 验证。
11. **谱系画布一次加载全部节点**：详情页仍读取整棵谱系，画布只按世代窗口渲染；超过 500 人时首屏 5 世、每次追加 5 世，但没有服务端分页或虚拟滚动。极大人丁量下传输与索引仍有成本，后续需补按代查询。
12. **活动日志语义不一致**：谱系写入在业务事务内（日志失败会回滚业务），组织写入在提交后（失败只告警）。目标语义是“日志尽力而为、不回滚业务”；差异见 2026-10-24 评审 P1-10。
13. **根布局读取会话与组织**：`app/layout.tsx` 对每个请求查会话与组织，营销页因此动态渲染；这是营销页无法静态化的直接原因，见评审 P1-9。
14. **缓存失效范围过宽**：所有写入 Action 都调用 `revalidateWholeConsole()`（整棵 `/dashboard` 树 + `layout`）；`lib/lineage/revalidate.ts` 里按子树收窄的 `revalidateProject(orgSlug, projectRef)` / `revalidateOrg(orgSlug)` **已实现但零调用者**，前提是 Action 能拿到公开 `orgSlug` / `projectRef`（现在只有 UUID）。见评审 P1-8 与 [ADR 0013](./decisions/0013-next-react-runtime-layer.md)。

> `getSessionUser()` 只返回 `SessionUser`（`{ id, name, email }`），不再返回完整用户行；新增对外出口必须显式挑字段，不能直接序列化任何认证记录。

---

## 6. 路线决策（2026-10-21 / 2026-10-22 / 2026-10-23）

| # | 决策 | 状态 |
|---|---|---|
| D1/D2 | 目标为家谱 M1；无生产数据，采用基础层重置 | ✅ Phase 3 已执行；见 [ADR 0001](./decisions/0001-foundation-reset.md) |
| D3 | UUIDv7 在创建家谱表之前一次性替换 `serial` | ✅ 已实现（`uuidv7()`） |
| D4 | 新家谱表从第一天启用 RLS；先补齐 `organization_member` 策略缺口 | ✅ 已实现：`auth.has_org_role()` + 按角色策略；集成测试覆盖 |
| D5 | 先落权限字符串矩阵，再扩到 4 个角色 | ✅ 已实现 |
| D6 | 移除改邮箱入口；邮箱只读 | ✅ 已实现：`user.changeEmail.enabled = false`，无改邮箱表单 |
| D7 | 保留 `activity_logs` 作为产品活动流并修复多组织归属；不把它当审计表 | ✅ 已实现：账号级事件 `org_id` 为空 |
| D8 | 保留 4 个只读 Route Handler（health + 3 个刷新），写只走 Server Action | ✅ 已实现；见 [ADR 0008](./decisions/0008-read-only-route-handlers.md) |
| D9 | 认证切换到自托管 Better Auth，邀请使用 organization 插件（邀请 ID + 7 天过期），禁止邀请 owner | ✅ 已实现；见 [ADR 0007](./decisions/0007-self-hosted-better-auth.md) |

## 7. 更新规则

- 合并涉及家谱目标功能的 PR 时，更新本文件对应模块与 FR 行。
- 新增/删除表、Action、Route Handler 时，同步更新本文件 §1 与对应 FR 行；README 不再维护当前值快照。
- 只有代码、迁移、测试都落地后，状态才能从 🟡/⬜ 改为 ✅。
- 本文件不记录“计划做什么”；计划写在 PRD、架构文档或 issue 里。
