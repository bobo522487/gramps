# 目标环境与部署蓝图

> **文档状态：M1 目标设计（基础层已实现，部署未验证）** · 最后更新：2026-10-25
> 本文件描述家谱目标架构的部署与运维蓝图，**不是当前仓库的操作指南**。
> 当前仓库请读 [环境与部署（当前实现）](./setup.md)；实现差异见 [实现状态](./implementation-status.md) 与 [ADR 0001](./decisions/0001-foundation-reset.md)。

| 项 | 值 |
|---|---|
| 文档版本 | 1.5 |
| 文档状态 | M1 目标设计（基础层已实现，部署未验证） |
| 最后更新 | 2026-10-25 |
| 部署单元 | Vercel（Next.js）+ Neon PostgreSQL 18+；本地 Docker 只跑 PostgreSQL |
| 本地开发 | `docker compose up -d db` + `pnpm dev`（`next dev`，不用应用容器） |
| 迁移 | Drizzle Kit，对直连 URL 执行，与应用部署分离 |
| 相关文档 | [架构](./architecture/00-overview.md) · [数据模型](./data-model.md) · [接口](./api.md) |

---

## 0. 先看当前仓库的实际情况

**已经落地**（见 [ADR 0001](./decisions/0001-foundation-reset.md)）：

- RLS + `FORCE ROW LEVEL SECURITY`、`app_rw`、`auth.users`、`SECURITY DEFINER` 函数、注册触发器。
- UUIDv7 主键、11 张组织级业务表、软删、复合外键、邀请 token。
- `/api/health`、结构化日志、Zod 配置校验、`POSTGRES_URL` 变量。
- `POSTGRES_URL_DIRECT`：`drizzle.config.ts` 已优先使用它执行迁移。
- `0002_app_role_grant`：`app` 角色存在时补 `GRANT app_rw TO app`。
- Playwright 关键路径 E2E 与 `scripts/verify-deployment.mjs`（`pnpm verify:deploy`）。
- 谱系/人丁的页面、Server Action、画布与世系表。

**尚未实现或未验证**：

- 真实 Vercel/Neon 部署、生产角色创建与连接池配置。
- Vercel 项目配置、备份恢复演练。
- 谱文/谱书/分类接入与分享、回收站、编辑锁；相关表已存在。
- 云端 `verify:deploy` 与 external E2E 未执行（本机无凭据）；本地生产模式已全项验证。

本地开发使用 `next dev`，数据库由 `pnpm db:setup` 生成的 Docker PostgreSQL 18 提供。因此本文中的 Compose 片段、迁移顺序、Vercel 与 Neon 配置仍需按实际环境核对，不能直接照搬。

---

## 1. 目标前置条件

| 依赖 | 版本 | 用途 | 校验 |
|---|---|---|---|
| Node.js | 24.x LTS | 本地开发与 CI | `node -v` |
| pnpm | 12.x | 包管理与脚本 | `pnpm -v` |
| Docker | 24+ | **只用于本地 PostgreSQL** | `docker -v` |
| Neon | PostgreSQL **18+** 项目 | 生产数据库 | `SELECT uuidv7();` |
| Vercel | 账号 + 目标域名 | 生产应用托管、TLS、CDN | 项目可部署 |
| Git | 2.40+ | 版本管理 | `git --version` |

`corepack enable && corepack prepare pnpm@12 --activate` 可省去单独安装 pnpm。

Node 24 是 LTS，作为生产基线；Node 26 是 Current，不作为生产基线。

**PostgreSQL 18 是硬前提**：所有表主键使用原生 `uuidv7()`。Neon 项目创建时必须选择 18+；本地镜像固定 `postgres:18-alpine`。PostgreSQL 18 是当前可用的最新稳定大版本，19 尚无稳定镜像。低于 18 的实例在建表阶段就会失败，迁移前先执行：

```sql
SELECT uuidv7();
```

---

## 2. 本地开发：Docker 只跑数据库

本地不构建应用镜像、不启动反向代理。Next.js 直接运行在宿主机，保留热更新与调试体验；生产才由 Vercel 托管。

### 2.1 Compose 只包含 PostgreSQL

```yaml
# docker-compose.yml（目标蓝图）
services:
  db:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: genealogy
      POSTGRES_USER: app
      POSTGRES_PASSWORD: dev-only-not-for-production
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d genealogy"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

没有 `app`、`caddy`、`web` 之类的服务。应用、迁移脚本和测试都在宿主机执行。

### 2.2 启动顺序

```bash
# 1. 启动数据库
docker compose up -d db

# 2. 安装依赖
pnpm install

# 3. 创建 .env（内容见 §2.3）

# 4. 执行迁移（本地直连 54322）
pnpm db:migrate

