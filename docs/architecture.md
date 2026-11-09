# 系统架构（Architecture）

> **回答什么问题**：系统边界在哪、代码怎么分层、依赖只允许朝哪个方向、跑在什么上面。
> **读者**：全员 · 新人第二份　**长度上限**：6 页
> **不写什么**：接口清单与 DTO（`docs/interfaces.md`、`docs/contracts/`）、表与列（`docs/data-model.md`）、可度量阈值（`docs/nfr.md`）、进度与编排（`docs/roadmap.md`）、命令与排障（`docs/runbooks/`）、「为什么选 A 不选 B」（`docs/adr/`）。

术语一律按 `docs/glossary.md`。本文只写**当前实现**；架构变了先改本文，再改引用方，不在 `plan.md` 里重述整体架构。

---

## 1. 系统边界

**模块化单体**：一个 Next.js 应用承载页面、Server Action 与 Route Handler，全部业务域共用一个 PostgreSQL。没有微服务、消息队列、后台任务、独立缓存层、API 网关。Better Auth 是应用内嵌的库，自己持有 `auth` schema，**不是外部身份提供方**。

| 能力 | 落地位置 |
| --- | --- |
| 账号与会话 | `lib/auth/`、`app/(login)/` |
| 组织：成员 / 角色 / 邀请 / 活动流 | `lib/org/`、`app/(dashboard)/dashboard/org/` |
| 云谱空间（`project`）与设置 | `lib/project/`、`app/(dashboard)/dashboard/project/[projectRef]/` |
| 分类树 | `lib/folder/` |
| 谱系、人丁、世次、字辈、世系画布 | `lib/lineage/`、`components/lineage/` |
| 谱文：列表 / 三区编辑器 / 正文插图 | `lib/article/`、`components/article/` |
| 只读刷新 / 健康检查 / 图片通道 | `app/api/` |
| 打印 | 谱系工作区的 `print:` 样式，不是独立路由 |

外部依赖只有 **Vercel**（运行时）与 **Neon**（数据库），任一不可用即全站不可用，没有降级路径。产品范围的「明确不做」在 `docs/vision.md`；架构层面的刻意排除（无后台任务、无队列、无独立缓存、无网关）连同重新考虑条件在 `docs/adr/`，本文不重列。

---

## 2. 运行时结构

```text
浏览器
  RSC 首屏 ───────────────────────────┐
  客户端组件 ─ TanStack Query 缓存 ────┤
                                      ↓
  ┌── Next.js 应用（Vercel 函数，无状态） ──────────────────────┐
  │  proxy.ts            Cookie 存在性乐观门禁，不查库            │
  │  Server Action       唯一写通道 → lib/<domain>/actions.ts    │
  │  Route Handler       只读刷新 · 健康检查 · 图片通道           │
  │  Better Auth         进程内库，数据库会话 + scrypt            │
  └───────┬───────────────────────────────┬────────────────────┘
          │ APP_POSTGRES_URL               │ AUTH_POSTGRES_URL
          │ pooled · 事务内 SET LOCAL ROLE genealogy_app
          │                               │ direct · 固定 auth_service
          ↓                               ↓
     Neon PostgreSQL 18   public schema（RLS，非 FORCE） / auth schema
```

浏览器里的 zustand **只存谱系工作区的视图状态**，不存实体、不 persist；实体来自 RSC props 与 Action 结果。

三条不能碰的运行期规则：

1. **两条连接不能混用**：业务用 `APP_POSTGRES_URL`（基线创建的 LOGIN 角色 `genealogy_app`，`withOrg` 内 `SET LOCAL ROLE genealogy_app` 把角色钉死），认证用 `AUTH_POSTGRES_URL`（`auth_runtime` → 固定 `auth_service`）。认证侧必须独立：`auth.*` 四表无 RLS，共用业务角色会让它直读密码哈希与会话 token。`SET LOCAL` 是事务级；会话级 `SET` 会把角色与声明泄漏给下一个借用该连接的请求。
2. **组织隔离三层**：应用层按成员关系过滤 + RLS（`genealogy_app` + `app.visible_org_array()` 的 InitPlan 谓词）+ 复合外键。**RLS 是兜底，不是替代品**；公开 `slug` / `ref` 只用于定位，不是授权凭证，非成员一律 404。
3. **读走 RSC、写走 Server Action**：首屏服务端直接查库；客户端不手写 `fetch`，`queryKey` 一律从 `lib/query-keys.ts` 取，缓存新鲜度只由 `staleTime` 决定。

