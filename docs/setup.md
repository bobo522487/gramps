# 环境与部署（当前实现）

| 项 | 值 |
|---|---|
| 文档状态 | **当前实现说明**，以仓库代码与 `package.json` 为准 |
| 最后更新 | 2026-10-25 |
| 运行环境 | Node.js 24 LTS（CI）· pnpm 12（CI） |
| 依赖服务 | PostgreSQL 18 |
| 相关文档 | [文档中心](./README.md) · [实现状态](./implementation-status.md) · [工程协作](../AGENTS.md) · [ADR 0001](./decisions/0001-foundation-reset.md) · [ADR 0007](./decisions/0007-self-hosted-better-auth.md) · [目标部署蓝图](./ops-target.md) |

> 基础层已按 [ADR 0001](./decisions/0001-foundation-reset.md) 重置：PostgreSQL 18 + UUIDv7 + RLS（`app_rw`）+ 4 角色 + 软删。认证已按 [ADR 0007](./decisions/0007-self-hosted-better-auth.md) 切换到**自托管 Better Auth**：`auth` schema 下的 `users`/`session`/`account`/`verification`、数据库会话、organization 插件负责组织/成员/邀请，运行时拆成 `app` 与 `auth_runtime` 两个登录角色。谱系/人丁的画布、世系表、检查器与写流程已实现；谱文、谱书、分享、回收站尚未实现。生产预期部署到 Vercel + 自定义域名 + Neon，本地 Docker 只跑 PostgreSQL、应用用 `next dev`；本地生产模式已用 `verify-deployment` 验证，真实 Vercel/Neon 部署尚未验证。目标设计不包含支付；当前实现也已移除 Stripe、套餐、计费与订阅。目标蓝图见 [ops-target.md](./ops-target.md)。

---

## 1. 前置条件

| 依赖 | 版本 | 校验 | 是否必需 |
|---|---|---|---|
| Node.js | 24.x LTS | `node -v` | 必需 |
| pnpm | 12.x | `pnpm -v` | 必需 |
| Docker | 24+ | `docker -v` | 使用本地 Postgres 时必需 |
| Git | 2.40+ | `git --version` | 必需 |

可以用 `corepack enable && corepack prepare pnpm@12.15.0 --activate` 固定 pnpm 版本。

项目通过 `package.json` 的 `packageManager`（`pnpm@12.15.0`）与 `engines`（`node >=24.0.0 <25`、`pnpm >=12.0.0 <13`）固定工具链；`.nvmrc` 记录 Node `24.22.1`。以 CI（Node 24 / pnpm 12）为准。

pnpm 12 从 `pnpm-workspace.yaml` 读取 `allowBuilds` 白名单（当前放行 `@tailwindcss/oxide` 与 `esbuild`）；`onlyBuiltDependencies` 已在 pnpm 11 删除，不要恢复。

---

## 2. 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 交互式初始化：创建 .env、docker-compose.yml、本地 Postgres、BETTER_AUTH_SECRET
pnpm db:setup

# 3. 执行数据库迁移
pnpm db:migrate

# 4. 灌入本地演示数据（可选）
pnpm db:seed

# 5. 启动开发服务器
pnpm dev
```

打开 http://localhost:3000。

> 如果本地库是 Phase 3 之前的旧结构（`users`/`organizations`/`projects` 等）或仍带旧认证数据，基线或 `0003_better_auth` 会冲突。先按 §4.4 清空 `public`/`auth`/`drizzle` schema，再执行迁移；本地演示数据会丢失，这是 ADR 0001/0007 的预期代价。

### 2.1 `pnpm db:setup` 会做什么

`lib/db/setup.ts` 是一个交互式脚本：

1. 询问使用本地 Docker Postgres 还是远程 Postgres。
   - 本地：创建 `docker-compose.yml`，启动 `postgres:18-alpine`，端口 `54322`。
   - 远程：要求输入 `POSTGRES_URL`。
2. 生成随机 `BETTER_AUTH_SECRET`（32 字节十六进制）。
3. 写入项目根目录的 `.env`，包含 `POSTGRES_URL`、`BETTER_AUTH_SECRET`、`BETTER_AUTH_URL=http://localhost:3000`。

**注意：生成的是 `.env`，不是 `.env.local`。** 当前代码通过 `dotenv` 读取 `.env`，不要改成 `.env.local` 而不改代码。

也可以手动创建 `.env`（参考 `.env.example`），至少需要 `POSTGRES_URL`、`BETTER_AUTH_SECRET` 与 `BETTER_AUTH_URL`。

---

## 3. 环境变量

| 变量 | 必填 | 示例 | 说明 |
|---|:--:|---|---|
| `POSTGRES_URL` | ✅ | `postgres://postgres:postgres@localhost:54322/postgres` | 数据库连接串，必须是 `postgres://` 或 `postgresql://`；本地/CI 同时作为业务与认证连接的兜底 |
| `BETTER_AUTH_SECRET` | ✅ | `openssl rand -hex 32` 生成 | Better Auth 签名/加密密钥，至少 32 字符；轮换会使所有会话失效 |
| `BETTER_AUTH_URL` | ✅ | `http://localhost:3000` | 应用对外绝对 URL；决定 Cookie 与邀请链接的基址 |
| `APP_POSTGRES_URL` | Vercel 必填 | `postgresql://app:...@host/db` | 业务查询连接，登录角色 `app`（仅 `GRANT app_rw`）。未设置时回退 `POSTGRES_URL`；可使用 Neon pooled endpoint |
| `AUTH_POSTGRES_URL` | Vercel 必填 | `postgresql://auth_runtime:...@host/db` | 认证连接，登录角色 `auth_runtime`（仅 `GRANT auth_service`）。未设置时回退 `POSTGRES_URL`；必须使用 Neon **direct（unpooled）** endpoint |
| `TEST_POSTGRES_URL` | — | `postgres://postgres:postgres@localhost:54322/gramps_test` | 集成测试、覆盖率与 E2E 专用库；名称必须以 `_test` 结尾。未设置时回退到 `POSTGRES_URL`，同样要求库名以 `_test` 结尾 |
| `POSTGRES_URL_DIRECT` | — | Neon Direct connection | 迁移/运维直连地址；`drizzle.config.ts` 优先使用它，未设置时回退到 `POSTGRES_URL` |
| `LOG_LEVEL` | — | `debug` / `info` / `warn` / `error` | 默认开发 `debug`、生产 `info` |
| `NODE_ENV` | — | `development` / `production` | Next.js 与日志默认级别使用 |