# 5. 启动 Next.js 开发服务器
pnpm dev
```

| 服务 | 地址 |
|---|---|
| Next.js（`next dev --turbopack`） | `http://localhost:3000` |
| PostgreSQL（Docker） | `localhost:54322` / 数据库 `postgres` |

### 2.3 本地环境变量

本地使用 `.env`（不提交；`dotenv` 读取）：

```bash
POSTGRES_URL=postgresql://postgres:postgres@localhost:54322/postgres
BETTER_AUTH_SECRET=local-development-secret-at-least-32-bytes
BETTER_AUTH_URL=http://localhost:3000
LOG_LEVEL=debug
```

生产环境额外提供 `APP_POSTGRES_URL`（`app` 登录角色）与 `AUTH_POSTGRES_URL`（`auth_runtime` 登录角色）；本地可省略，两个连接都回退到 `POSTGRES_URL`。`AUTH_POSTGRES_URL` 必须使用 **direct（unpooled）** endpoint：认证连接通过启动参数固定 `role=auth_service`，Neon pooler 会以 `08P01 unsupported startup parameter in options: role` 拒绝；业务连接可以继续使用 pooled endpoint。当前仓库使用 `.env` + `dotenv`；不要改名为 `.env.local` 而不改代码。

### 2.4 重置本地数据库

```bash
docker compose down -v
docker compose up -d db
pnpm db:migrate
```

仅限本地。生产 Neon 分支不要用删除数据卷的方式重置，改用分支或 PITR 恢复。

---

## 3. 目标环境变量

| 变量 | 必填 | 本地 | 生产（Vercel） | 说明 |
|---|:--:|---|---|---|
| `NODE_ENV` | ✅ | `development` | 由 Vercel 注入 | 不要在生产手动改成其他值 |
| `POSTGRES_URL` | ✅ | 本地 `localhost:54322` | Neon **pooled** endpoint | 业务运行期连接串；本地用 postgres.js 直连，生产用 pg Pool 并以 `app` 登录角色连接 |
| `APP_POSTGRES_URL` | 生产必填 | 可省略，回退 `POSTGRES_URL` | Neon pooled endpoint（`app` 角色） | 业务查询连接；经 `withOrg` 在事务内 `SET LOCAL ROLE app_rw` |
| `AUTH_POSTGRES_URL` | 生产必填 | 可省略，回退 `POSTGRES_URL` | Neon **direct（unpooled）** endpoint（`auth_runtime` 角色） | Better Auth 连接；连接初始化固定 `role=auth_service`，pooler 不支持该启动参数 |
| `POSTGRES_URL_DIRECT` / `POSTGRES_URL_NON_POOLING` | — | 可省略，回落到 `POSTGRES_URL` | **只放 CI / 运维环境，不进 Vercel** | 迁移、备份、DDL；Neon direct endpoint |
| `BETTER_AUTH_SECRET` | ✅ | 本地随机值 | 随机生成，**≥ 32 字符** | Better Auth Cookie 签名密钥 |
| `BETTER_AUTH_URL` | ✅ | `http://localhost:3000` | 自定义域名，如 `https://family.example.com` | Better Auth 基地址；生成邀请链接与回调 URL |
| `LOG_LEVEL` | — | `debug` | `info` | 默认 `info`，生产不要设 `debug` |

启动时用 Zod 校验，缺必填项直接退出：

```typescript
// src/server/config.ts（目标目录）
export const config = schema.parse(process.env);
```

报错示例：

```text
❌ Invalid environment variables:
   POSTGRES_URL: Required
   BETTER_AUTH_SECRET: String must contain at least 32 character(s)
```

**目标规则**：应用代码里禁止出现 `process.env`，只能 `import { config } from '@/server/config'`。Biome 的 `noRestrictedProperties` 规则拦截。`drizzle.config.ts` 属于工具链配置，可以直接读 `process.env`。

### 3.1 驱动与连接串拆分

| 环境 | 推荐驱动 | 连接 | 说明 |
|---|---|---|---|
| 本地 Docker PostgreSQL 18 | `postgres.js` + `drizzle-orm/postgres-js` | `localhost:54322` 直连 | 轻量、API 简洁，长连接没问题；可用默认 prepared statements |
| Vercel + Neon 生产 | `pg` 的 `Pool` + `drizzle-orm/node-postgres` + `attachDatabasePool` | `APP_POSTGRES_URL`（Neon pooled）+ `AUTH_POSTGRES_URL`（Neon direct） | Vercel 官方推荐；函数实例回收时自动释放空闲连接 |

