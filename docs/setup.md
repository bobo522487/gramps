# 环境与部署（当前实现）

| 项 | 值 |
|---|---|
| 文档状态 | **当前实现说明**，以仓库代码与 `package.json` 为准 |
| 最后更新 | 2026-10-22 |
| 运行环境 | Node.js 22（CI）· pnpm 9（CI） |
| 依赖服务 | PostgreSQL 18 |
| 相关文档 | [文档中心](./README.md) · [实现状态](./implementation-status.md) · [工程协作](../AGENTS.md) · [ADR 0001](./adr/0001-foundation-reset.md) · [目标部署蓝图](./ops-target.md) |

> 基础层已按 [ADR 0001](./adr/0001-foundation-reset.md) 重置：PostgreSQL 18 + UUIDv7 + RLS（`app_rw`）+ `auth.users` + 4 角色 + 软删 + 邀请 token。家谱业务页面/Action 尚未实现。生产预期部署到 Vercel + 自定义域名 + Neon，本地 Docker 只跑 PostgreSQL、应用用 `next dev`；真实 Vercel/Neon 部署尚未验证。目标设计不包含支付；当前实现也已移除 Stripe、套餐、计费与订阅。目标蓝图见 [ops-target.md](./ops-target.md)。

---

## 1. 前置条件

| 依赖 | 版本 | 校验 | 是否必需 |
|---|---|---|---|
| Node.js | 22.x | `node -v` | 必需 |
| pnpm | 9.x | `pnpm -v` | 必需 |
| Docker | 24+ | `docker -v` | 使用本地 Postgres 时必需 |
| Git | 2.40+ | `git --version` | 必需 |

可以用 `corepack enable && corepack prepare pnpm@9 --activate` 固定 pnpm 版本。

当前项目**没有** `packageManager` 和 `engines` 字段；以 CI（Node 22 / pnpm 9）为准。

---

## 2. 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 交互式初始化：创建 .env、docker-compose.yml、本地 Postgres、AUTH_SECRET
pnpm db:setup

# 3. 执行数据库迁移
pnpm db:migrate

# 4. 灌入本地演示数据（可选）
pnpm db:seed

# 5. 启动开发服务器
pnpm dev
```

打开 http://localhost:3000。

> 如果本地库是 Phase 3 之前的旧结构（`users`/`organizations`/`projects` 等），基线迁移会冲突。先按 §4.4 清空 `public`/`auth`/`drizzle` schema，再执行迁移；本地演示数据会丢失，这是 ADR 0001 的预期代价。

### 2.1 `pnpm db:setup` 会做什么

`lib/db/setup.ts` 是一个交互式脚本：

1. 询问使用本地 Docker Postgres 还是远程 Postgres。
   - 本地：创建 `docker-compose.yml`，启动 `postgres:18-alpine`，端口 `54322`。
   - 远程：要求输入 `POSTGRES_URL`。
2. 生成随机 `AUTH_SECRET`。
3. 写入项目根目录的 `.env`。

**注意：生成的是 `.env`，不是 `.env.local`。** 当前代码通过 `dotenv` 读取 `.env`，不要改成 `.env.local` 而不改代码。

也可以手动创建 `.env`（参考 `.env.example`），只需 `POSTGRES_URL` 与 `AUTH_SECRET`。

---

## 3. 环境变量

| 变量 | 必填 | 示例 | 说明 |
|---|:--:|---|---|
| `POSTGRES_URL` | ✅ | `postgres://postgres:postgres@localhost:54322/postgres` | 数据库连接串，必须是 `postgres://` 或 `postgresql://` |
| `AUTH_SECRET` | ✅ | `openssl rand -hex 32` 生成 | JWT HS256 签名密钥，至少 32 字符 |
| `TEST_POSTGRES_URL` | — | `postgres://postgres:postgres@localhost:54322/gramps_test` | `pnpm test:integration` 专用库；名称必须以 `_test` 结尾。未设置时回退到 `POSTGRES_URL`，同样要求库名以 `_test` 结尾 |
| `BASE_URL` | — | `http://localhost:3000` | 应用对外地址；必须是合法 URL |
| `LOG_LEVEL` | — | `debug` / `info` / `warn` / `error` | 默认开发 `debug`、生产 `info` |
| `NODE_ENV` | — | `development` / `production` | Next.js 与日志默认级别使用 |

### 3.1 手动初始化示例

