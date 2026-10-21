# 环境与部署（当前实现）

| 项 | 值 |
|---|---|
| 文档状态 | **当前实现说明**，以仓库代码与 `package.json` 为准 |
| 最后更新 | 2026-10-21 |
| 运行环境 | Node.js 22（CI）· pnpm 9（CI） |
| 依赖服务 | PostgreSQL |
| 相关文档 | [文档中心](./README.md) · [实现状态](./implementation-status.md) · [工程协作](../AGENTS.md) · [目标部署蓝图](./ops-target.md) |

> 家谱目标架构使用 PostgreSQL 18 + RLS + 自建 JWT 认证（本地 `postgres.js` / 生产 `pg` + `attachDatabasePool`）；生产部署到 Vercel + 自定义域名 + Neon，本地 Docker 只跑 PostgreSQL、应用用 `next dev`。当前仓库**没有** RLS 与家谱表，也没有 Vercel/Neon 配置，但已有自建 JWT。目标设计不包含支付；当前实现也已移除 Stripe、套餐、计费与订阅。目标蓝图见 [ops-target.md](./ops-target.md)。

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
| `POSTGRES_URL` | ✅ | `postgres://postgres:postgres@localhost:54322/postgres` | Drizzle/postgres.js 连接串；缺失时首次查询即抛错 |
| `AUTH_SECRET` | ✅ | `openssl rand -hex 32` 生成 | JWT HS256 签名密钥；缺失时首次签发/校验 token 即抛错 |
| `TEST_POSTGRES_URL` | — | `postgres://postgres:postgres@localhost:54322/gramps_test` | `pnpm test:integration` 专用库；名称必须以 `_test` 结尾。未设置时回退到 `POSTGRES_URL`，同样要求库名以 `_test` 结尾 |
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

当前仓库**没有**统一的 Zod 配置模块，也**没有**启动时集中校验。行为是：

- `POSTGRES_URL` 缺失：`lib/db/drizzle.ts` 在第一次建库连接时抛错。
- `AUTH_SECRET` 缺失：`lib/auth/session.ts` 在第一次签发或校验 JWT 时抛错。

因此启动成功不代表环境变量齐全；请在第一次登录/查询前确认。

---

## 4. 数据库

### 4.1 当前模型

Schema 定义在 `lib/db/schema.ts`，迁移在 `lib/db/migrations/`（当前为 `0000`–`0006`）。

当前 6 张表：

| 表 | 用途 |
|---|---|
| `users` | 账号、密码哈希、`token_version`、软删标记 |
| `organizations` | 组织；`slug` 为 20 位公开 ID，用于控制台 URL |
| `org_members` | 用户与组织的关系、角色 |
| `projects` | 组织下的项目；`ref` 为 20 位公开 ID，用于控制台 URL |
| `activity_logs` | 用户活动日志；账号级事件的 `org_id` 为空 |
| `invitations` | 邀请记录（无 token/过期时间） |

`organizations.slug` 与 `projects.ref` 都是 `varchar(20)`、非空、全局唯一，字符集为 `[0-9a-z]`；数字 `serial` 主键仍是内部外键。`projects.slug`（可读 slug）仍然存在，但只用于展示，不进入 URL。

本地 `pnpm db:setup` 启动 PostgreSQL 18；当前主键仍是 `serial`，尚未启用目标设计的 `uuidv7()`。

`0005_remove_billing_and_tier` 已删除 `organizations` 的 5 个 Stripe 字段（`stripe_customer_id`、`stripe_subscription_id`、`stripe_product_id`、`plan_name`、`subscription_status`）与 `projects.tier`；历史迁移 `0000`–`0004` 保持原样。

`0006_cheerful_surge` 增加 `org_members (org_id, user_id)` 唯一索引、`org_members`/`invitations` 角色与状态 `CHECK`、待处理邀请的 `(org_id, lower(email))` 部分唯一索引、常用查询索引，并允许 `activity_logs.org_id` 为空（账号级事件）。如果已有库中存在重复成员或同一组织下重复的待处理邀请，需要先人工清理，否则唯一索引会创建失败。

当前数据库**没有**：

- RLS、`app_rw` 角色、org 隔离策略。
- 注册触发器；默认组织由应用层在单个事务内创建。
- 家谱业务表（`lineage`、`node`、`article`、`book`、`book_catalog`、`folder`）。
- 软删（除 `users.deleted_at` 外，业务表没有 `deleted_at`）。
- 支付、套餐、订阅相关表或字段。

### 4.2 迁移命令

```bash
pnpm db:generate   # 根据 schema 生成新的迁移 SQL，必须人工 review
pnpm db:migrate    # 执行全部待执行迁移
pnpm db:studio     # 打开 Drizzle Studio
```