| 用途 | 变量 | 取值 |
|---|---|---|
| 业务运行期查询 | `APP_POSTGRES_URL`（回退 `POSTGRES_URL`） | 本地直连 / Neon 控制台的 **Pooled connection**（主机名含 `-pooler`） |
| 认证与租户写 | `AUTH_POSTGRES_URL`（回退 `POSTGRES_URL`） | Neon 控制台的 **Direct connection**（不带 `-pooler`）；登录角色 `auth_runtime` |
| 迁移 / 备份 / DDL | `POSTGRES_URL_DIRECT`（回退 `POSTGRES_URL_NON_POOLING`） | Neon 控制台的 **Direct connection**（不带 pooler） |

| 规则 | 说明 |
|---|---|
| 连接池 | 每个 Vercel 函数实例 `max: 1–5`，不要按请求新建连接 |
| 两个连接 | 业务连接固定 `app` → `app_rw`；认证连接固定 `auth_runtime` → `auth_service`，**不能互换** |
| 模块级单例 | 连接池在模块作用域创建并复用，不在请求里创建 |
| 直连隔离 | `POSTGRES_URL_DIRECT` 不配置到 Vercel 运行期，避免应用拿到绕过连接池的管理连接 |
| 事务池 | DDL 与长事务走直连；池化连接只跑短查询 |
| Prepared statements | 生产 `pg` 默认不创建命名 prepared statements；本地 postgres.js 可直接用默认值 |
| 类型边界 | 驱动工厂导出 `db` 与 `Db` 类型；查询层只 import 这两者，不直接 import `pg` 或 `postgres` |

```typescript
// lib/db/auth-db.ts（认证连接示意）
const pool = new Pool({
  connectionString: config.AUTH_POSTGRES_URL ?? config.POSTGRES_URL,
  max: 5,
  options: '-c role=auth_service',
});
attachDatabasePool(pool);

export const authDb = drizzle(pool, { schema: authSchema });
```

```typescript
// src/server/db/client.ts（生产示意）
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { config } from '@/server/config';
import * as schema from './schema';

const pool = new Pool({ connectionString: config.POSTGRES_URL, max: 5 });
attachDatabasePool(pool);

export const db = drizzle(pool, { schema });
```

本地路径使用 postgres.js，业务代码不变：

```typescript
// src/server/db/client.ts（本地示意）
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '@/server/config';
import * as schema from './schema';

const client = postgres(config.POSTGRES_URL, { max: 5 });

export const db = drizzle(client, { schema });
```

`attachDatabasePool` 只在生产路径调用，本地不引入 Vercel 运行时依赖。业务模块不感知当前使用哪个驱动。

Neon 的 Vercel 集成可能注入 `DATABASE_URL` / `DATABASE_URL_UNPOOLED`。若使用该集成，在 Vercel 中映射为目标变量名，或调整配置模块的读取名；**不要同时保留两套变量**。

### 3.2 环境作用域

| 环境 | 数据库 | `BETTER_AUTH_URL` | 说明 |
|---|---|---|---|
| Development | 本地 Docker | `http://localhost:3000` | 不需要 Neon |
| Preview | Neon 预览分支或独立 staging 分支 | 该预览部署的域名 | **禁止**指向生产直连 URL；需要迁移时先对分支执行 |
| Production | Neon 生产分支 | 自定义域名 | 发布前先迁移，见 §5.3 |

Vercel 的环境变量同时用于构建与运行。构建命令中**不得**包含迁移；构建环境只需要能通过 `config` 校验的运行期变量。

---

## 4. 目标数据库初始化与迁移

### 4.1 Drizzle 的职责边界

| 职责 | 工具 | 说明 |
|---|---|---|
| 表、列、索引、关系的定义 | Drizzle Schema（TypeScript） | **落地单一来源**；类型由 `$inferSelect` / `$inferInsert` 推导 |
| 迁移 SQL 生成 | `drizzle-kit generate` | 生成后必须人工审查，尤其是唯一索引、外键、`deleted_at` |
| 迁移执行 | `drizzle-kit migrate` | 对 `POSTGRES_URL_DIRECT` 执行；有序、一次性 |
| 扩展、schema、角色、RLS、授权、触发器 | 自定义 SQL 迁移 | Drizzle Schema 无法表达，用 `--custom` 生成空迁移后手写 |
| 临时探索 | `drizzle-kit push` / Studio | 只允许本地；生产禁止 `push` |

类型安全来自 Schema，不来自数据库返回值断言。Repo 层返回 Schema 推导类型，禁止另写一套手写行类型。

### 4.2 迁移顺序

迁移文件以 `lib/db/migrations/meta/_journal.json` 为准（本文不重复枚举；目标设计曾计划拆成更多文件）：