---

## 3. 模块划分

四层，依赖只朝下。读路径不引入 repository 抽象，写路径不引入 service 三层文件。

```text
app/**/page.tsx · app/api/**/route.ts        入口层
        ↓
lib/<domain>/actions.ts · *-services.ts       应用层
        ↓
lib/db/queries/<domain>.ts                    查询层
        ↓
lib/db/drizzle.ts · lib/db/auth-db.ts         连接层
        ↓
PostgreSQL（业务 genealogy_app / 认证 auth_service）
```

| 层 | 职责 | 禁止 |
| --- | --- | --- |
| 入口层 `app/` | 解析 URL 与 scope、取首屏数据 | 不拼 SQL、不手写权限判断、不做多步写 |
| 应用层 `lib/<domain>/` | Zod 校验、`hasPermission`、开事务、返回 `ActionState` | 不串联多个独立事务、不抛异常堆栈给 UI |
| 查询层 `lib/db/queries/` | 组织级过滤、`isNull(deletedAt)` | 不 import Action、不读 `auth.*`、不开事务 |
| 连接层 `lib/db/drizzle.ts` | 两个连接单例、`SET LOCAL` 上下文 | 不写业务逻辑、不用会话级 `SET` |

物理目录树与「新增一样东西放哪」见下文「项目结构」。每张表有且只有一个 owner，跨域读调用 owner 域的查询函数，不直接 join 别人的表。

| 域 | 拥有的表 | 写入口 |
| --- | --- | --- |
| `auth` | `auth.user` / `session` / `account` / `verification` | `lib/auth/`、`auth.api.*`（认证连接） |
| `organization` | `organization` / `organization_member` / `invite` / `activity_logs` | `lib/org/` |
| `project` | `project` | `lib/project/` |
| `folder` | `folder` | `lib/folder/` |
| `lineage` | `lineage` / `node` | `lib/lineage/` |
| `article` | `article` | `lib/article/actions.ts`、`lib/db/queries/articles.ts` |
| 谱书 / 编目 | `book` / `book_catalog` | **无**：表已落库，无 Action 与查询函数 |
| 事实层 | `person` / `person_name` / `family` / `family_*` / `event` | 应用主数据源：写走 Server Action（`lib/<domain>/actions.ts`）、读走查询层 `lib/db/queries/`；`node` 只是 `person` 在谱系树上的位置引用 |

**schema 文件名不等于域所有权**：`project.ts` 同时定义 `project` 与 `folder`，但 `folder` 的写入口在 `lib/folder/`；`content.ts` 定义 `article` / `book` / `book_catalog`，但业务域叫 **`article`**，不存在一个叫 `content` 的域。schema 按内容分组，域按写入口划分，两套名字不要互相代入。

事实层六表是身份、姓名、亲属关系与生卒等事实的**主数据源**，由应用直接读写：写走 Server Action、读走查询层，不再有回填 / 对账 CLI。谱系层 `node` 只是 `person` 在树上的位置引用，不再承载完整身份。**[目标]** 事实层六表与 `lineage` / `node` 共八张表一律 `ON DELETE RESTRICT` 硬删、没有软删列；**[现状]** 尚未切换的表（如 `folder`、`project`、`article`、`book_catalog`）仍用 `deleted_at` 软删且查询默认过滤，没有回收站 UI；`organization_member` 与 `invite` 是硬删除。

---

## 4. 依赖方向与事务

三条依赖方向由 Biome `noRestrictedImports` 自动拦截（`pnpm check`）：客户端组件不得 import `@/lib/db/*` 与 `drizzle-orm`；`lib/db/**` 不得 import `next/*`；`lib/db/queries/**` 不得 import `@/lib/*/actions`。其余靠评审。

事务：一个写入口一个事务，由 Action 或该域 `*-services.ts` 打开，`*Tx` 变体只接已有事务、不再开新事务。`withOrgWrite()` 把「开组织范围事务 + 事务内复权」合成一步——事务外读到的角色可能已过期，必须用 `getOrgRoleInTx(tx, ...)` 锁定读重判。多步写失败整体回滚，不留半成品；没有补偿任务、没有重试队列。

---

## 5. 技术栈

> **版本基线唯一在 `package.json`**：本表不写精确版本号，也不写「放弃的替代」——那是决策记录的职责。新增依赖须说明为什么现有能力不够。