`POSTGRES_URL_NON_POOLING` 是 Neon 原生变量名；`verify:deploy` 在未设置 `POSTGRES_URL_DIRECT` 时会读取它作为直连地址。

### 3.1 手动初始化示例

```bash
cp .env.example .env
# 编辑 .env：
# POSTGRES_URL=postgres://postgres:postgres@localhost:54322/postgres
# BETTER_AUTH_SECRET=$(openssl rand -hex 32)
# BETTER_AUTH_URL=http://localhost:3000
```

### 3.2 配置校验方式

`lib/config.ts` 用 Zod 校验 `POSTGRES_URL`、`BETTER_AUTH_SECRET`（≥32 字符）、`BETTER_AUTH_URL`（合法 URL）、`LOG_LEVEL`，并缓存校验结果。

- 服务启动时 `instrumentation.ts` 调用 `getServerConfig()`；配置缺失或非法会记录错误并阻止启动（`next build` 阶段跳过）。
- 在 Vercel（`process.env.VERCEL` 存在）上，`APP_POSTGRES_URL` 与 `AUTH_POSTGRES_URL` 也变为必填，避免两个运行时意外共用表属主连接。
- `lib/db/drizzle.ts` 与 `lib/db/auth-db.ts` 都通过 `getServerConfig()` 读取连接串；测试与脚本在首次查询前设置环境变量即可。
- 校验结果在进程内只算一次：进程起来之后再改 `process.env` 不会生效，需要另一套配置的测试应起独立进程（没有清除缓存的测试钩子）。

### 3.3 数据库驱动与连接池

代码里有**两个连接池**，用途和角色不同：

- `lib/db/drizzle.ts`：业务查询，读取 `APP_POSTGRES_URL ?? POSTGRES_URL`。本地/CI 用 `postgres.js`；Vercel 用 `pg` Pool + `attachDatabasePool`。
- `lib/db/auth-db.ts`：Better Auth 与认证读写，读取 `AUTH_POSTGRES_URL ?? POSTGRES_URL`。连接建立时通过启动参数 `options: '-c role=auth_service'` 固定以 `auth_service` 身份执行。**该连接必须使用 direct（unpooled）endpoint**：Neon pooler 会以 `08P01 unsupported startup parameter in options: role` 拒绝启动参数；`lib/config.ts` 在启动时校验主机名，含 `-pooler.` 直接报配置错误。
- 两条路径共用同一套 Drizzle schema 与查询代码；Vercel 分支尚未在真实部署中验证。
- 业务代码**不要**导入 `lib/db/auth-db.ts`，也不要直接查询 `auth.*` 表。

---

## 4. 数据库

### 4.1 当前模型

Schema 定义在 `lib/db/schema/`（每张表一个文件，`index.ts` 汇总导出），迁移在 `lib/db/migrations/`；迁移编号与顺序以 `lib/db/migrations/meta/_journal.json` 为准，本文不抄。

| 表 | 用途 |
|---|---|
| `auth.users` | Better Auth 账号（邮箱、姓名、`email_verified`）；`app_rw` 无表权限 |
| `auth.session` | 数据库会话（token、过期时间、IP、UA）；7 天过期、`updateAge` 1 天 |
| `auth.account` | 密码凭据（scrypt 哈希）与第三方账号占位；业务代码从不读取 |
| `auth.verification` | Better Auth 验证记录；当前未启用邮箱验证/找回 |
| `organization` | 组织；`slug` 为 20 位公开 ID；`deleted_at` 表示归档 |
| `organization_member` | 用户与组织的关系、角色；活动行唯一、单组织最多一个 `owner`；硬删除 |
| `invite` | Better Auth 邀请；`id` 即邀请链接参数，7 天过期、一次性；硬删除 |
| `project` | 云谱空间；`ref` 为 20 位公开 ID；目标字段（姓氏/郡望/地区） |
| `folder` / `lineage` / `node` | 分类、谱系与人丁；已接入左侧谱系管理、画布、世系表、检查器与写流程 |
| `article` / `book` / `book_catalog` | 谱文/谱书表；已建表与 RLS，尚无页面/Action |
| `activity_logs` | 产品活动流；账号级事件的 `organization_id` 为空 |

