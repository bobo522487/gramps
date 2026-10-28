# 工程协作指南（当前实现）

> **文档状态：当前实现说明** · 最后更新：2026-10-28
> 本文件每次会话都会被加载，所以只放**每次都必须遵守**的内容：项目边界、仓库约定、数据与安全规则、禁止清单。
> 其余细节按 [docs/README.md §5.1](docs/README.md) 的单一事实来源写，本文件**只指路、不复制**：命令与环境变量 → [setup.md](docs/setup.md)；实现状态与当前代码结构 → [implementation-status.md](docs/implementation-status.md)；加表/加 Action/加页面 → [guides/add-a-feature.md](docs/guides/add-a-feature.md)；测试分层与写法 → [guides/testing.md](docs/guides/testing.md)；架构目标 → [architecture/](docs/architecture/00-overview.md)；决策理由 → [decisions/](docs/decisions/README.md)。
> 冲突时以代码与 [实现状态](docs/implementation-status.md) 为准；本文件的仓库约定（安全、数据规则、禁止清单）优先于任何技能或目标文档的建议。

---

## 0. 技能系统（Superpowers）

本仓库装了 [superpowers](https://github.com/obra/superpowers)，技能在 `.agents/skills/`。

**开工前先调用 `using-superpowers`**；之后凡是有技能可能适用的任务，流程类技能优先：

- 「我们来做个 X」/ 改行为 / 新功能 → 先 `brainstorming`，再 `writing-plans`，再 `test-driven-development` 实现。
- 遇到 bug、测试失败、意外行为 → 先 `systematic-debugging`，不要先猜着改。
- 准备声称「完成 / 修好了」→ 先 `verification-before-completion`，拿命令输出作证据。

调用格式 `skill({ name: "<技能名>" })`。

---

## 1. 项目是什么

Next.js 组织/项目控制台 + 家谱业务第一版：组织 → 项目两层控制台，组织与项目用 20 位公开 ID（`organization.slug`、`project.ref`）作 URL，UUIDv7 主键仅内部使用；登录、组织成员（4 角色）、邀请链接、活动日志；注册/建组织/接受邀请/成员变更/删号等多步写在单个事务内完成，失败不留半成品。谱系与人丁已有第一版（左侧谱系管理、分类树、欧式书本画布、世系表、检查器、搜索定位、字辈、始祖/子女/兄弟/配偶、拖拽录入、移动/删除、打印视图、按代渲染窗口）。界面全简体中文，品牌「云谱」，不引入 i18n 框架。

**尚未实现**：谱文与富文本编辑/自动保存、谱书与编目编辑器、谱文/谱书分类页面接入、人丁自定义字段 UI、回收站、编辑锁、分享。任务要求实现这些时，先读 [PRD](docs/prd.md)、[架构](docs/architect.md)、[数据模型](docs/data-model.md)、[接口](docs/api.md)，先写实现计划；**不要把目标文档里的 `src/modules` 目录当成现状**。已明确不做：邮箱验证、找回密码、改邮箱、邮件发送、`/api/auth/*`。

| 项 | 当前值 |
|---|---|
| 框架 | Next.js 16.4.3 App Router + React 19.3.1 |
| 语言 | TypeScript 7.0.2（Go 原生实现）；`strict` + 4 条实测零报错的额外检查，开关账目与「为什么不开更贵的开关」见 [ADR 0012](docs/decisions/0012-typescript7-compiler-flags.md) |
| 运行时 | Node.js 24 LTS · pnpm 12 |
| 数据库 | PostgreSQL + Drizzle ORM（业务 `app_rw`、认证 `auth_service`；本地/CI `postgres.js`，Vercel `pg` + `attachDatabasePool`） |
| 认证 | 自托管 Better Auth 1.7.12（数据库会话 + organization 插件） |
| 客户端数据 | TanStack Query 5（RSC 首屏 `dehydrate`/`HydrationBoundary` 注入）；zustand 5 仅谱系工作区 UI |
| 检查/测试 | Biome；Vitest 单测 + 真实 PostgreSQL 集成测试 + Playwright E2E |

---

## 2. 按任务读什么

| 你要做的事 | 先读 |
|---|---|
| 任何事 | 本文件 + [实现状态](docs/implementation-status.md) |
| 本地跑起来 / 配环境变量 | [setup.md](docs/setup.md)（含 `pnpm db:setup`、全部脚本表） |
| 改表 / 加迁移 | [数据模型](docs/data-model.md) + `lib/db/schema.ts`、`lib/db/migrations/`；步骤见 [add-a-feature ①–④](docs/guides/add-a-feature.md) |
| 加页面 / Action / API | [接口契约](docs/api.md)（目标）；当前做法见 [add-a-feature ⑤–⑧](docs/guides/add-a-feature.md) |
| 写测试 / 覆盖率门槛 | [guides/testing.md](docs/guides/testing.md) |
| 线上故障 / 恢复 | [guides/runbooks.md](docs/guides/runbooks.md)、[ops-target.md](docs/ops-target.md) |
| 讨论家谱目标架构 | [architecture/](docs/architecture/00-overview.md)、[decisions/](docs/decisions/README.md) |

---

## 3. 命令

```bash
pnpm check && pnpm typecheck && pnpm test   # 提交前必须全绿
```

其余命令（`dev`/`build`/`start`/`db:*`/`lint`/`format`/`fix`）与各自作用见 [setup.md §5](docs/setup.md)；测试与 CI 细节见 [setup.md §7](docs/setup.md)。

- `pnpm arch:check` —— 架构约束：`app`/`components`/`lib`/`hooks` 下单文件 ≤400 行（F6，存量豁免只许缩不许涨）+ 只在 `lib/config.ts` 读 `process.env`（F7）。
- `pnpm docs:check` —— 文档相对链接、锚点、过期路径、矛盾措辞、文档头；CI 跑 `--strict`。
- `pnpm test:integration` / `test:coverage` 需要名称以 `_test` 结尾的库；`pnpm test:e2e` 本地模式会清空该库。
- CI 另外执行：`docs:check --strict`、`arch:check`、`test:coverage`（`postgres:18`）、迁移漂移检查、`build`、`test:e2e`（production server）、`verify:deploy`。
- 外部模式 E2E 必须同时设 `E2E_EXTERNAL_SERVER=1` 与 `E2E_ALLOW_EXTERNAL=1`，仅限 staging。
- **不存在的命令**：`pnpm db:reset`、ESLint、dependency-cruiser。

---

## 4. 目录与命名

目录树与「哪块代码在哪」见 [implementation-status §1.5](docs/implementation-status.md)；模块边界与依赖方向见 [03-components](docs/architecture/03-components.md)。顶层是 `app/` + `components/` + `lib/` + `hooks/` + `tests/`，没有 `src/modules`。

| 对象 | 规则 | 示例 |
|---|---|---|
| 文件 | `kebab-case` | `rate-limit.ts` |
| React 组件文件 | `PascalCase.tsx` 或 `kebab-case.tsx`（现存两种并存） | `Button.tsx`、`members-panel.tsx` |
| 函数 / 变量 | `camelCase` | `getOrgRoleInTx` |
| 类型 | `PascalCase`，不加 `I` 前缀 | `ActionState` |
| 常量 | `SCREAMING_SNAKE` | `ORG_ROLES` |
| 数据库列 | `snake_case` | `org_id`、`organization_id` |

不要为了「以后可能用到」提前拆 `service/repo/module` 目录。

---

## 5. 架构与数据流规则

### 5.1 读

- 页面默认 Server Component，服务端直接调 `lib/db/queries/<domain>.ts`；客户端组件不查库。
- 需要 scope 时用 `requireOrgContext(orgSlug)` / `requireProjectContext(projectRef)`（内部已含 `getSessionUser()` + 成员校验，失败 `notFound()`）或 `getOrgContext` / `getProjectContext`（返回 `null`）。**不要再自行 `getSessionUser()` + 查询 scope**，也不要在页面里重复解析。
- 页面数据查询仍按 UUID `orgId` 过滤；scope 里的 `id` 来自服务端校验过的成员关系。
- 首屏数据由 RSC 通过 `dehydrate` / `components/query-provider.tsx` 注入，客户端用 `useQuery` 读取只读路由；`queryKey` 一律从 `lib/query-keys.ts` 的工厂取，**不要在组件里手写 `fetch` 或拼字符串 key**。**不要在单个 hook 上设 `refetchOnMount`**（`'always'` 会绕过新鲜度判断，把服务端刚查过的同一份数据再打一遍；新鲜度只由 `createQueryClient` 的 `staleTime` 统一决定，见 [ADR 0013](docs/decisions/0013-next-react-runtime-layer.md)）。写成功后除 `revalidatePath` 外按需 `invalidateQueries`。不要引入 SWR。
- 谱系列表/文件夹走 `lib/lineage/nav.ts`（React `cache()` 请求级共享）；新增导航数据也走这里。

### 5.2 写

- 写操作用 Server Action，放 `lib/<domain>/actions.ts`；入参用 Zod 校验（认证/组织/项目在 `lib/auth/schemas.ts`，家谱在 `lib/genealogy/schemas.ts`；名字是历史原因）。
- 用 `validatedAction` / `validatedActionWithUser` 包装，不要手写校验与取用户。
- 单步 CRUD 调 `lib/db/queries/<domain>.ts`（内部 `withOrg`）；**多步写**（注册、建组织、接受邀请、成员变更、删号）放 `lib/db/services.ts` 或 `lib/<domain>/*-services.ts` 的单个事务内，并在事务内用 `getOrgRoleInTx()` / 锁定读复核权限。不要在 Action 里串联多个独立写操作。
- 权限用 `hasPermission(role, '<permission>')`；不要写 `role === 'owner' || role === 'admin'`。
- 返回 `ActionState`（`error` / `success` / `fieldErrors`），可带稳定 `code`（`lib/errors.ts` 的 `actionError()`）；不把异常堆栈抛给 UI，失败返回中文文案而不是 throw。
- 写后按需 `revalidatePath`：组织级变化 `/dashboard` 或 `/dashboard/org/${slug}`，项目设置 `/dashboard/project/${ref}`。
- 涉及组织/项目/成员的写操作**必须在服务端做成员/角色校验**，不能只靠按钮禁用或 URL 里的公开 ID。

### 5.3 认证与会话

链路：`proxy.ts`（乐观门禁，只查 `better-auth.session_token` 是否存在）→ `getSessionUser()`（权威校验，`auth.api.getSession` 查库 + 请求级缓存）→ 页面/Action/API 内的组织成员校验。

- 认证由自托管 Better Auth 负责（`lib/auth/better-auth.ts`，表在 `auth` schema）；密码以 scrypt 存储，应用不接触哈希。
- **不创建** `app/api/auth/[...all]/route.ts`，也不引入浏览器 auth client；认证与租户写只从 Server Action 调 `auth.api.*`。
- 数据库会话：7 天过期、1 天滑动续期、关闭 cookie cache；撤销即时生效，**不要自建会话版本字段**。改密走 `auth.api.changePassword({ revokeOtherSessions: true })`（当前会话保留、其他设备失效）；删号走 `auth.api.deleteUser`，删前检查该用户是否为任何组织的唯一 owner。
- `getSessionUser()` 只返回 `SessionUser`（`{ id, name, email }`）或 `null`；**不要 `Response.json(session.user)`**。任何出口只传 `SessionUser`。
- 邮箱只读、邮箱验证关闭、无找回密码；不要新增改邮箱表单。账号区布局统一 `requireUser()`，账号页不要各自猜认证状态。
- **两个连接不能混用**：业务用 `APP_POSTGRES_URL`（登录角色 `app` → `withOrg` 内 `SET LOCAL ROLE app_rw`），认证用 `AUTH_POSTGRES_URL`（登录角色 `auth_runtime` → 连接固定 `role=auth_service`）。不要把 `BETTER_AUTH_SECRET` 或哈希传给客户端。
- 陷阱：`.env` 才是 dotenv 读取的文件（改成 `.env.local` 会读不到；Next 会额外加载它）；本地用 `http://localhost:3000`，Cookie 带 `Secure`，用 IP/非 localhost 域名会登录不上。

### 5.4 组织隔离

三层都要有，不要因为「有 RLS」就省略 `orgId` 条件：**应用层按成员关系过滤** + **`withOrg` 事务内的 RLS（`app_rw`）** + **复合外键**。

- 组织级查询必须同时带 `orgId` 并通过 `withOrg(userId, fn)` 执行；`withOrg` 内只用 `SET LOCAL`（会话级 `SET` 会污染连接池）。
- `organization` / `organization_member` / `invite` 的写权限属于 `auth_service`：业务代码不要用 `withOrg` 写这三张表，也不要直接操作 `auth` schema。业务查询不要访问 `auth.*`（`app_rw` 无表权限），也不要 import `lib/db/auth-db.ts`。
- URL 的 `[orgSlug]` / `[projectRef]` 是 20 位公开 ID：先 `isPublicId()` 校验格式，再按 `userId` 过滤解析；非成员与不存在的 ID 一律 404。**公开 ID 不是授权凭证**，能猜到 slug/ref 不等于能访问。
- Server Action 的 `orgId` / `projectId` 是 UUID 字符串，来自服务端 scope；不要新增按公开 ID 写入的入口。角色只从数据库成员关系读取，不要信任客户端传来的角色。

### 5.5 数据访问

- 查询集中在 `lib/db/queries/<domain>.ts`（organizations、invitations、projects、activity、folders、lineages、nodes）；不要在页面里拼 SQL。用 Drizzle；迁移只由 `pnpm db:generate` 生成后**人工 review**，迁移与业务代码分开提交。
- `lib/db/migrations/meta/_journal.json` 是迁移清单的唯一来源，文档不手抄编号；`drizzle.config.ts` 优先用 `POSTGRES_URL_DIRECT`。
- 主键由 PostgreSQL 18 `uuidv7()` 生成；20 位公开 `slug`/`ref` 只用于 URL，不进入外键。公开 ID 由 `lib/ids.ts` 的 `generatePublicId()` 生成，项目创建遇 `ref` 冲突时重新生成、最多重试 3 次。
- 约束：成员 `(organization_id, user_id)` 唯一、单组织仅一个 `owner`（部分唯一索引 + 触发器兜底）、角色 `CHECK`、待处理邀请 `(organization_id, lower(email))` 部分唯一、`auth.users` 活动邮箱唯一。捕获 `23505` / `23514` / `23503` 时转成中文提示，不要吞掉、也不要重试成重复数据。
- 业务表（project、folder、lineage、node、article、book、book_catalog、activity_logs 等）有 `deleted_at` 软删，查询默认 `isNull(deletedAt)`；`organization.deleted_at` 表示归档。`organization_member` 与 `invite` 是**硬删除**，不要假设可恢复。

### 5.6 API Route

当前 4 个只读 Route Handler（`/api/health`、`/api/orgs`、`/api/orgs/[orgId]/projects`、`/api/user`）与 DTO/状态码契约见 [implementation-status §1.3](docs/implementation-status.md)；它们是过渡形态，见 [ADR 0008](docs/decisions/0008-read-only-route-handlers.md)。

新增 API Route 的顺序：`withApiLogging('<route-name>', handler)` 导出 → `getSessionUser()`，未登录 401 → Zod 校验路径参数与 body → 组织资源先 `getOrgRole`，非成员 403/404 → 查询带 `orgId` → 返回显式 DTO（不给整行）→ 补 Vitest（401/403/404/成功）。**不要复制 Server Action 的逻辑**，能复用 query 就复用；认证类 handler 数量为 0，不要新增 `/api/auth/*`。

---

## 6. 编码约定

- `strict: true`，避免 `any`，不用 `as` 强行断言未知数据。领域类型从 `lib/db/schema.ts` 的 `$inferSelect` / `$inferInsert` 派生；外部输入（表单、URL、API body）一律 Zod。
- 返回给 UI 的文案一律简体中文，且**不回显密码**；不要把数据库错误、堆栈直接展示给用户。API Route 用明确状态码 + 英文 JSON 错误体，内部日志保持英文。
- 表单用 Server Action + `useActionState` / `useTransition`，并加 `noValidate`，让中文 Zod 消息生效。
- 日志用 `logger`（`lib/logger.ts`，结构化 JSON，服务端自动带 `request_id` / `user_id`，API 另带 `duration_ms`）；不要在业务代码散落 `console.log`，不要记录密码、token、身份证、完整住址。
- 默认 Server Component，需要交互才加 `'use client'`。全局 UI 状态库只允许 **zustand**，且只用于谱系工作区 UI 状态（视图、选中、折叠、搜索、筛选、渲染窗口、侧栏宽度，见 `components/lineage/lineage-store.ts`）：**不存数据库实体、不做 persist**，服务端实体仍来自 RSC props + Action。其余场景不引入 Redux/Jotai。
- 样式 Tailwind v4 + shadcn/ui：新基础组件先放 `components/ui/`，控制台布局放 `components/console/`；**不要在页面里写裸色值**（`tests/design-system.test.ts` 会失败），优先用 `components/ui` 与 `lib/ui/status.ts`；不要用大量原子类重造已有组件。
- 重定向只允许同源绝对路径（现有登录逻辑已做）。公开 API 需要限流用 `checkRateLimit`，它是进程内实现，只能当辅助。

---

## 7. 数据规则

| # | 规则 |
|---|---|
| 1 | 组织级查询必须带 `orgId` 并通过 `withOrg` 执行，不能只按子资源 ID 查 |
| 2 | 组织级写操作必须先 `hasPermission()`；事务流程在事务内锁定读复核角色 |
| 3 | 角色是 `owner` / `admin` / `editor` / `viewer`；业务代码检查权限字符串，不要直接比较角色名 |
| 4 | 主键是 UUIDv7；20 位公开 ID 只用于 URL |
| 5 | RLS 是兜底，不是替代品；应用层仍必须按成员关系过滤 |
| 6 | 业务表都有 `deleted_at` 软删，查询默认 `isNull(deletedAt)`，没有回收站 UI；`organization_member` 与 `invite` 硬删除 |
| 7 | 表结构变更走 Drizzle 迁移，不手改数据库；RLS/角色/函数写在 custom migration |
| 8 | 迁移生成后必须人工 review；迁移与业务代码分开提交 |
| 9 | 不要在迁移里夹带数据修复逻辑；迁移必须能在空库一次执行 |
| 10 | 新表若属于组织范围，必须带 `organization_id` 并在所有查询中过滤，且启用 RLS |
| 11 | 公开 ID（slug/ref）查询必须同时按 `userId` 过滤，不能先查后判 |
| 12 | 多步写必须使用单个事务；失败时不能留下半成品数据 |
| 13 | 邮箱只读：不新增改邮箱入口；账号资料更新只改 `name` |
| 14 | 不要绕过唯一约束 / `CHECK` 直接写库；冲突转换为中文 `ActionState` |
| 15 | 不要直接读写 `auth.*`：认证只走 Better Auth（`auth_service` 连接），业务只走 `withOrg`（`app_rw`） |

---

## 8. 禁止清单（含后果）

| 禁止 | 后果 |
|---|---|
| 未经实现计划就做未完成的家谱业务功能（谱文/谱书/分享/回收站等） | 留下半成品；先读目标文档再写计划 |
| 信任客户端传来的 `orgId` / `projectId` / 公开 ID / 角色，或在客户端判角色 | 越权 |
| 只按子资源 ID 或只按公开 ID 查组织级数据 | 跨组织读取 |
| 以为 RLS 可以替代应用层过滤 | 用户看到自己所有组织的数据 |
| 只靠 `proxy.ts` 保护资源 | 它是门禁，不是授权边界；绕过路由直接调 Action 就失效 |
| 只信 Cookie 存在而不查库 | 伪造/过期会话通过 |
| 绕过 Better Auth 直接写 `auth.*`，或新增 `/api/auth/*`、浏览器 auth client | 会话/密码/成员状态不一致，绕过唯一 owner 与活动日志 |
| 混用业务连接与认证连接 | 以 `app_rw` 写 `auth.*` 失败，或绕过 RLS 读业务表 |
| 返回完整用户行 / 整行 `session.user` / 密码哈希，或把 `BETTER_AUTH_SECRET`、密钥读到客户端 | 信息泄露、进入 bundle |
| 存储明文密码 | 泄露即灾难 |
| Server Action 返回值回显密码 | 安全回归测试失败 |
| 页面/组件里写裸色值 | 设计系统测试失败 |
| 在谱系工作区之外引入 zustand，或在 store 里存实体数据 / 做 persist | 数据源与权限仍以服务端为准 |
| 新增后台任务 / 队列 / 定时器 | 当前部署模型没有消费者也没有调度器 |
| 套用目标设计的 `src/modules`、`*.service.ts`、`*.repo.ts` 结构 | 当前目录不是这样 |
| 以为依赖方向规则没生效 | `pnpm check` 已用 Biome `noRestrictedImports` 拦下三条（客户端 import `@/lib/db/*`、`lib/db/**` import `next/*`、`lib/db/queries/**` import Actions），其余靠评审 |
| 按「清理冗余」删 `tsconfig.json` 里的 `strict` / `target` / `allowJs` 等行 | Next 每次构建在**键缺失时**把 `strict: false`、`target: ES2017` 写回，全仓库静默降级且无报错；唯一可删的是被 `verbatimModuleSyntax` 覆盖的 `isolatedModules`，见 [ADR 0012 §2](docs/decisions/0012-typescript7-compiler-flags.md) |
| 把「软删 / 回收站」当成已有能力 | 当前业务删除不可恢复 |
| 直接删组织 / 成员而不确认备份 | 成员与邀请是硬删除，直接清库不可恢复；生产走工单/备份 |
| 只靠应用层判断最后一个 owner | 直接删成员仍可产生无主组织；触发器兜底 + 应用层预检 |
| 依赖内存限流作为安全边界 | 重启清零、多实例失效；生产要换共享存储 |

---

## 9. 提交与评审

**Commit**：`<type>(<scope>): <描述>`，一个 commit 只做一件事，迁移与业务代码分开提交。
`type` = `feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `perf`；`scope` = `auth` / `org` / `project` / `db` / `ui` / `docs` / `ci` / `ts`（编译器与工具链配置）。

**PR 自查**（勾选前须有命令输出为证）：

- [ ] `pnpm check && pnpm typecheck && pnpm test` 全绿；`pnpm arch:check`、`pnpm docs:check --strict` 无 issue
- [ ] 涉及真实 SQL / 约束 / 成员隔离 / 多步事务的改动补了 `pnpm test:integration`，失败路径不留半成品数据
- [ ] CI 的 `test:coverage`、`test:e2e`、`verify:deploy`、迁移漂移检查能通过
- [ ] 新增的组织级查询/写入都带 `orgId` 且做成员校验；公开 ID 查询带 `userId`、非成员 404
- [ ] 没有返回密码哈希或整行用户；新表有已 review 的迁移并已启用 RLS
- [ ] 安全路径有测试（越权、密码回显、限流）
- [ ] 没有把家谱业务页面/写流程做成半成品
- [ ] 文档同步：行为/命令变化 → `setup.md` / `implementation-status.md`（状态只写一处）

**评审顺序**：① 越权（猜 ID 能否访问别的组织）② 信息泄露（整行/密钥/内部错误）③ 认证语义（`getSessionUser()` 是否查库、撤销是否正确）④ 错误处理（401/403/404）⑤ 迁移（可重复、可回滚、影响现有数据）⑥ 命名与风格。

---

## 10. 基础层与部署现状（**不要再次重置**）

基础层已按 [ADR 0001](docs/decisions/0001-foundation-reset.md) 落地，认证已按 [ADR 0007](docs/decisions/0007-self-hosted-better-auth.md) 切换到自托管 Better Auth：UUIDv7、`auth.users/session/account/verification`、Better Auth organization 插件、11 张组织级业务表、业务表软删、复合外键、RLS + `app_rw`/`auth_service`、`withOrg`、4 角色 + 权限字符串、邀请链接（邀请 ID、7 天过期、一次性、禁止邀请 `owner`，旧 pending 会被取消）。实现家谱业务功能时：先读目标文档 → 先写实现计划 → 不要在同一 PR 里混入业务功能与基础层改动 → 更新 [实现状态](docs/implementation-status.md)。

部署：Vercel + 自定义域名 + Neon PostgreSQL 18+；生产驱动已接入（`process.env.VERCEL` 时用 `pg` + `attachDatabasePool`），生产必须提供 `APP_POSTGRES_URL`（`app`）与 `AUTH_POSTGRES_URL`（`auth_runtime`）；本地/CI 用 `postgres.js`，本地 Docker 只跑 PostgreSQL + `next dev`。**本地生产模式已用 `pnpm verify:deploy` 全项验证**；真实 Vercel/Neon 部署仍未执行（无凭据），云端验证入口为 `verify:deploy` 与 external E2E（[部署蓝图](docs/ops-target.md)）。