```bash
cp .env.example .env
# 编辑 .env：
# POSTGRES_URL=postgres://postgres:postgres@localhost:54322/postgres
# AUTH_SECRET=$(openssl rand -hex 32)
```

### 3.2 配置校验方式

`lib/config.ts` 用 Zod 校验 `POSTGRES_URL`、`AUTH_SECRET`（≥32 字符）、`LOG_LEVEL`、`BASE_URL`，并缓存校验结果。

- 服务启动时 `instrumentation.ts` 调用 `getServerConfig()`；配置缺失或非法会记录错误并阻止启动（`next build` 阶段跳过）。
- `lib/db/drizzle.ts` 也通过 `getServerConfig()` 读取连接串；测试与脚本在首次查询前设置环境变量即可。
- 单元测试可使用 `resetServerConfig()` 清除缓存后重新校验。

### 3.3 数据库驱动

`lib/db/drizzle.ts` 按运行环境选择驱动：

- 本地/CI：`postgres.js`。
- Vercel（`process.env.VERCEL` 存在）：`pg` Pool + `attachDatabasePool`，便于 Fluid compute 复用连接。
- 两条路径共用同一套 Drizzle schema 与查询代码；Vercel 分支尚未在真实部署中验证。

---

## 4. 数据库

### 4.1 当前模型

Schema 定义在 `lib/db/schema.ts`，迁移在 `lib/db/migrations/`（当前只有 `0000_baseline` 与 `0001_auth_rls`）。

| 表 | 用途 |
|---|---|
| `auth.users` | 账号、密码哈希、`token_version`、软删；运行时角色无表权限 |
| `organization` | 组织；`slug` 为 20 位公开 ID，用于控制台 URL |
| `organization_member` | 用户与组织的关系、角色；活动成员唯一、单组织单 owner |
| `invite` | 邀请；只存 token 哈希、7 天过期、一次性 |
| `project` | 云谱空间；`ref` 为 20 位公开 ID；目标字段（姓氏/郡望/地区） |
| `folder` / `lineage` / `node` / `article` / `book` / `book_catalog` | 家谱业务表；已建表与 RLS，无页面/Action |
| `activity_logs` | 产品活动流；账号级事件的 `organization_id` 为空 |

- 全部主键是 UUIDv7（`uuidv7()`），20 位公开 ID 只用于 URL，不参与外键。
- 组织级业务表使用 `organization_id` 隔离；`organization`、`organization_member`、`invite`、`project` 与 6 张家谱表都有 `deleted_at` 软删。`activity_logs` 是产品活动流，没有软删列。
- `organization.slug` 与 `project.ref` 是 `varchar(20)`、非空、唯一，字符集 `[0-9a-z]`。
- 复合外键把子资源的 `(organization_id, project_id)` 约束在同一个组织内。
- 活动成员 `(organization_id, user_id)` 唯一；`uk_org_member_single_owner` 保证单组织最多一个 `owner`（没有最少一个的数据库约束）。
- 邀请 `(organization_id, lower(email))` 在待处理状态下唯一；token 只存 SHA-256 哈希。
- `auth.users` 的活动邮箱唯一；软删后邮箱可复用。
- `0000_baseline` 由 Drizzle 生成；`0001_auth_rls` 是 custom migration，包含 `app_rw`、`auth` 函数、注册触发器、GRANT、RLS 策略、`ltree`/`pg_trgm`/`btree_gist` 与 GIN/GiST 索引。

当前数据库**已有**：

- RLS + `FORCE ROW LEVEL SECURITY`，`app_rw`（NOLOGIN、NOBYPASSRLS、无 `auth.users` 权限、无业务表 `DELETE`）。
- 注册触发器 `handle_new_user`：每个 `auth.users` 插入自动创建个人组织与 owner 成员关系。
- 家谱业务表（`folder`、`lineage`、`node`、`article`、`book`、`book_catalog`），但没有业务 UI/Action。
- 软删列与复合外键。

当前数据库**没有**：

- 支付、套餐、订阅相关表或字段。
- 分享页、回收站、编辑锁、审计表。
- 家谱业务功能（谱系/人丁/谱文/谱书/分类）的页面与写流程。

### 4.2 迁移命令

```bash
pnpm db:generate   # 根据 schema 生成新的迁移 SQL，必须人工 review
pnpm db:migrate    # 执行全部待执行迁移
pnpm db:studio     # 打开 Drizzle Studio
```