- 全部主键是 UUIDv7（`uuidv7()`），20 位公开 ID 只用于 URL，不参与外键。
- `organization_member` 与 `invite` 不再保留软删列，成员移除/邀请取消即删除行；`organization` 用 `deleted_at` 归档；`project` 与 6 张家谱表保留 `deleted_at` 软删。`activity_logs` 是产品活动流，没有软删列。
- `organization.slug` 与 `project.ref` 是 `text`（20 位公开 ID）、非空、唯一，字符集 `[0-9a-z]`。
- 复合外键把子资源的 `(organization_id, project_id)` 约束在同一个组织内。
- 活动成员 `(organization_id, user_id)` 唯一；`uk_org_member_single_owner` 保证单组织最多一个 `owner`；触发器在数据库层阻止移除/降级最后一个 owner。
- 邀请 `(organization_id, lower(email))` 在待处理状态下唯一；角色只能是 `admin`/`editor`/`viewer`。
- `auth.users` 的活动邮箱唯一。
- `0000_baseline` 由 Drizzle 生成；`0001_auth_rls` 包含 `app_rw`、`auth` 函数、注册触发器、GRANT、RLS 策略、`ltree`/`pg_trgm`/`btree_gist` 与 GIN/GiST 索引。
- `0002_app_role_grant` 仅当登录角色 `app` 存在时执行 `GRANT app_rw TO app`。
- `0003_better_auth` 是 custom migration：在空认证/租户数据上前提下创建 `auth_service`、新 auth 表、租户读写策略与触发器，并清理旧认证函数。若 `auth.users` 或 `organization` 已有数据，它会**拒绝执行**。

数据库层角色：

| 角色 | 登录 | 权限 |
|---|:--:|---|
| `app_rw` | 否 | 业务表读写（无 `DELETE`）、RLS 隔离；无 `auth.*`、组织/成员/邀请写权限 |
| `auth_service` | 否 | `auth.*` 读写、组织/成员/邀请写入、`SECURITY DEFINER` 函数属主 |
| `app` | 是 | 仅 `GRANT app_rw`；业务运行时登录角色 |
| `auth_runtime` | 是 | 仅 `GRANT auth_service`；认证运行时登录角色 |

当前数据库**已有**：

- RLS + `FORCE ROW LEVEL SECURITY`，`app_rw` 与 `auth_service` 都 `NOBYPASSRLS`。
- Better Auth 租户触发器：`trg_auth_user_created`（建个人组织与 owner）、`trg_org_member_last_owner_delete` / `_update`、`trg_org_member_active_org`、`trg_invite_active_org`、`trg_org_slug_immutable`。
- 归档函数 `auth.archive_organization()`。
- 谱系/人丁的页面、Server Action 与画布；分类树与左侧谱系管理。
- 软删列与复合外键（租户成员/邀请除外）。

当前数据库**没有**：

- 支付、套餐、订阅相关表或字段。
- 分享页、回收站、编辑锁、审计表。
- 谱文/谱书页面与写流程；人丁自定义字段 UI。
- 邮箱验证、密码找回、改邮箱入口。

### 4.2 迁移命令

```bash
pnpm db:generate   # 根据 schema 生成新的迁移 SQL，必须人工 review
pnpm db:migrate    # 执行全部待执行迁移
pnpm db:studio     # 打开 Drizzle Studio
```

- 空库直接 `pnpm db:migrate`，会依次执行 `0000_baseline`、`0001_auth_rls`、`0002_app_role_grant`、`0003_better_auth`。
- `0001`、`0002`、`0003` 是 custom migration：新增 RLS/角色/触发器时同样手工维护，生成后必须 review。
- `0003_better_auth` 只允许在空认证/租户数据上执行；已有数据必须先重建库（§4.4）。
- 迁移角色需要能创建扩展、角色并执行 `SET ROLE app_rw`；生产把迁移角色与运行角色分开（见 §4.2.1）。
- 迁移里不写数据修复；演示数据由 `pnpm db:seed` 重建。
- 不要修改已应用迁移的 SQL；需要修正时新增迁移。

#### 4.2.1 生产角色分离

- 业务连接（`APP_POSTGRES_URL`）必须使用仅 `GRANT app_rw` 的登录角色 `app`，**不能是表属主或超级用户**；否则 RLS 的兜底会被绕过。
- 认证连接（`AUTH_POSTGRES_URL`）必须使用仅 `GRANT auth_service` 的登录角色 `auth_runtime`，并使用 Neon **direct（unpooled）** endpoint；`lib/db/auth-db.ts` 会在连接启动参数里再固定 `role=auth_service`，pooler 不支持该参数。
- 两个登录角色都不能 `BYPASSRLS`。`app_rw` 与 `auth_service` 由 `0001`/`0003` 创建；登录角色由本地/运维创建，迁移不保存密码。
- `drizzle.config.ts` 优先读取 `POSTGRES_URL_DIRECT`（未设置时回退 `POSTGRES_URL`），生产迁移在独立的受保护 job 中执行，并把该变量指向直连/迁移角色地址。
- 密码只放 Neon/Vercel 环境变量，不写进迁移。

本地验证运行时隔离时，可手工创建两个登录角色（密码仅用于本地）：

```sql
CREATE ROLE app LOGIN PASSWORD '<local-only>' NOBYPASSRLS;
GRANT app_rw TO app;

CREATE ROLE auth_runtime LOGIN PASSWORD '<local-only>' NOBYPASSRLS;
GRANT auth_service TO auth_runtime;
```

然后把连接串交给应用与部署验证：

```bash
APP_POSTGRES_URL=postgres://app:<local-only>@localhost:54322/postgres
AUTH_POSTGRES_URL=postgres://auth_runtime:<local-only>@localhost:54322/postgres
pnpm verify:deploy
```

### 4.3 种子数据

`pnpm db:seed` 通过 Better Auth 注册接口创建演示账号，并在已存在时复用：