```text
0000_baseline         Drizzle 生成：11 张组织级业务表 + auth.users + 普通索引
0001_auth_rls         自定义：ltree/pg_trgm/btree_gist、auth schema 与 SECURITY DEFINER 函数、
                      app_rw 角色、注册触发器、GRANT、RLS 策略与部分唯一索引
0002_app_role_grant   自定义：app 登录角色存在时 GRANT app_rw TO app
0003_better_auth      自定义：Better Auth 表结构、auth_service 角色、双角色边界、
                      organization 插件所需的策略与触发器；要求 auth/租户数据为空
```

| 迁移 | 为什么必须存在 |
|---|---|
| `0000` | 业务表与 `auth.users`；主键统一 `DEFAULT uuidv7()`，软删列与部分唯一索引 |
| `0001` | 没有 `app_rw`，`SET LOCAL ROLE` 失败；没有 `auth` schema/函数无法认证；没有 RLS 策略与授权，查询越权或返回 0 行；没有触发器，注册后没有默认组织 |
| `0002` | 运行期登录角色 `app` 必须在迁移前创建；该迁移补 `GRANT app_rw TO app`，角色不存在时安全跳过 |
| `0003` | 认证切到自托管 Better Auth；创建 `auth_service`，收回 `app_rw` 对组织/成员/邀请的写权限，并重建 RLS 策略与最后 owner 触发器。**要求空库**：已有 `auth.users` 或 `organization` 行时直接报错 |

自定义迁移用 Drizzle Kit 的空迁移能力创建，例如 `drizzle-kit generate --custom --name=extensions`，再手写 SQL。**已应用的迁移不修改**；修正用新迁移。

### 4.3 执行迁移

生产环境先完成 §4.4 的第 1 步（创建运行期登录角色 `app`），再执行迁移；本地 Compose 的 `app` 已由 `POSTGRES_USER` 提供。

本地：

```bash
pnpm db:generate   # Schema 变更后生成 SQL，人工 review
pnpm db:migrate    # 对本地 PostgreSQL 执行
```

Neon（生产或分支）：

```bash
# 只在可信终端 / CI 的受保护环境中执行，不要写进 Vercel Build Command
POSTGRES_URL_DIRECT='postgresql://<迁移角色>:<pwd>@<direct-host>/<db>?sslmode=require' \
  pnpm db:migrate
```

`drizzle.config.ts` 已实现直连优先（实际路径为当前仓库的 `lib/db/schema.ts` 与 `lib/db/migrations`）：

```typescript
// drizzle.config.ts
export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.POSTGRES_URL_DIRECT ?? process.env.POSTGRES_URL!,
  },
});
```

| 规则 | 原因 |
|---|---|
| 迁移不在 Vercel 构建中执行 | 构建可能重复、并发，Preview 也可能触发；DDL 必须单点、有序 |
| Preview 不自动迁移生产库 | 预览部署数量多，任何一次构建都不应改动生产 schema |
| 迁移先于应用发布 | 避免“新代码访问旧表”的窗口期 |
| 迁移只前进 | M1 不做 down 迁移；破坏性变更用“新增列 → 回填 → 后续删除”三段式 |
| 执行前确认目标 | 先跑 `SELECT current_database(), current_user;`，确认是哪个分支 |

### 4.4 角色与授权

顺序是：先创建两个运行期登录角色 `app` 与 `auth_runtime`（一次性），再执行迁移。`0001` 创建受限角色 `app_rw`，`0002`/`0003` 在登录角色存在时补授权，`0003` 另外创建 `auth_service`。密码只存在于环境变量与 Neon 中，不写进迁移文件。

**第 1 步：运行期登录角色（迁移之前，一次性）**

```sql
-- 本地由 POSTGRES_USER=postgres 提供；生产手工执行一次
-- 不要用 Neon 控制台创建运行期角色：控制台创建的角色会加入 neon_superuser。
CREATE ROLE app LOGIN PASSWORD '<generated>'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

CREATE ROLE auth_runtime LOGIN PASSWORD '<generated>'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
```

**第 2 步：迁移创建受限角色并补授权**

```sql
-- 0001_auth_rls.sql（节选）
CREATE SCHEMA IF NOT EXISTS auth;
CREATE ROLE app_rw NOLOGIN NOSUPERUSER NOBYPASSRLS;

-- 0003_better_auth.sql（节选）
CREATE ROLE auth_service NOLOGIN NOSUPERUSER NOBYPASSRLS;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT app_rw TO app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_runtime') THEN
    GRANT auth_service TO auth_runtime;
  END IF;
END
$$;
```

`app` 的密码写入 Vercel 的 `APP_POSTGRES_URL`，`auth_runtime` 的密码写入 `AUTH_POSTGRES_URL`；两者都不要进入 Git。迁移连接使用 Neon 项目所有者角色（默认 `neondb_owner`），与运行期角色分离。

