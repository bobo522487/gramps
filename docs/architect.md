# 架构设计

> **文档状态：M1 目标设计（尚未实现）** · 最后更新：2026-10-21
> 当前仓库实现与此文档存在系统性差异，请先读 [实现状态](./implementation-status.md)。

| 项 | 值 |
|---|---|
| 文档版本 | 1.4 |
| 文档状态 | M1 目标设计（尚未实现） |
| 最后更新 | 2026-10-21 |
| 架构风格 | 模块化单体（Modular Monolith），单一 Next.js 应用 |
| 技术栈 | TypeScript · Next.js 16 App Router · PostgreSQL 18+ · Drizzle 0.43 · postgres.js（本地）/ pg + attachDatabasePool（生产） · React Flow |
| 运行时 | 本地：Docker 只跑 PostgreSQL + `next dev`；生产：Vercel + Neon PostgreSQL 18+ |
| 工具链 | Biome · Vitest · Playwright E2E |
| 规模 | 10 张业务表 + `auth.users` · 6 个模块 · 1 个 Route Handler · 0 个后台任务 |
| 相关文档 | [PRD](./prd.md) · [数据模型](./data-model.md) · [接口](./api.md) · [部署](./ops-target.md) · [实现状态](./implementation-status.md) |

---

## 1. 目标与约束

### 1.1 架构目标

| # | 目标 | 可验证的判据 |
|---|---|---|
| G1 | 单组织数据不可被跨组织访问 | 隔离测试：换一个 `organizationId` 查询必须返回 0 行 |
| G2 | 十万级人丁的谱系图可交互 | 首屏 ≤ 1.5s，拖拽 ≥ 45fps（1000 节点） |
| G3 | 一人一套代码可维护 | 新增一个业务实体 ≤ 3 个文件 + 1 个迁移 |
| G4 | 故障可定位 | 每个错误响应带 `request_id`，能在日志里串起完整链路 |
| G5 | 基础设施成本可控 | 月成本 ≤ ¥900（百级组织规模） |
| G6 | M1 的每一行代码都在为 M2 铺路 | 编目结构、`cover_spec`、`hide` 字段现在就正确，M2 只加渲染不改模型 |

### 1.2 约束

| 类型 | 约束 |
|---|---|
| 团队 | 1–3 人全栈，无专职运维、无 DBA |
| 规模 | 百级组织、十万级人丁/组织、峰值 QPS < 50 |
| 合规 | 家谱含在世人口信息，数据不得跨组织泄露 |
| 交付 | M1 只做「录入与结构化」，不做渲染、分享、协作 |
| 运维 | 使用 Vercel + Neon 托管，无专职运维；允许分钟级发布中断 |

### 1.3 非目标

微服务、事件驱动、多 region 双活、实时协同（CRDT）、插件化模板市场、字段级权限。理由见 §13 ADR。

---

## 2. 系统上下文

```
                    ┌──────────────────────────┐
                    │   谱系编纂 SaaS（本系统）  │
                    └────────────┬─────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
        ┌─────▼─────┐     ┌──────▼──────┐    ┌──────▼──────┐
        │  编纂者    │     │   Vercel    │    │  运维        │
        │ (浏览器)   │     │ Next.js +   │    │ (日志/探针)  │
        └───────────┘     │ 自定义域名   │    └─────────────┘
                          └──────┬──────┘
                                 │ pg.Pool + attachDatabasePool（Neon pooled）
                          ┌──────▼──────┐
                          │    Neon     │
                          │ PostgreSQL  │
                          │    18+      │
                          └─────────────┘
```

| 外部角色 | 交互方式 | 说明 |
|---|---|---|
| 编纂者 | 浏览器，登录后使用 | 修谱工作室成员或家族内部人员 |
| Vercel | HTTPS + 托管 Next.js | 应用运行、TLS、自定义域名、CDN |
| Neon | `pg` 连接池 + `attachDatabasePool` | 托管 PostgreSQL 18+；10 张业务表 + `auth.users` |
| 运维 | Vercel / Neon 日志、`GET /api/health` | 无外部监控服务；故障排查靠结构化日志与探针 |

**M1 没有匿名访问者。** 所有页面都需要登录——没有分享页，没有公开 API。M2 引入分享后才出现「族内读者」这个角色。

---

## 3. 部署视图