| 对象 | 内容 |
|---|---|
| 用户 | `test@test.com` / `admin123` |
| 组织 | 个人组织改名为 `测试组织`，该用户为 `owner` |
| 项目 | `示例云谱`（ref `example0000000000001`）、`支系档案`（ref `branch00000000000001`） |

种子可重复执行：已存在演示账号时复用，项目用 `onConflictDoNothing` 跳过，并在结束时注销自己创建的会话。需要彻底重灌时先重置数据库。

### 4.4 重置本地数据库

Phase 3 基线、`0003_better_auth` 都与旧结构不兼容；`0003` 还要求没有认证/租户数据。仅本地、且使用 `db:setup` 生成的 Docker Postgres 时：

```bash
# 方式一：删除容器与数据卷
docker compose down -v
pnpm db:migrate
pnpm db:seed
```

```bash
# 方式二：保留容器，只清空 schema
psql "$POSTGRES_URL" -c 'drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists drizzle cascade; create schema public;'
pnpm db:migrate
pnpm db:seed
```

这会**永久删除**本地数据，生产环境禁止执行。远程数据库请使用独立实例或手动管理 schema。Neon 上建议直接建新分支或新库，而不是清空共享分支。

---

## 5. 脚本

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 开发服务器（Turbopack） |
| `pnpm build` | 生产构建 |
| `pnpm start` | 启动生产构建 |
| `pnpm db:setup` | 交互式创建 `.env` 与本地 Postgres |
| `pnpm db:seed` | 灌入本地演示数据（幂等，已存在时复用） |
| `pnpm db:generate` | 生成 Drizzle 迁移 SQL |
| `pnpm db:migrate` | 执行迁移 |
| `pnpm db:studio` | 打开 Drizzle Studio |
| `pnpm data:backfill:fact --org <uuid>` | 把 `node` 回填成事实层六张表（单事务，只能人工执行，见下方注意） |
| `pnpm data:reconcile:fact --org <uuid>` | 从 `node` 重算十四项计数并与事实层比较（只读） |
| `pnpm check` | Biome 检查（格式 + lint + import 组织），CI 使用 |
| `pnpm docs:check` | 文档一致性检查：相对链接、锚点、过期路径、矛盾措辞、文档头 |
| `pnpm lint` | 仅 Biome lint |
| `pnpm format` | Biome 格式化 |
| `pnpm fix` | Biome 检查并自动修复 |
| `pnpm typecheck` | `tsc --noEmit`（TypeScript 7 的 Go 原生编译器；实测冷跑 1.36s、增量暖跑 0.43s，账目见 [ADR 0012](decisions/0012-typescript7-compiler-flags.md)） |
| `pnpm test` | Vitest 单测（不连数据库） |
| `pnpm test:unit` | 同 `pnpm test` |
| `pnpm test:integration` | 真实 PostgreSQL 集成测试（需要 `*_test` 数据库） |
| `pnpm test:coverage` | 单测 + 集成测试合并采集 V8 覆盖率，含门槛检查（需要 `*_test` 数据库） |
| `pnpm test:e2e` | Playwright 关键路径 E2E（本地模式会清空 `*_test` 数据库） |
| `pnpm verify:deploy` | 部署验证：HTTP 健康/安全头/鉴权 + 数据库结构/RLS/角色 |

**没有** `db:reset`、ESLint 或 dependency-cruiser 脚本。E2E 通过 Playwright 提供。

**`data:*` 脚本的注意点**：

- 两个脚本都以迁移角色直连（`POSTGRES_URL_DIRECT`），启动时断言 `rolsuper` 或 `rolbypassrls`，否则拒绝运行；它们绕过 RLS 与 `withOrg`，只能由人执行，不能从应用请求里调用。
- 退出码：`0` 成功、`1` 有差异或该组织已回填过、`2` 用法错误、`3` 跑不起来（凭据、缺表、连不上）。
- **回填期间持有 `organization` 行的 `SELECT … FOR UPDATE`（`lib/db/backfill/fact-layer.ts`），直到事务结束**。所以大树回填会挡住该组织的组织级写操作（改名、归档），也是两个并发回填被串行化的原因——这是有意的：宁可排队，也不要两个事务同时写同一批事实层行。回填跑完之前不要在同一组织上做组织级写。

---

## 6. 本地开发

### 6.1 端口

| 服务 | 端口 |
|---|---|
| Next.js | 3000 |
| Postgres（`db:setup` 本地模式） | 54322 |

### 6.2 认证与会话现状

| 项 | 当前行为 |
|---|---|
| 认证组件 | 自托管 Better Auth 1.7.12 + Drizzle 适配器；organization 插件 |
| 登录方式 | 邮箱 + 密码（注册后直接登录，无邮箱确认） |
| 密码存储 | Better Auth 默认 scrypt，哈希在 `auth.account`；业务代码从不读取 |
| 会话 | 数据库会话（`auth.session`），HttpOnly Cookie `better-auth.session_token`，`SameSite=Lax`，生产 `Secure` |
| 有效期 | 7 天过期，`updateAge` 1 天；Cookie 缓存关闭 |
| 权威校验 | `getSessionUser()` 调 `auth.api.getSession()` 读数据库会话；按请求缓存 |
| 请求上下文 | `getOrgContext` / `getProjectContext` 复用会话与成员 scope；公开 ID 失败返回 404 |
| 撤销 | 改密时 `revokeOtherSessions`，其他设备立即失效、当前设备保持登录；删号会删除用户与会话 |
| 修改邮箱 | **未启用**（`user.changeEmail.enabled = false`），账号页没有入口 |
| 角色 | `owner` / `admin` / `editor` / `viewer`，业务代码使用权限字符串 |
| 数据隔离 | 应用层 `orgId` 过滤 + `withOrg` 内 `SET LOCAL ROLE app_rw` 的 RLS + 复合外键；组织/成员/邀请写入由 `auth_service` 承担 |
| 限流 | 进程内滑动窗口：登录 10 次/15 分钟（IP + 邮箱），注册 5 次/小时（IP） |