- 空库直接 `pnpm db:migrate`，会依次执行 `0000_baseline` 与 `0001_auth_rls`。
- `0001_auth_rls` 是 custom migration：新增 RLS/角色/函数时同样手工维护，生成后必须 review。
- 迁移角色需要能创建扩展、角色并执行 `SET ROLE app_rw`；生产把迁移角色与运行角色分开（见 §4.2.1）。
- 迁移里不写数据修复；演示数据由 `pnpm db:seed` 重建。
- 不要修改已应用迁移的 SQL；需要修正时新增迁移。

#### 4.2.1 生产角色分离

- 运行时连接（`POSTGRES_URL`）必须使用仅 `GRANT app_rw` 的登录角色 `app`，**不能是表属主或超级用户**；否则 RLS 的兜底会被绕过。
- 迁移连接使用数据库所有者/迁移角色。当前 `drizzle.config.ts` 只读取 `POSTGRES_URL`，所以生产迁移必须在独立的受保护 job 中把 `POSTGRES_URL` 指向迁移角色/直连地址；目标设计的 `POSTGRES_URL_DIRECT` 尚未接入代码。
- `app` 的密码只放 Neon/Vercel 环境变量，不写进迁移。

### 4.3 种子数据

`pnpm db:seed` 通过 `auth.sign_up` 创建演示账号，并在已存在时复用：

| 对象 | 内容 |
|---|---|
| 用户 | `test@test.com` / `admin123` |
| 组织 | 个人组织改名为 `测试组织`，该用户为 `owner` |
| 项目 | `示例云谱`（ref `example0000000000001`）、`支系档案`（ref `branch00000000000001`） |

种子可重复执行：已存在演示账号时复用，项目用 `onConflictDoNothing` 跳过。需要彻底重灌时先重置数据库。

### 4.4 重置本地数据库

Phase 3 的基线迁移与旧结构不兼容。仅本地、且使用 `db:setup` 生成的 Docker Postgres 时：

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

这会**永久删除**本地数据，生产环境禁止执行。远程数据库请使用独立实例或手动管理 schema。

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
| `pnpm check` | Biome 检查（格式 + lint + import 组织），CI 使用 |
| `pnpm lint` | 仅 Biome lint |
| `pnpm format` | Biome 格式化 |
| `pnpm fix` | Biome 检查并自动修复 |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest 单测（不连数据库） |
| `pnpm test:unit` | 同 `pnpm test` |
| `pnpm test:integration` | 真实 PostgreSQL 集成测试（需要 `*_test` 数据库） |

**没有** `test:e2e`、`db:reset`、ESLint、dependency-cruiser 或 Playwright 脚本。

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
| 登录方式 | 邮箱 + 密码 |
| 密码存储 | bcrypt，10 rounds |
| 会话 | JWT HS256，HttpOnly Cookie `session`，`SameSite=Lax`，`Secure` |
| 有效期 | 1 天 |
| 续期 | `proxy.ts` 在剩余 < 6 小时时重新签发 1 天 Cookie |
| 权威校验 | `getSessionUser()` 查库校验 `token_version` 与 `deleted_at`；按请求缓存 |
| 请求上下文 | `getOrgContext` / `getProjectContext` 复用会话与成员 scope；公开 ID 失败返回 404 |
| 撤销 | 修改密码时递增 `token_version` 并重签当前设备，其他设备立即失效；删除账号时递增版本并清除 Cookie |
| 修改邮箱 | 需要当前密码；邮箱归一化为小写后写入；重复邮箱返回中文冲突提示 |
| 角色 | `owner` / `admin` / `editor` / `viewer`，业务代码使用权限字符串 |
| 数据隔离 | 应用层 `orgId` 过滤 + `withOrg` 内 `SET LOCAL ROLE app_rw` 的 RLS + 复合外键 |
| 限流 | 进程内滑动窗口：登录 10 次/15 分钟（IP + 邮箱），注册 5 次/小时（IP） |

> `proxy.ts` 只是路由门禁：它验证 JWT 签名并做跳转，不是授权边界。所有 Server Action、RSC 数据读取和 API Route 都必须再走 `getSessionUser()` 与组织成员校验。

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

集成测试使用真实 PostgreSQL。先建一个独立测试库，库名必须以 `_test` 结尾：

```bash
# 使用 db:setup 生成的本地 Docker Postgres
docker compose exec postgres createdb -U postgres gramps_test

# 在 .env 增加（不要指向开发库或生产库）
TEST_POSTGRES_URL=postgres://postgres:postgres@localhost:54322/gramps_test

pnpm test:integration
```

安全护栏：

