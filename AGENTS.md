# 工程协作指南（当前实现）

> **文档状态：当前实现说明** · 最后更新：2026-10-21
> 本文件位于仓库根目录，文件名必须保持 `AGENTS.md`，Agent 会自动将其作为项目指令读取。
> 本文件面向**在当前仓库写代码的人与 AI Agent**。它以现有代码、`package.json` 和 CI 为准。
> 家谱目标设计是另一套未实现的系统，见 [文档中心](docs/README.md) 与 [实现状态](docs/implementation-status.md)；不要把目标架构当成现状。

---

## 1. 项目是什么

当前仓库是一个 **Next.js 组织/项目控制台** 的改造版：

- 组织（organization）→ 项目（project），组织与项目各有独立控制台界面。
- 组织与项目使用 20 位公开 ID（`organizations.slug`、`projects.ref`）作为 URL；数字主键仅内部使用。
- 用户登录、组织成员管理、邀请记录、活动日志。
- 注册、创建组织、移除成员、删除账号等多步写操作在单个数据库事务内完成；失败不会留下半成品数据。
- 界面全部为简体中文，品牌“云谱”，不引入 i18n 框架。
- 营销首页、登录/注册、控制台界面。

它**还不是**家谱编纂产品。以下目标能力尚未实现：

- 谱系、人丁、世次、字辈。
- 谱文、富文本编辑。
- 谱书、编目。
- 分类树（folder）。
- 目标设计的 RLS、数据库触发器、`auth` schema 与家谱表。
- 软删、回收站、编辑锁。

如果任务要求实现目标能力，先读 [PRD](docs/prd.md)、[架构](docs/architect.md)、[数据模型](docs/data-model.md)、[接口](docs/api.md)，并先做迁移与实现计划；不要直接套用目标文档里的目录、表名和命令。

技术形态：

| 项 | 当前值 |
|---|---|
| 框架 | Next.js 16.4 App Router + React 19.1 |
| 语言 | TypeScript（`strict: true`） |
| 数据库 | PostgreSQL + Drizzle ORM（本地/CI `postgres.js`；Vercel 环境 `pg` + `attachDatabasePool`） |
| 认证 | bcrypt + JWT HS256 Cookie |
| 界面 | 简体中文（品牌“云谱”），无 i18n 框架 |
| 检查/格式化 | Biome |
| 测试 | Vitest：单测 7 文件/39 用例；真实 PostgreSQL 集成测试 8 文件/61 用例 |

---

## 2. 开工前必读

| 你要做的事 | 先读 |
|---|---|
| 任何事 | 本文件 + [实现状态](docs/implementation-status.md) |
| 本地跑起来 / 配环境 | [setup.md](docs/setup.md) |
| 改表 / 加迁移 | `lib/db/schema.ts`、`lib/db/migrations/`；目标表结构见 [data-model.md](docs/data-model.md)，但注意它尚未实现 |
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
pnpm db:setup       # 交互式创建 .env / 本地 Postgres
pnpm db:seed        # 灌入演示数据（非幂等）
pnpm db:backfill-ids        # 回填缺失的 20 位 slug/ref（幂等）
pnpm db:migrate:until <tag> # 只执行到指定迁移（两阶段升级用）
pnpm db:generate    # 生成迁移 SQL，必须人工 review
pnpm db:migrate     # 执行迁移
pnpm db:studio      # Drizzle Studio
```

提交前必须全绿：

```bash
pnpm check && pnpm typecheck && pnpm test
```

CI 还会额外执行 `pnpm test:integration`（连接 `postgres:18` 服务）与迁移漂移检查，最后执行 `pnpm build`。

**不存在的命令**：`pnpm test:e2e`、`pnpm db:reset`、ESLint、dependency-cruiser。当前没有 Playwright/E2E。

---

## 4. 目录与命名

```
app/
├── (marketing)/              # / 首页
├── (login)/                  # /sign-in、/sign-up
├── (dashboard)/dashboard/    # 登录后控制台
│   ├── (account)/            # /dashboard、general、security、activity（无 org scope）
│   ├── org/[orgSlug]/        # projects、team、settings
│   └── project/[projectRef]/ # overview、lineages、articles、books、settings
└── api/
    ├── health/
    ├── orgs/
    ├── orgs/[orgId]/projects/
    └── user/