> Better Auth 不暴露 `/api/auth/*`：登录、注册、登出都走 Server Action 内的 `auth.api.*`。`proxy.ts` 只用 `getSessionCookie()` 做乐观门禁与跳转，不是授权边界；所有 Server Action、RSC 数据读取和 API Route 都必须再走 `getSessionUser()` 与组织成员校验。

### 6.3 界面语言

界面为单一简体中文，品牌“云谱”，不引入 i18n 框架。`app/layout.tsx` 使用 `<html lang="zh-CN">`，`globals.css` 的字体栈包含 `PingFang SC`、`Microsoft YaHei` 等 CJK 系统字体回退。数据库枚举值、角色、区域通过 `lib/ui/status.ts` 集中映射为中文；用户输入、邮箱、IP、`ref` 等技术标识不翻译。API JSON 错误与内部日志保持英文。

---

## 7. 测试与 CI

### 7.1 本地

```bash
pnpm check
pnpm typecheck
pnpm test:unit
```

集成测试、覆盖率与 E2E 使用真实 PostgreSQL。先建一个独立测试库，库名必须以 `_test` 结尾：

```bash
# 使用 db:setup 生成的本地 Docker Postgres
docker compose exec postgres createdb -U postgres gramps_test

# 在 .env 增加（不要指向开发库或生产库）
TEST_POSTGRES_URL=postgres://postgres:postgres@localhost:54322/gramps_test

pnpm test:integration
pnpm test:coverage        # 单测 + 集成，合并 V8 覆盖率
```

E2E 需要 Playwright 浏览器：

```bash
pnpm exec playwright install chromium
pnpm test:e2e             # 本地 dev 模式，端口 3100
CI=1 pnpm test:e2e        # 生产构建模式（先 pnpm build）
```

> **警告**：E2E 本地模式会先对 `TEST_POSTGRES_URL` 指向的库执行 `resetAndMigrate`（删除 `public`/`auth`/`drizzle` schema 与扩展后重新迁移），库名不以 `_test` 结尾会直接拒绝。不要把它指向开发库。
>
> E2E 与集成测试共用同一个 `_test` 库，`workers: 1` 串行执行；不要并行运行两者。
>
> 注册接口限流为 5 次/小时/IP（进程内）。本地重启服务会重置；外部模式连续运行可能触发限流，需要等待窗口或换环境。
>
> Playwright 默认 `reuseExistingServer`：本地若端口 3100 已有手工启动的服务，E2E 会直接复用。跑测试前请停掉带其他数据库配置的旧服务，否则会出现与代码无关的登录/注册失败。

安全护栏：

- 测试 helper 拒绝名称不以 `_test` 结尾的数据库，避免误清开发/生产数据。
- `globalSetup` 会先删除测试库的 `public`/`auth`/`drizzle` schema 与扩展，再从空库执行全部迁移；不要把它指向开发库。
- 每个集成测试用例开始前（`beforeEach`）`TRUNCATE` 业务表与 `auth` 表。
- 集成测试通过 `auth.api.signInEmail({ asResponse: true })` 取得真实会话 Cookie，再驱动需要登录的 Action。
- 测试文件串行执行，避免共享库竞争。

### 7.2 CI

`.github/workflows/ci.yml` 在 push 到 `main` 和 pull request 时运行：

```text
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm test:coverage        # 单测 + 集成 + 覆盖率门槛（postgres:18-alpine，库名 gramps_test）
上传 coverage/             # actions/upload-artifact，if: always()
创建 app / auth_runtime 登录角色并授权（本地 role 由 CI 预置）
pnpm db:generate && git status --porcelain lib/db/migrations  # 漂移检查
pnpm build
pnpm exec playwright install --with-deps chromium
pnpm test:e2e             # CI=1，production server（pnpm start -p 3100）
pnpm start -p 3100 &      # 部署验证：健康检查后执行 verify:deploy
pnpm verify:deploy -- --base-url http://127.0.0.1:3100
上传 playwright-report/ 与 test-results/  # 失败时
```

CI 使用 Node 24、pnpm 12。`postgres:18-alpine` 作为 service 启动，测试从空库执行全部迁移；随后创建 `app` 与 `auth_runtime` 登录角色，让运行期 RLS 与角色断言真正生效。

### 7.3 测试覆盖

单测不连接数据库（另有 `tests/server-only.stub.ts` 作为测试环境 stub）；文件数/用例数以输出为准：