| 层 | 选型 | 作用 |
| --- | --- | --- |
| 框架与运行时 | Next.js App Router · React · Node.js 24 LTS · pnpm | RSC 首屏直读、写走 Server Action；与 Vercel 运行时一致 |
| 语言与检查 | TypeScript（strict）· Biome · Zod | 类型、依赖方向与格式、外部输入统一校验 |
| 数据库与 ORM | PostgreSQL 18（Neon）· Drizzle | 需要 `ltree` / RLS / 非属主角色；迁移可读可审 |
| 认证 | 自托管 Better Auth（organization 插件） | 数据库会话 + scrypt，不依赖外部 IdP |
| 客户端数据 | TanStack Query · zustand | 只读刷新缓存；zustand 只管谱系工作区视图状态 |
| UI 与画布 | Tailwind · shadcn/ui · @xyflow/react | 组件源码进仓库；可交互世系画布 |
| 富文本与图片 | TipTap · Vercel Blob | 谱文正文编辑与插图；本地 / CI 落 `.data/media/` |
| 测试 | Vitest · Playwright | 单测 + 真实 PostgreSQL 集成测试 + 关键路径 E2E |
| 部署 | Vercel · Neon | 无状态函数 + 托管数据库，无常驻进程 |

`postgres`（本地 / CI）与 `pg`（生产）两个驱动并存是刻意的：生产要 `attachDatabasePool` 在实例冻结时回收连接，本地要 prepared statements。差异由 `lib/db/drizzle.ts` 与 `lib/db/auth-db.ts` 吸收，查询层不直接 import 驱动。

---

## 6. 项目结构

> 与 `README.md` 的文档分层树互补：那份回答「文档按变化频率放哪层」，这份是**整个仓库的物理地图**。逻辑分层与域所有权见上文「模块划分」，本节只回答「文件放哪」。

只列到二级；树里的路径都以仓库实际存在为准。

```text
/
├── app/                    路由与页面：(marketing) / (login) / (dashboard) / api
├── components/             控制台框架、谱系工作区、谱文编辑器、components/ui 基础组件
├── lib/                    服务端逻辑
│   ├── <domain>/           actions.ts / *-services.ts（域按写入口划分）
│   ├── db/schema/          表定义（按内容分组，文件名不等于域）
│   ├── db/queries/         只读查询与单表写
│   ├── db/migrations/      迁移 SQL 与 meta/_journal.json（唯一清单）
│   └── config.ts           唯一读 process.env 的地方
├── hooks/                  客户端 React hook
├── scripts/                文档 / 架构 / 部署校验脚本
├── tests/                  单测 + 真实 PostgreSQL 集成测试 + Playwright E2E
├── .github/workflows/      CI 与生产迁移 job
├── .specify/               治理层：constitution 与 spec / plan / tasks 模板
├── docs/                   项目层长期活文档（本文件所在层）
├── specs/                  交付层：NNN-xxx/ 工作产物（模板在 .specify/templates/）
└── <根配置>                package.json / tsconfig.json / biome.json / next.config.ts /
                             drizzle.config.ts / proxy.ts / instrumentation.ts /
                             vitest*.config.ts / playwright.config.ts / .env.example
```

**落点规则**（新增一样东西时照表放，不要另起一套）：

| 要加的东西 | 放哪 | 不要放哪 |
| --- | --- | --- |
| 新表 | `lib/db/schema/<domain>.ts` | 不在页面或 Action 里建表 |
| 新查询 | `lib/db/queries/<domain>.ts` | 不在页面里拼 SQL |
| 新写操作 | `lib/<domain>/actions.ts` | 不放进 Route Handler |
| 多步事务 | `lib/<domain>/*-services.ts` | 不在 Action 里串联多个事务 |
| 新页面 | `app/(dashboard)/` | 不放进 `components/` |
| 新组件 | `components/<区域>/` 或 `components/ui/` | 不在页面里堆大段 JSX |
| 校验 schema | `lib/auth/`、`lib/genealogy/` | 不散落在组件里 |
| 迁移 | `lib/db/migrations/`（生成后人工 review） | 不手抄编号、不夹带数据修复 |
| 校验脚本 | `scripts/` | 不混进业务测试 |
| 验收测试 | `tests/` | 不放进 feature 目录当文档 |

两条硬规则：

- **没有 `src/modules`**，不用 `*.service.ts` / `*.repo.ts` 后缀；目录跟着已存在的调用方长，不跟着预测长。
- **基线只留一处**：版本与命令在 `package.json`，环境变量在 `lib/config.ts`，迁移清单在 `lib/db/migrations/meta/_journal.json`，术语在 `docs/glossary.md`。文档不另立基线表，也不写「当前有 N 张表 / N 个依赖」这类会过期的汇总数字。