components/
├── console/                  # 控制台框架、导航、组织/项目选择器、scope context、路由错误边界
├── org/                      # 组织成员/设置
├── project/                  # 项目设置/工作区
├── marketing/                # 营销页组件
└── ui/                       # shadcn/ui 基础组件
lib/
├── auth/                     # session、context（请求级会话/scope）、permissions、rate-limit、schema、actions
├── db/
│   ├── queries/              # 按领域拆分的查询：users、organizations、invitations、projects、activity
│   ├── services.ts           # 多步事务流程
│   ├── schema.ts             # Drizzle schema
│   ├── drizzle.ts            # 连接单例（本地 postgres.js / Vercel pg）
│   ├── errors.ts             # PG 错误码识别
│   └── migrations/           # drizzle-kit 迁移
├── org/actions.ts            # 组织相关 Server Action
├── project/actions.ts        # 项目相关 Server Action
├── server/request-context.ts # AsyncLocalStorage 请求日志上下文
├── api.ts                    # Route Handler 日志/request_id/500 包装
├── config.ts                 # Zod 环境变量校验
├── errors.ts                 # ActionState 错误码构造
├── ids.ts                    # 20 位公开 ID 生成与校验
├── logger.ts
├── fetcher.ts
├── utils.ts
└── ui/status.ts
hooks/
tests/                        # Vitest 单测 + 真实 PostgreSQL 集成测试
instrumentation.ts            # 启动时校验配置并注册日志上下文
proxy.ts                      # Next 16 路由门禁
```

| 对象 | 规则 | 示例 |
|---|---|---|
| 文件 | `kebab-case` | `rate-limit.ts` |
| React 组件文件 | `PascalCase.tsx` 或 `kebab-case.tsx`（现有两种并存） | `members-panel.tsx`、`Button.tsx` |
| 函数 / 变量 | `camelCase` | `checkOrgRole` |
| 类型 | `PascalCase`，不加 `I` 前缀 | `ActionState` |
| 常量 | `SCREAMING_SNAKE` | `ROLE_LEVEL` |
| 数据库列 | `snake_case` | `org_id`、`password_hash` |

不要为了“以后可能用到”提前拆 `service/repo/module` 目录；当前代码以页面、Action、查询函数为主。

---

## 5. 当前架构与数据流

### 5.1 读

- 页面默认是 Server Component，直接在服务端调用 `lib/db/queries/<domain>.ts`。
- 客户端组件只接收已序列化的 props；不要在客户端直接查库。
- 组织/项目布局用 `requireOrgContext(orgSlug)` / `requireProjectContext(projectRef)` 解析 scope：内部先 `getSessionUser()`，再用 `getOrgWithRoleBySlug` / `getProjectScopeByRef` 同时按当前用户过滤，失败 `notFound()`。`getSessionUser` 与两个 context helper 用 React `cache()` 做请求级记忆化。
- 页面需要 scope 时调用 `getOrgContext` / `getProjectContext`（返回 `null`）或 `require*Context`（404/重定向）；**不要再自行 `getSessionUser()` + 查询 scope**。
- 页面内的数据查询仍按数字 `orgId` 过滤；scope 里的 `id` 来自服务端校验过的成员关系。

### 5.2 写

- 写操作使用 Server Action，放在 `lib/<domain>/actions.ts`。
- 入参用 Zod 校验；当前 schema 集中在 `lib/auth/schemas.ts`（名字是历史原因，包含 org/project 等 schema）。
- 用 `validatedAction` 或 `validatedActionWithUser` 包装：

```typescript
export const renameOrgAction = validatedActionWithUser(
  renameOrgSchema,
  async (data, _, user) => {
    const denied = await checkOrgRole(user.id, data.orgId, 'owner');
    if (denied) return { error: denied };

    const updated = await renameOrg(data.orgId, data.name);
    if (!updated) return { error: '组织不存在' };

    await logActivity(data.orgId, user.id, ActivityType.RENAME_ORG);
    revalidatePath(`/dashboard/org/${updated.slug}`, 'layout');
    return { success: '组织名称已更新' };
  }
);
```

- 多步写操作（注册、建组织、移除成员、删号）放在 `lib/db/services.ts`，整个流程使用一个 `db.transaction`；不要在 Action 里串联多个独立写操作。事务内的权限判断必须用锁定读（`FOR UPDATE`）重新校验，不能只依赖事务外的 `checkOrgRole`。
- 返回 `{ error }` / `{ success }` 等 `ActionState` 字段，不把异常堆栈抛给 UI。新代码的错误可带稳定 `code`（见 `lib/errors.ts` 的 `actionError()`）。
- 返回给 UI 的文案一律使用简体中文；内部日志、API JSON 错误保持英文。
- 写成功后按需 `revalidatePath`；组织级变化用 `/dashboard` layout 或 `/dashboard/org/${slug}`，项目设置用 `/dashboard/project/${ref}`。
- 涉及组织/项目/成员的写操作，**必须在服务端做成员/角色校验**，不能只靠按钮禁用或 URL 里的公开 ID。

### 5.3 认证与会话

```
proxy.ts（路由门禁，验证 JWT 签名/过期）
   ↓