```sql
-- 授权矩阵（示意）
GRANT USAGE ON SCHEMA public TO app_rw;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_rw;
-- 不授予 DELETE：软删统一走 UPDATE deleted_at
REVOKE INSERT, UPDATE, DELETE ON organization_member FROM app_rw;
REVOKE SELECT, INSERT, UPDATE, DELETE ON invite FROM app_rw;

-- 认证与租户写只属于 auth_service
GRANT USAGE ON SCHEMA auth TO auth_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.users, auth.session, auth.account, auth.verification TO auth_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_member TO auth_service;
GRANT SELECT, INSERT, UPDATE ON organization, invite TO auth_service;

-- app_rw 不得直接读写 auth 表
REVOKE ALL ON auth.users FROM app_rw;
```

> `GRANT ... ON ALL TABLES` 只影响执行时已存在的表。新增表后需要在同一迁移中重新授权，或配置 `ALTER DEFAULT PRIVILEGES`。
>
> 密码由 Better Auth 以 scrypt 存入 `auth.account`；只有 `auth_service` 能读写。`app_rw` 没有 `auth.*` 表权限。
>
> 迁移角色必须能绕过 RLS（Neon 默认所有者角色与本地超级用户满足）。否则 `SECURITY DEFINER` 触发器在 `FORCE RLS` 表上仍会失败，注册会整体回滚。

### 4.5 RLS 验证

这是**必须做**的一步。Neon 控制台与迁移连接通常是所有者角色，可能绕过 RLS；验证必须实际切到 `app_rw`。

先用直连写入最小测试数据（一个用户、两个组织、各一条 `node`），再用运行期连接验证：

```sql
BEGIN;
SET LOCAL ROLE app_rw;

-- 不设 claims，auth.uid() 为 NULL
SELECT count(*) FROM node;      -- 必须返回 0

SELECT set_config('request.jwt.claims',
  '{"sub":"<user-uuid>","role":"authenticated"}', true);
SELECT auth.uid();              -- 必须等于 <user-uuid>
SELECT count(*) FROM node;      -- 必须只等于该用户所属组织的行数

-- 换一个组织 ID 查询，必须仍是 0 行
SELECT count(*) FROM node WHERE organization_id = '<other-org-uuid>';
ROLLBACK;
```

认证表的越权检查放在单独事务里（`permission denied` 会中止当前事务）：

```sql
BEGIN;
SET LOCAL ROLE app_rw;
SELECT count(*) FROM auth.users;   -- 期望：permission denied for table users
ROLLBACK;
```

| 断言 | 期望 |
|---|---|
| 无 claims 查询 `node` | 0 行 |
| 带本组织 claims | 本组织行数 |
| 带其他组织 claims | 0 行 |
| `SELECT auth.uid()` | 返回 claims 中的 `sub` |
| `SELECT * FROM auth.users`（`app_rw`） | `permission denied` |

> 该断言在空表上会“天然通过”。测试库必须先插入数据，再验证跨组织查询返回 0 行。

### 4.6 本地重置

```bash
docker compose down -v          # 删除本地数据卷
docker compose up -d db
pnpm db:migrate
```

本地专用。生产禁止；生产回退见 §6.2。

---

## 5. 构建与部署（Vercel + 自定义域名 + Neon）

### 5.1 Vercel 项目

| 项 | 配置 |
|---|---|
| 导入方式 | Git 仓库连接 Vercel |
| Framework Preset | Next.js（App Router 自动识别） |
| Node.js | 24.x |
| Install Command | `pnpm install --frozen-lockfile` |
| Build Command | `pnpm build`（**不包含迁移**） |
| 区域 | 与 Neon 项目同区域，降低函数到数据库的 RTT |
| 环境变量 | 按 §3 配置 Production / Preview 作用域 |

部署模型是 **Vercel Functions 多实例、无状态**：会话在 Cookie，数据在 Neon，上传/后台任务在 M1 都不存在，因此不需要粘性会话或共享内存。

### 5.2 自定义域名

```text
1. Vercel 项目 → Settings → Domains → 添加 family.example.com
2. 按 Vercel 提示配置 DNS（A / CNAME）
3. 等待 TLS 证书自动签发
4. 把 BETTER_AUTH_URL 设为 https://family.example.com
5. 重新部署，使构建与运行期都读取新的 BETTER_AUTH_URL
```

| 检查项 | 说明 |
|---|---|
| `BETTER_AUTH_URL` 与域名一致 | 邀请链接、Cookie 安全属性与回跳都依赖它 |
| Cookie | `better-auth.session_token`：HttpOnly + Secure + SameSite=Lax；自定义域名下必须能落盘 |
| Neon 网络限制 | 若开启 IP Allow，需要放行 Vercel 出口，或改用可固定出口的方案；否则函数无法连库 |
| 代理链 | Vercel 已终止 TLS；应用不需要再信任额外的 `X-Forwarded-*` 代理头 |