- 测试 helper 拒绝名称不以 `_test` 结尾的数据库，避免误清开发/生产数据。
- `globalSetup` 会先删除测试库的 `public`/`auth`/`drizzle` schema 与扩展，再从空库执行全部迁移；不要把它指向开发库。
- 每个测试用例开始前（`beforeEach`）`TRUNCATE` 11 张业务表与 `auth.users`。
- 测试文件串行执行，避免共享库竞争。

### 7.2 CI

`.github/workflows/ci.yml` 在 push 到 `main` 和 pull request 时运行：

```text
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm test:unit
pnpm test:integration     # postgres:18-alpine，库名 gramps_test
pnpm db:generate && git status --porcelain lib/db/migrations  # 漂移检查
pnpm build
```

CI 使用 Node 22、pnpm 9。`postgres:18-alpine` 作为 service 启动，集成测试从空库执行全部迁移。

### 7.3 测试覆盖

单测 10 个文件 44 个用例（另有 `tests/server-only.stub.ts` 作为测试环境 stub），不连接数据库：

| 文件 | 关注点 |
|---|---|
| `tests/auth-schemas.test.ts` | 邮箱归一化、密码边界、中文校验消息 |
| `tests/session.test.ts` | JWT 签名/过期、`tokenVersion` 撤销、软删用户 |
| `tests/config.test.ts` | 环境变量校验与缓存 |
| `tests/request-context.test.ts` | `AsyncLocalStorage` 请求上下文、日志字段注入、并发隔离 |
| `tests/rate-limit.test.ts` | 滑动窗口限流与中文提示 |
| `tests/ids.test.ts` | 20 位公开 ID 的长度/字符集与校验 |
| `tests/fetcher.test.ts` | 非 2xx 响应抛错并保留 `status` |
| `tests/permissions.test.ts` | 4 角色 × 9 权限矩阵、`isOrgRole` |
| `tests/security-regressions.test.ts` | 密码回显、计时攻击、DTO、公开 ID 成员过滤、`withOrg` 的 `SET LOCAL ROLE`/claims |
| `tests/design-system.test.ts` | 设计令牌边界、角色中文映射 |

集成测试 9 个文件 103 个用例，使用真实 PostgreSQL：

| 文件 | 关注点 |
|---|---|
| `tests/integration/migrations.test.ts` | 空库迁移、11 张业务表 + `auth.users`、索引、RLS/`FORCE`、`app_rw` 权限、扩展与函数 |
| `tests/integration/session.test.ts` | `getSessionUser()` 的 `token_version` 撤销、软删用户、缺失/无效会话 |
| `tests/integration/org-scope.test.ts` | 公开 ID 的成员过滤、跨组织读写拒绝、权限矩阵、RLS 无 claims/跨组织拒绝 |
| `tests/integration/constraints.test.ts` | 唯一邮箱/slug/ref、成员唯一、单 owner、角色 `CHECK`、待处理邀请部分唯一、复合外键 |
| `tests/integration/services.test.ts` | 注册/邀请/建组织/成员变更/删号事务与权限/回滚 |
| `tests/integration/actions.test.ts` | 注册、登录/登出、改密、改邮箱、删号、成员管理的 Action 行为与数据库副作用 |
| `tests/integration/api-auth.test.ts` | 三个业务路由 401、DTO 形状、非法 UUID 404、非成员 403 |
| `tests/integration/health.test.ts` | `/api/health` 数据库探活与 `x-request-id` |
| `tests/integration/projects.test.ts` | 项目创建时 `ref` 冲突后重新生成并重试 |

公共 helper 位于 `tests/helpers/`：测试库连接与清理、用户/组织/项目/邀请工厂、会话签名。

没有端到端测试。

---

## 8. 构建与部署

### 8.1 本地生产构建

```bash
pnpm build
pnpm start
```

### 8.2 当前仓库的部署状态

当前仓库**没有提供可直接使用的生产部署配置**：

- `next.config.ts` 没有设置 `output: 'standalone'`。
- 仓库没有 `public/` 目录。
- 没有 Dockerfile，也没有纳入版本管理的部署 Compose（`db:setup` 生成的 Compose 只用于本地 PostgreSQL）。
- 没有 Vercel 项目配置或 Neon 连接；`/api/health` 已实现，生产驱动分支（`pg` + `attachDatabasePool`）已接入但尚未在真实 Vercel 部署中验证。