```
┌───────────────────────────────────────────────────────────────┐
│ 浏览器                                                         │
│  React 19 客户端组件（画布、编辑器、表单）                        │
└───────────────────────────┬───────────────────────────────────┘
                            │ HTTPS
┌───────────────────────────▼───────────────────────────────────┐
│ Vercel（Next.js 运行时，多实例无状态）                            │
│                                                               │
│  Next.js 16 App Router                                        │
│   ├─ RSC            读操作，服务端直出                          │
│   ├─ Server Action  写操作                                      │
│   └─ Route Handler  1 个：/api/health                           │
│                                                               │
│  业务模块（6 个）                                               │
│  认证：bcrypt 校验 + jose JWT 签发/验签（进程内）                 │
│  仓储层（Drizzle；本地 postgres.js / 生产 pg）                   │
└───────────────────────────┬───────────────────────────────────┘
                            │ pg.Pool + attachDatabasePool（pooled endpoint）
┌───────────────────────────▼───────────────────────────────────┐
│ Neon PostgreSQL 18+                                           │
│  ├─ public schema：10 张业务表（全部强制 RLS）                   │
│  └─ auth schema：auth.users 与 SECURITY DEFINER 认证函数         │
└───────────────────────────────────────────────────────────────┘
```

本地开发时，数据库由 Docker 提供，Next.js 用 `next dev` 在宿主机运行；Vercel 与 Neon 只用于生产。

### 3.1 运行时清单

| 运行时 | 技术 | 职责 | 伸缩 |
|---|---|---|---|
| Web 应用 | Vercel（Next.js 16 / Node 22） | 全部业务逻辑、页面渲染、认证与会话 | 自动水平扩 |
| 数据库 | Neon PostgreSQL 18+ | 数据存储、RLS 隔离、`auth` schema | 托管 |

### 3.2 关键形态决策

| 决策 | 结论 | 依据 |
|---|---|---|
| 进程数 | **Vercel Functions 多实例，无状态** | 所有工作在单次请求内完成 |
| 后台任务 | **0 个** | 邀请过期由查询时判断；软删无清理任务；无异步需求 |
| 消息队列 | **无** | 没有消费者 |
| 缓存层 | **无**（M1） | Next.js 自带 RSC 缓存足够；触发条件见 §12 |
| 数据库连接 | **Neon pooled endpoint；生产 `pg.Pool` 每实例 max = 1–5** | serverless 多实例下避免连接数爆炸 |
| 数据库驱动 | 本地 `postgres.js`；生产 `pg` + `@vercel/functions` 的 `attachDatabasePool` | 本地轻量、API 简洁；生产按 Vercel 官方方式管理连接生命周期 |
| 迁移/备份 | 使用 Neon direct 连接 `POSTGRES_URL_DIRECT` | 长事务与 `pg_dump` 不占应用连接池 |
| 认证 | **应用运行时内** | bcrypt + jose，不依赖外部 IdP |
| 对外接口 | **1 个 Route Handler** | 只有健康检查需要标准 HTTP 语义 |

---

## 4. 组件视图

### 4.1 模块划分

按**业务能力 + 数据所有权**切分，不按技术层切分。

```
src/
├── app/                        # 路由与页面（只做适配）
├── modules/
│   ├── identity/               # 成员、邀请
│   ├── organization/           # 组织、默认组织
│   ├── project/                # 云谱空间、分类
│   ├── lineage/                # 谱系、人丁、世次
│   ├── content/                # 谱文
│   └── publishing/             # 谱书、编目
├── server/                     # 基础设施：db、auth、errors、logger、config
└── components/                 # 通用 UI 组件
```

M1 只有 6 个模块。`collab`（锁/回收站）与 `media`（上传）随对应功能一起进 M2。

### 4.2 模块职责与所有权

| 模块 | 拥有的表 | 对外导出 |
|---|---|---|
| `identity` | `organization_member`、`invite` | `requireOrgContext`、`orgMemberQuery` |
| `organization` | `organization` | `organizationService`、`organizationQuery` |
| `project` | `project`、`folder` | `projectQuery`、`folderQuery` |
| `lineage` | `lineage`、`node` | `lineageQuery`、`lineageService`、`nodeService` |
| `content` | `article` | `articleQuery`、`articleService` |
| `publishing` | `book`、`book_catalog` | `bookQuery`、`catalogService` |

每张表有且只有一个 owner。**跨模块读数据必须调对方导出的 query，禁止直接 join 别人的表。**