getSessionUser()（权威校验：查库比对 token_version + deleted_at，按请求缓存）
   ↓
页面 / Action / API Route 内的组织成员校验
```

- `proxy.ts` 不是授权边界；不要只靠它保护资源。
- `getSessionUser()` 返回完整 `users` 行；**不要直接 `Response.json(user)`**。对外出口（API、SWR fallback、客户端组件 props）只传 `SessionUser`，即 `{ id, name, email }`。
- 修改密码、删除账号会递增 `token_version`，旧 Cookie 自动失效；改密成功后会用新版本重签当前设备。
- 修改邮箱必须验证当前密码，邮箱归一化为小写后写入；重复邮箱转换为中文冲突提示。
- 账号区布局 `app/(dashboard)/dashboard/(account)/layout.tsx` 统一 `requireUser()`（内部 `redirect('/sign-in')`）；账号页不要各自猜认证状态。
- 不要使用 `getSession()` 之类的“只读 Cookie”方案做鉴权。
- Cookie 使用 `Secure`；本地开发请使用 `http://localhost:3000`，不要用 IP/非 localhost 域名。

### 5.4 组织隔离

- 当前**没有 RLS**，隔离完全靠应用层。
- 每个组织级查询都必须带 `org_id`/`orgId` 条件：

```typescript
// ✅
getProjectById(projectId, orgId);

// ❌ 仅按 projectId 查，随后再判断
getProjectById(projectId);
```

- URL 里的 `[orgSlug]` / `[projectRef]` 是 20 位公开 ID；`requireOrgContext` / `requireProjectContext` 先用 `isPublicId()` 校验格式，再用 `getOrgWithRoleBySlug` / `getProjectScopeByRef` 同时按当前用户过滤。非成员、不存在的 ID 一律 404。
- 公开 ID 不是授权凭证：能猜到 slug/ref 不等于能访问，解析查询必须带 `userId`。
- Server Action 的入参仍是数字 `orgId` / `projectId`，来自服务端 scope，不要新增按公开 ID 写入的入口。
- 不要信任客户端传来的角色；角色只从数据库成员关系读取。

### 5.5 数据访问

- 查询集中在 `lib/db/queries/<domain>.ts`（users、organizations、invitations、projects、activity）；不要在页面里拼 SQL。
- 使用 Drizzle；迁移由 `drizzle-kit generate` 生成。
- 当前 ID 是 `serial` 整数主键 + 20 位公开 `slug`/`ref`，不是 UUIDv7。
- 公开 ID 由 `lib/ids.ts` 的 `generatePublicId()` 生成，插入时依赖唯一索引；项目创建遇到 slug/ref 冲突时每次重试重新生成，最多尝试 5 次。
- `0006` 起数据库已约束成员 `(org_id, user_id)` 唯一、角色/状态 `CHECK`、待处理邀请 `(org_id, lower(email))` 部分唯一；捕获 `23505`/`23514` 时转换为中文提示，不要吞掉或重试成重复数据。
- 当前只有 `users.deleted_at`；业务表**没有**软删。不要假设删除可恢复。
- 当前没有 `withOrg`、`app_rw`、RLS claims。

### 5.6 API Route

当前 4 个 Route Handler：

| 路由 | 说明 |
|---|---|
| `GET /api/health` | 数据库 `SELECT 1`；健康 200、不可用 503；不要求登录 |
| `GET /api/orgs` | 当前用户的组织列表，DTO 为 `{ id, name, slug, role }` |
| `GET /api/orgs/[orgId]/projects` | 组织内项目列表，先校验成员；DTO 为 `{ id, name, ref, status }` |
| `GET /api/user` | 当前用户，DTO 为 `{ id, name, email }` |

三个业务路由未登录时都返回 `401 { error: 'Unauthorized' }`；`lib/fetcher.ts` 对非 2xx 抛错，错误对象带 `status`。所有路由用 `withApiLogging()` 包装：生成/透传 `x-request-id`、记录 `duration_ms`、异常返回 JSON 500。客户端退出登录时要同时清空 `/api/user` 的 SWR 缓存。

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
- 不引入 Redux/Zustand/Jotai 等全局状态库。
- 设计令牌与状态样式：不要在页面里写裸色值（`tests/design-system.test.ts` 会检查）；优先用 `components/ui` 与 `lib/ui/status.ts`。