目标架构选择 **Vercel + 自定义域名 + Neon**：应用由 Vercel 构建与运行，数据库使用 Neon PostgreSQL 18+，生产驱动为 `pg` Pool + `attachDatabasePool`，本地开发用 `postgres.js`；本地 Docker 只跑 PostgreSQL、应用用 `next dev`。迁移对 Neon 直连执行，不放进 Vercel 构建。完整蓝图见 [ops-target.md](./ops-target.md)。

### 8.3 生产环境至少需要

- 一个可用的 Postgres（含迁移）。目标设计使用 Neon PostgreSQL 18+。
- `POSTGRES_URL`、`AUTH_SECRET`。
- 以 `pnpm build` + `pnpm start` 或平台适配方式运行 Next.js；目标设计使用 Vercel。

---

## 9. 故障排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 启动报 `Invalid environment configuration: POSTGRES_URL ...` | 没有 `.env` 或连接串不是 `postgres://`/`postgresql://` | 运行 `pnpm db:setup` 或手动修正 `.env` |
| 启动报 `Invalid environment configuration: AUTH_SECRET ...` | 缺少 JWT 密钥或长度不足 32 | 用 `openssl rand -hex 32` 生成并写入 `.env` |
| `pnpm db:setup` 卡在 Docker | Docker 未启动 | 启动 Docker Desktop/daemon |
| `pnpm db:migrate` 连接失败 | 本地 Postgres 未启动、端口不对 | 检查 `docker compose ps` 与 `POSTGRES_URL` 的端口 54322 |
| `pnpm db:seed` 报邮箱唯一约束 | 种子已执行过 | 重置本地库后再执行，或直接使用已有 `test@test.com` |
| 登录后立刻掉线 | Cookie 被清除、域名/Secret 变化、`AUTH_SECRET` 改变 | 检查 Cookie 与 `AUTH_SECRET` 是否变化 |
| 访问 `/dashboard/org/[orgSlug]` 或 `/dashboard/project/[projectRef]` 返回 404 | 当前用户不是成员、公开 ID 不存在或格式非法 | 用该组织成员账号登录；确认 slug/ref 为 20 位 `[0-9a-z]` |
| 组织 API 返回 401 | 未登录或会话已失效 | 重新登录；三个业务 API 未登录统一返回 401 |
| 组织 API 返回 403 / 404 | 非成员、组织 ID 不是合法 UUID 或不存在 | 先确认成员关系；不要绕过 `getOrgRoleInTx` |
| 迁移报 `schema "public" already exists` / 表已存在 | 本地库仍是 Phase 3 之前的旧结构 | 按 §4.4 清空 schema 后重新迁移 |
| 迁移报 `permission denied to create extension` | 迁移角色权限不足 | 用数据库所有者/迁移角色执行；生产在独立 job 中运行迁移 |
| 应用查询返回 0 行但数据存在 | 运行时角色是表属主或 RLS claims 未设置 | 生产用 `app`（仅 `GRANT app_rw`）；应用查询走 `withOrg` |
| 限流很快失效 | 限流是进程内内存实现 | 重启后清零；多实例不共享；生产需替换为共享存储（P1） |
| 集成测试报 `database name must end with "_test"` | `TEST_POSTGRES_URL` 指向了开发库或生产库 | 创建独立 `gramps_test` 库，设置专用 `TEST_POSTGRES_URL` |
| 修改密码后其他设备退出 | `tokenVersion` 被递增 | 预期行为；当前设备已重签保持登录，其他设备旧会话失效 |

---

## 10. 当前限制

- 没有邮箱确认、密码重置或持久化账号锁定。
- 有 4 角色与权限矩阵，但没有转让所有权；`org.transfer` 尚无 Action/UI。
- 邀请不会发送邮件；需要人工复制链接。token 7 天过期、一次性、禁止邀请 `owner`。
- 没有家谱业务功能（谱系、人丁、谱文、谱书、分类）；相关表与 RLS 已存在。
- 没有回收站、编辑锁、分享页；业务表是软删，但用户无法自助恢复。
- 最后一个 owner 保护只在服务层；数据库只有“至多一个 owner”约束。
- RLS 的生产语义依赖运行角色不是表属主；本地/CI 已用 `SET LOCAL ROLE app_rw` 验证。
- 限流为单进程内存实现，不适合多实例生产环境。
- 没有 Playwright/E2E。
- `/api/health` 与 Vercel 数据库驱动分支已实现，但未在真实 Vercel/Neon 环境验证。

目标设计的差异与后续待办见 [implementation-status.md](./implementation-status.md)。