### 4.3 模块依赖方向

```
        ┌────────────────────────────────────────┐
        │  server（db / auth / errors / logger）  │  ← 所有模块可用
        └───────────────────┬────────────────────┘
                            │
        ┌───────────────────┴───────────────────┐
        ▼                                       ▼
   identity                              organization
        └───────────────────┬───────────────────┘
                            ▼
                        project
                 ┌──────────┴──────────┐
                 ▼                     ▼
             lineage                content
                 └──────────┬──────────┘
                            ▼
                       publishing
```

依赖只允许**向下**。`lineage` 不能 import `publishing`；`publishing` 可以 import `lineage`（编目要引用谱系）。

### 4.4 三层职责

每个模块内部固定三层：

| 层 | 文件 | 职责 | 禁止 |
|---|---|---|---|
| 适配层 | `app/**/page.tsx`、`actions.ts`、`route.ts` | 解析输入、调 service、格式化输出 | 写业务规则、直接查库 |
| 服务层 | `*.service.ts` | 业务规则、事务边界、权限校验 | import `next/*`、拼 SQL |
| 仓储层 | `*.repo.ts` | SQL、映射到领域对象 | 业务判断 |

`service.ts` 里出现 `import { cookies } from 'next/headers'` 是**架构违规**，目标设计用 Biome 的 `noRestrictedImports` 规则拦截，配合代码评审与测试约束（当前仓库已用 Biome，但尚未配置该规则，见 [实现状态](./implementation-status.md)）。

---

## 5. 运行时视图

### 5.1 读请求（RSC）

```
GET /{orgSlug}/{projectSlug}/lineages/{lineageId}
  │
  ├─ proxy.ts           验签会话 Cookie，剩余 < 6h 时滑动续期
  ├─ [orgSlug]/layout  解析组织 → 查 organization_member → 注入 OrgContext
  ├─ [projectSlug]/layout  解析项目（组织内）
  ├─ page.tsx          lineageQuery.getGraph(ctx, lineageId)
  │     └─ withOrg()   SET LOCAL ROLE app_rw + 注入 claims
  │           └─ repo  SELECT ... WHERE organization_id = $1（RLS 兜底）
  └─ RSC 直出 HTML
```

**没有客户端数据请求**。内部 UI 的读操作全部在服务端完成，客户端组件只接收已序列化的 props。

### 5.2 写请求（Server Action）

```
用户提交表单
  │
  ├─ action.ts        Zod 校验 → 得到 input
  ├─ requireOrgContext(orgSlug)   未登录 401 / 非成员 404
  ├─ assertPermission(ctx, 'xxx.write')
  ├─ withOrg(ctx, tx => ...)
  │    └─ xxxService.xxx(tx, ctx, input)      业务
  ├─ revalidateTag(`lineage:${id}`)
  └─ return { ok: true, data }       失败返回 { ok: false, error }
```

M1 只有两步：**业务 → 失效缓存**。M2 引入编辑锁后，前面会插入「锁校验」一步。