### 6.5 样式

- Tailwind v4 + shadcn/ui。
- 新基础组件先放 `components/ui/`。
- 控制台布局用 `components/console/`。
- 不要在页面里用大量原子类重新实现已有组件。

### 6.6 安全

- 密码只存 bcrypt 哈希。
- 不把 `password_hash`、`AUTH_SECRET` 传给客户端。
- 重定向只允许同源绝对路径（现有登录逻辑已做）。
- 公开 API 需要限流时用 `checkRateLimit`，并注意它是进程内实现。

---

## 7. 数据规则

| # | 规则 |
|---|---|
| 1 | 组织级查询必须带 `orgId`，不能只按子资源 ID 查 |
| 2 | 组织级写操作必须先 `checkOrgRole`/`requireOrgAccess`；事务流程在事务内锁定读重新校验角色 |
| 3 | 角色只有 `owner` / `member`，不要自行添加目标设计中的 admin/editor/viewer |
| 4 | 主键是 `serial` 整数，不是 UUIDv7 |
| 5 | 当前没有 RLS；不要假设数据库会兜底隔离 |
| 6 | 当前只有用户软删；组织/项目/成员删除是硬删除，没有回收站 |
| 7 | 表结构变更走 Drizzle 迁移，不手改数据库 |
| 8 | 迁移生成后必须人工 review；迁移与业务代码分开提交 |
| 9 | 不要在迁移里夹带数据修复逻辑；另写可重复执行的脚本（公开 ID 回填见 `lib/db/backfill-public-ids.ts`） |
| 10 | 新表如果属于组织范围，必须带 `org_id` 并在所有查询中过滤 |
| 11 | 公开 ID（slug/ref）查询必须同时按 `userId` 过滤，不能先查后判 |
| 12 | 多步写必须使用单个事务；失败时不能留下半成品数据 |
| 13 | 修改邮箱必须验证当前密码，并在写入前归一化邮箱 |
| 14 | 不要绕过唯一约束/`CHECK` 直接写库；冲突转换为中文 `ActionState` |

### 7.1 加一张表的顺序

```text
1. lib/db/schema.ts 增加 Drizzle 定义
2. pnpm db:generate → 人工 review SQL
3. pnpm db:migrate
4. lib/db/queries/<domain>.ts 增加带 orgId 的查询
5. 更新 setup.md / implementation-status.md 的当前状态
6. 需要时补 Vitest 覆盖组织隔离；涉及真实 SQL、约束或事务的行为放进 `tests/integration`
```

---

## 8. 禁止清单

| # | 禁止 | 原因 |
|---|---|---|
| 1 | 直接实现家谱目标功能（谱系/谱文/谱书/RLS） | 尚未迁移，避免半成品和不一致模型 |
| 2 | 信任客户端传来的 `orgId` / `projectId` / 公开 ID / 角色 | 越权 |
| 3 | 返回完整用户行或 `password_hash` | 信息泄露 |
| 4 | 存储明文密码 | 泄露即灾难 |
| 5 | 只靠 `proxy.ts` 做授权 | 它只是门禁 |
| 6 | 在客户端组件读取服务端密钥 | 进入 bundle |
| 7 | 引入全局状态库 | 当前架构不需要 |
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
4. 校验用户与组织角色（checkOrgRole）
5. 单步 CRUD 调 lib/db/queries/<domain>.ts；多步写放进 lib/db/services.ts 的单个 db.transaction，并在事务内锁定读重新校验权限
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
4. 数据查询必须带数字 orgId
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
1. 先读 lib/auth/session.ts 与 lib/auth/context.ts 的 getSessionUser()
2. 注意 tokenVersion 撤销语义
3. 修改密码/删除账号必须递增 tokenVersion；改密后重签当前设备
4. 删除账号要清理该用户的全部组织成员关系，并阻止删除唯一 owner 的组织归属
5. 更新/新增 tests/session.test.ts、security-regressions.test.ts 或 tests/integration
6. 不要在 proxy.ts 里做需要数据库的校验
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
- [ ] CI 的 `pnpm test:integration` 与迁移漂移检查能通过
- [ ] 新增的组织级查询/写入都带 `orgId` 且做了成员校验
- [ ] 公开 ID 查询带 `userId` 过滤，非成员返回 404
- [ ] 没有返回 `password_hash`
- [ ] 新增/修改表有迁移，迁移已人工 review
- [ ] 没有引入目标架构的半成品（RLS、谱系表、新角色等）
- [ ] 安全相关路径有测试（越权、密码回显、限流）
- [ ] 文档同步：行为/命令变化 → `setup.md` / `implementation-status.md`

