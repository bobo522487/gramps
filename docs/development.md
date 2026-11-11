# 开发与测试（Development）

> **回答什么问题**：本地怎么跑起来、命令是什么、测试分几层、CI 与部署怎么走、常见故障怎么排。
> **读者**：开发 · 新人 · 值班　**长度上限**：6 页
> **不写什么**：架构与依赖规则（`docs/architecture.md`）、表结构（`docs/data-model.md`）、生产发布与回滚步骤（`docs/runbooks/`）、可度量阈值（`docs/nfr.md`）。

## 1. 前置条件

| 工具 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | `>=26.0.0 <27` | `.nvmrc` 固定 26.13.0 |
| pnpm | `12.18.0` | `packageManager` 字段固定 |
| PostgreSQL | 18 | 本地 Docker 或远程 Neon |
| Docker | 可选 | `pnpm db:setup` 本地库需要 |

```bash
node -v      # v26.x
pnpm -v      # 12.18.0
```

## 2. 首次启动

```bash
pnpm install
pnpm db:setup        # 交互式：选 Docker 本地库或输入远程 POSTGRES_URL，生成 .env
pnpm db:migrate      # 应用唯一基线 0000_target_schema.sql
pnpm db:seed         # 可选：演示账号与数据
pnpm dev             # next dev --turbopack → http://localhost:3000
```

### 2.1 `db:setup` 做了什么

`lib/db/setup.ts`：

1. 询问本地 Docker（`L`）还是远程（`R`）；
2. 本地：检查 Docker → 生成 `docker-compose.yml`（`postgres:18-alpine`，端口 `54322`）→ `docker compose up -d`；
3. 写入 `.env`（**会覆盖已有 `.env`**，请先备份）：
   - `POSTGRES_URL`
   - `BETTER_AUTH_SECRET`（随机 ≥32 字符）
   - `BETTER_AUTH_URL=http://localhost:3000`

### 2.2 演示数据

`pnpm db:seed` 使用 Better Auth 自己的注册/登录接口创建：

- 账号：`test@test.com`
- 密码：`admin123`
- 组织：`测试组织`
- 两个演示云谱空间：`示例云谱`（颍川陈氏宗谱）与 `支系档案`（漳州陈氏支谱）

这样 `handle_new_user` 触发器与个人组织创建路径与生产一致。

## 3. 环境变量

变量名、取值与最小可用 `.env` 见 [`.env.example`](../.env.example)（复制为 `.env` 即可本地启动）；校验逻辑见 [`lib/config.ts`](../lib/config.ts) 与 [infrastructure.md](infrastructure.md) §1。本文件不复制第二份清单。

> `.env` 必须是 `.env`，不是 `.env.local`（`db:setup` 与脚本按此约定读取）。

## 4. 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 开发服务器（Turbopack） |
| `pnpm build` | 生产构建 |
| `pnpm start` | 启动生产构建 |
| `pnpm check` | Biome check（lint + format + import 规则） |
| `pnpm lint` / `pnpm format` / `pnpm fix` | 分项 / 自动修复 |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm arch:check` | F6 文件行数 + F7 env 访问 |
| `pnpm docs:check` | 文档链接与一致性 |
| `pnpm db:generate` | 由 TS schema 生成迁移 |
| `pnpm db:migrate` | 应用迁移 |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm db:provision-roles` | 创建/更新数据库角色（迁移前） |
| `pnpm db:reset-target` | 清空目标库（重建模式，需 `--apply --confirm=<db>`） |
| `pnpm verify:target-schema` | 目标态 schema 全量校验 |
| `pnpm verify:deploy` | 部署后自检 |
| `pnpm test` / `test:integration` / `test:coverage` / `test:e2e` | 测试 |

## 5. 数据库工作流

### 5.1 角色必须先于迁移

```mermaid
flowchart LR
  R["pnpm db:provision-roles --apply --roles-only"] --> M["pnpm db:migrate"]
  M --> G["pnpm db:provision-roles --apply --grants-only"]
  G --> V["pnpm verify:deploy"]
```

原因：

- 基线只建 schema，第一条 `GRANT` 就要求角色已存在；
- `genealogy_app` / `auth_service` / `auth_runtime` 是**部署配置**，不是 schema 的一部分；
- 角色口令来自 `APP_DB_PASSWORD` / `AUTH_DB_PASSWORD`，绝不写进 SQL。

### 5.2 迁移体系

- 唯一基线：`lib/db/migrations/0000_target_schema.sql`；
- `drizzle-kit migrate` 应用；
- CI 会跑 `db:generate` 检查 **schema 漂移**：如果生成需要交互或产生新迁移文件，直接失败；
- 生产迁移由 `.github/workflows/migrate-production.yml` 在 `lib/db/migrations/**` 变更时触发；
- 重建模式需手动 `workflow_dispatch` + `reset=true`，会清空 `public/auth/app/drizzle` 四个 schema。

### 5.3 常见迁移陷阱

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 迁移「applied successfully」但表不存在 | 旧库 + `CREATE TABLE IF NOT EXISTS` | 使用重建模式或检查 `drizzle.__drizzle_migrations` |
| Neon 拒绝 `CREATE ROLE ... PASSWORD 'app_pw'` | 弱口令（XX000） | 角色交给 `provision-roles`，用强口令 |
| 角色不存在，GRANT 失败 | 顺序错误 | 先 `--roles-only` 再 migrate |
| `auth` 连接报 pooler 错误 | 用了 `-pooler.` 端点 | `AUTH_POSTGRES_URL` 必须直连 |
| 业务查询恒返回 0 行 | `app.user_id` GUC 未注入 | 确认走 `withOrg()`，不要直接用 `db` |