| 文件 | 关注点 |
|---|---|
| `tests/auth-schemas.test.ts` | 邮箱归一化、密码边界、中文校验消息 |
| `tests/auth-schema.test.ts` | Drizzle → Better Auth schema map 的字段映射 |
| `tests/auth-context.test.ts` | `getSessionUser()` 对 Better Auth 会话的收窄与缓存 |
| `tests/auth-errors.test.ts` | Better Auth 错误码到中文文案的映射 |
| `tests/access-control.test.ts` | organization 插件权限声明与角色 |
| `tests/config.test.ts` | 环境变量校验与缓存（含 Vercel 双连接要求） |
| `tests/docs-consistency.test.ts` | ADR 0007 与文档中的认证术语一致性 |
| `tests/request-context.test.ts` | `AsyncLocalStorage` 请求上下文、日志字段注入、并发隔离 |
| `tests/rate-limit.test.ts` | 滑动窗口限流与中文提示 |
| `tests/ids.test.ts` | 20 位公开 ID 的长度/字符集与校验 |
| `tests/fetcher.test.ts` | 非 2xx 响应抛错并保留 `status` |
| `tests/permissions.test.ts` | 4 角色 × 权限矩阵、`isOrgRole` |
| `tests/security-regressions.test.ts` | 密码回显、DTO、公开 ID 成员过滤、`withOrg` 的 `SET LOCAL ROLE`/claims、两个连接池不混用 |
| `tests/design-system.test.ts` | 设计令牌边界、角色中文映射 |
| `tests/lineage-schemas.test.ts` | 谱系/人丁/分类 Zod schema |
| `tests/lineage-store.test.ts` | zustand 工作区 UI 状态 |
| `tests/lineage-canvas-layout.test.ts` | 欧式书本布局与代际索引纯函数 |

集成测试使用真实 PostgreSQL（数量以输出为准）：

| 文件 | 关注点 |
|---|---|
| `tests/integration/migrations.test.ts` | 空库迁移、11 张业务表 + 4 张 auth 表、索引、RLS/`FORCE`、`app_rw` 权限、扩展与函数 |
| `tests/integration/auth-migration.test.ts` | `0003_better_auth` 的空数据 guard、角色/授权、租户触发器与函数 |
| `tests/integration/better-auth.test.ts` | 注册/登录/会话/改密/删号、organization 插件、邀请两段式、最后 owner 保护 |
| `tests/integration/org-scope.test.ts` | 公开 ID 的成员过滤、跨组织读写拒绝、权限矩阵、RLS 无 claims/跨组织拒绝 |
| `tests/integration/constraints.test.ts` | 唯一邮箱/slug/ref、成员唯一、单 owner、角色 `CHECK`、待处理邀请部分唯一、复合外键 |
| `tests/integration/api-auth.test.ts` | 三个业务路由 401、DTO 形状、非法 UUID 404、非成员 403 |
| `tests/integration/health.test.ts` | `/api/health` 数据库探活与 `x-request-id` |
| `tests/integration/projects.test.ts` | 项目创建时 `ref` 冲突后重新生成并重试 |
| `tests/integration/folders-lineages.test.ts` | 分类树与谱系 CRUD、排序、软删、组织隔离 |
| `tests/integration/nodes.test.ts` | 人丁 CRUD、关系、搜索、组织隔离 |
| `tests/integration/queries.test.ts` | 组织级查询：软删过滤、跨组织、排序、搜索转义、账号级活动日志 |

公共 helper 位于 `tests/helpers/`：测试库连接与清理（`db.ts`）、数据库重建与迁移（`db-url.ts` / `db-setup.ts`）、Better Auth 账号/会话/组织工厂（`auth.ts` / `factories.ts`）。

E2E 1 个文件 2 条用例（`tests/e2e/critical-path.spec.ts`）：

1. 关键路径：注册 → 建项目 → 左侧谱系管理（文件夹/谱系） → 录入始祖 → 添子女 → 检查器编辑并持久化 → 侧栏搜索/折叠。
2. 认证路径：邀请 → 登出 → 登录 → 接受邀请。

### 7.4 覆盖率

`pnpm test:coverage` 用 `vitest.coverage.config.ts` 把单测与集成测试合并为一次 V8 覆盖率采集（`text`、`json-summary`、`lcov` 输出到 `coverage/`）。

- 采集范围：`lib/**/*.ts`、`app/api/**/route.ts`、`components/lineage` 的纯逻辑模块与 `canvas/layout/**`。
- 排除：`lib/db/schema/**`、`lib/db/migrations/**`、`lib/db/seed.ts`、`lib/db/drizzle.ts` 与类型声明文件（`**/*.d.ts`）。
- 全局门槛：lines/statements 76、functions 84、branches 65。
- 关键服务层门槛：`lib/db/queries/**` lines/functions 98、`lib/project/services.ts` lines 92 / functions 98、`lib/lineage/node-services.ts` lines 84 / functions 94。
- 当前基线显著高于门槛；门槛按基线下方安全垫设定，不以 `skip` 凑数。

---

## 8. 构建与部署

### 8.1 本地生产构建

```bash
pnpm build
pnpm start
```

### 8.2 部署验证

`scripts/verify-deployment.mjs`（`pnpm verify:deploy`）同时检查 HTTP 与数据库：

```bash
# 本地生产模式：先构建，再启动，再验证
POSTGRES_URL=<test-url> pnpm build
POSTGRES_URL=<test-url> BETTER_AUTH_SECRET=<dev-secret> BETTER_AUTH_URL=http://127.0.0.1:3100 pnpm start -p 3100
node scripts/verify-deployment.mjs --base-url http://127.0.0.1:3100
```

HTTP 检查（未登录）：`/api/health` 返回 200 且 `database: up`；`/api/orgs` 返回 401 且带 `x-request-id`；`/dashboard` 重定向到 `/sign-in`；所有响应带 `nosniff`、`X-Frame-Options: DENY`、`referrer-policy`、`permissions-policy`、`content-security-policy-report-only`，且没有 `x-powered-by`。