### 5.3 发布顺序

```text
1. CI：pnpm check → pnpm typecheck → pnpm test:coverage → 迁移漂移检查 → pnpm build → pnpm test:e2e → pnpm verify:deploy
2. 对 Neon 生产分支执行迁移（POSTGRES_URL_DIRECT，独立受保护步骤）
3. 部署 / Promote Vercel 生产部署
4. 外部验证：BETTER_AUTH_URL=https://<staging> POSTGRES_URL_DIRECT=<direct> APP_POSTGRES_URL=<app-login> pnpm verify:deploy
5. 外部 E2E（仅 staging）：E2E_ALLOW_EXTERNAL=1 E2E_EXTERNAL_SERVER=1 E2E_BASE_URL=https://<staging> pnpm test:e2e
6. 回滚：Vercel 即时回退到上一部署；数据库按 §6.2 恢复
```

**迁移先于应用启动**。顺序反了会出现“新代码访问旧表”的窗口期；反过来把迁移塞进构建，则可能在多次构建或预览部署中重复执行 DDL。

### 5.4 Preview 部署与 Neon 分支

| 方案 | 做法 | 适用 |
|---|---|---|
| 共享 staging 分支 | Preview 的 `POSTGRES_URL` 指向独立 staging 分支；迁移在分支上手工执行 | 小团队、预览少 |
| 每 Preview 一个 Neon 分支 | 集成在 Preview 创建分支并注入连接串 | 需要隔离数据时 |
| 不接数据库的 Preview | 只验证 UI；不配置数据库变量 | 纯前端改动 |

无论哪种方案，**Preview 不得拿到生产直连 URL**。生产库的迁移只由 §5.3 的独立步骤执行。

### 5.5 CI 清单

```text
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm test:coverage     # 单测 + 集成 + V8 覆盖率门槛
pnpm db:generate && git status --porcelain lib/db/migrations  # 漂移检查
pnpm build
pnpm exec playwright install --with-deps chromium
pnpm test:e2e          # CI=1，production server（pnpm start -p 3100）
pnpm verify:deploy -- --base-url http://127.0.0.1:3100
```

E2E 使用本地 Docker PostgreSQL 或 Neon 预览分支，不使用生产库。迁移作为独立任务，放在受保护环境（需要人工批准）中执行。外部/云端验证模板见 §5.3；本轮仅本地生产模式已执行，云端未执行（无凭据）。

---

## 6. 目标运维

### 6.1 备份

| 类型 | 频率 | 保留 | 位置 |
|---|---|---|---|
| Neon PITR / 历史分支 | 连续 | 按 Neon 当前配置的历史窗口 | Neon |
| 逻辑备份（可选） | 每日 | 30 天 | 对象存储（`pg_dump -Fc`） |

Neon 的 PITR 是主备份手段；逻辑备份用于跨平台迁移与“误删后快速取单表”。`pg_dump` 不包含角色与扩展，恢复时必须先重建 `app_rw` / `app` 与 `ltree` / `pg_trgm`。

```bash
# public、auth 与 Drizzle 迁移记录（默认 drizzle schema）都要备份
pg_dump "$POSTGRES_URL_DIRECT" \
  --schema=public --schema=auth --schema=drizzle \
  -Fc -f backup-$(date +%F).dump
```

### 6.2 恢复

**首选 Neon 分支恢复**：从目标时间点创建分支 → 在分支上验证 schema、RLS、注册触发器 → 把 `POSTGRES_URL` / `POSTGRES_URL_DIRECT` 指向新分支 → 重新部署 → 保留旧分支作为回退。

逻辑恢复：

```bash
# 先确保目标库存在 app_rw / app 角色与 ltree / pg_trgm 扩展
pg_restore -d "$POSTGRES_URL_DIRECT" --no-owner --clean --if-exists backup-2026-10-21.dump
```

恢复后**必须**重跑 §4.5 的 RLS 验证，并确认 `0006_signup_trigger.sql` 的触发器仍在。`--clean` 会重建表，策略与触发器可能丢失。

每季度做一次恢复演练，记录 RPO / RTO 实测值。

### 6.3 监控

| 项 | 阈值 | 动作 |
|---|---|---|
| `GET /api/health` | 连续 3 次失败 | 外部探针告警；检查 Neon 连接与 Vercel 部署 |
| Vercel 函数 5xx | > 1%（5 分钟） | 按 `request_id` 查 Vercel 日志 |
| 保存 p95 | > 2s | 查慢查询与 Neon 指标 |
| Neon 连接数 | > 80% 上限 | 降 `max`、排查连接泄漏或升级规格 |
| Neon CPU / 存储 | 持续高位 | 优化查询或扩容 |
| Vercel 函数时长 | 接近平台上限 | 拆分批量写；M1 无长任务 |