`0003_public_ids` 与 `0004_public_ids_not_null` 是一次两阶段迁移：前者增加可空列并删除 `api_keys`，后者才设置 `NOT NULL` 与唯一索引。`drizzle-kit migrate` 会把所有待执行迁移放在同一个事务里，因此**已有数据的库不能直接执行 `pnpm db:migrate`**（`0004` 会因空值失败并整体回滚）。

已有数据的库按以下顺序升级，**先备份**：

```bash
# 1. 备份数据库（示例：db:setup 生成的本地 Docker Postgres）
docker compose exec postgres pg_dump -U postgres -d postgres > backup-before-public-ids.sql

# 2. 只执行到 0003（增加可空列 + 删除 api_keys）
pnpm db:migrate:until 0003_public_ids

# 3. 回填 20 位 slug/ref（幂等，可重复执行）
pnpm db:backfill-ids

# 4. 执行剩余迁移（0004：NOT NULL + 唯一索引；0005：删除计费字段；0006：约束与索引）
pnpm db:migrate
```

已经完成 `0004` 回填的库可以直接执行 `pnpm db:migrate` 应用 `0005`、`0006`；两者只改结构，不改写数据。执行 `0006` 前先确认没有重复成员或重复待处理邀请，否则唯一索引会失败。

全新/空库不需要分步：`pnpm db:migrate` 会在同一事务内执行 `0003`–`0006`，随后执行 `pnpm db:seed`。

### 4.3 种子数据

`pnpm db:seed` 会创建：

| 对象 | 内容 |
|---|---|
| 用户 | `test@test.com` / `admin123` |
| 组织 | `测试组织`，slug 为 `testorg0000000000001`，该用户为 `owner` |
| 项目 | `示例家谱`（slug `example-lineage`，ref `docsapi0000000000001`）、`支系档案`（slug `branch-archive`，ref `mobilebackend0000001`） |

种子脚本**不是幂等的**；重复执行会因 `users.email` 唯一约束失败。需要重灌时先重置数据库。

### 4.4 重置本地数据库

仅本地、且使用 `db:setup` 生成的 Docker Postgres 时：