数据库检查（`POSTGRES_URL_DIRECT ?? POSTGRES_URL_NON_POOLING ?? POSTGRES_URL`）：PostgreSQL ≥ 18；11 张业务表与 4 张 auth 表存在且启用并强制 RLS；迁移条数与 journal 一致；`app_rw` 与 `auth_service` 存在、非超级用户、不绕过 RLS、不可登录；`auth_service` 拥有身份与租户写入、但不能读业务表；若 `app` / `auth_runtime` 登录角色存在则校验其成员关系。提供 `APP_POSTGRES_URL`（或旧名 `APP_DATABASE_URL`）时额外以运行期角色验证：`current_user`、无 JWT claims 查询组织表返回 0 行、读取 `auth.users` 被拒绝。脚本输出逐项 `PASS`/`FAIL`/`SKIP`，任一失败退出码为 1。

认证用的浏览器 E2E（Playwright）也能打到已部署环境，但需要显式双开关且仅限 staging：

```bash
E2E_ALLOW_EXTERNAL=1 E2E_EXTERNAL_SERVER=1 E2E_BASE_URL=https://<staging> pnpm test:e2e
```

外部模式不清库、不启动本地服务；禁止指向生产。

### 8.3 当前仓库的部署状态

本地生产模式（`pnpm build` + `pnpm start -p 3100`）已用 `verify:deploy` 全项验证通过。真实云端部署尚未执行：

- 本机没有 Vercel/Neon CLI 或凭据，无法在本轮完成真实部署。
- 仓库没有 `output: 'standalone'`、Dockerfile、`public/` 或版本管理的部署 Compose（`db:setup` 生成的 Compose 只用于本地 PostgreSQL）。
- 生产驱动分支（`pg` + `attachDatabasePool`）与 `-c role=auth_service` 启动参数已接入，但未在真实 Vercel 环境验证。
- `POSTGRES_URL_DIRECT` 已接入 `drizzle.config.ts`；`0003_better_auth` 已就绪，`app` 与 `auth_runtime` 登录角色仍需运维先行创建。

目标架构选择 **Vercel + 自定义域名 + Neon**：应用由 Vercel 构建与运行，数据库使用 Neon PostgreSQL 18+，生产驱动为 `pg` Pool + `attachDatabasePool`，本地开发用 `postgres.js`；本地 Docker 只跑 PostgreSQL、应用用 `next dev`。迁移对 Neon 直连执行，不放进 Vercel 构建。开发环境连接 Neon 的独立分支，staging 使用统一分支。完整蓝图见 [ops-target.md](./ops-target.md)。

拿到 staging 凭据后：

```bash
BETTER_AUTH_URL=https://<staging> \
POSTGRES_URL_DIRECT=<neon-direct-url> \
APP_POSTGRES_URL=<app-login-url> \
AUTH_POSTGRES_URL=<auth-runtime-login-url> \
pnpm verify:deploy

E2E_ALLOW_EXTERNAL=1 E2E_EXTERNAL_SERVER=1 E2E_BASE_URL=https://<staging> pnpm test:e2e
```

以上云端命令**本轮未执行**（无凭据），属于交付的可复用验证入口。

### 8.4 生产环境至少需要

- 一个可用的 Postgres（含迁移）。目标设计使用 Neon PostgreSQL 18+。
- `POSTGRES_URL`、`BETTER_AUTH_SECRET`、`BETTER_AUTH_URL`；迁移 job 另需 `POSTGRES_URL_DIRECT`。
- Vercel 上另需 `APP_POSTGRES_URL` 与 `AUTH_POSTGRES_URL`，分别对应 `app` / `auth_runtime` 登录角色。
- 以 `pnpm build` + `pnpm start` 或平台适配方式运行 Next.js；目标设计使用 Vercel。

---