没有外部错误聚合服务。告警源是外部探针与 Vercel / Neon 自带指标；需要更长日志保留时，再接入日志导出（非 M1 范围）。

### 6.4 日志

结构化 JSON 输出到 stdout，由 Vercel 收集。

```json
{"level":"warn","event":"reference_in_use","code":"REF_LINEAGE_IN_USE","organization_id":"0192...","user_id":"0193...","request_id":"req_01J9Z8K2QH","duration_ms":37}
```

| 级别 | 用途 |
|---|---|
| `error` | 需要人工介入（未预期异常、数据库不可用） |
| `warn` | 可预期但值得关注（校验失败、引用冲突、权限不足） |
| `info` | 关键业务动作（组织创建、成员变更） |
| `debug` | 仅开发环境 |

**不要**把日志写文件（函数实例随时回收）。**不要**记录密码、Cookie、会话 token、邀请 ID、完整邮箱。认证相关日志只记录 `user_id` 与结果码。Vercel 日志保留期有限，超出保留期的逐条追溯只能依赖日志导出或 PITR 恢复；M1 不建审计表。

### 6.5 密钥与权限运维

| 项 | 规则 |
|---|---|
| `BETTER_AUTH_SECRET` | 每个环境独立；轮换后该环境全员重新登录，按应急操作处理 |
| `APP_POSTGRES_URL` | 只使用运行期角色 `app`（`NOBYPASSRLS`）+ Neon pooled endpoint |
| `AUTH_POSTGRES_URL` | 只使用运行期角色 `auth_runtime` + Neon **direct** endpoint；连接固定 `role=auth_service` |
| `POSTGRES_URL_DIRECT` | 只在 CI / 运维环境；不配置到 Vercel 运行期 |
| 运行期角色 | 不用 Neon 控制台创建（会加入 `neon_superuser`）；用 SQL 创建普通登录角色 |
| 日志脱敏 | 邀请 ID、Cookie、密码、完整邮箱一律不落日志 |
| 最小权限 | `app_rw` 无 DELETE、无 `auth.*` 表权限、无组织/成员/邀请写权限；这些写操作只属于 `auth_service` |

---