---

## 7. 部署形态

| 部署单元 | 跑什么 |
| --- | --- |
| Vercel 函数 | 页面 / Action / Route Handler / Better Auth；按请求自动水平扩，实例间无共享状态 |
| Neon 计算实例 | `public` + `auth` 两个 schema；空闲可自动挂起 |
| 本地 Docker | 仅 PostgreSQL，应用跑 `next dev`；不构建应用镜像、不起反向代理 |
| CI runner | 构建、单测、集成测试、E2E、部署校验 |
| 生产迁移 job | `lib/db/migrations/**` 变更时对生产库执行迁移，**不在 Vercel 构建里** |

发布顺序：PR 全绿 → 合并 `main`（改了迁移则生产迁移 job 先执行）→ Vercel 构建部署 → `GET /api/health` 自检。回滚 = Vercel 回退上一部署 + Neon 分支 / PITR 恢复数据，**没有应用层回滚脚本**。**迁移必须先于应用启动**：反了会出现「新代码访问旧表」的窗口；塞进构建则会在多次构建或 Preview 中重复执行 DDL。

环境变量全部集中在 `lib/config.ts`，由 `getServerConfig()` 在 `instrumentation.ts` 启动时用 Zod 校验，缺项或格式错直接抛错，不带病运行。变量清单与作用域在 `docs/runbooks/`。对象存储只有一处例外：谱文正文插图走 Vercel Blob 私有桶。

---

## 8. 以代码为准

适用范围：本节只对 [现状] 成立；[目标] 以 `docs/data-model.md` 为准，裁决顺序见 `CONTRIBUTING.md` §2「权威口径」。

> 文档与代码冲突时**以代码为准**，然后回来改文档。以下结论都有仓库内依据，不以「文档曾写过什么」为凭。

| 结论 | 依据 |
| --- | --- |
| 谱文编辑已实现，业务域叫 `article` 不叫 `content` | `lib/article/actions.ts`、`lib/db/queries/articles.ts`、`components/article/editor/tiptap-editor.tsx` |
| TipTap 已安装并在用 | `package.json` 的 `@tiptap/core` / `react` / `starter-kit` / `pm` / `extension-image` / `extension-text-style` |
| 谱文插图上传已实现 | `app/api/media/upload/route.ts`、`app/api/blob/upload/route.ts`、`app/api/media/[...key]/route.ts`、`lib/article/media/` |
| Route Handler 共 7 个，不止只读刷新 | 4 条只读（`health` / `orgs` / `projects` / `user`）+ 3 条图片通道 |
| 谱书与编目仍无写入口 | `lib/db/schema/content.ts` 有 `book` / `book_catalog`，但 `lib/db/queries/` 无对应查询、`components/` 无编目编辑器 |
| 云谱空间是 `project`，不是组织的别名 | `docs/glossary.md`；`lib/db/schema/project.ts` |

改文档前先跑：

```bash
ls lib/
find app/api -name route.ts | sort
grep -rn "pgTable(" lib/db/schema/
grep -n "@tiptap" package.json
```

---

## 9. 约束要有执行者

> 写在文档里但拦不住的规则，等于没有规则。新增规则前先确认它能让 CI 变红。

| 约束 | 执行者 |
| --- | --- |
| 单文件 ≤400 行（`app` / `components` / `lib` / `hooks`，存量豁免只许缩不许涨） | `pnpm arch:check` → `scripts/check-file-size.mjs` |
| `process.env` 只在 `lib/config.ts` 读 | `pnpm arch:check` → `scripts/check-env-access.mjs` |
| 三条依赖方向 | `pnpm check` → Biome `noRestrictedImports` |
| 组织隔离与 `genealogy_app` 读 `auth.user` 被拒 | `tests/integration/org-scope.test.ts` |
| 迁移漂移（生成后无未提交 DDL） | CI：`pnpm db:generate` 后检查 `lib/db/migrations` 无改动 |
| 生产迁移先于部署 | `.github/workflows/migrate-production.yml` |
| 文档链接与过期路径 | `pnpm docs:check --strict` |
| 部署后自检 | `pnpm verify:deploy` → `scripts/verify-deployment.mjs` |

这些约束的「为什么」在 `docs/adr/`；本文只记**现在是什么、谁在拦**。