### 10.3 评审关注顺序

1. **越权**：能否通过猜 ID 访问别的组织。
2. **信息泄露**：是否返回了整行用户/密钥/内部错误。
3. **认证语义**：`getSessionUser()` 是否是权威校验；tokenVersion 是否正确。
4. **错误处理**：401/403/404 是否合理。
5. **迁移**：是否可重复、可回滚、是否影响现有数据。
6. 命名与风格。

---

## 11. 陷阱

| # | 陷阱 | 现象 | 正确做法 |
|---|---|---|---|
| 1 | 只靠 `proxy.ts` 保护 | 绕过路由直接调 Action/API | 每个入口都 `getSessionUser()` + 成员校验 |
| 2 | 按子资源 ID 直接查 | 跨组织读取 | 查询同时带 `orgId` |
| 3 | 返回整行 `user` | `password_hash` 泄露 | 显式 DTO |
| 4 | 只读 Cookie 做鉴权 | 伪造/过期 token 通过 | `getSessionUser()` 查库 |
| 5 | 忘记 `tokenVersion` | 改密后旧会话仍有效 | 改密/删号递增版本 |
| 6 | 在客户端判断角色 | 改前端即可越权 | 服务端 `checkOrgRole` |
| 7 | 依赖内存限流做安全边界 | 重启清零、多实例失效 | 视为辅助；生产换共享存储 |
| 8 | 重复执行 `db:seed` | 邮箱唯一约束报错 | 重置本地库或使用已有账号 |
| 9 | 把 `.env` 改成 `.env.local` | 变量读不到 | 当前 dotenv 读取 `.env` |
| 10 | 在页面写裸色值 | 设计系统测试失败 | 用 token/组件 |
| 11 | 在 Server Action 回显密码 | 安全回归测试失败 | 不在 `ActionState` 放密码 |
| 12 | 删除组织/成员无备份 | 硬删除不可恢复 | 操作前确认；生产走工单/备份 |
| 13 | 以为已有 RLS/软删 | 实际没有，误删即丢失 | 以当前 schema 为准 |
| 14 | 只按公开 ID 查组织/项目 | 猜到 slug/ref 即可跨组织读取 | 查询同时带 `userId`，失败一律 404 |
| 15 | 注册/建组织/移除成员拆成多个独立写操作 | 中途失败留下孤儿用户或无成员组织 | 放进 `lib/db/services.ts` 的单个事务 |
| 16 | 修改邮箱不归一化、不验当前密码 | 大写邮箱无法登录、账号可被接管 | 复用 `normalizedEmail` 并要求当前密码 |
| 17 | 只靠应用层判断最后一个 owner | 绕过服务层直接写库仍可产生无主组织 | 事务内锁定校验；未来补数据库约束 |

---

## 12. 目标架构（只读，不要直接实现）

以下内容描述未来家谱 M1 的目标设计，当前代码**没有实现**：

- 目录与分层：`src/modules`、`service/repo`、`withOrg`，用 Biome `noRestrictedImports` 约束。
- 数据隔离：PostgreSQL RLS + `app_rw` + 复合外键。
- 数据模型：UUIDv7（数据库生成）、ltree、软删、10 张业务表 + `auth.users`；不建审计表，关键动作写结构化日志。
- 接口：RSC + Server Action + `/api/health`。
- 部署：Vercel + 自定义域名 + Neon PostgreSQL 18+；生产驱动已接入（`process.env.VERCEL` 时用 `pg` + `attachDatabasePool`），但尚未做真实 Vercel/Neon 部署验证；本地/CI 用 `postgres.js`；本地 Docker 只跑 PostgreSQL + `next dev`（[部署蓝图](docs/ops-target.md)）。

需要实现时：

1. 先读 [PRD](docs/prd.md) / [架构](docs/architect.md) / [数据模型](docs/data-model.md) / [接口](docs/api.md)。
2. 先写迁移与实现计划，确认现有数据如何迁移。
3. 不要在同一 PR 里混入目标功能与当前功能修复。
4. 更新 [实现状态](docs/implementation-status.md)。