## 7. 目标环境故障排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 启动即退出，日志显示 `Invalid environment variables` | 缺 env 或作用域不对 | 按 §3 补齐；确认 Vercel 环境变量覆盖当前环境 |
| 迁移报 `function uuidv7() does not exist` | Neon 项目或本地镜像低于 PostgreSQL 18 | 升级到 18+；先跑 `SELECT uuidv7();` 自检 |
| 连接报 `password authentication failed` | 使用了直连密码配 pooled 主机，或角色不是 `app` | 核对 §3.1 的两条连接串与角色 |
| 报 `too many connections` | 每实例 pool 过大、实例过多或连接泄漏 | 用 pooled endpoint；`max` 降到 1–5；监控 Neon 连接数 |
| 报 prepared statement 冲突 | 生产用了 `postgres.js` 的预编译语句穿过 Neon 事务池 | 生产改用 `pg` Pool + pooled endpoint；本地 `postgres.js` 不受影响 |
| 所有查询返回 0 行 | `SET LOCAL ROLE app_rw` 没执行，或 `app_rw` 无 `GRANT` | 检查 `withOrg` 与 `0003_better_auth.sql` 的授权 |
| 查询报 `permission denied for schema auth` | 用业务连接访问了 `auth.*` | 业务查询只走 `APP_POSTGRES_URL` + `withOrg`；认证读写只经 Better Auth（`AUTH_POSTGRES_URL`） |
| 查询报 `infinite recursion detected in policy` | `organization_member` 的策略子查询了自己 | 使用 `auth.has_org_role()`（已落地），不要回到裸子查询 |
| 登录后立即掉线 | Cookie 域名 / `SameSite` / `Secure` 配置错，或 `BETTER_AUTH_SECRET` 已轮换 | 检查 `BETTER_AUTH_URL`、Cookie 设置与最近一次密钥轮换 |
| 登录后反复跳回登录页 | `proxy.ts` 只检查 Cookie 存在，权威校验在 `getSessionUser()` | 确认 Cookie 名是 `better-auth.session_token`，且 `BETTER_AUTH_URL` 与访问域名一致 |
| 修改密码后其他设备被登出 | `changePassword({ revokeOtherSessions: true })` 已执行 | 预期行为；重新登录即可 |
| 登录后访问组织 404 | 注册触发器没建或没生效，账号没有组织 | 检查 `trg_auth_user_created` / `handle_new_user()`；查 `organization_member` |
| 注册直接失败 | 触发器报错（多为 slug 冲突或权限不足） | 看 Neon 日志；确认函数是 `SECURITY DEFINER`、owner 为 `auth_service`、`search_path = public, auth, pg_temp` |
| 接受邀请报 `INVITE_INVALID` | 邀请 ID 错误、过期、已接受或已撤销 | 让邀请人重新生成链接；检查 `invite` 与 Better Auth invitation 状态 |
| 切换组织后看到旧数据 | 查询漏了 `WHERE organization_id` | 走 RLS 兜底但性能差，补上应用层条件 |
| 建同名谱书报 23505 | 唯一索引没加 `WHERE deleted_at IS NULL` | 见 [data-model §11.2](./data-model.md#112-唯一约束必须是部分索引) |
| 列表里出现已删数据 | 查询漏了 `deleted_at IS NULL` | 所有业务查询都要带这个条件 |
| 迁移改错了分支 | 直连 URL 指向了生产或错误的 Neon 分支 | 执行前先看 `current_database()`；用分支恢复，不要手改生产 |
| Vercel 构建或函数报连接超时 | Neon IP Allow 未放行、区域不一致或 `sslmode` 缺失 | 检查网络限制与区域；连接串加 `sslmode=require` |
| Vercel 预览能打开但数据异常 | Preview 指向了 staging / 预览分支 | 确认环境作用域与 `BETTER_AUTH_URL`，不要拿生产库做预览 |
| `/api/health` 返回 503 | 数据库不可达或迁移未完成 | 查 Neon 状态与连接数；确认迁移步骤已执行 |
| 日志里没有 `request_id` | 请求入口未生成或未透传 | 在 Server Action / Route Handler 入口统一生成 |

### 7.1 紧急处置

| 场景 | 动作 |
|---|---|
| 数据被误删（无回收站 UI） | 按 [data-model §11.3](./data-model.md#113-整组恢复运维手册) 用 `deleted_at` 整组恢复；先 `pg_dump` 相关表，走工单 |
| 跨组织数据泄露 | 立即下线应用 → 用结构化日志（`request_id` / `user_id` / `organization_id`）定位 → 修复策略 → 隔离验证 → 上线 |
| 数据库连接耗尽 | 降低函数实例数或 `max`；排查未关闭的事务；必要时在 Neon 侧终止会话 |
| 注册触发器异常 | 暂停注册入口 → 修触发器 → 补偿缺失的组织 → 恢复 |
| `BETTER_AUTH_SECRET` 疑似泄露 | 立即轮换密钥 → 全员重新登录 → 排查异常登录日志 |
| 忘记密码且无法登录 | 人工核验身份后，按 [RB-2](./guides/runbooks.md#rb-2-用户忘记密码--强制下线) 更新 `auth.account.password` 并删除该用户会话；无自助找回 |
| Neon 故障 | 查看状态页；短时等待；必要时用最近备份/分支恢复并切换连接串 |
| Vercel 故障 | 查看状态页；回退上一部署；静态资源由 CDN 兜底，动态功能不可用 |

---

## 8. 实现前必须补齐的 P1 项

- 一次性创建运行期登录角色 `app`（`NOBYPASSRLS`）；`0002_app_role_grant` 已负责在角色存在时授权 `app_rw`。把密码写入 Neon 与 Vercel，不写进迁移。
- 固化本地 `postgres.js` / 生产 `pg` Pool 两套驱动工厂与共享 `Db` 类型，并验证 `attachDatabasePool` 在目标 Vercel 运行时释放空闲连接。
- 固定 auth 函数的 `GRANT` / `REVOKE` 矩阵，并加集成测试：`app_rw` 不能直接 `SELECT auth.users`，也不能写 `auth` schema。
- 补齐 RLS 成员管理策略与邀请接受路径（当前目标设计存在已知缺口，见 [data-model §12.4](./data-model.md#124-organization_member-的策略是-rls-的根)）。
- 备份与恢复同时覆盖 `public`、`auth` 与 Drizzle 迁移记录（默认 `drizzle` schema），并演练“重建角色 + 扩展 + 迁移”的完整恢复。
- 为 Preview 选择 Neon 分支策略，并把迁移放进受保护的 CI 步骤；禁止构建期迁移。
- ~~补齐 Playwright 关键路径 E2E~~：已实现（注册 → 建项目 → 建谱系 → 录入始祖/子女 → 检查器 → 侧栏），云端 external 模式待 staging 凭据执行。
- 在 staging 执行 `pnpm verify:deploy` 与 external E2E，覆盖 `pg` + `attachDatabasePool`、pooled/direct 连接分离与 Cookie 落盘。
- 配置外部探针访问 `GET /api/health`，并确认 Vercel 与 Neon 的日志与指标可用于定位 `request_id`。
- 在 Vercel 中配置自定义域名与 `BETTER_AUTH_URL`，验证 Cookie 能正常落盘。