## 9. 故障排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 启动报 `Invalid environment configuration: POSTGRES_URL ...` | 没有 `.env` 或连接串不是 `postgres://`/`postgresql://` | 运行 `pnpm db:setup` 或手动修正 `.env` |
| 启动报 `Invalid environment configuration: BETTER_AUTH_SECRET ...` | 缺少密钥或长度不足 32 | 用 `openssl rand -hex 32` 生成并写入 `.env` |
| 启动报 `Invalid environment configuration: BETTER_AUTH_URL ...` | 缺少 URL 或不是合法绝对地址 | 设置 `BETTER_AUTH_URL=http://localhost:3000`（生产为正式域名） |
| Vercel 启动报缺少 `APP_POSTGRES_URL` / `AUTH_POSTGRES_URL` | 生产强制两个运行时连接分离 | 创建 `app` / `auth_runtime` 登录角色并配置对应变量 |
| 启动报 `AUTH_POSTGRES_URL ... unpooled` | 认证连接指向 Neon pooled endpoint | 把 `AUTH_POSTGRES_URL` 换成 Neon **Direct connection**（主机名不含 `-pooler`）；业务连接仍可用 pooled |
| 注册/登录报 `08P01 unsupported startup parameter in options: role` | 同上，运行期绕过了启动校验 | 检查 `AUTH_POSTGRES_URL` 与回退的 `POSTGRES_URL` 是否含 `-pooler` |
| `pnpm db:setup` 卡在 Docker | Docker 未启动 | 启动 Docker Desktop/daemon |
| `pnpm db:migrate` 连接失败 | 本地 Postgres 未启动、端口不对 | 检查 `docker compose ps` 与 `POSTGRES_URL` 的端口 54322 |
| 迁移报 `0003_better_auth requires an empty auth/tenant dataset` | 库里有旧认证或组织数据 | 按 §4.4 重建本地库；Neon 上新建分支/库 |
| `pnpm db:seed` 报邮箱已存在 | 种子已执行过 | 直接使用已有 `test@test.com`，或重置本地库 |
| 登录后立刻掉线 | Cookie 被清除、域名/Secret 变化、`BETTER_AUTH_SECRET` 改变 | 检查 `BETTER_AUTH_URL`、Cookie 与密钥是否变化 |
| 登录成功但页面仍显示未登录 | 业务与认证连接指向了不同数据库 | 检查 `APP_POSTGRES_URL` 与 `AUTH_POSTGRES_URL` 的库名/分支 |
| 访问 `/dashboard/org/[orgSlug]` 或 `/dashboard/project/[projectRef]` 返回 404 | 当前用户不是成员、公开 ID 不存在或格式非法 | 用该组织成员账号登录；确认 slug/ref 为 20 位 `[0-9a-z]` |
| 组织 API 返回 401 | 未登录或会话已失效 | 重新登录；三个业务 API 未登录统一返回 401 |
| 组织 API 返回 403 / 404 | 非成员、组织 ID 不是合法 UUID 或不存在 | 先确认成员关系；不要绕过 `getOrgRoleInTx` |
| 迁移报 `schema "public" already exists` / 表已存在 | 本地库仍是旧结构 | 按 §4.4 清空 schema 后重新迁移 |
| 迁移报 `permission denied to create extension` | 迁移角色权限不足 | 用数据库所有者/迁移角色执行；生产在独立 job 中运行迁移 |
| 应用查询返回 0 行但数据存在 | 运行时角色是表属主或 RLS claims 未设置 | 生产用 `app`（仅 `GRANT app_rw`）；应用查询走 `withOrg` |
| 认证查询报 `42501` | 认证连接不是 `auth_runtime`/`auth_service`，或缺表权限 | 检查 `AUTH_POSTGRES_URL`；确认 `GRANT auth_service TO auth_runtime` |
| 邀请链接 404 或已过期 | 邀请超过 7 天、已被接受/取消，或重复邀请已取消旧邀请 | 重新发起邀请；链接参数是 `invite.id` |
| 限流很快失效 | 限流是进程内内存实现 | 重启后清零；多实例不共享；生产需替换为共享存储（P1） |
| 集成测试报 `database name must end with "_test"` | `TEST_POSTGRES_URL` 指向了开发库或生产库 | 创建独立 `gramps_test` 库，设置专用 `TEST_POSTGRES_URL` |
| `pnpm test:e2e` 报 `Executable doesn't exist` | 未安装 Playwright 浏览器 | `pnpm exec playwright install chromium` |
| Playwright 报缺少 `libasound.so.2`（WSL/Linux） | 系统缺少 Chromium 运行库 | `pnpm exec playwright install --with-deps chromium`，或安装 `libasound2` |
| E2E 点击无反应、页面未 hydration | 通过 `127.0.0.1` 访问且 Next 16 拦截跨源 dev 资源 | `next.config.ts` 已允许 `allowedDevOrigins: ['127.0.0.1']`；不要删除 |
| E2E 注册失败并提示操作频繁 | 注册限流 5 次/小时/IP（进程内） | 重启本地服务或等待窗口；外部模式换环境 |
| E2E 登录/注册行为与预期不符 | 本地复用了端口 3100 上旧的手工服务 | 停掉旧服务后重跑；CI 不复用 |
| `pnpm test:e2e` 清空了测试库数据 | E2E 本地模式会执行 `resetAndMigrate` | 预期行为；确认 `TEST_POSTGRES_URL` 指向 `*_test` 库 |
| `verify:deploy` 报 `x-powered-by` | 启动的进程不是当前构建 | 重新 `pnpm build` 并用 `pnpm start -p 3100` 启动 |
| `verify:deploy` 运行期 RLS 断言被 SKIP | 未提供 `APP_POSTGRES_URL` | 按 §4.2.1 创建本地 `app` 登录角色并设置该变量 |
| 修改密码后其他设备退出 | `revokeOtherSessions` 生效 | 预期行为；当前设备保持登录，其他设备旧会话失效 |

---

## 10. 当前限制

- 没有邮箱确认、密码找回或持久化账号锁定；改邮箱入口已移除。
- 有 4 角色与权限矩阵，但没有转让所有权；`org.transfer` 尚无 Action/UI。
- 邀请不会发送邮件；需要人工复制链接。邀请 7 天过期、一次性、禁止邀请 `owner`，重复邀请会取消旧的待处理邀请。
- 谱系/人丁已实现画布、世系表、检查器与写流程；谱文、谱书、编目、分类页面、人丁自定义字段 UI 尚未实现。
- 没有回收站、编辑锁、分享页；组织/项目与家谱表保留软删，成员/邀请是硬删除，用户无法自助恢复。
- 最后一个 owner 保护同时存在于服务层与数据库触发器；没有“至少一个 owner”的 INSERT 侧约束。
- RLS 的生产语义依赖运行角色不是表属主、且不是超级用户；本地/CI 已用 `SET LOCAL ROLE app_rw` 与独立登录角色验证，本地生产模式已用 `verify:deploy` 验证。
- 限流为单进程内存实现，不适合多实例生产环境。
- E2E 覆盖 2 条关键路径，没有视觉回归或全量 CRUD 矩阵。
- `/api/health` 与 Vercel 数据库驱动分支已实现，但未在真实 Vercel/Neon 环境验证；云端验证入口（`verify:deploy` 与 external E2E）待有凭据时执行。
- 迁移 `0003_better_auth` 是一次性切换，要求空认证/租户数据；没有旧数据迁移脚本。

目标设计的差异与后续待办见 [implementation-status.md](./implementation-status.md)。