## 6. 测试

### 6.1 分层

| 层 | 配置 | 范围 | 依赖 |
| --- | --- | --- | --- |
| 单元 | `vitest.config.ts` | `tests/*.test.ts(x)`：纯函数、schema、状态机 | 无数据库、无服务 |
| 集成 | `vitest.integration.config.mts` | `tests/integration/**`：服务层、查询、RLS、事务 | 真实 PostgreSQL |
| E2E | `playwright.config.ts` | `tests/e2e`：登录 → 组织 → 项目 → 谱系/谱文 | 完整应用 + 浏览器 |

集成测试要求：

- 使用 `TEST_POSTGRES_URL`，数据库名必须以 `_test` 结尾（测试会 truncate）；
- `fileParallelism: false`，避免共享库竞争；
- **不要 mock 服务层**：集成测试的价值就是验证真实 SQL、RLS 与事务。

### 6.2 覆盖率

- 阈值数值只在 [`vitest.coverage.config.ts`](../vitest.coverage.config.ts) 的 `thresholds` 定义，本文不复制；「谁让它变红」的登记见 [`docs/nfr.md`](nfr.md) §2；
- 由 `pnpm test:coverage` 执行（单测 + 集成）；
- CI 上传 `coverage/` 产物。

阈值是**下限不是目标**：刻意比实测基线低约 2 点，基线上涨后只许抬高。

### 6.3 E2E 关键路径

Playwright（chromium 单 worker 串行）：

1. 注册/登录；
2. 进入组织与云谱空间；
3. 创建谱系 → 录入始祖/子女；
4. 创建谱文 → 编辑 → 自动保存 → 刷新回显；
5. 上传图片（E2E 用空 `BLOB_READ_WRITE_TOKEN` 钉回 fs 模式）。

## 7. CI（`.github/workflows/ci.yml`）

```mermaid
flowchart TB
  A["checkout + pnpm + node(.nvmrc)"] --> B["pnpm install --frozen-lockfile"]
  B --> C["pnpm check"]
  C --> D["pnpm docs:check"]
  D --> E["pnpm arch:check (F6/F7)"]
  E --> F["pnpm typecheck"]
  F --> G["provision roles --roles-only"]
  G --> H["pnpm db:migrate"]
  H --> I["pnpm verify:target-schema"]
  I --> J["provision grants --grants-only"]
  J --> K["pnpm test:coverage"]
  K --> L["drizzle 漂移检查"]
  L --> M["pnpm build"]
  M --> N["Playwright E2E"]
  N --> O["start :3100 → verify-deployment"]
```

CI 使用 `postgres:18-alpine` service，设置：

```text
POSTGRES_URL=postgres://postgres:postgres@localhost:5432/gramps_test
APP_POSTGRES_URL=postgres://genealogy_app:app_pw@localhost:5432/gramps_test
AUTH_POSTGRES_URL=postgres://auth_runtime:auth@localhost:5432/gramps_test
```

## 8. 生产部署

### 8.1 Vercel 配置

| 项 | 值 |
| --- | --- |
| Node | 24.x |
| 构建 | `pnpm build` |
| 环境变量 | 以 [`.env.example`](../.env.example) 与 [infrastructure.md](infrastructure.md) §1 为准：业务连接走 pooled endpoint、认证连接必须 direct、Blob token 决定媒体模式、`BETTER_AUTH_URL` 为生产绝对 URL |

### 8.2 迁移 job

`.github/workflows/migrate-production.yml`：

1. 校验 `POSTGRES_URL_DIRECT` 与 `APP_DB_PASSWORD` 存在；
2. （可选）重建模式清库；
3. `provision-roles --apply --roles-only`；
4. `db:migrate`；
5. 失败时运行 `diagnose-drizzle-state.mjs` + `diagnose-migration.mjs`；
6. `provision-roles --apply --grants-only`；
7. `verify-deployment.mjs --skip-http`。

并发组 `production-migration`，`cancel-in-progress: false` —— 迁移不允许被新提交打断。

### 8.3 上线自检

```bash
curl -s https://<host>/api/health
pnpm verify:deploy
```

`verify-deployment.mjs` 检查：

- HTTP 安全头（CSP-Report-Only、HSTS、X-Frame-Options、nosniff、Referrer-Policy）；
- `/api/health` 返回 `database: up`；
- 数据库角色、schema、关键表/策略/触发器/函数存在；
- 输出 `PASS/FAIL/SKIP`，任一 FAIL 退出非零。

## 9. 排障速查

| 问题 | 排查 |
| --- | --- |
| 启动即报环境配置错误 | `instrumentation.ts` 的 `getServerConfig()` 输出会列出具体字段 |
| 所有组织查询为空 | 是否绕过 `withOrg()`；GUC 是否为 `app.user_id` |
| 写操作返回 forbidden | Action 权限 vs 事务内角色；检查 `organization_member.role` |
| 删除项目提示还有内容 | `PROJECT_CHILD_CONSTRAINTS` 中某表有行 |
| 谱文保存失败 | `ARTICLE_ERRORS` 文案；检查页 id、图片 pathname 前缀、页数/图片数上限 |
| 图片 404 | 媒体模式与 pathname 是否匹配；谱文是否仍存在；`parseMediaPathname` 是否通过 |
| `drizzle-kit` 交互提示 | TS schema 与 snapshot 漂移，先 `db:generate` 提交迁移 |
| E2E 页面不水合 | `allowedDevOrigins` 是否包含 `127.0.0.1` |