M1 **不写审计表**：关键业务动作写结构化日志，作为运维追溯入口（[data-model §9](./data-model.md#9-审计与追溯)）。

### 5.3 组织解析

URL 是组织的唯一来源。

```typescript
export async function requireOrgContext(orgSlug: string): Promise<OrgContext> {
  // 验签 JWT → auth.get_session_user(sub)：校验 token_version 与 deleted_at
  const user = await requireUser();

  const membership = await withOrg({ userId: user.id }, (tx) =>
    orgMemberQuery.findByOrgSlug(tx, user.id, orgSlug),
  );
  if (!membership) throw new NotFoundError('organization', orgSlug);

  return {
    userId: user.id,
    organizationId: membership.organizationId,
    organizationSlug: orgSlug,
    role: membership.role,
  };
}
```

| 特性 | 说明 |
|---|---|
| 无状态 | 不存 Cookie、不存 session 变量。多标签页天然一致 |
| 可分享 | 链接发给同事，对方看到的组织与发送者一致 |
| 切换成本 | 切换组织 = 点一个 `<Link>`，无 Action、无 `revalidate` |
| 失败语义 | 非成员返回 **404** 而不是 403，避免泄露组织是否存在 |

### 5.4 注册与默认组织

注册由应用层发起、数据落在自建 `auth.users`，组织创建必须放在**数据库触发器**里，这是唯一能保证「有账号必有组织」的位置。

```
用户提交邮箱密码
  │
  ├─ Zod 校验 + bcrypt 哈希
  ├─ auth.sign_up()                     SECURITY DEFINER 函数
  │    └─ INSERT INTO auth.users
  ├─ 触发器 handle_new_user()          ← 同一事务
  │    ├─ INSERT organization（slug = 'u-' + user_id 前 12 位 hex）
  │    └─ INSERT organization_member（role = owner）
  ├─ 立即签发 JWT、写 session Cookie
  └─ 直接进入 /{默认组织 slug}
```

| 关注点 | 处理 |
|---|---|
| 原子性 | 触发器与 `auth.users` 插入在同一事务。组织建失败 → 注册失败，不产生半残账号 |
| 绕过 RLS | 触发器函数是 `SECURITY DEFINER`，属主为迁移/超级用户，可写受 RLS 保护的表 |
| `search_path` | 函数上强制 `SET search_path = public`，防注入 |
| 幂等 | 一个 `auth.users` 行只触发一次 |
| 可改 | 组织名与 slug 都可由 owner 修改（FR-ORG-7） |
| 无验证邮件 | 注册成功即登录；不存在「等待验证」状态 |

详见 [data-model §4.4](./data-model.md#44-注册触发器默认组织)。

### 5.5 并发编辑（M1 不做保护）

M1 **没有编辑锁**。两个用户同时打开同一谱系并保存，后提交的覆盖先提交的。

```
T0  用户 A 打开谱系，载入节点 #5 的姓名「元英」
T1  用户 B 打开谱系，把 #5 的姓名改成「元瑛」并保存
T2  用户 A 把 #5 的生卒年填上并保存 → 提交的是整行，姓名被写回「元英」
T3  结果：B 的修改丢失
```

| 阶段 | 机制 |
|---|---|
| M1 | 无保护。UI 提示「建议一人编辑完再换人」 |
| M2 | 资源锁（`resource_lock` + fencing token），编辑期独占 |
| 触发提前 | 客户反馈覆盖问题影响使用时，把锁提前到 M2 首批 |

这是 PRD §6.3 的缺口 3，是**已知并接受**的风险，不是遗漏。

---

## 6. 前端架构

### 6.1 渲染策略

| 页面类型 | 策略 | 理由 |
|---|---|---|
| 登录 / 邀请接受 | SSR（动态） | 需要会话 |
| 内部页面 | RSC 动态渲染 | 数据强一致，无 loading 闪烁 |
| 谱系画布 | 客户端组件 | 需要交互与视口计算 |

M1 **没有公开页面**（没有落地页、定价页、分享页），所以不需要 SSG/CDN 与「公开页 + 缓存头」这一层设计。这些页面最早在 M2 引入分享时再补。

### 6.2 状态管理

| 状态类型 | 方案 |
|---|---|
| 服务端数据 | RSC props 传入，`revalidateTag` 失效 |
| 表单 | React Hook Form + Zod |
| 乐观更新 | `useOptimistic`（仅用于排序、改名等可回滚操作） |
| 画布视口 | 本地 `useState` + `useRef`，不入全局 |
| 全局 UI 状态 | 无。**不引入 Redux / Zustand** |

### 6.3 谱系画布

| 关注点 | 方案 |
|---|---|
| 渲染 | `@xyflow/react`（React Flow）受控画布 |
| 布局 | `d3-hierarchy` 计算坐标，**不用内置 dagre** |
| 大数据 | `onlyRenderVisibleElements` + 按代分段加载 |
| 节点组件 | 自绘，不用 React Flow 默认节点（样式与信息密度不可控） |
| 连线 | 自定义 bezier，配偶用虚线横连 |
| 状态同步 | 画布状态由 URL + props 决定，画布自身不持有数据源 |

**布局为什么在 React Flow 之外算**：React Flow 的定位是「交互 + 渲染」，布局算法换过一次（dagre → d3-hierarchy）。把布局抽出去，换算法不动画布代码，也方便在服务端预计算初始坐标。

### 6.4 组件分层

```
components/
├── ui/            基础组件（Button / Input / Dialog），来自 shadcn/ui
├── form/          表单域组件，绑定 RHF
├── layout/        页面骨架、侧栏、面包屑
└── domain/        领域组件（LineageCanvas、NodeCard、CatalogTree）
```

`components/ui` 之外不允许直接写 Tailwind 原子类拼组件——先看 `ui/` 里有没有。

---

## 7. 后端架构

### 7.1 分层与依赖规则

```
route.ts / actions.ts  →  *.service.ts  →  *.repo.ts  →  db
        (适配)              (业务)          (SQL)
```

| 规则 | 强制方式 |
|---|---|
| `service.ts` 不得 import `next/*` | Biome `noRestrictedImports` + 评审 |
| `repo.ts` 不得 import `*.service.ts` | Biome `noRestrictedImports` + 评审 |
| 只有 `repo.ts` 能 import `src/server/db` | Biome `noRestrictedImports` + 评审 |
| 跨模块只能 import 对方 `index.ts` 导出的内容 | Biome `noRestrictedImports` |
| `server-only` 模块不得被客户端组件引用 | `server-only` 包 |

### 7.2 事务边界

**一个 Server Action = 一个事务。** 事务在 `withOrg` 里开，service 不自己开事务，避免嵌套。

跨模块的写操作共享同一个 `tx`：编目引用谱系时，`catalogService` 拿到的是 `publishing` 模块的 `tx`，通过参数传递，不新建事务。

### 7.3 数据访问

| 场景 | 方式 |
|---|---|
| 单表查询 | Drizzle Query Builder |
| 复杂查询（ltree、窗口函数） | `sql` 模板 + 手写 SQL |
| 批量插入 | `db.insert().values([...])`，单条语句 |
| 行锁 | `SELECT ... FOR UPDATE` 写在 repo 内 |

**禁止 N+1**：列表页的关联数据必须用 `with`（Drizzle relations）或一次 `IN` 查询。Code review 检查项。

### 7.4 接口形态

| 通道 | 用途 | 数量 |
|---|---|---|
| RSC | 内部读 | 全部页面 |
| Server Action | 内部写 | 全部写操作 |
| Route Handler | 健康检查 | **1 个** |

---

## 8. 数据架构

### 8.1 存储模型

| 数据 | 位置 | 说明 |
|---|---|---|
| 结构化数据 | PostgreSQL 18+ | 10 张业务表 + `auth.users` |
| 富文本 | PostgreSQL `jsonb` | ProseMirror 文档 |
| 会话 | `session` Cookie（jose JWT HS256） | 应用签发与校验；`token_version` 撤销 |
| 图片字节 | 无对象存储 | M1 不上传媒体，M2 再定 |

### 8.2 隔离

三层防护，缺一不可：

| 层 | 机制 |
|---|---|
| 应用层 | 所有查询 `WHERE organization_id = $1` |
| 数据库层 | RLS `organization_isolation`，`FORCE ROW LEVEL SECURITY` |
| Schema 层 | 复合外键 `(organization_id, project_id)` 阻止跨组织引用 |

RLS 策略基于 `organization_member` 子查询，**组织不写进 JWT**。详见 [data-model §12](./data-model.md#12-隔离与-rls)。

### 8.3 连接

| 项 | 值 |
|---|---|
| 驱动（本地） | `postgres.js` + `drizzle-orm/postgres-js`；直连 `localhost:5432`，无 pooler，可用默认 prepared statements |
| 驱动（生产） | `pg` 的 `Pool` + `drizzle-orm/node-postgres`；模块级单例，并调用 `@vercel/functions` 的 `attachDatabasePool` |
| 连接方式 | `POSTGRES_URL` 指向 Neon pooled endpoint |
| 连接数 | 生产每个 Vercel 函数实例 pool = 1–5 |
| 直连 | 迁移、备份与运维使用 `POSTGRES_URL_DIRECT`（Neon direct） |
| 迁移 | CI 里用直连 URL，与应用运行期分离 |
| 类型边界 | 驱动工厂导出 `db` 与 `Db` 类型；仓储层只 import 这两者，不直接 import `pg` 或 `postgres` |

`postgres.js` 只在本地使用；生产不要用它连接 Neon 事务池，也不需要为生产设置 `prepare: false`。`pg` 默认不创建命名 prepared statements，与 pooled endpoint 兼容。

### 8.4 一致性策略

| 数据 | 策略 |
|---|---|
| 人丁数展示 | 读 `lineage.node_count`（冗余计数），写入时同事务维护 |
| 编目引用 | 真外键 + `ON DELETE RESTRICT` |
| 树路径 | 写入时重算受影响子树（移动节点时批量 `UPDATE ... SET path = ...`） |
| 软删分组 | 同一事务的所有软删行共享 `deleted_at`（`now()` 取事务开始时间），供运维整组恢复 |

---

## 9. 横切关注点

### 9.1 配置

全部来自环境变量，启动时用 Zod 校验，缺一个就拒绝启动。

```typescript
// src/server/config.ts
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  POSTGRES_URL: z.string().url(),
  POSTGRES_URL_DIRECT: z.string().url().optional(),
  AUTH_SECRET: z.string().min(32),
  BASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});
export const config = schema.parse(process.env);   // 失败即崩，不带病运行
```

完整变量表与各环境取值见 [部署蓝图 §3](./ops-target.md#3-目标环境变量)。

代码中**禁止出现 `process.env`**，只能 `import { config }`。

### 9.2 错误

类型化错误层级 + 双序列化出口：

| 出口 | 格式 | 用于 |
|---|---|---|
| Server Action | `{ ok, data } \| { ok, error }` 判别联合 | 全部写操作 |
| Route Handler | RFC 9457 `application/problem+json` | `/api/health` 的 503 |

Server Action 不 throw：throw 会被框架转成 500 错误页，UI 无法区分「同名冲突」和「校验失败」。详见 [api §4](./api.md#4-错误模型)。

### 9.3 日志

结构化 JSON，每条带 `request_id`、`organization_id`、`user_id`。

| 级别 | 用途 |
|---|---|
| `error` | 需要人工介入（未预期异常、外部服务失败） |
| `warn` | 可预期但值得关注（校验失败、引用冲突、权限不足） |
| `info` | 关键业务动作（组织创建、成员变更） |
| `debug` | 仅开发环境 |

**禁止 `console.log`**，Biome 规则拦截。M1 不建审计表；结构化日志是唯一的运维追溯来源，关键业务动作写 `info`。

### 9.4 安全

| 项 | 措施 |
|---|---|
| 认证 | 自建：bcrypt 校验密码，jose 签发/验签 HS256 JWT |
| 会话 | `session` Cookie：HttpOnly + Secure + SameSite=Lax；`proxy.ts` 滑动续期；`getUser()` 校验 `token_version` 与 `deleted_at` |
| 密码变更 | 验证旧密码 → `token_version + 1` → 当前会话重签，其他设备立即失效 |
| CSRF | Server Action 自带 Origin 校验；唯一 Route Handler 是 GET |
| 输入校验 | 所有 Action 入口 Zod，不信任客户端 |
| 越权 | RLS + `assertPermission` + 复合外键 |
| 登录防护 | 进程内滑窗限流（同一来源 + 账号），统一错误文案防账号枚举；不做持久化账号锁定 |
| 密钥 | `AUTH_SECRET`（≥ 32 字节）只在服务端环境变量，永不进客户端 |
| 软删数据 | 界面不可见，但库内保留；运维恢复需工单 |

M2 引入分享页时，必须补「在世人口脱敏在服务端完成」这一条。

### 9.5 可观测性

| 项 | 方案 |
|---|---|
| 错误聚合 | 无外部服务；未预期异常写 `error` 级结构化日志，带 `request_id`，由 Vercel 日志收集 |
| 性能 | 从日志的 `duration_ms` 按路由聚合 p95 |
| 业务指标 | 关键动作写结构化日志，不建独立埋点表与审计表 |
| 存活探针 | `GET /api/health`，检查数据库连通性 |

---

## 10. 部署拓扑

```
            ┌──────────────────────────┐
  用户 ────▶│  Vercel                  │  自定义域名、TLS、CDN
            │  Next.js + /api/health   │  多实例无状态
            └────────────┬─────────────┘
                         │ pg.Pool + attachDatabasePool（pooled）
                         ▼
            ┌──────────────────────────┐
            │  Neon PostgreSQL 18+     │  托管，与函数同区域
            └──────────────────────────┘
```

| 项 | 配置 |
|---|---|
| 应用实例 | Vercel Functions，按请求伸缩 |
| 部署方式 | Git push → Vercel 构建部署；支持即时回滚到上一版本 |
| 域名 | Vercel 自定义域名 + 自动 TLS；`BASE_URL` 使用正式域名 |
| 静态资源 | Vercel CDN，`/_next/static` 长缓存 |
| 数据库 | Neon PostgreSQL 18+（PITR / 分支） |
| 备份 | Neon PITR；另可 `pg_dump --schema=public --schema=auth --schema=drizzle` 导出 |
| 本地开发 | Docker 只跑 PostgreSQL，应用用 `next dev` |

---

## 11. 质量属性与验证

| 属性 | 目标 | 验证方式 |
|---|---|---|
| 隔离 | 跨组织查询 0 行 | 集成测试，`app_rw` 无 claims 执行查询 |
| 注册完整性 | 有账号必有组织 | 集成测试：注册后断言 1 条 owner 成员关系 |
| 性能（画布） | 1000 节点 ≥ 45fps | Playwright + `performance` API 采样 |
| 性能（页面） | 内部页面 TTFB < 400ms | 结构化日志 `duration_ms` p95 |
| 可用性 | 月度 99.5% | 外部探针 5 分钟一次 |
| 可维护性 | 单文件 ≤ 400 行，函数 ≤ 50 行 | Biome 规则 + 代码评审 |
| 可测试性 | service 层单测覆盖率 ≥ 70% | Vitest coverage |
| 关键路径 | 注册 → 建谱系 → 录入人丁可用 | Playwright E2E |
| 恢复 | RPO ≤ 1 天，RTO ≤ 4 小时 | 每季度一次恢复演练 |

---

## 12. 演进路线

| 阶段 | 范围 | 架构影响 |
|---|---|---|
| **M1**（当前） | 录入、编目、成员、默认组织 | 本文档描述的全部 |
| M2 | 谱书预览与分享、回收站、编辑锁、媒体上传、版式设置 | 加 4 张表（`share_link`、`delete_batch`、`resource_lock`、`media`）+ `collab` / `media` 两个模块 + 第 2 个 Route Handler |
| M3 | PDF 排版成书、导出 | 加 `edition` 表 + 排版服务；渲染进程独立部署（Vercel 之外），不进入主应用运行时 |
| M4 | 手机验证码 / OAuth、邮件通道与密码找回、实时协同、OCR | 邮件通道引入第三方投递依赖；实时协同需 CRDT 或 OT |

### 12.1 条件触发

| 触发条件 | 引入什么 |
|---|---|
| 客户反馈编辑覆盖影响使用 | 把编辑锁从 M2 提前 |
| 某查询 p95 > 200ms 且 QPS > 50 | 引入缓存层 |
| `node` 单表 > 500 万行或搜索 p95 > 300ms | 引入外部搜索索引 |
| 单模块团队 > 3 人，或单模块部署频率影响其他模块 | 拆服务 |

**M3 的排版为什么必须独立进程**：Chromium 常驻内存 300MB+，与主应用同进程会把主应用的 GC 压力和 OOM 风险放大一个量级。这是「何时该有第二个运行时」的唯一明确触发条件。

---

## 13. 架构决策记录

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| ADR-01 | 架构风格 | 模块化单体，单一 Next.js 应用 | 1–3 人团队；应用与数据库都托管，微服务的运维成本远超收益 |
| ADR-02 | 前后端边界 | RSC 直读 + Server Action，不做 REST | 省一层契约维护；内部 UI 无需对外接口 |
| ADR-03 | 对外接口 | 仅 `/api/health` | M1 没有外部消费者 |
| ADR-04 | 组织模型 | org + project 两级，URL 驱动解析 | URL 即状态，切换组织零成本；`project` 只是分组 |
| ADR-05 | 默认组织 | 数据库触发器在 `auth.users` 插入时创建 | 注册写账号与建组织必须同一事务，只有触发器能保证「有账号必有组织」 |
| ADR-06 | 隔离机制 | RLS + 应用层 WHERE + 复合外键 | 单层可被绕过，三层互为兜底 |
| ADR-07 | 组织来源 | 查 `organization_member`，不入 JWT | 换 token 要重签，改权限要等过期 |
| ADR-08 | 树存储 | 邻接表 + `ltree` 物化路径 | 祖先/后代查询一次索引扫描；配偶不入路径 |
| ADR-09 | 删除 | 软删，但 M1 无回收站界面 | 软删是零成本保险；恢复 UI 可后补，数据没了补不回来 |
| ADR-10 | 并发 | **M1 不做锁**，last-write-wins | 锁需要表 + 心跳 + fencing + UI 只读态，M1 冲突概率低 |
| ADR-11 | 邮件与邀请 | **M1 无邮件通道**，邀请走手动复制的一次性链接；密码靠登录态修改 | 邮件投递与模板是额外运维面；M1 用户是小团队，链接可当面或即时通讯传递 |
| ADR-12 | 富文本 | ProseMirror JSON，不存 HTML | 结构可校验、可迁移、可服务端渲染 |
| ADR-13 | 检索 | `pg_trgm` + ILIKE | PG 无中文分词器，trigram 对中文子串可用 |
| ADR-14 | 主键 | UUIDv7，PostgreSQL 18 原生 `uuidv7()` 生成 | 时间有序、索引友好；数据库内置，应用层与扩展都不需要 |
| ADR-15 | 后台任务 | 零个 | 无清理需求；邀请过期靠查询判断 |
| ADR-16 | 渲染管线 | M1 不做，M3 独立进程 | Chromium 内存特性不适合与主应用同进程 |
| ADR-17 | 认证 | 自建：bcrypt + jose HS256 + `session` Cookie + `token_version` | 无外部 IdP；会话撤销靠版本号，改密即时踢掉其他设备 |
| ADR-18 | 部署 | Vercel + Neon；本地 Docker 只跑 PostgreSQL + `next dev` | 无专职运维；托管 Next.js 与 PostgreSQL，本地开发保持最简 |
| ADR-19 | 数据库驱动 | 本地 `postgres.js`；生产 `pg` 的 `Pool` + `attachDatabasePool` | 本地轻量、API 简洁；生产按 Vercel 官方方式管理连接生命周期，避免实例回收时泄漏连接 |

---

## 14. 已知技术风险

| # | 风险 | 影响 | 应对 |
|---|---|---|---|
| R1 | Neon 项目低于 PostgreSQL 18 | 建表与插入直接失败（无 `uuidv7()`） | 创建项目时选 18+；部署前置自检 `SELECT uuidv7();` |
| R2 | React Flow 1000+ 节点帧率 | 核心体验 | Phase 0 第二项验证；不达标则降级为「按代折叠」 |
| R3 | **无编辑锁导致并发覆盖** | 用户数据被旧内容覆盖 | UI 提示 + 帮助文档；客户反馈强烈时把锁提前到 M2 首批 |
| R4 | **无回收站，误删需运维恢复** | 恢复依赖人工，有响应延迟 | 软删兜底 + 运维手册（data-model §11.3）+ 恢复工单 |
| R5 | 注册触发器失败导致注册失败 | 新用户无法注册 | 触发器极简（2 条 INSERT）；集成测试覆盖；失败即回滚，不产生半残账号 |
| R6 | `AUTH_SECRET` 泄露或轮换不当 | 会话可被伪造，或全量用户被登出 | 仅存服务端环境变量；轮换即全量登出，作为可接受的应急操作 |
| R7 | **无自助密码找回** | 忘记密码只能人工重置 | 运维手册：验证身份后置临时密码并 `token_version + 1`；邮件通道进 M4 |
| R8 | auth SECURITY DEFINER 函数授权错误 | 密码哈希泄露或 `app_rw` 越权 | 显式 `GRANT`/`REVOKE` 矩阵；集成测试断言 `app_rw` 不能直接读 `auth.users` |
| R9 | `ltree` 深度上限 65535，单节点 label 长度受限 | 超深谱系（>200 代）无法表达 | 现实中不存在；文档记录上限 |
| R10 | 软删数据永不清理，长期膨胀 | 存储成本、查询变慢 | 十万级数据量下 2 年约 30MB；超过 500 万行再评估归档 |
| R11 | Vercel 或 Neon 服务故障 / 函数冷启动 | 请求延迟或短时不可用 | 依赖托管状态页；关键操作重试；Vercel 即时回滚 |
| R12 | 无客户自助导出 | 数据主权争议 | 合同约定 + 手工 `pg_dump` 兜底 |
| R13 | Serverless 多实例耗尽 Neon 连接数 | 新请求无法连接数据库 | 使用 pooled endpoint；每实例 pool = 1–5；生产用 `attachDatabasePool` 释放空闲连接；监控连接数 |
| R14 | Vercel 函数执行时长超限 | 长请求被中断 | M1 无长任务；批量写上限 500 行；超时前完成响应 |
| R15 | 登录限流只存在于进程内 | Vercel 多实例下失败计数不共享，暴力尝试可分散到不同实例 | 接受为 best-effort；配合强密码策略；需要严格锁定时再引入持久化计数或上游防护 |