```bash
docker compose down -v     # 删除容器与数据卷
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
| `pnpm db:seed` | 灌入本地演示数据（非幂等） |
| `pnpm db:backfill-ids` | 为缺失 `slug`/`ref` 的组织与项目回填 20 位公开 ID（幂等） |
| `pnpm db:migrate:until <tag>` | 只执行到指定迁移（用于两阶段升级） |
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
| 权威校验 | `getUser()` 查库校验 `token_version` 与 `deleted_at` |
| 撤销 | 修改密码时递增 `token_version` 并重签当前设备，其他设备立即失效；删除账号时递增版本并清除 Cookie |
| 修改邮箱 | 需要当前密码；邮箱归一化为小写后写入；重复邮箱返回中文冲突提示 |
| 角色 | `owner` / `member` |
| 限流 | 进程内滑动窗口：登录 10 次/15 分钟（IP + 邮箱），注册 5 次/小时（IP） |

> `proxy.ts` 只是路由门禁：它验证 JWT 签名并做跳转，不是授权边界。所有 Server Action、RSC 数据读取和 API Route 都必须再走 `getUser()` 与组织成员校验。

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
- `globalSetup` 在测试库上执行全部迁移；迁移已应用时是幂等的。
- 每个测试用例开始前（`beforeEach`）`TRUNCATE` 6 张业务表并重置自增 ID。
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

单测 7 个文件 39 个用例（另有 `tests/server-only.stub.ts` 作为测试环境 stub），不连接数据库：

| 文件 | 关注点 |
|---|---|
| `tests/auth-schemas.test.ts` | 邮箱归一化、密码边界、中文校验消息 |
| `tests/session.test.ts` | JWT 签名/过期、`tokenVersion` 撤销、软删用户 |
| `tests/rate-limit.test.ts` | 滑动窗口限流与中文提示 |
| `tests/ids.test.ts` | 20 位公开 ID 的长度/字符集与校验 |
| `tests/fetcher.test.ts` | 非 2xx 响应抛错并保留 `status` |
| `tests/security-regressions.test.ts` | 密码回显、计时攻击、组织越权、公开 ID 查询的成员过滤、`/api/user` DTO |
| `tests/design-system.test.ts` | 设计令牌边界、状态/角色/区域中文映射、项目列表 DTO |

集成测试 8 个文件 61 个用例，使用真实 PostgreSQL：

| 文件 | 关注点 |
|---|---|
| `tests/integration/migrations.test.ts` | 空库迁移、业务表/索引、`0006` 约束与 `activity_logs.org_id` 可空 |
| `tests/integration/session.test.ts` | `getUser()` 的 `token_version` 撤销、软删用户、缺失/无效会话 |
| `tests/integration/org-scope.test.ts` | 公开 ID 的成员过滤、跨组织读写拒绝 |
| `tests/integration/constraints.test.ts` | 唯一邮箱/slug/ref、成员唯一、角色/状态 `CHECK`、待处理邀请部分唯一、外键级联 |
| `tests/integration/services.test.ts` | 注册/邀请、建组织、移除成员、删号事务与权限/回滚 |
| `tests/integration/actions.test.ts` | 注册、登录/登出、改密、改邮箱、删号、移除成员的 Action 行为与数据库副作用 |
| `tests/integration/api-auth.test.ts` | `/api/user` 与 `/api/orgs` 未登录返回 401 |
| `tests/integration/projects.test.ts` | 项目创建时 slug 冲突后重新生成并重试 |

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
- 没有 Vercel 项目配置、Neon 连接或健康检查端点 `/api/health`。

目标架构选择 **Vercel + 自定义域名 + Neon**：应用由 Vercel 构建与运行，数据库使用 Neon PostgreSQL 18+，生产驱动为 `pg` Pool + `attachDatabasePool`，本地开发用 `postgres.js`；本地 Docker 只跑 PostgreSQL、应用用 `next dev`。迁移对 Neon 直连执行，不放进 Vercel 构建。完整蓝图见 [ops-target.md](./ops-target.md)。

### 8.3 生产环境至少需要

- 一个可用的 Postgres（含迁移）。目标设计使用 Neon PostgreSQL 18+。
- `POSTGRES_URL`、`AUTH_SECRET`。
- 以 `pnpm build` + `pnpm start` 或平台适配方式运行 Next.js；目标设计使用 Vercel。

---

## 9. 故障排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 启动或首次查询报 `POSTGRES_URL environment variable is not set` | 没有 `.env` 或变量为空 | 运行 `pnpm db:setup` 或手动创建 `.env` |
| 首次登录报 `AUTH_SECRET environment variable is not set` | 缺少 JWT 密钥 | 在 `.env` 写入 `AUTH_SECRET` |
| `pnpm db:setup` 卡在 Docker | Docker 未启动 | 启动 Docker Desktop/daemon |
| `pnpm db:migrate` 连接失败 | 本地 Postgres 未启动、端口不对 | 检查 `docker compose ps` 与 `POSTGRES_URL` 的端口 54322 |
| `pnpm db:seed` 报邮箱唯一约束 | 种子已执行过 | 重置本地库后再执行，或直接使用已有 `test@test.com` |
| 登录后立刻掉线 | Cookie 被清除、域名/Secret 变化、`AUTH_SECRET` 改变 | 检查 Cookie 与 `AUTH_SECRET` 是否变化 |
| 访问 `/dashboard/org/[orgSlug]` 或 `/dashboard/project/[projectRef]` 返回 404 | 当前用户不是成员、公开 ID 不存在或格式非法 | 用该组织成员账号登录；确认 slug/ref 为 20 位 `[0-9a-z]` |
| 组织 API 返回 401 | 未登录或会话已失效 | 重新登录；三个 API 未登录统一返回 401 |
| 组织 API 返回 403 / 404 | 非成员、组织 ID 非数字或不存在 | 先确认成员关系；不要绕过 `getOrgRole` |
| 已有数据的库执行 `pnpm db:migrate` 报 `column "slug" contains null values` | `0004` 在 `0003` 之后立即执行，缺少回填 | 按 §4.2 分步执行：`migrate:until 0003` → `db:backfill-ids` → `db:migrate` |
| 执行 `0006` 报 duplicate key | 历史库存在重复成员或重复待处理邀请 | 先人工清理重复数据，再执行迁移 |
| 限流很快失效 | 限流是进程内内存实现 | 重启后清零；多实例不共享；生产需替换为共享存储（P1） |
| 集成测试报 `database name must end with "_test"` | `TEST_POSTGRES_URL` 指向了开发库或生产库 | 创建独立 `gramps_test` 库，设置专用 `TEST_POSTGRES_URL` |
| 修改密码后其他设备退出 | `tokenVersion` 被递增 | 预期行为；当前设备已重签保持登录，其他设备旧会话失效 |

---

## 10. 当前限制

- 没有邮箱确认、密码重置或持久化账号锁定。
- 角色只有 `owner` / `member`；没有目标设计中的 `admin` / `editor` / `viewer`。
- 邀请不会发送邮件，也没有 token/过期时间；仍允许邀请 `owner`。
- 没有 RLS；隔离完全依赖应用层组织校验。
- 没有家谱业务功能（谱系、人丁、谱文、谱书、分类）。
- 限流为单进程内存实现，不适合多实例生产环境。
- 没有 Playwright/E2E，也没有 `/api/health`。

目标设计的差异与后续待办见 [implementation-status.md](./implementation-status.md)。
